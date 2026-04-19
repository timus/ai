/**
 * display.js — Terminal output for the Day 4 agent.
 *
 * Extends Day 3's display with three new functions that make the
 * memory mechanism visible to the learner:
 *
 *   showMemoryContext  — shown at startup: what we loaded from NEDB
 *   showMemoryBlock    — shown by `show memory`: the exact text injected into the system prompt
 *   showProfile        — shown by `show profile`: full user preferences + session history
 *   showSessionSummary — shown after end_session fires: what was just saved
 */

// ── Tool call display ─────────────────────────────────────────────────────

const TOOL_ICONS = {
  search_properties:  '🔍',
  capture_lead:       '📋',
  request_callback:   '📞',
  analyze_sentiment:  '🧠',
  identify_user:      '👤',
  update_preferences: '⚙️ ',
  end_session:        '💾',
};

export function showToolCall(name, args) {
  const icon = TOOL_ICONS[name] ?? '🔧';
  console.log();
  console.log(`  ${icon} Agent calling: ${name}`);
  console.log(`     Arguments: ${JSON.stringify(args, null, 0)}`);
}

export function showToolResult(name, result) {
  if (name === 'search_properties') {
    if (result.error) {
      console.log(`     Result: ${result.error}`);
    } else {
      console.log(`     Result: ${result.found} listings retrieved`);
      result.listings?.slice(0, 2).forEach(l => {
        console.log(`       • ${l.address} — ${l.price || 'contact agent'} (score: ${l.score})`);
      });
    }
  } else if (name === 'capture_lead') {
    console.log(`     Result: ${result.success ? `Lead saved (ID: ${result.lead_id})` : result.error}`);
  } else if (name === 'request_callback') {
    console.log(`     Result: ${result.success ? 'Callback registered' : result.error}`);
  } else if (name === 'analyze_sentiment') {
    const score = result.readiness_score;
    const bar   = '█'.repeat(score) + '░'.repeat(10 - score);
    console.log(`     Result: ${result.sentiment} | ${result.intent} | readiness ${score}/10`);
    console.log(`     [${bar}] "${result.summary}"`);
  } else if (name === 'identify_user') {
    if (result.is_new_user) {
      console.log(`     Result: New user created (ID: ${result.user_id})`);
    } else {
      console.log(`     Result: Returning user — ${result.previous_sessions} previous session(s)`);
      if (result.loaded_preferences && Object.keys(result.loaded_preferences).length) {
        console.log(`     Loaded: ${JSON.stringify(result.loaded_preferences)}`);
      }
    }
  } else if (name === 'update_preferences') {
    if (result.success) {
      console.log(`     Result: Updated — ${result.updated_fields?.join(', ')}`);
      console.log(`     Current: ${JSON.stringify(result.current_preferences)}`);
    } else {
      console.log(`     Result: ${result.error}`);
    }
  } else if (name === 'end_session') {
    if (result.success) {
      console.log(`     Result: Session #${result.sessions_total} saved`);
      console.log(`     Summary: "${result.summary?.slice(0, 100)}${result.summary?.length > 100 ? '...' : ''}"`);
    } else {
      console.log(`     Result: ${result.error}`);
    }
  }
}

// ── Turn stats ────────────────────────────────────────────────────────────

function bar(value, max, width = 28) {
  const filled = max === 0 ? 0 : Math.round((value / max) * width);
  return '█'.repeat(Math.min(filled, width)) + '░'.repeat(Math.max(0, width - filled));
}

export function showTurnStats(result, turnNumber) {
  const max = Math.max(result.promptTokens, result.completionTokens, 500);
  console.log();
  console.log(`  ── Turn #${turnNumber} ─────────────────────────────────────────────`);
  console.log(`  Prompt   [${bar(result.promptTokens,     max)}] ${String(result.promptTokens).padStart(5)} tokens`);
  console.log(`  Reply    [${bar(result.completionTokens, max)}] ${String(result.completionTokens).padStart(5)} tokens`);
  console.log(`  Cost     $${result.cost.toFixed(6)} USD  |  Tools called: ${result.toolCallsMade.length}`);
  console.log();
}

// ── Memory display ────────────────────────────────────────────────────────

/**
 * Show the memory block at session start — immediately after the user is identified.
 *
 * This is the tutorial's "aha moment": Session 1 shows a blank slate,
 * Session 2 shows real data that will be injected into the system prompt.
 * Students can see exactly what the LLM gets told before answering.
 */
