#!/usr/bin/env node
/**
 * prepare-data.js — Scrape Domain listings, build a RAG knowledge base.
 *
 * Usage:
 *   npm run prepare-data -- --suburb toongabbie-nsw-2146
 *   npm run prepare-data -- --suburb seven-hills-nsw-2147
 *
 * What this script teaches:
 *   1. How raw web data becomes a structured knowledge base
 *   2. Why you chunk data the way you do (1 listing = 1 chunk)
 *   3. What an embedding actually costs and looks like
 *   4. Why you cache embeddings (skip re-embedding on next run)
 *
 * Output: data/embeddings/{slug}.json
 * The chatbot loads this file — no API cost on subsequent runs.
 */

import { existsSync, mkdirSync } from 'fs';
import { join, dirname }         from 'path';
import { fileURLToPath }         from 'url';
import 'dotenv/config';

import { scrapeSuburb }  from '../src/scraper.js';
import { chunkListings } from '../src/chunks.js';
import { embedTexts }    from '../src/embeddings.js';
import { VectorStore }   from '../src/vectorStore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = join(__dirname, '../data/embeddings');

// ── CLI args ──────────────────────────────────────────────────────────────

const args     = process.argv.slice(2);
const slugIdx  = args.indexOf('--suburb');
const slug     = slugIdx !== -1 ? args[slugIdx + 1] : null;
const maxIdx   = args.indexOf('--max-pages');
const maxPages = maxIdx !== -1 ? parseInt(args[maxIdx + 1]) : Infinity;

if (!slug) {
  console.log('\n  Usage: npm run prepare-data -- --suburb <domain-slug>');
  console.log('  Example slugs:');
  console.log('    toongabbie-nsw-2146');
  console.log('    seven-hills-nsw-2147');
  console.log('    chatswood-nsw-2067');
  console.log('    parramatta-nsw-2150\n');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function sep(title) {
  console.log();
  console.log(`  ── ${title} ${'─'.repeat(Math.max(0, 54 - title.length))}`);
  console.log();
}

function fmt(n) { return n.toLocaleString(); }

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.clear();
  console.log();
  console.log('  ╔══════════════════════════════════════════════════════╗');
  console.log('  ║   prepare-data — Building RAG Knowledge Base         ║');
  console.log('  ╚══════════════════════════════════════════════════════╝');
  console.log(`\n  Suburb slug: ${slug}`);
  console.log(`  Output:      data/embeddings/${slug}.json`);

  const outPath = join(DATA_DIR, `${slug}.json`);
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  // ── STEP 1: Scrape Domain ──────────────────────────────────────────────
  sep('STEP 1 — Scraping Domain.com.au');
  console.log('  Fetching listing pages from Domain.com.au...');
  console.log();
  console.log('  Note: scraping Domain.com.au directly — results may be incomplete');
  console.log('  if the site rate-limits or changes structure. A 1.5s delay is added');
  console.log('  between pages to be polite and avoid blocks.');
  console.log();

  const { suburb, nearby, listings, method } = await scrapeSuburb(slug, {
    maxPages,
    onPage: (page, count) => {
      console.log(`    Page ${page}: ${count} listings`);
    },
  });

  console.log(`\n  Total: ${listings.length} listings for ${suburb}  [via ${method}]`);
  if (method === 'fetch') {
    console.log('  Note: fetch mode gets ~50% of listings (Domain SSR-renders pages inconsistently).');
    console.log('  For full data: sudo apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2');
  }
  console.log(`  Nearby suburbs Domain knows about: ${nearby.map(s => s.name).join(', ')}`);

  if (listings.length === 0) {
    console.log('\n  No listings found. Check the suburb slug and try again.');
    process.exit(1);
  }

  // Show a sample listing (raw → structured)
  const sample = listings[0];
  console.log('\n  Sample listing (raw → structured):');
  console.log(`    Address:  ${sample.address}`);
  console.log(`    Type:     ${sample.type}`);
  console.log(`    Beds:     ${sample.beds}  Baths: ${sample.baths}  Cars: ${sample.cars}`);
  console.log(`    Price:    ${sample.displayPrice || '(contact agent)'}`);
  console.log(`    Land:     ${sample.landArea ? sample.landArea + sample.landUnit : 'n/a'}`);
  if (sample.features?.length) console.log(`    Features: ${sample.features.join(', ')}`);
  console.log(`    Headline: ${sample.headline?.slice(0, 80) || '(none)'}`);

  // ── STEP 2: Chunk ──────────────────────────────────────────────────────
  sep('STEP 2 — Converting listings to text chunks');
  console.log('  Each property becomes ONE chunk containing all its details.');
  console.log('  Why one chunk? Semantic search works best on complete, self-contained units.');
  console.log('  "3 bed house with pool" needs address + features + description together.\n');

  const chunks = chunkListings(listings);

  console.log(`  ${chunks.length} chunks created.`);
  console.log('\n  Chunk preview (what gets embedded):');
  console.log('  ┌─────────────────────────────────────────────────────');
  chunks[0].text.split('\n').forEach(line => {
    console.log(`  │ ${line}`);
  });
  console.log('  └─────────────────────────────────────────────────────');

  // ── STEP 3: Embed ──────────────────────────────────────────────────────
  sep('STEP 3 — Embedding chunks (text-embedding-3-small)');
  console.log('  Each chunk → 1,536 floating-point numbers (a vector).');
  console.log('  Chunks with similar meaning land CLOSE in 1,536-dimensional space.');
  console.log('  Your search query will also become a vector — distance = relevance.\n');
  console.log(`  Embedding ${chunks.length} chunks...`);

  const texts = chunks.map(c => c.text);
  const { embeddings, totalTokens, cost } = await embedTexts(texts);

  console.log(`  Done.`);
  console.log(`  Tokens used:    ${fmt(totalTokens)}`);
  console.log(`  Embedding cost: $${cost.toFixed(6)} USD`);
  console.log(`\n  First vector (first 8 of 1,536 dimensions):`);
  console.log(`  [${embeddings[0].slice(0, 8).map(v => v.toFixed(4)).join(', ')}, ...]`);

  // ── STEP 4: Save ───────────────────────────────────────────────────────
  sep('STEP 4 — Saving to disk');
  console.log('  Embeddings are cached so the chatbot loads them instantly.');
  console.log('  No API cost on subsequent runs — embeddings only computed once.\n');

  const store = new VectorStore();
  store.suburbs = [suburb];
  store.nearby  = { [slug]: nearby };
  store.addMany(chunks, embeddings);
  store.save(outPath);

  const fileSizeKb = Math.round(
    Buffer.byteLength(JSON.stringify({ docs: store.docs })) / 1024
  );

  console.log(`  Saved → data/embeddings/${slug}.json`);
  console.log(`  File size: ~${fileSizeKb} KB  (${chunks.length} chunks × 1,536 floats each)`);

  // ── STEP 5: What's next ────────────────────────────────────────────────
  sep('READY');
  console.log(`  ✓ ${listings.length} ${suburb} listings indexed`);
  console.log(`  ✓ Embeddings cached — chatbot runs with zero embedding cost`);
  console.log();
  console.log('  Add more suburbs:');
  nearby.slice(0, 3).forEach(s => {
    console.log(`    npm run prepare-data -- --suburb ${s.slug}`);
  });
  console.log();
  console.log('  Then start the chatbot:');
  console.log('    npm start');
  console.log();
}

main().catch(err => {
  console.error('\n  Error:', err.message);
  process.exit(1);
});
