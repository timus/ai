/**
 * chatbot.js — Property guide chatbot using RAG.
 *
 * RAG pipeline per turn:
 *   1. User question → embed → 1,536-dimensional vector
 *   2. Cosine search → top-k most similar listing vectors
 *   3. Retrieved listings injected into the prompt as context
 *   4. LLM answers from that context only — cannot invent listings
 */

import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL  = 'gpt-4o-mini';

// gpt-4o-mini pricing — input and output billed separately
const INPUT_CPM  = 0.15;  // $ per 1M input tokens
const OUTPUT_CPM = 0.60;  // $ per 1M output tokens

function buildSystemPrompt() {
  return `You are a friendly and knowledgeable Australian property guide chatbot.

You help people find properties for sale. You have access to real listings scraped from Domain.com.au.

IMPORTANT RULES:
1. Only recommend properties that appear in the provided listings context.
2. Never invent addresses, prices, or property details. If you don't have matching listings, say so clearly.
3. If the user asks about a suburb you have no listings for, tell them which loaded suburbs are nearby and offer to search there.
4. If no listings match the filters (e.g. no 5-bed houses in Toongabbie), proactively suggest the nearest loaded suburb that does have matches.
5. Always include: full address, price, beds/baths/cars, property type, and a brief description when recommending a property.
6. For questions about interest rates, stamp duty, or market trends — say clearly that this is outside your data.

When you cannot find a match, say something like:
"I don't have any [criteria] in [suburb]. The closest suburb I have data for is [X], which has [N] matching properties."`;
}

function extractFilters(message) {
  const lower = message.toLowerCase();

  const bedMatch = lower.match(/(\d+)\s*(?:bed(?:room)?s?|br\b)/);
  const beds = bedMatch ? parseInt(bedMatch[1]) : null;

  const priceMatch = lower.match(/(?:under|max|budget|less than|up to)\s*\$?([\d.]+)\s*([mk]?)/);
  let maxPrice = null;
  if (priceMatch) {
    const val  = parseFloat(priceMatch[1]);
    const unit = priceMatch[2].toLowerCase();
    maxPrice   = unit === 'm' ? val * 1_000_000 : unit === 'k' ? val * 1_000 : val;
  }

  const suburbMatch = lower.match(/\bin\s+([a-z\s]+?)(?:\s+nsw|\s+vic|\s+qld|\?|$)/);
  const suburb = suburbMatch ? suburbMatch[1].trim() : null;

  return { beds, maxPrice, suburb };
}

import { embedQuery } from './embeddings.js';

export async function retrieveListings(query, store, topK = 5) {
  const { embedding } = await embedQuery(query);
  // Over-fetch then apply hard filters — gives filters enough candidates to work with
  const results = store.search(embedding, topK * 3);

  const filters = extractFilters(query);

  // Hard filters on structured fields (beds, price) are applied post-retrieval.
  // Property type is left to semantic search — the type text is inside each chunk
  // so cosine similarity naturally surfaces the right property types.
  let filtered = results;
  if (filters.beds) {
    filtered = filtered.filter(r => r.metadata.beds >= filters.beds);
  }
  if (filters.maxPrice) {
    filtered = filtered.filter(r => r.metadata.priceFrom > 0 && r.metadata.priceFrom <= filters.maxPrice);
  }
  if (filters.suburb) {
    filtered = filtered.filter(r => r.metadata.suburb?.toLowerCase().includes(filters.suburb));
  }

  // If hard filters eliminate everything, fall back to pure semantic results
  return filtered.length > 0 ? filtered.slice(0, topK) : results.slice(0, topK);
}

export function findNearbyLoaded(targetSuburb, store) {
  for (const [, nearbyList] of Object.entries(store.nearby)) {
    const match = nearbyList.find(n =>
      n.name.toLowerCase().includes(targetSuburb.toLowerCase())
    );
    if (match) {
      return store.suburbs.filter(s => s.toLowerCase() !== targetSuburb.toLowerCase());
    }
  }
  return [];
}

export async function chat(userMessage, retrievedChunks, history) {
  // Listings are appended to the USER message, not the system prompt.
  // This keeps the system prompt token-stable across turns while
  // the context (retrieved listings) stays fresh each time.
  const context = retrievedChunks.length > 0
    ? '=== AVAILABLE LISTINGS ===\n' +
      retrievedChunks.map((c, i) =>
        `[Listing ${i + 1} — similarity: ${c.score.toFixed(3)}]\n${c.text}`
      ).join('\n\n')
    : 'No listings matched your search criteria.';

  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    ...history,
    { role: 'user',   content: `${userMessage}\n\n${context}` },
  ];

  const response = await openai.chat.completions.create({ model: MODEL, messages });
  const reply    = response.choices[0].message.content;

  return {
    reply,
    promptTokens:     response.usage.prompt_tokens,
    completionTokens: response.usage.completion_tokens,
    cost: (response.usage.prompt_tokens / 1e6) * INPUT_CPM +
          (response.usage.completion_tokens / 1e6) * OUTPUT_CPM,
    systemPrompt: messages[0].content,
  };
}