export function showMemoryContext(userContext) {
  console.log();
  if (!userContext) {
    console.log('  ── Memory ──────────────────────────────────────────────────');
    console.log('  No user profile found. Starting fresh.');
    console.log('  Agent will ask for your name and start building your profile.');
  } else {
    const p = userContext.preferences ?? {};
    console.log('  ── Memory: Returning User Loaded ───────────────────────────');
    console.log(`  Name:     ${userContext.name}`);
    console.log(`  Sessions: ${userContext.sessionCount}`);
    if (p.beds)                        { console.log(`  Beds:     ${p.beds}+`); }
    if (p.budget)                      { console.log(`  Budget:   ${p.budget}`); }
    if (p.preferred_suburbs?.length)   { console.log(`  Suburbs:  ${p.preferred_suburbs.join(', ')}`); }
    if (p.must_haves?.length)          { console.log(`  Wants:    ${p.must_haves.join(', ')}`); }
    if (p.timeline)                    { console.log(`  Timeline: ${p.timeline}`); }
    if (userContext.lastSummary) {
      console.log(`  Last:     "${userContext.lastSummary}"`);
    }
    console.log();
    console.log(`  → Agent will greet ${userContext.name} by name and open with relevant listings.`);
  }
  console.log();
}

/**
 * Show the exact text that will be injected into the system prompt this session.
 * Used by the `show memory` CLI command.
 *
 * This makes the mechanism completely transparent — students see the string
 * the LLM receives as its first instruction, built from their NEDB data.
 */
export function showMemoryBlock(systemPromptText) {
  console.log();
  console.log('  ── System Prompt (memory block) ────────────────────────────');
  console.log();
  const lines = systemPromptText.split('\n');
  lines.forEach(l => console.log(`  ${l}`));
  console.log();
}

/**
 * Show the summary that was just saved to NEDB after end_session.
 * Appears after the agent's reply to show what will be remembered next time.
 */
export function showSessionSummary(summary) {
  console.log();
  console.log('  ── Session Saved ───────────────────────────────────────────');
  console.log(`  "${summary}"`);
  console.log('  This will appear as "Last session" the next time you connect.');
  console.log();
}

// ── Profile display ───────────────────────────────────────────────────────

/**
 * Show the full user profile for the `show profile` command.
 */
export function showProfile(user) {
  console.log();
  if (!user) {
    console.log('  No active user. Start a conversation first.');
    console.log();
    return;
  }

  const p = user.preferences ?? {};
  console.log('  ── User Profile ────────────────────────────────────────────');
  console.log(`  Name:     ${user.name}`);
  if (user.phone) { console.log(`  Phone:    ${user.phone}`); }
  if (user.email) { console.log(`  Email:    ${user.email}`); }
  console.log(`  Sessions: ${user.sessionCount ?? 0}`);
  console.log();
  console.log('  Preferences:');
  if (p.beds)                      { console.log(`    Beds:     ${p.beds}+`); }
  if (p.budget)                    { console.log(`    Budget:   ${p.budget}`); }
  if (p.preferred_suburbs?.length) { console.log(`    Suburbs:  ${p.preferred_suburbs.join(', ')}`); }
  if (p.must_haves?.length)        { console.log(`    Wants:    ${p.must_haves.join(', ')}`); }
  if (p.timeline)                  { console.log(`    Timeline: ${p.timeline}`); }
  if (!Object.keys(p).length)      { console.log('    (no preferences recorded yet)'); }
  if (user.lastSummary) {
    console.log();
    console.log(`  Last session: "${user.lastSummary}"`);
  }
  console.log();
}

// ── Leads display ─────────────────────────────────────────────────────────

const INTENT_COLOUR = {
  ready_to_buy: '🟢',
  interested:   '🟡',
  browsing:     '⚪',
};

export function showLeads(leads) {
  console.log();
  if (leads.length === 0) {
    console.log('  No leads captured yet.');
    console.log();
    return;
  }
  console.log(`  ── Captured Leads (${leads.length}) ────────────────────────────────`);
  console.log();
  for (const l of leads) {
    const icon  = INTENT_COLOUR[l.intent] ?? '⚪';
    const score = l.readiness_score != null ? `${l.readiness_score}/10` : 'not scored';
    console.log(`  ${icon}  ${l.name}`);
    if (l.email)           { console.log(`       Email:    ${l.email}`); }
    if (l.phone)           { console.log(`       Phone:    ${l.phone}`); }
    if (l.suburb_interest) { console.log(`       Suburb:   ${l.suburb_interest}`); }
    if (l.budget)          { console.log(`       Budget:   ${l.budget}`); }
    if (l.sentiment)       { console.log(`       Sentiment: ${l.sentiment} | ${l.intent} | readiness ${score}`); }
    if (l.sentiment_summary) { console.log(`       "${l.sentiment_summary}"`); }
    console.log(`       Captured: ${l.createdAt}`);
    console.log();
  }
}

// ── Callbacks display ─────────────────────────────────────────────────────

export function showCallbacks(cbs) {
  console.log();
  if (cbs.length === 0) {
    console.log('  No callback requests yet.');
    console.log();
    return;
  }
  console.log(`  ── Callback Requests (${cbs.length}) ──────────────────────────────`);
  console.log();
  for (const c of cbs) {
    console.log(`  📞  ${c.name}  —  ${c.phone}`);
    console.log(`       Preferred time: ${c.preferred_time}`);
    console.log(`       Requested:      ${c.createdAt}`);
    console.log();
  }
}
