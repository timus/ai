/**
 * agent.js — The AI agent loop with tool use (function calling).
 *
 * What makes this an AGENT and not just a chatbot:
 *
 *   Chatbot: User → LLM → Reply
 *   Agent:   User → LLM → Tool call → Tool result → LLM → Tool call → ... → Reply
 *
 * The LLM decides:
 *   1. Whether to call a tool or reply directly
 *   2. Which tool to call
 *   3. What arguments to pass
 *   4. Whether to call another tool after seeing the result
 *
 * This loop continues until the LLM produces a reply with no tool calls.
 *
 * OpenAI function calling works by:
 *   - Sending tool definitions (JSON schema) alongside the messages
 *   - The model returns either a normal message OR a list of tool_calls
 *   - We execute the tool calls and add results back as `role: "tool"` messages
 *   - We call the API again — the model sees the results and decides what to do next
 */

import OpenAI from 'openai';
import {
  search_properties,
  capture_lead,
  request_callback,
  analyze_sentiment,
} from './tools.js';
import { showToolCall, showToolResult } from './display.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * gpt-4o-mini — fast and cheap, suitable for agent loops.
 *
 * Why not gpt-4o?
 * An agent loop makes multiple API calls per user turn (one per loop iteration).
 * Using the most expensive model multiplies the cost by the number of iterations.
 * gpt-4o-mini handles tool use well and keeps per-turn cost low.
 */
const MODEL = 'gpt-4o-mini';

/**
 * Pricing for gpt-4o-mini (as of 2025).
 *
 * CPM = Cost Per Million tokens.
 *
 * INPUT_CPM  — what you pay per 1M tokens you SEND to the model.
 *              This includes: system prompt + conversation history + tool definitions + tool results.
 *              In an agent loop, input tokens grow each iteration because tool results are appended.
 *
 * OUTPUT_CPM — what you pay per 1M tokens the model GENERATES.
 *              This includes: tool call arguments + the final reply text.
 *              Output is billed at 4× the input rate because generating tokens
 *              requires more compute than reading them.
 *
 * Example for one agent turn with 3 tool calls:
 *   Iteration 1: send 800 input tokens  → model outputs tool call args (~50 tokens)
 *   Iteration 2: send 900 input tokens  → model outputs tool call args (~50 tokens)
 *   Iteration 3: send 1000 input tokens → model outputs final reply (~200 tokens)
 *   Total input:  2,700 tokens × $0.15/1M = $0.000405
 *   Total output:   300 tokens × $0.60/1M = $0.000180
 *   Total cost: ~$0.000585 per turn
 */
const INPUT_CPM  = 0.15; // $ per 1M input tokens
const OUTPUT_CPM = 0.60; // $ per 1M output tokens

// ── System prompt ─────────────────────────────────────────────────────────
// The agent has a dual goal: help users AND capture qualified leads.
// The prompt instructs it when to proactively ask for contact details.

const SYSTEM_PROMPT = `You are a smart property agent assistant for an Australian real estate agency.

You have access to real property listings and four tools: search, lead capture, callback request, and sentiment analysis.

YOUR GOALS:
1. Help users find properties that match their needs
2. Capture contact details when users show genuine interest
3. Offer callbacks for serious buyers
4. Always analyze sentiment after capturing a lead

WHEN TO CAPTURE A LEAD:
- User mentions a specific budget or timeline ("looking to buy in 3 months")
- User asks detailed questions about a specific property
- User asks about inspections, finance, or next steps
- User says they are ready to buy — ask for name, email, and phone

WORKFLOW:
1. Search for properties first, always use the search tool for property questions
2. If user shows interest, naturally ask: "I'd love to help you further — can I get your name and contact details?"
3. Once you have name + at least one contact method, call capture_lead
4. Then call analyze_sentiment to score the conversation
5. If readiness_score >= 7, offer a callback and call request_callback

IMPORTANT:
- Only describe properties that came back from search_properties
- Never invent addresses, prices, or features
- Sentiment analysis must be called after every lead capture`;

