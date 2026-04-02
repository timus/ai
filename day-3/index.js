/**
 * index.js — Day 3: AI Agent with Tool Use
 *
 * This is the entry point. It:
 *   1. Loads embedded property listings from disk (built by prepare-data)
 *   2. Starts an interactive CLI loop
 *   3. Passes each user message to the agent, which decides what tools to call
 *
 * Commands:
 *   Any message    → runs the agent (may trigger tool calls)
 *   show leads     → display all captured leads with sentiment scores
 *   show callbacks → display all callback requests
 *   quit           → exit
 */

import { createInterface } from 'readline';
import { readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

import { VectorStore }   from './src/vectorStore.js';
import { runAgent }      from './src/agent.js';
import { getAllLeads, getAllCallbacks } from './src/tools.js';
import { showTurnStats, showLeads, showCallbacks } from './src/display.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const EMBED_DIR  = join(__dirname, 'data/embeddings');

// ── Load vector store ─────────────────────────────────────────────────────

const store = new VectorStore();

if (existsSync(EMBED_DIR)) {
  const files = readdirSync(EMBED_DIR).filter(f => f.endsWith('.json'));
  for (const f of files) {
    store.merge(VectorStore.load(join(EMBED_DIR, f)));
  }
}

// ── Welcome ───────────────────────────────────────────────────────────────

console.clear();
console.log();
console.log('  ╔══════════════════════════════════════════════════════╗');
console.log('  ║   Day 3 — AI Agent: Property Lead Capture            ║');
console.log('  ╚══════════════════════════════════════════════════════╝');
console.log();

if (store.size === 0) {
  console.log('  ⚠  No property data found.');
  console.log('  Run first: npm run prepare-data -- --suburb toongabbie-nsw-2146');
  console.log();
} else {
  console.log(`  Loaded ${store.size} property listings across ${store.suburbs.join(', ')}`);
  console.log();
}

console.log('  The agent can search properties, capture your details,');
console.log('  arrange callbacks, and analyze conversation sentiment.');
console.log();
console.log('  Commands: show leads | show callbacks | quit');
console.log('  ─────────────────────────────────────────────────────');
console.log();

// ── Conversation loop ─────────────────────────────────────────────────────

// History holds only user/assistant pairs — not internal tool messages.
// Tool calls are ephemeral to each turn; the conversation context is preserved.
const history = [];
let   turnNumber = 0;

const rl = createInterface({ input: process.stdin, output: process.stdout });

function prompt() {
  rl.question('You: ', async (input) => {
    const q = input.trim();
    if (!q) { prompt(); return; }

    if (q.toLowerCase() === 'quit' || q.toLowerCase() === 'exit') {
      console.log('\n  Goodbye.\n');
      rl.close();
      return;
    }

    if (q.toLowerCase() === 'show leads') {
      const all = await getAllLeads();
      showLeads(all);
      prompt();
      return;
    }

    if (q.toLowerCase() === 'show callbacks') {
      const all = await getAllCallbacks();
      showCallbacks(all);
      prompt();
      return;
    }

    try {
      turnNumber++;
      const result = await runAgent(q, history, store);

      console.log();
      console.log(`Agent: ${result.reply}`);

      showTurnStats(result, turnNumber);

      // Only keep user/assistant pairs in history for context
      history.push({ role: 'user',      content: q });
      history.push({ role: 'assistant', content: result.reply });

    } catch (err) {
      console.error(`\n  Error: ${err.message}\n`);
    }

    prompt();
  });
}

prompt();
