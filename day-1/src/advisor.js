/**
 * advisor.js — OpenAI API calls, tokenization, and token stats
 *
 * This file is the core of the LLM learning experience.
 * Every function here is designed to make a hidden LLM concept visible.
 *
 * Concepts demonstrated:
 *  - Tokenization: how text is split before the model reads it
 *  - Token costs: prompt tokens + completion tokens = your bill
 *  - Context window: everything the model sees in one call
 *  - Conversation history: why prompt tokens grow with every message
 *  - Temperature: how random/creative the model's output is
 */

import OpenAI from "openai";
import { encoding_for_model } from "tiktoken";

/**
 * OpenAI client — authenticated via API key from .env
 *
 * The client handles HTTP requests to OpenAI's API.
 * Every call to client.chat.completions.create() costs money
 * based on the number of tokens sent and received.
 */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Pricing per 1,000,000 tokens (1M) by model — as of 2024
 *
 * WHY THIS MATTERS:
 * Input (prompt) tokens and output (completion) tokens are priced separately.
 * Output tokens cost more because generating text is more compute-intensive
 * than reading it.
 *
 * Example at scale:
 *  - 1,000 users/day × 800 tokens each = 800,000 tokens/day
 *  - At gpt-4o-mini input rate: 800,000 / 1,000,000 × $0.15 = $0.12/day
 *  - Sounds cheap — but a poorly written prompt that doubles token usage doubles your bill.
 */
const PRICING = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10.0 },
};

/**
 * The model we are using.
 *
 * gpt-4o-mini is a great default for learning:
 *  - 128,000 token context window
 *  - Much cheaper than gpt-4o
 *  - Fast responses
 *  - Smart enough for structured tasks like this
 *
 * When to upgrade to gpt-4o:
 *  - Complex reasoning tasks
 *  - When answer quality noticeably suffers
 *  - When you need vision (image input) capabilities
 */
const MODEL = "gpt-4o-mini";

/**
 * The maximum number of tokens this model can hold in a single call.
 *
 * WHAT IS A CONTEXT WINDOW?
 * Think of it as the model's working memory — everything it can "see" at once.
 * This includes:
 *   1. The system prompt (instructions you give the model)
 *   2. All previous messages in the conversation
 *   3. The new message you are sending now
 *
 * Once this limit is hit, you must drop old messages or the call fails.
 * Managing this efficiently is one of the key skills of AI architecture.
 *
 * Context window by model:
 *   GPT-3.5-turbo:  4,096 tokens   (~3,000 words)
 *   GPT-4o-mini:  128,000 tokens   (~96,000 words)
 *   GPT-4o:       128,000 tokens   (~96,000 words)
 */
const CONTEXT_WINDOW = 128_000;

/** Width of bar chart visualisations in the terminal */
const BAR_WIDTH = 28;

/**
 * Renders a simple ASCII bar chart for visualising token proportions.
 *
 * @param {number} value - The current value (e.g. tokens used)
 * @param {number} max   - The maximum value (e.g. context window size)
 * @param {number} width - How many characters wide the bar should be
 * @returns {string}     - e.g. "[████░░░░░░░░░░░░░░░░░░░░░░░░░░]"
 */
function bar(value, max, width = BAR_WIDTH) {
  const filled = Math.round((value / max) * width);
  return "[" + "█".repeat(filled) + "░".repeat(width - filled) + "]";
}

/**
 * Left-pads a string or number to a fixed length for aligned terminal output.
 *
 * @param {string|number} str - Value to pad
 * @param {number} len        - Target width
 * @returns {string}
 */
function pad(str, len) {
  return String(str).padStart(len);
}

/**
 * Splits any text string into its actual token array using tiktoken.
 *
 * WHAT ARE TOKENS?
 * A token is the smallest unit an LLM processes. It is NOT the same as a word.
 * The model never sees "Hello world" — it sees something like ["Hello", " world"].
 *
 * Token rules of thumb:
 *  - ~1 token per 4 characters in English
 *  - 1,000 tokens ≈ 750 words
 *  - Punctuation, spaces, and numbers are often their own tokens
 *  - Uncommon or long words split into multiple tokens
 *
 * Examples:
 *  "property"     → ["property"]           = 1 token
 *  "unaffordable" → ["un", "afford", "able"] = 3 tokens
 *  "$80,000"      → ["$", "80", ",000"]    = 3 tokens
 *
 * WHY THIS MATTERS:
 * Every token costs money. A verbose system prompt that says the same thing
 * in 500 tokens vs 200 tokens costs 2.5x more — on every single API call.
 *
 * @param {string} text - Any string to tokenize
 * @returns {string[]}  - Array of token strings, e.g. ["Hello", " world"]
 */
