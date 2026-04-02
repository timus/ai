/**
 * prompts.js — System prompt and user prompt templates
 *
 * WHAT IS A PROMPT?
 * A prompt is the text you send to the model. It has two parts:
 *
 *  1. System prompt — set by the developer. Defines the model's persona,
 *     rules, and constraints. Sent on every call but hidden from the user.
 *
 *  2. User prompt — the actual message. In this app it contains the user's
 *     financial data + pre-calculated figures.
 *
 * DAY 1 LESSON — Prompt design directly affects hallucination:
 *
 *  Vague prompt:
 *    "You are a property advisor. Help the user."
 *    → Model will confidently state interest rates, stamp duty amounts,
 *      grant eligibility — most of which may be outdated or wrong.
 *
 *  Grounded prompt (what we use):
 *    - Explicit rules: "never state interest rates as fact"
 *    - Pre-calculated data: we send LVR, LMI, stamp duty as facts
 *    - Model reasons about real numbers instead of guessing them
 *
 * This is called PROMPT ENGINEERING — shaping model behaviour through
 * careful instruction, not code changes.
 */

/**
 * System prompt — the developer-controlled instructions sent on every API call.
 *
 * STRUCTURE BEST PRACTICES:
 *  - Define the role clearly ("You are a property buying advisor")
 *  - List explicit rules to prevent hallucination
 *  - Tell the model what to focus on
 *  - Keep it concise — every token here is paid for on every call
 *
 * WHY RULES MATTER:
 * LLMs will answer any question confidently by default. Without explicit
 * instructions, the model will happily state a specific interest rate,
 * a grant amount, or legal advice — even if it's wrong or outdated.
 *
 * These rules don't eliminate hallucination — they instruct the model
 * to be honest about uncertainty. True accuracy requires real data (RAG).
 *
 * TOKEN COST OF THIS PROMPT:
 * This system prompt is sent with every single API call.
 * If it's 150 tokens and you make 1,000 calls → 150,000 tokens in system prompts alone.
 * Keeping system prompts tight is important at scale.
 */
const SYSTEM_PROMPT = `You are a property buying advisor. Your job is to give clear,
step-by-step guidance based on the user's financial situation.

IMPORTANT RULES to avoid hallucination:
- Never state specific interest rates as fact — say "rates vary, currently around X% but confirm with your lender"
- Never quote exact government grant amounts — say "check your state/country government website for current schemes"
- Never give legal advice — recommend consulting a conveyancer or solicitor
- If you are unsure about something, say so clearly

Focus on: affordability, next steps, risks, and what to watch out for.
Keep advice practical and actionable.`;

/**
 * Builds the user prompt — the financial situation sent to OpenAI for analysis.
 *
 * GROUNDING TECHNIQUE:
 * Instead of asking "what is the stamp duty on a $600k property?" (hallucination risk),
 * we calculate it in calculator.js and send the answer as a fact:
 *   "Estimated Stamp Duty: $27,000 (varies by state — estimate only)"
 *
 * The model then reasons about our number rather than guessing its own.
 * This is the core principle behind RAG (Retrieval Augmented Generation) —
 * give the model accurate context so it doesn't have to make things up.
 *
 * PROMPT STRUCTURE:
 * Structured sections (INPUTS, CALCULATED FIGURES, etc.) help the model
 * parse the information clearly. Models perform better with organised input
 * than with dense paragraphs of mixed data.
 *
 * NUMBERED QUESTIONS AT THE END:
 * Asking specific numbered questions improves response quality.
 * The model tends to address each point in order, giving you structured output
 * rather than a vague general response.
 *
 * TOKEN COST NOTE:
 * This prompt is only sent once (the first message). Follow-up questions are
 * much shorter — but this full prompt stays in the conversation history,
 * so it's included in the token count of every subsequent call.
 * That's why prompt_tokens grow even when you ask a short follow-up question.
 *
 * @param {object} inputs - Raw user inputs from the CLI
 * @param {number} inputs.propertyPrice     - Property price ($)
 * @param {number} inputs.totalSavings      - Total savings ($)
 * @param {number} inputs.salary            - Annual salary ($)
 * @param {number} inputs.expenses          - Monthly expenses ($)
 * @param {number} inputs.exchangeDepositPct - Exchange deposit (%)
 *
 * @param {object} calc - Pre-calculated figures from calculator.js
 * @returns {string} The full user prompt string ready to send to OpenAI
 */
function buildInitialPrompt(inputs, calc) {
  return `Here is my financial situation for buying a property:

INPUTS:
- Property Price: $${inputs.propertyPrice.toLocaleString()}
- Total Savings: $${inputs.totalSavings.toLocaleString()}
- Annual Salary (gross): $${inputs.salary.toLocaleString()}
- Monthly Expenses: $${inputs.expenses.toLocaleString()}
- Exchange Deposit: ${inputs.exchangeDepositPct}% = $${calc.deposit.toLocaleString()}

CALCULATED FIGURES:
- Loan Amount: $${calc.loanAmount.toLocaleString()}
- Loan to Value Ratio (LVR): ${calc.lvr}%
- Borrowing Capacity (~5x salary): $${calc.borrowingCapacity.toLocaleString()}
- Can Borrow Enough: ${calc.canBorrow ? 'YES' : 'NO — loan exceeds borrowing capacity'}
- Monthly Repayment (6.5%, 30yr): $${calc.monthlyRepayment.toLocaleString()}
- Monthly Disposable After Repayment: $${calc.disposableAfterRepayment.toLocaleString()}
- Cash Left After Exchange Deposit: $${calc.cashAfterDeposit.toLocaleString()}

STAMP DUTY & LMI:
- Estimated Stamp Duty: $${calc.stampDuty.toLocaleString()} (varies by state — estimate only)
- LMI Required (LVR > 80%): ${calc.lmiRequired ? 'YES' : 'No'}
- Estimated LMI Cost: ${calc.lmiRequired ? '$' + calc.lmiCost.toLocaleString() + ' (can be added to loan)' : 'N/A — LVR under 80%'}
- Ideal Deposit to Avoid LMI (20%): $${calc.idealDeposit.toLocaleString()}

DEPOSIT VERDICT:
- ${calc.depositVerdict}

UPFRONT CASH SUMMARY:
- Exchange Deposit: $${calc.deposit.toLocaleString()}
- Stamp Duty: $${calc.stampDuty.toLocaleString()}
- Legal & Inspection (est.): $${calc.legalAndInspection.toLocaleString()}
- Total Upfront Needed: $${calc.totalUpfrontNeeded.toLocaleString()}
- Total Savings Available: $${inputs.totalSavings.toLocaleString()}
- Can Cover All Upfront Costs: ${calc.canAffordUpfront ? 'YES' : 'NO — gap of $' + calc.upfrontGap.toLocaleString()}
${calc.monthsToSave ? `- Months to Save the Gap: ~${calc.monthsToSave} months` : ''}

Based on this, please give me:
1. A clear verdict — can I buy this property now, or should I wait?
2. Deposit advice — should I put more or less down? What does LMI mean for me?
3. What stamp duty and LMI will actually cost me and how to handle them
4. The biggest risks I should know about
5. Step-by-step next steps (what to do first, second, third)
`;
}

export { SYSTEM_PROMPT, buildInitialPrompt };
