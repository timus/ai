/**
 * index.js — Day 4: AI Agent with Persistent Memory
 *
 * The key difference from Day 3 is the startup sequence:
 *
 *   Day 3: loads vector store → starts conversation
 *   Day 4: loads vector store → asks for name → loads user from NEDB
 *          → injects profile into system prompt → starts conversation
 *
 * The conversation loop is identical to Day 3. Memory is injected once,
 * at the top of the system prompt, before the first API call.
 *
 * Commands:
 *   Any message       → runs the agent (may trigger tool calls)
 *   show leads        → display all captured leads with sentiment scores
 *   show callbacks    → display all callback requests
 *   show profile      → display the current user's preferences and session history
 *   show memory       → display the exact system prompt text injected this session
 *   quit              → exit
 */

import { createInterface } from 'readline';
import { readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

import { VectorStore }    from './src/vectorStore.js';
import { runAgent, getMemoryBlock } from './src/agent.js';
import { loadUserContext } from './src/memory.js';
import {
  getAllLeads,
  getAllCallbacks,
  getCurrentUser,
} from './src/tools.js';
import {
  showTurnStats,
  showLeads,
  showCallbacks,
  showMemoryContext,
  showMemoryBlock,
  showProfile,
} from './src/display.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EMBED_DIR = join(__dirname, 'data/embeddings');

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
console.log('  ║   Day 4 — AI Agent: Persistent Memory                ║');
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

console.log('  Commands: show leads | show callbacks | show profile | show memory | quit');
console.log('  ─────────────────────────────────────────────────────');

// ── Startup: identify user and load memory ────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

let userContext = null;

async function startup() {
  console.log();
  const name = (await ask('  Your name or phone (press Enter to skip): ')).trim();

  if (name) {
    userContext = await loadUserContext({ name });
  }

  showMemoryContext(userContext);

  startConversation();
}

// ── Conversation loop ─────────────────────────────────────────────────────

const history    = [];
let   turnNumber = 0;

function startConversation() {
  prompt();
}

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

    if (q.toLowerCase() === 'show profile') {
      // getCurrentUser() returns the currentUser set by identify_user tool;
      // fall back to the startup-loaded userContext if the tool hasn't fired yet
      const user = getCurrentUser() ?? userContext;
      showProfile(user);
      prompt();
      return;
    }

    if (q.toLowerCase() === 'show memory') {
      // Show the exact system prompt text the LLM receives this session.
      // This is the key teaching display — students can see the injection.
      const currentUser = getCurrentUser() ?? userContext;
      showMemoryBlock(getMemoryBlock(currentUser));
      prompt();
      return;
    }

    try {
      turnNumber++;

      // Pass userContext so buildSystemPrompt can inject the memory block.
      // After identify_user fires, tools.js has currentUser set, but the
      // system prompt for this turn is already built from startup userContext.
      const result = await runAgent(q, history, store, userContext);

      console.log();
      console.log(`Agent: ${result.reply}`);

      showTurnStats(result, turnNumber);

      history.push({ role: 'user',      content: q });
      history.push({ role: 'assistant', content: result.reply });

    } catch (err) {
      console.error(`\n  Error: ${err.message}\n`);
    }

    prompt();
  });
}

// ── Handle Ctrl+C gracefully ──────────────────────────────────────────────
// If the user quits abruptly, preferences are already saved by update_preferences.
// The session summary won't be saved — end_session must be called explicitly.
// In production you would trigger end_session here automatically.

process.on('SIGINT', () => {
  console.log('\n\n  Session ended without summary. Your preferences are saved.');
  console.log('  Tip: say "goodbye" before quitting so the agent saves a session summary.\n');
  process.exit(0);
});

// ── Start ─────────────────────────────────────────────────────────────────

startup();
