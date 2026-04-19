/**
 * memory.js — Load and save persistent user memory.
 *
 * This file is the bridge between the database and the system prompt.
 *
 * THE CORE IDEA:
 *   LLMs have no memory. They only know what is in the context window.
 *   To give them memory, we:
 *     1. Store facts in NEDB between sessions (this file + database.js)
 *     2. Load those facts at startup (loadUserContext)
 *     3. Format them as text and inject into the system prompt (agent.js)
 *
 * The LLM then "remembers" because it reads the injected text — not because
 * it has any persistent state. It is the same mechanism as telling a new
 * colleague: "By the way, this client prefers 3 bedrooms and has a $800k budget."
 *
 * Two responsibilities:
 *   loadUserContext   — fetch user + sessions from NEDB, return a structured object
 *   saveSessionSummary — append a session summary and update the user's cached last_session_summary
 */

import { users, sessions, findOne, findAll, insert, update } from './database.js';

/**
 * Load everything we know about a user from prior sessions.
 *
 * We try identifiers in order: phone (most unique) → email → name.
 * For a tutorial, first-match on name is fine. In production you would
 * prompt for a secondary identifier to disambiguate duplicate names.
 *
 * @param {{ name?: string, phone?: string, email?: string }} identifier
 * @returns {Promise<UserContext|null>}
 *   null if this is a new user.
 *   UserContext object if found:
 *   {
 *     userId:       string,
 *     name:         string,
 *     sessionCount: number,
 *     preferences:  { beds, budget, preferred_suburbs, must_haves, timeline },
 *     lastSummary:  string | null,
 *     sessions:     [{ summary, createdAt }, ...]   ← most recent first
 *   }
 */
export async function loadUserContext(identifier) {
  if (!identifier || (!identifier.name && !identifier.phone && !identifier.email)) {
    return null;
  }

  let user = null;

  // Try phone first — it is the most reliable unique identifier
  if (identifier.phone) {
    user = await findOne(users, { phone: identifier.phone });
  }
  if (!user && identifier.email) {
    user = await findOne(users, { email: identifier.email });
  }
  if (!user && identifier.name && identifier.name.trim()) {
    user = await findOne(users, { name: identifier.name.trim() });
  }

  if (!user) {
    return null;
  }

  const userSessions = await findAll(sessions, { userId: user._id });

  return {
    userId:       user._id,
    name:         user.name,
    phone:        user.phone,
    email:        user.email,
    sessionCount: user.sessionCount ?? 0,
    preferences:  user.preferences ?? {},
    lastSummary:  user.last_session_summary ?? null,
    sessions:     userSessions.map(s => ({ summary: s.summary, createdAt: s.createdAt })),
  };
}

/**
 * Append a session summary to the user's history.
 *
 * Writes a new document to the sessions collection and updates
 * the user's last_session_summary field for fast injection next visit.
 * Also increments sessionCount.
 *
 * @param {string} userId   — NEDB _id of the user
 * @param {string} summary  — plain text summary written by the LLM via end_session tool
 */
export async function saveSessionSummary(userId, summary) {
  await insert(sessions, { userId, summary });
  await update(users, { _id: userId }, {
    last_session_summary: summary,
    sessionCount: await getSessionCount(userId),
  });
}

async function getSessionCount(userId) {
  const all = await findAll(sessions, { userId });
  return all.length;
}
