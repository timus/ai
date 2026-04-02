/**
 * vectorStore.js — In-memory vector store with cosine similarity search.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  WHAT IS A VECTOR STORE?                                        │
 * │                                                                 │
 * │  A vector store is a database that holds text chunks alongside  │
 * │  their embedding vectors. At query time it finds the chunks     │
 * │  whose vectors are closest to the query vector.                 │
 * │                                                                 │
 * │  This file implements the simplest possible version:            │
 * │    • Store: a plain JavaScript array of objects                 │
 * │    • Search: loop over every stored vector and compute cosine   │
 * │      similarity against the query vector, return top-k          │
 * │                                                                 │
 * │  This is called a "linear scan" or "flat index". It is O(n)     │
 * │  — every search looks at every document. Fast enough for        │
 * │  hundreds or low thousands of listings.                         │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * HOW DOES COSINE SIMILARITY WORK?
 *
 *   Two vectors are "similar" if they point in roughly the same direction,
 *   regardless of their magnitude (length). Cosine similarity measures
 *   the angle between them:
 *
 *     cos(θ) =  (A · B)         ← dot product of the two vectors
 *              ─────────────    ─────────────────────────────────
 *              |A| × |B|        ← product of their lengths (magnitudes)
 *
 *   Result is always between -1 and +1:
 *     1.0  — identical direction (identical meaning)
 *     0.7  — similar (related topic)
 *     0.0  — perpendicular (unrelated)
 *    -1.0  — opposite direction (rare for text embeddings)
 *
 *   In practice, property listing scores look like:
 *     0.85+  — very strong match (e.g. "3 bed house" vs a 3 bed house listing)
 *     0.70   — moderate match  (same suburb, different type)
 *     0.55   — weak match      (same state, very different property)
 *
 * WHY NOT USE A "REAL" VECTOR DATABASE?
 *
 *   Pinecone, pgvector, Chroma, Weaviate, Qdrant — all do the same thing
 *   as this file, but with indexing (HNSW, IVF) that makes search O(log n)
 *   instead of O(n). For hundreds of listings a linear scan is fine and
 *   keeps the code simple and transparent.
 *
 * PERSISTENCE:
 *
 *   Embeddings are expensive to compute (API call, money). We compute them
 *   ONCE in prepare-data.js and save to disk as JSON. The chatbot loads
 *   the file at startup — no API call, instant load, zero cost.
 */

import { readFileSync, writeFileSync } from 'fs';

export class VectorStore {
  constructor() {
    /**
     * The main store: an array of document objects.
     * Each document looks like:
     *   {
     *     id:        string          — unique listing ID
     *     text:      string          — the chunk text that was embedded
     *     embedding: number[]        — 1,536 floats from OpenAI
     *     metadata:  object          — structured fields for filtering
     *                                  (beds, price, suburb, type, url, ...)
     *   }
     */
    this.docs    = [];

    /**
     * Which suburbs are loaded in this store.
     * Used by the chatbot to tell users what data is available.
     * Example: ['Seven Hills', 'Toongabbie']
     */
    this.suburbs = [];

    /**
     * Nearby suburb data scraped from Domain.com.au.
     * Domain includes a list of surrounding suburbs on each search page.
     * We use this to suggest alternatives when the user asks about a
     * suburb we haven't indexed.
     *
     * Shape: { [slug]: [{ name, slug }, ...] }
     * Example: { 'seven-hills-nsw-2147': [{ name: 'Toongabbie', slug: 'toongabbie-nsw-2146' }] }
     */
    this.nearby  = {};
  }

  /**
   * Add a single document to the store.
   *
   * @param {string}   id         — unique identifier (listing ID from Domain)
   * @param {string}   text       — the text that was embedded (chunk text)
   * @param {number[]} embedding  — the 1,536-dimensional vector
   * @param {object}   metadata   — structured fields for post-retrieval filtering
   */
  add(id, text, embedding, metadata = {}) {
    this.docs.push({ id, text, embedding, metadata });
  }

  /**
   * Add multiple documents at once.
   *
   * chunks[i] is the text chunk, embeddings[i] is its vector.
   * The arrays must be the same length and in the same order.
   * This is the typical path from prepare-data.js.
   */
  addMany(chunks, embeddings) {
    for (let i = 0; i < chunks.length; i++) {
      this.add(chunks[i].id, chunks[i].text, embeddings[i], chunks[i].metadata ?? {});
    }
  }

