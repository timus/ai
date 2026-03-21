import OpenAI from "openai";
import { encoding_for_model } from "tiktoken";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Tokenize text and return the actual token strings as an array
 * e.g. "buy a house" → ["buy", " a", " house"]
 */
function tokenizeText(text) {
  const enc = encoding_for_model("gpt-4o");
  const tokenIds = enc.encode(text);
  const decoder = new TextDecoder();
  const tokens = Array.from(tokenIds).map((id) =>
    decoder.decode(enc.decode(new Uint32Array([id])))
  );
  enc.free();
  return tokens;
}

function showTokens(text, label = "YOUR MESSAGE") {
  const tokens = tokenizeText(text);
  console.log(`\n  TOKENS — ${label} (${tokens.length} tokens)`);
  console.log("  " + JSON.stringify(tokens));
}

// Pricing per 1M tokens (gpt-4o-mini as of 2024)
const PRICING = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10.0 },
};

const MODEL = "gpt-4o-mini";

const CONTEXT_WINDOW = 128_000;
const BAR_WIDTH = 28;

function bar(value, max, width = BAR_WIDTH) {
  const filled = Math.round((value / max) * width);
  return "[" + "█".repeat(filled) + "░".repeat(width - filled) + "]";
}

function pad(str, len) {
  return String(str).padStart(len);
}

/**
 * DAY 1 LESSON — Token tracking
 * Every API response includes usage: { prompt_tokens, completion_tokens, total_tokens }
 * prompt_tokens  = your system prompt + conversation history + new message
 * completion_tokens = the model's reply
 * As conversation grows → prompt_tokens grow → cost grows → eventually hits context limit
 */
function showTokenStats(usage, label = "", contextBreakdown = null) {
  const price = PRICING[MODEL];
  const callCost =
    (usage.prompt_tokens / 1_000_000) * price.input +
    (usage.completion_tokens / 1_000_000) * price.output;
  const sessionTotal = sessionTotals.promptTokens + sessionTotals.completionTokens;
  const maxTokens = Math.max(usage.total_tokens, sessionTotal, 1);
  const ctxPct = (usage.prompt_tokens / CONTEXT_WINDOW) * 100;

  console.log(`\n${"─".repeat(56)}`);
  console.log(`  TOKEN USAGE ${label ? `(${label})` : ""}`);
  console.log(`${"─".repeat(56)}`);

  // This call breakdown
  console.log(`  THIS CALL`);
  console.log(`  Prompt     ${bar(usage.prompt_tokens, CONTEXT_WINDOW)} ${pad(usage.prompt_tokens.toLocaleString(), 7)}`);
  console.log(`  Completion ${bar(usage.completion_tokens, CONTEXT_WINDOW)} ${pad(usage.completion_tokens.toLocaleString(), 7)}`);
  console.log(`  Cost       $${callCost.toFixed(6)} USD`);

  // Context window breakdown
  console.log(`${"─".repeat(56)}`);
  console.log(`  CONTEXT WINDOW — ${ctxPct.toFixed(2)}% of 128,000 token limit`);
  if (contextBreakdown) {
    const { systemTokens, historyTokens, currentMsgTokens } = contextBreakdown;
    console.log(`  System prompt  ${bar(systemTokens, CONTEXT_WINDOW)} ${pad(systemTokens.toLocaleString(), 6)} tokens`);
    console.log(`  History        ${bar(historyTokens, CONTEXT_WINDOW)} ${pad(historyTokens.toLocaleString(), 6)} tokens`);
    console.log(`  This message   ${bar(currentMsgTokens, CONTEXT_WINDOW)} ${pad(currentMsgTokens.toLocaleString(), 6)} tokens`);
    console.log(`  ─────────────────────────────────────────────────`);
    console.log(`  Total used     ${bar(usage.prompt_tokens, CONTEXT_WINDOW)} ${pad(usage.prompt_tokens.toLocaleString(), 6)} / 128,000`);
    console.log(`  Remaining      ${bar(CONTEXT_WINDOW - usage.prompt_tokens, CONTEXT_WINDOW)} ${pad((CONTEXT_WINDOW - usage.prompt_tokens).toLocaleString(), 6)} free`);
  }

  console.log(`${"─".repeat(56)}`);

  // Call history array breakdown
  console.log(`  CALL HISTORY`);
  callHistory.forEach((c, i) => {
    const pct = ((c.promptTokens / CONTEXT_WINDOW) * 100).toFixed(2);
    console.log(
      `  #${String(i + 1).padEnd(2)} prompt ${bar(c.promptTokens, maxTokens, 16)} ${pad(c.promptTokens.toLocaleString(), 6)}  ` +
      `reply ${bar(c.completionTokens, maxTokens, 10)} ${pad(c.completionTokens.toLocaleString(), 6)}  ctx ${pct}%`
    );
  });

  console.log(`${"─".repeat(56)}`);

  // Session totals
  console.log(`  SESSION TOTALS`);
  console.log(`  All tokens ${bar(sessionTotal, maxTokens)} ${pad(sessionTotal.toLocaleString(), 7)}`);
  console.log(`  Total cost $${sessionTotals.cost.toFixed(6)} USD`);
  console.log(`${"─".repeat(56)}\n`);
}

/**
 * conversationHistory holds all messages so far.
 * DAY 1 LESSON — Context window:
 * Each new message adds to history. The model sees ALL of it every call.
 * At ~128k tokens for gpt-4o-mini, you'd need a very long conversation to hit it,
 * but for GPT-3.5 (4k context) this fills up fast — that's why context management matters.
 */
let conversationHistory = [];
let sessionTotals = { promptTokens: 0, completionTokens: 0, cost: 0 };
let callHistory = [];

async function chat(systemPrompt, userMessage, isFirstMessage = false) {
  if (isFirstMessage) {
    conversationHistory = [];
    sessionTotals = { promptTokens: 0, completionTokens: 0, cost: 0 };
    callHistory = [];
  }

  conversationHistory.push({ role: "user", content: userMessage });

  // Context breakdown — tokenize each part before sending
  const systemTokens = tokenizeText(systemPrompt).length;
  const historyTokens = conversationHistory
    .slice(0, -1) // exclude the message we just pushed
    .reduce((sum, m) => sum + tokenizeText(m.content).length, 0);
  const currentMsgTokens = tokenizeText(userMessage).length;

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      ...conversationHistory,
    ],
    temperature: 0.7,
  });

  const assistantMessage = response.choices[0].message;
  conversationHistory.push(assistantMessage);

  const price = PRICING[MODEL];
  sessionTotals.promptTokens += response.usage.prompt_tokens;
  sessionTotals.completionTokens += response.usage.completion_tokens;
  sessionTotals.cost +=
    (response.usage.prompt_tokens / 1_000_000) * price.input +
    (response.usage.completion_tokens / 1_000_000) * price.output;
  callHistory.push({
    promptTokens: response.usage.prompt_tokens,
    completionTokens: response.usage.completion_tokens,
  });

  return {
    content: assistantMessage.content,
    usage: response.usage,
    totalMessages: conversationHistory.length,
    contextBreakdown: { systemTokens, historyTokens, currentMsgTokens },
  };
}

function getHistory() {
  return conversationHistory;
}

export { chat, showTokenStats, showTokens, getHistory };
