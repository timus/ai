/**
 * Day 2 — Property Guide Chatbot (RAG)
 *
 * Run `npm run prepare-data -- --suburb toongabbie-nsw-2146` first to build
 * the knowledge base, then `npm start` to launch the chatbot.
 *
 * Teaching what this session covers:
 *   1. Raw data → knowledge base  (prepare-data script)
 *   2. Vector DB + RAG             (this file)
 *   3. Prompt design for chatbot   (type "show prompt")
 *   4. Hallucination guard         (ask something not in the data)
 *   5. Token comparison            (stats shown after every turn)
 */

import readline  from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { readdirSync, existsSync }          from 'fs';
import { join, dirname }                    from 'path';
import { fileURLToPath }                    from 'url';
import 'dotenv/config';

import { VectorStore }  from './src/vectorStore.js';
import {
  retrieveListings,
  findNearbyLoaded,
  chat,
  showTurnStats,
  showChunks,
  showSystemPrompt,
  extractFilters,
  buildSystemPrompt,
} from './src/chatbot.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const EMBED_DIR  = join(__dirname, 'data/embeddings');

// ── Load all suburb embeddings ────────────────────────────────────────────

function loadAllStores() {
  if (!existsSync(EMBED_DIR)) return null;

  const files = readdirSync(EMBED_DIR).filter(f => f.endsWith('.json'));
  if (!files.length) return null;

  const combined = new VectorStore();
  for (const file of files) {
    const store = VectorStore.load(join(EMBED_DIR, file));
    combined.merge(store);
  }
  return combined;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.clear();
  console.log();
  console.log('  ╔══════════════════════════════════════════════════════╗');
  console.log('  ║   Day 2 — Property Guide Chatbot (RAG)               ║');
  console.log('  ╚══════════════════════════════════════════════════════╝');
  console.log();

  // ── Check data exists ─────────────────────────────────────────────────
  const store = loadAllStores();

  if (!store) {
    console.log('  No suburb data found. Run prepare-data first:\n');
    console.log('    npm run prepare-data -- --suburb toongabbie-nsw-2146');
    console.log('    npm run prepare-data -- --suburb seven-hills-nsw-2147');
    console.log();
    process.exit(1);
  }

  console.log(`  Knowledge base loaded:`);
  console.log(`    Suburbs:    ${store.suburbs.join(', ')}`);
  console.log(`    Listings:   ${store.size}`);
  console.log(`    Dimensions: ${store.dimensions}`);
  console.log();
  console.log('  Commands:');
  console.log('    Any question   ← property search via RAG');
  console.log('    show prompt    ← see the system prompt design');
  console.log('    show chunks    ← see retrieved listings + similarity scores');
  console.log('    tokens         ← see last turn token breakdown');
  console.log('    quit           ← exit');
  console.log();

  // ── Chatbot loop ──────────────────────────────────────────────────────
  const rl = readline.createInterface({ input, output });
  const history  = [];
  let turnNumber = 0;
  let lastChunks = [];
  let lastResult = null;

  // Opening message
  console.log(`  Agent: Hi! I'm your property guide. I have listings for ${store.suburbs.join(' and ')}.`);
  console.log(`         What are you looking for today?`);
  console.log();

  while (true) {
    const userInput = await rl.question('  You: ');
    const q = userInput.trim();
    if (!q) continue;

    // ── Special commands ────────────────────────────────────────────────
    if (q.toLowerCase() === 'quit' || q.toLowerCase() === 'exit') break;

    if (q.toLowerCase() === 'show prompt') {
      showSystemPrompt(buildSystemPrompt());
      continue;
    }

    if (q.toLowerCase() === 'show chunks') {
      if (lastChunks.length) showChunks(lastChunks);
      else console.log('\n  No chunks retrieved yet. Ask a question first.\n');
      continue;
    }

    if (q.toLowerCase() === 'tokens') {
      if (lastResult) showTurnStats(lastResult, turnNumber, lastChunks);
      else console.log('\n  No turn yet. Ask a question first.\n');
      continue;
    }

    // ── Check for suburb not in knowledge base ──────────────────────────
    const filters = extractFilters(q);
    if (filters.suburb) {
      const isLoaded = store.suburbs.some(s =>
        s.toLowerCase().includes(filters.suburb)
      );
      if (!isLoaded) {
        const nearby = findNearbyLoaded(filters.suburb, store);
        if (nearby.length) {
          console.log();
          console.log(`  Agent: I don't have listings for "${filters.suburb}".`);
          console.log(`         I do have data for: ${nearby.join(', ')}`);
          console.log(`         Shall I search there instead?`);
          console.log();
          continue;
        }
      }
    }

    // ── RAG pipeline ────────────────────────────────────────────────────
    turnNumber++;
    process.stdout.write('  Agent: [retrieving...]\r');

    lastChunks = await retrieveListings(q, store, 5);
    lastResult = await chat(q, lastChunks, history);

    console.log(`  Agent: ${lastResult.reply}`);
    showTurnStats(lastResult, turnNumber, lastChunks);

    history.push({ role: 'user',      content: q });
    history.push({ role: 'assistant', content: lastResult.reply });
  }

  console.log();
  console.log('  ─────────────────────────────────────────────────────────');
  console.log('  What you just used:');
  console.log('  • Real Domain.com.au listings → embedded into a vector store');
  console.log('  • Each question → embedding → cosine similarity → top listings');
  console.log('  • Only retrieved listings sent to LLM — not the entire database');
  console.log('  • Model refused to invent data not in the retrieved context');
  console.log();

  rl.close();
}

main().catch(err => {
  console.error('\n  Error:', err.message);
  process.exit(1);
});
