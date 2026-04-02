/**
 * display.js — Terminal output for the agent teaching display.
 *
 * Shows tool calls as they happen so you can see the agent reasoning in real time:
 *   - Which tool the LLM chose to call and why
 *   - What arguments it decided to pass
 *   - The result fed back to the model
 *   - Token and cost stats per turn
 *   - Lead and callback summaries
 */

// ── Tool call display ─────────────────────────────────────────────────────

const TOOL_ICONS = {
  search_properties: '🔍',
  capture_lead:      '📋',
  request_callback:  '📞',
  analyze_sentiment: '🧠',
};

/**
 * Print the tool call before it executes.
 * This shows which tool the LLM chose and what arguments it provided.
 */
export function showToolCall(name, args) {
  const icon = TOOL_ICONS[name] ?? '🔧';
  console.log();
  console.log(`  ${icon}  Agent calling: ${name}`);
  console.log(`     Arguments: ${JSON.stringify(args, null, 0)}`);
}

/**
 * Print the tool result after it executes.
 * This is what gets sent back to the LLM for its next decision.
 */
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
