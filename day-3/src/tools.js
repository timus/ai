/**
 * tools.js — Tool implementations for the property agent.
 *
 * Each function here is called when the LLM decides to invoke that tool.
 * The LLM provides the arguments — we execute the side effect and return a result.
 *
 * Tools:
 *   search_properties   — semantic search over embedded listings (RAG)
 *   capture_lead        — save contact details to NEDB
 *   request_callback    — save callback request to NEDB
 *   analyze_sentiment   — structured sentiment from the LLM, saved to the lead
 */

import { embedQuery }      from './embeddings.js';
import { leads, callbacks, insert, update, findAll } from './database.js';

// Track the most recently captured lead so sentiment can be linked to it
let lastLeadId = null;

/**
 * search_properties — RAG search over the loaded vector store.
 *
 * The LLM calls this when the user asks about properties.
 * We embed the query, find the top-k closest listing vectors, and return
 * the listing text so the LLM can answer from real data.
 */
export async function search_properties({ query }, store) {
  if (!store || store.size === 0) {
    return { error: 'No property data loaded. Run npm run prepare-data first.' };
  }

  const { embedding } = await embedQuery(query);
  const results = store.search(embedding, 5);

  if (results.length === 0) {
    return { found: 0, listings: [] };
  }

  return {
    found: results.length,
    listings: results.map(r => ({
      score:   parseFloat(r.score.toFixed(3)),
      address: r.metadata?.address,
      suburb:  r.metadata?.suburb,
      beds:    r.metadata?.beds,
      baths:   r.metadata?.baths,
      price:   r.metadata?.displayPrice,
      type:    r.metadata?.type,
      text:    r.text,
    })),
  };
}

/**
 * capture_lead — save the user's contact details to NEDB.
 *
 * The LLM calls this when it has collected enough information from the user.
 * The lead is stored with a timestamp and returned with its database _id
 * so subsequent tools (like analyze_sentiment) can link to it.
 */
export async function capture_lead({ name, email, phone, suburb_interest, budget, notes }) {
  const doc = await insert(leads, {
    name,
    email:           email    || null,
    phone:           phone    || null,
    suburb_interest: suburb_interest || null,
    budget:          budget   || null,
    notes:           notes    || null,
    sentiment:       null,    // filled in by analyze_sentiment
    intent:          null,
    readiness_score: null,
  });

  lastLeadId = doc._id;

  return {
    success: true,
    lead_id: doc._id,
    message: `Lead saved for ${name}. Call analyze_sentiment to score this conversation.`,
  };
}

/**
 * request_callback — register that the user wants a human agent to call them.
 *
 * The LLM calls this when the user explicitly asks for a callback
 * or when the agent decides to offer one based on high buying intent.
 */
export async function request_callback({ name, phone, preferred_time }) {
  const doc = await insert(callbacks, {
    name,
    phone,
    preferred_time: preferred_time || 'anytime',
    lead_id:        lastLeadId,
  });

  return {
    success: true,
    callback_id: doc._id,
    message: `Callback registered for ${name} at ${phone}. Preferred time: ${preferred_time || 'anytime'}.`,
  };
}

/**
 * analyze_sentiment — structured sentiment output from the LLM itself.
 *
 * This is the key teaching moment: the LLM fills in the tool parameters
 * based on its own reading of the conversation. No separate API call.
 * The tool schema forces structured output — the model must classify
 * sentiment and intent into defined categories and produce a numeric score.
 *
 * The result is saved back to the most recently captured lead.
 */
export async function analyze_sentiment({ sentiment, intent, readiness_score, key_interests, summary }) {
  const result = { sentiment, intent, readiness_score, key_interests, summary };

  // Link sentiment to the most recently captured lead
  if (lastLeadId) {
    await update(leads, { _id: lastLeadId }, {
      sentiment,
      intent,
      readiness_score,
      key_interests,
      sentiment_summary: summary,
    });
  }

  return {
    success:         true,
    sentiment,
    intent,
    readiness_score,
    key_interests,
    summary,
    linked_to_lead:  lastLeadId || 'none',
  };
}

/**
 * getAllLeads — not an agent tool, used by the CLI `show leads` command.
 */
export async function getAllLeads() {
  return findAll(leads);
}

/**
 * getAllCallbacks — not an agent tool, used by the CLI `show callbacks` command.
 */
export async function getAllCallbacks() {
  return findAll(callbacks);
}
