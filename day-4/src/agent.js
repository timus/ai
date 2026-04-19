/**
 * agent.js — AI agent loop with tool use and persistent memory.
 *
 * The key change from Day 3:
 *
 *   Day 3: SYSTEM_PROMPT was a static string — the same text every session.
 *   Day 4: buildSystemPrompt(userContext) is a function — the memory block
 *          changes depending on what we loaded from NEDB at startup.
 *
 * Session 1 (new user):
 *   userContext = null
 *   System prompt says: "NEW USER — ask for their name early"
 *
 * Session 2 (returning user):
 *   userContext = { name: 'Sarah', preferences: { beds: 3, budget: '$800k' }, ... }
 *   System prompt says: "RETURNING USER — Name: Sarah, Budget: $800k, Last session: ..."
 *
 * The LLM's warm greeting in Session 2 is not magic. It is text pre-filled
 * into the context window from a database read that happened before the first
 * API call.
 */

import OpenAI from 'openai';
import {
  search_properties,
  capture_lead,
  request_callback,
  analyze_sentiment,
  identify_user,
  update_preferences,
  end_session,
} from './tools.js';
import { showToolCall, showToolResult } from './display.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL      = 'gpt-4o-mini';
const INPUT_CPM  = 0.15; // $ per 1M input tokens
const OUTPUT_CPM = 0.60; // $ per 1M output tokens — 4× input because generation is compute-heavy

// ── System prompt (now a function) ───────────────────────────────────────

/**
 * Build the system prompt for this session.
 *
 * The memory block at the top changes every session based on what NEDB holds.
 * Everything below the memory block is the same workflow instructions as Day 3.
 *
 * @param {object|null} userContext — loaded from NEDB at startup, or null for new users
 */
function buildSystemPrompt(userContext) {
  let memoryBlock;

  if (userContext) {
    const p = userContext.preferences ?? {};
    const prefLines = [];
    if (p.beds)               { prefLines.push(`  Beds: ${p.beds}+`); }
    if (p.budget)             { prefLines.push(`  Budget: ${p.budget}`); }
    if (p.preferred_suburbs?.length) { prefLines.push(`  Suburbs: ${p.preferred_suburbs.join(', ')}`); }
    if (p.must_haves?.length) { prefLines.push(`  Must-haves: ${p.must_haves.join(', ')}`); }
    if (p.timeline)           { prefLines.push(`  Timeline: ${p.timeline}`); }

    memoryBlock = `RETURNING USER:
Name: ${userContext.name}
Previous sessions: ${userContext.sessionCount}
Known preferences:
${prefLines.length ? prefLines.join('\n') : '  (none recorded yet)'}
Last session summary: ${userContext.lastSummary ?? 'none recorded'}`;
  } else {
    memoryBlock = `NEW USER: You have not met this person before.
Ask for their name early in the conversation — call identify_user as soon as you have it.`;
  }

  return `You are a smart property agent assistant for an Australian real estate agency.

You have access to real property listings and seven tools.

${memoryBlock}

YOUR GOALS:
1. Help users find properties that match their needs
2. Remember their preferences across sessions — update them whenever they mention something new
3. Capture contact details when users show genuine interest
4. Summarise every session so you know where to pick up next time

MEMORY WORKFLOW:
1. Call identify_user early — even if you know from the memory block who they are,
   calling the tool sets up the session so update_preferences and end_session work
2. If returning user: greet by name, reference what you know, search for matching properties immediately
3. If new user: ask for name, start learning their preferences
4. Call update_preferences whenever the user mentions beds, budget, suburbs, must-haves, or timeline
5. Always call end_session before saying goodbye — write a brief summary of what was discussed

PROPERTY WORKFLOW:
1. Use search_properties for any property question — never invent listings
2. If user shows buying intent, capture their contact details with capture_lead
3. Call analyze_sentiment immediately after capturing a lead
4. Offer a callback when readiness_score >= 7

IMPORTANT:
- Only describe properties that came back from search_properties
- Never invent addresses, prices, or features
- Call end_session before saying goodbye — every session must be summarised`;
}

