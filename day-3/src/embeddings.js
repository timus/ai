/**
 * embeddings.js — OpenAI text embeddings wrapper.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  WHAT IS AN EMBEDDING?                                          │
 * │                                                                 │
 * │  An embedding is a way of turning text into numbers that a      │
 * │  computer can compare mathematically.                           │
 * │                                                                 │
 * │  OpenAI's text-embedding-3-small converts any text into a list  │
 * │  of 1,536 floating-point numbers (called a "vector"). The       │
 * │  numbers are chosen so that texts with similar meaning produce  │
 * │  vectors that point in the same direction in 1,536-dimensional  │
 * │  space.                                                         │
 * │                                                                 │
 * │  Example:                                                       │
 * │    "3 bed house with pool"  → [0.021, -0.043, 0.118, ...]       │
 * │    "three bedroom home, swimming pool" → [0.019, -0.041, ...]   │
 * │     ↑ nearly identical vectors — they mean the same thing       │
 * │                                                                 │
 * │    "commercial office space for lease" → [0.103, 0.287, ...]    │
 * │     ↑ very different vector — different topic                   │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * WHY DO WE NEED THIS?
 *   Keywords can't capture meaning. A search for "house with pool" won't
 *   match "home featuring swimming pool" with keyword matching. Embeddings
 *   make both produce similar vectors, so cosine similarity finds them.
 *
 * COST:
 *   text-embedding-3-small costs $0.02 per 1 million tokens.
 *   Embedding 100 property listings costs roughly $0.001 — less than a cent.
 *   Embeddings are computed ONCE in prepare-data and cached to disk.
 *   The chatbot loads them from disk — zero embedding cost at query time.
 *
 * DIMENSIONS:
 *   1,536 dimensions means each text becomes a list of 1,536 numbers.
 *   Higher dimensions = more nuance = better search quality.
 *   text-embedding-3-large has 3,072 dimensions but costs 10× more.
 *   For property search, 1,536 is more than enough.
 */

import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Which OpenAI embedding model to use.
 *
 * text-embedding-3-small — good balance of quality and cost.
 * text-embedding-3-large — higher quality, 10× more expensive.
 * text-embedding-ada-002 — older model, kept for backward compatibility.
 *
 * All models within the same family are compatible: you can embed your
 * knowledge base with one and query with the same model at any time.
 * You cannot mix models (e.g. embed with small, search with large).
 */
const EMBEDDING_MODEL = 'text-embedding-3-small';

/**
 * Number of dimensions in each embedding vector.
 *
 * Think of this as the "resolution" of the meaning representation.
 * 1,536 floats per text gives enough granularity to distinguish
 * subtle differences like "house with garden" vs "unit with courtyard".
 */
const DIMS = 1536;

/**
 * Cost per 1 million tokens for text-embedding-3-small.
 *
 * A "token" is roughly 4 characters or 0.75 words.
 * A typical property listing description is ~200 tokens.
 * 100 listings × 200 tokens = 20,000 tokens = $0.0004 to embed.
 */
const COST_PER_MILLION_TOKENS = 0.02; // $0.02 USD per 1M tokens

/**
 * Embed an array of texts in a single batched API call.
 *
 * Batching is important: sending 100 texts in one request is faster
 * and more efficient than 100 separate requests. OpenAI processes them
 * in parallel and returns results sorted by index.
 *
 * Returns:
 *   embeddings   — array of float arrays, one per input text, in order
 *   totalTokens  — how many tokens were processed (for cost tracking)
 *   cost         — USD cost of this call
 */
export async function embedTexts(texts) {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });

  // OpenAI may return results out of order — sort by index to guarantee
  // the output array matches the input array order.
  const embeddings = response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);

  const totalTokens = response.usage.total_tokens;
  const cost = (totalTokens / 1_000_000) * COST_PER_MILLION_TOKENS;

  return { embeddings, totalTokens, cost };
}

/**
 * Embed a single query string at search time.
 *
 * This is called for every user question in the chatbot. It converts
 * the question into a vector so we can compare it against the stored
 * listing vectors using cosine similarity.
 *
 * Cost: a typical question like "3 bed house under $900k" is ~15 tokens
 * = $0.0000003 per query — effectively free.
 *
 * Returns:
 *   embedding — float array (1,536 numbers)
 *   tokens    — tokens used
 *   cost      — USD cost
 *   dims      — number of dimensions (1,536)
 */
export async function embedQuery(text) {
  const { embeddings, totalTokens, cost } = await embedTexts([text]);
  return { embedding: embeddings[0], tokens: totalTokens, cost, dims: DIMS };
}

export { EMBEDDING_MODEL, DIMS, COST_PER_MILLION_TOKENS };