function tokenizeText(text) {
  const enc = encoding_for_model("gpt-4o");
  const tokenIds = enc.encode(text);
  const decoder = new TextDecoder();
  const tokens = Array.from(tokenIds).map((id) =>
    decoder.decode(enc.decode(new Uint32Array([id])))
  );
  enc.free(); // free WASM memory — always call this after encoding
  return tokens;
}

/**
 * Prints the token array of any text to the terminal.
 *
 * Use this to see exactly how the model reads your text before sending it.
 * The output looks like: ["What"," if"," rates"," go"," up"," 2","%","?"]
 *
 * Notice the leading spaces on tokens like " if" and " go" — that is real.
 * The tokenizer encodes the space as part of the next word, not the previous one.
 *
 * @param {string} text  - The text to tokenize and display
 * @param {string} label - A label shown in the header, e.g. "YOUR MESSAGE"
 */
function showTokens(text, label = "YOUR MESSAGE") {
  const tokens = tokenizeText(text);
  console.log(`\n  TOKENS — ${label} (${tokens.length} tokens)`);
  console.log("  " + JSON.stringify(tokens));
}

/**
 * Prints a full token usage report after an API call.
 *
 * WHAT THIS SHOWS:
 *
 * THIS CALL:
 *   Prompt tokens    = system prompt + full conversation history + new message
 *   Completion tokens = the model's reply
 *   Cost             = calculated from PRICING above
 *
 * CONTEXT WINDOW BREAKDOWN:
 *   System prompt  = the fixed instructions sent every call (never changes)
 *   History        = all previous messages (grows with every turn)
 *   This message   = what you just sent
 *   Remaining      = how much space is left before you hit the 128k limit
 *
 * CALL HISTORY:
 *   A row per API call — watch prompt tokens grow as conversation continues.
 *   This is the context window filling up, made visual.
 *
 * SESSION TOTALS:
 *   Cumulative tokens and cost across the entire conversation session.
 *
 * @param {object} usage            - OpenAI usage object from response
 * @param {number} usage.prompt_tokens     - Tokens you sent
 * @param {number} usage.completion_tokens - Tokens the model replied with
 * @param {number} usage.total_tokens      - Sum of both
 * @param {string} label            - Label shown in the header
 * @param {object|null} contextBreakdown   - Per-part token counts (optional)
 * @param {number} contextBreakdown.systemTokens     - System prompt token count
 * @param {number} contextBreakdown.historyTokens    - Previous messages token count
 * @param {number} contextBreakdown.currentMsgTokens - Current message token count
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

  console.log(`  THIS CALL`);
  console.log(`  Prompt     ${bar(usage.prompt_tokens, CONTEXT_WINDOW)} ${pad(usage.prompt_tokens.toLocaleString(), 7)}`);
  console.log(`  Completion ${bar(usage.completion_tokens, CONTEXT_WINDOW)} ${pad(usage.completion_tokens.toLocaleString(), 7)}`);
  console.log(`  Cost       $${callCost.toFixed(6)} USD`);

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
  console.log(`  CALL HISTORY`);
  callHistory.forEach((c, i) => {
    const pct = ((c.promptTokens / CONTEXT_WINDOW) * 100).toFixed(2);
    console.log(
      `  #${String(i + 1).padEnd(2)} prompt ${bar(c.promptTokens, maxTokens, 16)} ${pad(c.promptTokens.toLocaleString(), 6)}  ` +
      `reply ${bar(c.completionTokens, maxTokens, 10)} ${pad(c.completionTokens.toLocaleString(), 6)}  ctx ${pct}%`
    );
  });

  console.log(`${"─".repeat(56)}`);
  console.log(`  SESSION TOTALS`);
  console.log(`  All tokens ${bar(sessionTotal, maxTokens)} ${pad(sessionTotal.toLocaleString(), 7)}`);
  console.log(`  Total cost $${sessionTotals.cost.toFixed(6)} USD`);
  console.log(`${"─".repeat(56)}\n`);
}

/**
 * Conversation history — an array of all messages exchanged so far.
 *
 * WHY WE NEED THIS:
 * LLMs are stateless. Each API call is completely independent — the model
 * remembers nothing from previous calls by default.
 *
 * To simulate memory, we maintain this array and send the entire history
 * with every new message. This is why prompt_tokens grow with each turn.
 *
 * Structure of each message:
 *   { role: "user",      content: "What if rates go up?" }
 *   { role: "assistant", content: "If rates rise by 2%..." }
 *
 * Roles:
 *   "system"    — instructions set by the developer (not shown to the user)
 *   "user"      — messages from the human
 *   "assistant" — messages from the model
 *
 * At scale, you cannot send unlimited history — it fills the context window.
 * Strategies to manage this: summarisation, sliding window, RAG (Session 3).
 */