  /**
   * Semantic search: find the top-k most relevant documents.
   *
   * Steps:
   *   1. For each stored document, compute cosine similarity between
   *      its embedding and the query embedding.
   *   2. Sort all documents by score, highest first.
   *   3. Return the top-k results.
   *
   * This is a linear scan — it looks at every document on every search.
   * With 200 listings this runs in <5ms. With 1 million listings you'd
   * want an HNSW index (what Pinecone / pgvector use under the hood).
   *
   * @param {number[]} queryEmbedding  — embedded version of the user's question
   * @param {number}   topK            — how many results to return
   * @returns Array of { id, text, metadata, score } sorted best-first
   */
  search(queryEmbedding, topK = 5) {
    return this.docs
      .map(doc => ({
        id:       doc.id,
        text:     doc.text,
        metadata: doc.metadata,
        // cosineSimilarity returns a number between 0 and 1
        // (1 = identical meaning, 0 = completely unrelated)
        score:    cosineSimilarity(queryEmbedding, doc.embedding),
      }))
      .sort((a, b) => b.score - a.score) // highest score first
      .slice(0, topK);
  }

  /** Total number of documents in the store. */
  get size()       { return this.docs.length; }

  /** Number of dimensions in each embedding vector (should be 1,536). */
  get dimensions() { return this.docs[0]?.embedding.length ?? 0; }

  // ── Persistence ───────────────────────────────────────────────────────────

  /**
   * Save the entire store to a JSON file.
   *
   * The embedding vectors are just arrays of numbers, so JSON.stringify
   * handles them directly. File size is roughly:
   *   docs × 1,536 floats × ~10 bytes per float ≈ 15KB per listing
   *   100 listings ≈ 1.5MB — small enough to load instantly at startup.
   *
   * Called by prepare-data.js after embedding all listings.
   */
  save(filepath) {
    const data = {
      suburbs: this.suburbs,
      nearby:  this.nearby,
      docs:    this.docs.map(d => ({
        id:        d.id,
        text:      d.text,
        metadata:  d.metadata,
        embedding: d.embedding, // plain float array — JSON serialisable
      })),
    };
    writeFileSync(filepath, JSON.stringify(data), 'utf-8');
  }

  /**
   * Load a saved store from a JSON file.
   *
   * This is called at chatbot startup. No API call, no cost — just
   * reading a file and parsing JSON. Typically takes <100ms even for
   * large files.
   *
   * Returns a fully populated VectorStore ready for search.
   */
  static load(filepath) {
    const data = JSON.parse(readFileSync(filepath, 'utf-8'));
    const store = new VectorStore();
    store.suburbs = data.suburbs ?? [];
    store.nearby  = data.nearby  ?? {};
    for (const d of data.docs) {
      store.add(d.id, d.text, d.embedding, d.metadata);
    }
    return store;
  }

  /**
   * Merge another store's documents into this one.
   *
   * Used by the chatbot to combine multiple suburb files into a single
   * searchable store. Loading two suburb files then merging gives you
   * cross-suburb search for free — the same cosine similarity loop
   * now covers all loaded suburbs at once.
   */
  merge(other) {
    for (const d of other.docs) {
      this.add(d.id, d.text, d.embedding, d.metadata);
    }
    for (const s of other.suburbs) {
      if (!this.suburbs.includes(s)) {
        this.suburbs.push(s);
      }
    }
    Object.assign(this.nearby, other.nearby);
  }
}

/**
 * Cosine similarity between two equal-length vectors.
 *
 * Formula:  cos(θ) = (A · B) / (|A| × |B|)
 *
 * Step by step:
 *   dot  = sum of (A[i] × B[i]) for all i   ← dot product
 *   magA = sqrt(sum of A[i]²)                ← magnitude of A
 *   magB = sqrt(sum of B[i]²)                ← magnitude of B
 *
 * Dividing by the magnitudes normalises for vector length, so we're
 * measuring the ANGLE between the vectors rather than their distance.
 * This works better for text embeddings where the magnitude of a vector
 * doesn't carry meaning — only its direction does.
 *
 * OpenAI's embedding vectors are already L2-normalised (|v| = 1.0), so
 * dividing by magnitudes is technically redundant here, but we keep it
 * for correctness and clarity.
 *
 * Returns a value between 0 and 1 for typical text embeddings.
 * (Technically between -1 and +1, but text embeddings rarely go negative.)
 */
function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i]; // accumulate dot product
    magA += a[i] * a[i]; // accumulate squared magnitude of A
    magB += b[i] * b[i]; // accumulate squared magnitude of B
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
