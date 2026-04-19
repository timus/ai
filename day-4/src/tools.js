/**
 * tools.js — Tool implementations for the property agent with memory.
 *
 * Day 3 tools (unchanged):
 *   search_properties   — semantic search over embedded listings (RAG)
 *   capture_lead        — save contact details to NEDB
 *   request_callback    — save callback request to NEDB
 *   analyze_sentiment   — structured sentiment from the LLM, saved to the lead
 *
 * Day 4 tools (new — memory layer):
 *   identify_user       — find or create a user profile; load their history
 *   update_preferences  — persist whatever the user mentions about what they want
 *   end_session         — save an LLM-written summary of this conversation
 *
 * Module-level state (same pattern as lastLeadId from Day 3):
 *   lastLeadId   — links capture_lead → analyze_sentiment within a turn
 *   currentUser  — set by identify_user, used by update_preferences and end_session
 */

import { embedQuery }                            from './embeddings.js';
import { leads, callbacks, users, insert, update, findAll, findOne } from './database.js';
import { loadUserContext, saveSessionSummary }   from './memory.js';

let lastLeadId  = null;
let currentUser = null; // set by identify_user, read by update_preferences and end_session

// ── Day 3 tools ───────────────────────────────────────────────────────────

/**
 * search_properties — RAG search over the loaded vector store.
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
 */
export async function capture_lead({ name, email, phone, suburb_interest, budget, notes }) {
  const doc = await insert(leads, {
    name,
    email:           email    || null,
    phone:           phone    || null,
    suburb_interest: suburb_interest || null,
    budget:          budget   || null,
    notes:           notes    || null,
    sentiment:       null,
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
 * analyze_sentiment — structured sentiment output, written by the LLM itself.
 *
 * The tool schema forces the LLM to classify sentiment + intent into defined
 * categories and produce a numeric readiness score. No separate API call.
 */
export async function analyze_sentiment({ sentiment, intent, readiness_score, key_interests, summary }) {
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
    success:        true,
    sentiment,
    intent,
    readiness_score,
    key_interests,
    summary,
    linked_to_lead: lastLeadId || 'none',
  };
}

// ── Day 4 tools — memory layer ────────────────────────────────────────────

/**
 * identify_user — Find or create a user profile and load their session history.
 *
 * This is the "warm start" mechanism. The LLM calls this early in every session.
 * If the user is known, their preferences and last session summary come back
 * immediately — the LLM can reference their history without asking again.
 *
 * Side effect: sets module-level currentUser so update_preferences and
 * end_session can operate without re-loading the user every call.
 */
export async function identify_user({ name, phone, email }) {
  let context = await loadUserContext({ name, phone, email });

  if (context) {
    currentUser = context;
    return {
      is_new_user:        false,
      user_id:            context.userId,
      previous_sessions:  context.sessionCount,
      loaded_preferences: context.preferences,
      last_summary:       context.lastSummary,
    };
  }

  // First visit — create a new user profile
  const doc = await insert(users, {
    name:                 name || 'Unknown',
    phone:                phone || null,
    email:                email || null,
    preferences:          {},
    sessionCount:         0,
    last_session_summary: null,
  });

  currentUser = {
    userId:       doc._id,
    name:         doc.name,
    sessionCount: 0,
    preferences:  {},
    lastSummary:  null,
  };

  return {
    is_new_user:        true,
    user_id:            doc._id,
    previous_sessions:  0,
    loaded_preferences: null,
    last_summary:       null,
  };
}

/**
 * update_preferences — Persist what the user mentions about what they want.
 *
 * Called whenever the user mentions beds, budget, suburb, or timeline.
 * Arrays (preferred_suburbs, must_haves) are merged, not replaced, so
 * calling this twice doesn't lose earlier preferences.
 */
export async function update_preferences({ beds, budget, preferred_suburbs, must_haves, timeline }) {
  if (!currentUser) {
    return { success: false, error: 'No active user. Call identify_user first.' };
  }

  const current = currentUser.preferences ?? {};

  // Merge arrays — append new values, deduplicate
  const mergedSuburbs = dedupe([...(current.preferred_suburbs ?? []), ...(preferred_suburbs ?? [])]);
  const mergedMustHaves = dedupe([...(current.must_haves ?? []), ...(must_haves ?? [])]);

  const updates = {};
  const updated_fields = [];

  if (beds !== undefined)                 { updates['preferences.beds']              = beds;           updated_fields.push('beds'); }
  if (budget !== undefined)               { updates['preferences.budget']            = budget;         updated_fields.push('budget'); }
  if (preferred_suburbs?.length)          { updates['preferences.preferred_suburbs'] = mergedSuburbs;  updated_fields.push('preferred_suburbs'); }
  if (must_haves?.length)                 { updates['preferences.must_haves']        = mergedMustHaves; updated_fields.push('must_haves'); }
  if (timeline !== undefined)             { updates['preferences.timeline']          = timeline;       updated_fields.push('timeline'); }

  if (Object.keys(updates).length === 0) {
    return { success: false, error: 'No preference fields provided.' };
  }

  await update(users, { _id: currentUser.userId }, updates);

  // Keep in-memory state in sync so end_session and show profile are current
  if (beds !== undefined)        { currentUser.preferences.beds              = beds; }
  if (budget !== undefined)      { currentUser.preferences.budget            = budget; }
  if (preferred_suburbs?.length) { currentUser.preferences.preferred_suburbs = mergedSuburbs; }
  if (must_haves?.length)        { currentUser.preferences.must_haves        = mergedMustHaves; }
  if (timeline !== undefined)    { currentUser.preferences.timeline          = timeline; }

  return {
    success:             true,
    updated_fields,
    current_preferences: currentUser.preferences,
  };
}

/**
 * end_session — Save an LLM-written summary of this conversation.
 *
 * The LLM calls this before saying goodbye. The summary is written entirely
 * by the LLM — it decides what is worth remembering. This summary will appear
 * as "Last session:" in the system prompt next time this user connects.
 *
 * Teaching moment: the model writes its own memory. No NLP pipeline, no
 * extraction rules — just the LLM summarising what it thinks matters.
 */
export async function end_session({ summary }) {
  if (!currentUser) {
    return { success: false, error: 'No active user. Call identify_user first.' };
  }

  await saveSessionSummary(currentUser.userId, summary);

  return {
    success:        true,
    summary,
    sessions_total: currentUser.sessionCount + 1,
    message:        'Session saved. This summary will be loaded next time this user connects.',
  };
}

// ── CLI helpers (not agent tools) ─────────────────────────────────────────

export function getCurrentUser() { return currentUser; }

export async function getAllLeads()     { return findAll(leads); }
export async function getAllCallbacks() { return findAll(callbacks); }
export async function getAllUsers()     { return findAll(users); }

// ── Internal ──────────────────────────────────────────────────────────────

function dedupe(arr) {
  return [...new Set(arr.filter(Boolean))];
}