function bar(value, max, width = 30) {
  const filled = max === 0 ? 0 : Math.round((value / max) * width);
  return '█'.repeat(Math.min(filled, width)) + '░'.repeat(Math.max(0, width - filled));
}

export function showTurnStats(result, turnNumber, retrievedChunks) {
  const max = Math.max(result.promptTokens, result.completionTokens, 500);

  console.log();
  console.log(`  ── Turn #${turnNumber} — Token Breakdown ${'─'.repeat(36)}`);
  console.log();
  console.log(`  Prompt tokens  [${bar(result.promptTokens,     max)}] ${String(result.promptTokens).padStart(5)}`);
  console.log(`  Reply tokens   [${bar(result.completionTokens, max)}] ${String(result.completionTokens).padStart(5)}`);
  console.log();
  console.log(`  What's inside the ${result.promptTokens} prompt tokens:`);
  console.log(`    • System prompt    (instructions + rules for the model)`);
  console.log(`    • ${retrievedChunks.length} retrieved listings (the RAG context injected before your question)`);
  console.log(`    • Your question    (the user message)`);
  console.log(`    • Conversation history (prior turns, if any)`);
  console.log();
  const inputCost  = (result.promptTokens     / 1e6) * INPUT_CPM;
  const outputCost = (result.completionTokens / 1e6) * OUTPUT_CPM;
  console.log(`  Cost breakdown:`);
  console.log(`    Input  (${result.promptTokens} tokens × $${INPUT_CPM}/1M)  = $${inputCost.toFixed(6)}`);
  console.log(`    Output (${result.completionTokens} tokens × $${OUTPUT_CPM}/1M) = $${outputCost.toFixed(6)}`);
  console.log(`    Total this turn                      = $${result.cost.toFixed(6)} USD`);
  console.log();
  console.log(`  Note: input tokens are cheaper than output tokens because generating`);
  console.log(`  text (output) requires more compute than reading text (input).`);
  console.log();
  console.log(`  Type "show chunks" to see which ${retrievedChunks.length} listings were retrieved and their scores.`);
  console.log();
}

export function showChunks(chunks) {
  console.log();
  console.log('  ── Retrieved Chunks (RAG context sent to the model) ──────');
  console.log();
  console.log('  How to read this:');
  console.log('    • Score = cosine similarity between your query vector and the listing vector');
  console.log('    • 1.0 = identical meaning   0.7 = related   0.5 = loosely related');
  console.log('    • These are the ONLY listings the model sees — it cannot invent others');
  console.log();

  for (const [i, c] of chunks.entries()) {
    const scoreBar = bar(c.score, 1.0, 20);
    console.log(`  #${i + 1}  score: ${c.score.toFixed(4)}  [${scoreBar}]`);
    console.log(`       ${c.metadata?.address ?? c.id}`);
    const preview = c.text.split('\n').slice(0, 3).join(' | ').slice(0, 100);
    console.log(`       ${preview}`);
    console.log();
  }

  console.log('  Why these listings and not others?');
  console.log('  Your question was converted to a 1,536-dimensional vector.');
  console.log('  Every listing in the store was compared to it via cosine similarity.');
  console.log('  The listings above had the highest scores — closest meaning to your question.');
  console.log();
}

export function showSystemPrompt(systemPrompt) {
  console.log();
  console.log('  ── System Prompt ─────────────────────────────────────────');
  console.log();
  console.log('  The system prompt is sent to the model on EVERY turn, before your');
  console.log('  question. It defines the persona, what data it has access to,');
  console.log('  and strict rules to prevent hallucination.');
  console.log();
  console.log('  ── Actual prompt sent to the model: ──────────────────────');
  console.log();
  systemPrompt.split('\n').forEach(line => console.log(`  ${line}`));
  console.log();
  console.log('  ─────────────────────────────────────────────────────────');
  console.log();
  console.log('  The retrieved listings are appended to the USER message,');
  console.log('  not the system prompt — so listings stay fresh on every turn.');
  console.log();
}

export { extractFilters, buildSystemPrompt };