// ── Tool definitions (JSON Schema) ────────────────────────────────────────
// These are sent to OpenAI on every call. The model reads the descriptions
// to decide which tool is appropriate and what arguments to provide.

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_properties',
      description: 'Search for property listings matching the user\'s criteria using semantic search. Call this for any property-related question.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural language search query, e.g. "3 bed house with garage under $800k"',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'capture_lead',
      description: 'Save the user\'s contact details as a lead. Call this once you have their name and at least one contact method (email or phone).',
      parameters: {
        type: 'object',
        properties: {
          name:            { type: 'string',  description: 'Full name' },
          email:           { type: 'string',  description: 'Email address' },
          phone:           { type: 'string',  description: 'Phone number' },
          suburb_interest: { type: 'string',  description: 'Suburb or area they are interested in' },
          budget:          { type: 'string',  description: 'Budget range, e.g. "$700k-$900k"' },
          notes:           { type: 'string',  description: 'Any other relevant notes from the conversation' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_callback',
      description: 'Register a callback request. Call this when the user asks to speak with a human agent, or when readiness_score >= 7.',
      parameters: {
        type: 'object',
        properties: {
          name:           { type: 'string', description: 'User\'s name' },
          phone:          { type: 'string', description: 'Phone number to call back' },
          preferred_time: { type: 'string', description: 'Preferred callback time, e.g. "Tuesday afternoon"' },
        },
        required: ['name', 'phone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_sentiment',
      description: 'Analyze the user\'s sentiment and buying intent based on the full conversation. Call this immediately after capturing a lead.',
      parameters: {
        type: 'object',
        properties: {
          sentiment: {
            type: 'string',
            enum: ['positive', 'neutral', 'negative'],
            description: 'Overall sentiment of the conversation',
          },
          intent: {
            type: 'string',
            enum: ['browsing', 'interested', 'ready_to_buy'],
            description: 'Buying intent level',
          },
          readiness_score: {
            type: 'number',
            description: 'How ready is the user to buy? 1 (just looking) to 10 (ready to make an offer)',
          },
          key_interests: {
            type: 'array',
            items: { type: 'string' },
            description: 'Key things the user cared about, e.g. ["pool", "good schools", "under $900k"]',
          },
          summary: {
            type: 'string',
            description: 'One sentence summary of the user\'s situation and needs',
          },
        },
        required: ['sentiment', 'intent', 'readiness_score', 'summary'],
      },
    },
  },
];

// ── Agent loop ────────────────────────────────────────────────────────────

/**
 * Run the agent for one user turn.
 *
 * The loop:
 *   1. Build messages (system + history + user message)
 *   2. Call OpenAI with tools
 *   3. If the response has tool_calls: execute them, add results, go to 2
 *   4. If the response has no tool_calls: return the final reply
 *
 * @param {string}   userMessage  — the user's input for this turn
 * @param {Array}    history      — prior [user, assistant] message pairs
 * @param {object}   store        — the loaded VectorStore (for property search)
 * @returns {{ reply, toolCallsMade, promptTokens, completionTokens, cost }}
 */
export async function runAgent(userMessage, history, store) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user',   content: userMessage },
  ];

  let totalPromptTokens     = 0;
  let totalCompletionTokens = 0;
  const toolCallsMade       = [];

  // The loop runs until the model returns a reply with no tool calls
  while (true) {
    const response = await openai.chat.completions.create({
      model:  MODEL,
      messages,
      tools:  TOOLS,
      tool_choice: 'auto',
    });

    totalPromptTokens     += response.usage.prompt_tokens;
    totalCompletionTokens += response.usage.completion_tokens;

    const message = response.choices[0].message;
    messages.push(message);

    // No tool calls — the model is done, return the final reply
    if (!message.tool_calls || message.tool_calls.length === 0) {
      const cost = (totalPromptTokens / 1e6) * INPUT_CPM +
                   (totalCompletionTokens / 1e6) * OUTPUT_CPM;
      return {
        reply:            message.content,
        toolCallsMade,
        promptTokens:     totalPromptTokens,
        completionTokens: totalCompletionTokens,
        cost,
      };
    }

    // Execute each tool call and collect results
    for (const toolCall of message.tool_calls) {
      const name = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments);

      showToolCall(name, args);

      const result = await executeTool(name, args, store);
      toolCallsMade.push({ name, args, result });

      showToolResult(name, result);

      // Add the tool result back to messages so the model can see it
      messages.push({
        role:         'tool',
        tool_call_id: toolCall.id,
        content:      JSON.stringify(result),
      });
    }

    // Loop back — model will see the tool results and decide what to do next
  }
}

/**
 * Dispatch a tool call by name to the correct implementation.
 */
async function executeTool(name, args, store) {
  if (name === 'search_properties')  { return search_properties(args, store); }
  if (name === 'capture_lead')       { return capture_lead(args); }
  if (name === 'request_callback')   { return request_callback(args); }
  if (name === 'analyze_sentiment')  { return analyze_sentiment(args); }
  return { error: `Unknown tool: ${name}` };
}