let conversationHistory = [];

/**
 * Cumulative token and cost totals for the current session.
 * Reset to zero at the start of each new conversation.
 */
let sessionTotals = { promptTokens: 0, completionTokens: 0, cost: 0 };

/**
 * Per-call token log — one entry per API call.
 * Used to render the CALL HISTORY bar chart in showTokenStats().
 * Lets you visually see context growing over time.
 */
let callHistory = [];

/**
 * Sends a message to OpenAI and returns the response.
 *
 * HOW IT WORKS:
 * 1. Adds the new user message to conversationHistory
 * 2. Tokenizes each part of the context (system, history, current message)
 * 3. Sends everything to OpenAI — [system prompt, ...all history]
 * 4. Appends the assistant's reply to history (so next call includes it)
 * 5. Updates session totals and call history
 * 6. Returns the reply + usage stats + context breakdown
 *
 * ABOUT temperature:
 * Temperature controls how creative/random the model's output is.
 *   0.0 = deterministic, always the same answer (good for structured data, code)
 *   0.7 = balanced — some variety, still coherent (good for conversational advice)
 *   1.0 = more creative and varied (good for writing, brainstorming)
 *   2.0 = very random, often incoherent (rarely useful)
 *
 * We use 0.7 here because property advice should be helpful and natural,
 * but not so random that it gives wildly different answers to the same question.
 *
 * ABOUT the messages array:
 * The model receives an ordered array of messages. Order matters —
 * earlier messages provide context for later ones.
 * [
 *   { role: "system", content: "You are a property advisor..." },
 *   { role: "user",   content: "Here is my financial situation..." },
 *   { role: "assistant", content: "Based on your situation..." },
 *   { role: "user",   content: "What if rates go up?" },  ← newest message
 * ]
 *
 * @param {string}  systemPrompt   - Instructions for the model (sent every call)
 * @param {string}  userMessage    - The new message from the user
 * @param {boolean} isFirstMessage - If true, resets history and session totals
 * @returns {Promise<{content: string, usage: object, totalMessages: number, contextBreakdown: object}>}
 */
async function chat(systemPrompt, userMessage, isFirstMessage = false) {
  if (isFirstMessage) {
    conversationHistory = [];
    sessionTotals = { promptTokens: 0, completionTokens: 0, cost: 0 };
    callHistory = [];
  }

  conversationHistory.push({ role: "user", content: userMessage });

  // Tokenize each part of the context separately so we can show the breakdown.
  // This runs before the API call — we want the numbers before, not after.
  const systemTokens = tokenizeText(systemPrompt).length;
  const historyTokens = conversationHistory
    .slice(0, -1) // exclude the message we just pushed — count history only
    .reduce((sum, m) => sum + tokenizeText(m.content).length, 0);
  const currentMsgTokens = tokenizeText(userMessage).length;

  const response = await client.chat.completions.create({
    model: MODEL,

    /**
     * The messages array is the full context sent to the model.
     * System prompt first, then the full conversation history.
     * The model reads ALL of this on every single call.
     */
    messages: [
      { role: "system", content: systemPrompt },
      ...conversationHistory,
    ],

    /**
     * temperature: 0.7
     *
     * Controls randomness of the output.
     * 0.0 = same answer every time (deterministic)
     * 0.7 = natural variation, still coherent
     * 1.0+ = creative but less reliable
     *
     * Try changing this to 0.0 and ask the same question twice —
     * you'll get nearly identical responses.
     * Change it to 1.5 and the advice starts to feel unpredictable.
     */
    temperature: 0.7,
  });

  const assistantMessage = response.choices[0].message;

  // Add the model's reply to history so it's included in the next call.
  // This is what makes the conversation feel continuous — but remember,
  // the model itself has no memory. We are providing the memory.
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

/**
 * Returns the current conversation history array.
 * Used by the 'history' command in the CLI to show all messages
 * that are being sent with every API call.
 *
 * @returns {Array<{role: string, content: string}>}
 */
function getHistory() {
  return conversationHistory;
}

export { chat, showTokenStats, showTokens, getHistory };
