/**
 * Prompt templates
 *
 * DAY 1 LESSON — Prompt design affects everything:
 * - A vague system prompt → hallucinated interest rates, wrong grant amounts
 * - A grounded system prompt → honest, caveated, useful advice
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