// ── Tool definitions (JSON Schema) ───────────────────────────────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_properties',
      description: 'Search for property listings matching the user\'s criteria using semantic search. Call this for any property-related question.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query, e.g. "3 bed house with garage under $800k"' },
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
      description: 'Register a callback request. Call when the user asks to speak with a human agent, or when readiness_score >= 7.',
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
      description: 'Analyze the user\'s sentiment and buying intent based on the full conversation. Call immediately after capturing a lead.',
      parameters: {
        type: 'object',
        properties: {
          sentiment:       { type: 'string', enum: ['positive', 'neutral', 'negative'] },
          intent:          { type: 'string', enum: ['browsing', 'interested', 'ready_to_buy'] },
          readiness_score: { type: 'number', description: '1 (just looking) to 10 (ready to make an offer)' },
          key_interests:   { type: 'array', items: { type: 'string' }, description: 'e.g. ["pool", "quiet street", "under $900k"]' },
          summary:         { type: 'string', description: 'One sentence summary of the user\'s situation' },
        },
        required: ['sentiment', 'intent', 'readiness_score', 'summary'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'identify_user',
      description: 'Find or create a user profile and load their session history. Call this early in every session — as soon as you have the user\'s name.',
      parameters: {
        type: 'object',
        properties: {
          name:  { type: 'string', description: 'User\'s full name' },
          phone: { type: 'string', description: 'Phone number (optional but improves lookup accuracy)' },
          email: { type: 'string', description: 'Email address (optional but improves lookup accuracy)' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_preferences',
      description: 'Persist the user\'s property preferences to their profile. Call whenever the user mentions beds, budget, suburbs, must-haves, or timeline.',
      parameters: {
        type: 'object',
        properties: {
          beds:               { type: 'number', description: 'Minimum number of bedrooms' },
          budget:             { type: 'string', description: 'Budget range, e.g. "$700k-$900k"' },
          preferred_suburbs:  { type: 'array', items: { type: 'string' }, description: 'Suburbs or areas of interest' },
          must_haves:         { type: 'array', items: { type: 'string' }, description: 'Features the user requires, e.g. ["garage", "pool"]' },
          timeline:           { type: 'string', description: 'When they want to buy, e.g. "within 3 months"' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'end_session',
      description: 'Save a summary of this conversation so it can be loaded at the start of the next session. Call this before saying goodbye.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'A 1-3 sentence plain-text summary: who the user is, what they want, and any next steps discussed.',
          },
        },
        required: ['summary'],
      },
    },
  },
];

// ── Agent loop ────────────────────────────────────────────────────────────

/**
 * Run the agent for one user turn.
 *
 * Identical loop to Day 3, with two additions:
 *   - `userContext` param feeds into buildSystemPrompt
 *   - 3 new tools dispatched in executeTool
 *
 * @param {string}      userMessage
 * @param {Array}       history      — prior [user, assistant] pairs
 * @param {object}      store        — VectorStore for property search
 * @param {object|null} userContext  — loaded from NEDB at startup; null for new users
 */
export async function runAgent(userMessage, history, store, userContext = null) {
  const messages = [
    { role: 'system', content: buildSystemPrompt(userContext) },
    ...history,
    { role: 'user',   content: userMessage },
  ];

  let totalPromptTokens     = 0;
  let totalCompletionTokens = 0;
  const toolCallsMade       = [];

  while (true) {
    const response = await openai.chat.completions.create({
      model:       MODEL,
      messages,
      tools:       TOOLS,
      tool_choice: 'auto',
    });

    totalPromptTokens     += response.usage.prompt_tokens;
    totalCompletionTokens += response.usage.completion_tokens;

    const message = response.choices[0].message;
    messages.push(message);

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

    for (const toolCall of message.tool_calls) {
      const name = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments);

      showToolCall(name, args);

      const result = await executeTool(name, args, store);
      toolCallsMade.push({ name, args, result });

      showToolResult(name, result);

      messages.push({
        role:         'tool',
        tool_call_id: toolCall.id,
        content:      JSON.stringify(result),
      });
    }
  }
}

/**
 * Dispatch a tool call to the correct implementation.
 */
async function executeTool(name, args, store) {
  if (name === 'search_properties')  { return search_properties(args, store); }
  if (name === 'capture_lead')       { return capture_lead(args); }
  if (name === 'request_callback')   { return request_callback(args); }
  if (name === 'analyze_sentiment')  { return analyze_sentiment(args); }
  if (name === 'identify_user')      { return identify_user(args); }
  if (name === 'update_preferences') { return update_preferences(args); }
  if (name === 'end_session')        { return end_session(args); }
  return { error: `Unknown tool: ${name}` };
}

/**
 * Expose the memory block text so `show memory` can display it exactly.
 * This makes the injection mechanism transparent to the learner.
 */
export function getMemoryBlock(userContext) {
  return buildSystemPrompt(userContext);
}
