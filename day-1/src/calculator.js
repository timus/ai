/**
 * calculator.js — Property buying financial calculations
 *
 * All figures here are estimates used to ground the AI's response.
 *
 * WHY WE PRE-CALCULATE INSTEAD OF ASKING THE MODEL:
 * This is a key anti-hallucination technique called "grounding".
 * Instead of asking OpenAI "what is the stamp duty on a $600k property?",
 * we calculate it ourselves and send the answer as a fact.
 *
 * The model then reasons about real numbers — not guessed ones.
 * This is a simplified version of what RAG (Session 3) does at scale.
 *
 * DISCLAIMER: These are rough estimates for learning purposes.
 * Real figures vary by state, lender, and individual circumstances.
 * Always consult a licensed mortgage broker and conveyancer.
 */

/**
 * Estimates stamp duty based on property price.
 *
 * Stamp duty (also called transfer duty) is a government tax paid
 * when you purchase a property. It is calculated as a percentage of
 * the purchase price and varies significantly by state/territory.
 *
 * This function uses national average tiers as a rough estimate.
 * Real rates vary — e.g. NSW, VIC, QLD all have different tables.
 * First home buyers may also qualify for concessions or exemptions.
 *
 * Approximate tiers used here:
 *   Up to $300k   → 2.5%
 *   $300k–$500k   → 3.5%
 *   $500k–$1M     → 4.5%
 *   Over $1M      → 5.5%
 *
 * @param {number} propertyPrice - Purchase price of the property in dollars
 * @returns {number} Estimated stamp duty in dollars
 */
function estimateStampDuty(propertyPrice) {
  if (propertyPrice <= 300_000) return propertyPrice * 0.025;
  if (propertyPrice <= 500_000) return propertyPrice * 0.035;
  if (propertyPrice <= 1_000_000) return propertyPrice * 0.045;
  return propertyPrice * 0.055;
}

/**
 * Estimates Lenders Mortgage Insurance (LMI) based on LVR.
 *
 * WHAT IS LMI?
 * LMI is insurance that protects the LENDER (not you) if you default on
 * your loan and the property sells for less than what you owe.
 *
 * It is required when your LVR (Loan to Value Ratio) exceeds 80% —
 * meaning you are borrowing more than 80% of the property's value.
 *
 * LMI can typically be added to your loan (capitalised) rather than
 * paid upfront, but it increases your total loan amount and repayments.
 *
 * HOW TO AVOID LMI:
 * Save a 20% deposit. That brings LVR to 80% or below.
 * On a $600,000 property: 20% = $120,000 deposit → no LMI.
 *
 * Approximate LMI tiers used here (% of loan amount):
 *   LVR ≤ 80%  → $0 (no LMI)
 *   LVR ≤ 85%  → 0.8%
 *   LVR ≤ 90%  → 1.8%
 *   LVR ≤ 95%  → 3.5%
 *   LVR > 95%  → 4.5%
 *
 * @param {number} loanAmount - Total amount being borrowed in dollars
 * @param {number} lvr        - Loan to Value Ratio as a percentage (e.g. 85)
 * @returns {number} Estimated LMI cost in dollars (0 if LVR ≤ 80%)
 */
function estimateLMI(loanAmount, lvr) {
  if (lvr <= 80) return 0;
  if (lvr <= 85) return loanAmount * 0.008;
  if (lvr <= 90) return loanAmount * 0.018;
  if (lvr <= 95) return loanAmount * 0.035;
  return loanAmount * 0.045;
}

/**
 * Runs all property buying calculations from the user's inputs.
 *
 * KEY CONCEPTS:
 *
 * Exchange Deposit:
 *   When you sign a contract of sale, you must pay a deposit to the vendor
 *   immediately — typically 10% of the purchase price. This is separate from
 *   your loan. It comes from your own savings and is paid on the day contracts
 *   are exchanged (before settlement).
 *
 * LVR (Loan to Value Ratio):
 *   LVR = (Loan Amount / Property Price) × 100
 *   Example: $480k loan on a $600k property = 80% LVR
 *   The lower your LVR, the less risk for the lender → better rates, no LMI.
 *
 * Borrowing Capacity:
 *   A rough estimate of how much a lender will approve.
 *   Rule of thumb: ~5× your gross annual salary.
 *   Actual capacity depends on your debts, credit history, and lender policy.
 *
 * Monthly Repayment Formula:
 *   Uses the standard amortisation formula:
 *   M = P × [r(1+r)^n] / [(1+r)^n - 1]
 *   Where P = principal, r = monthly rate, n = number of payments
 *   Assumes 6.5% annual interest over 30 years — confirm with your lender.
 *
 * @param {number} totalSavings      - All cash you have available (dollars)
 * @param {number} propertyPrice     - Purchase price of the property (dollars)
 * @param {number} salary            - Gross annual salary (dollars)
 * @param {number} expenses          - Monthly living expenses (dollars)
 * @param {number} exchangeDepositPct - Deposit required at exchange as a % (e.g. 10)
 *
 * @returns {{
 *   deposit: number,               Exchange deposit amount ($)
 *   loanAmount: number,            Amount to borrow ($)
 *   lvr: string,                   Loan to Value Ratio (%)
 *   cashAfterDeposit: number,      Cash left after paying exchange deposit ($)
 *   borrowingCapacity: number,     Estimated max borrowing (~5x salary) ($)
 *   canBorrow: boolean,            Whether loan is within borrowing capacity
 *   monthlyRepayment: number,      Estimated monthly repayment ($)
 *   disposableAfterRepayment: number, Monthly cash left after repayment ($)
 *   stampDuty: number,             Estimated stamp duty ($)
 *   lmiRequired: boolean,          Whether LMI applies (LVR > 80%)
 *   lmiCost: number,               Estimated LMI cost ($)
 *   idealDeposit: number,          20% deposit to avoid LMI ($)
 *   depositVerdict: string,        Advice on whether to top up deposit
 *   legalAndInspection: number,    Fixed estimate for legal + inspection ($)
 *   totalUpfrontNeeded: number,    Total cash needed before settlement ($)
 *   canAffordUpfront: boolean,     Whether savings cover all upfront costs
 *   upfrontGap: number,            Shortfall amount if savings are insufficient ($)
 *   monthsToSave: number|null,     Months needed to save the gap (null if none)
 * }}
 */
function calculate(totalSavings, propertyPrice, salary, expenses, exchangeDepositPct) {
  // Deposit IS the exchange deposit — derived from the percentage input.
  // We calculate it rather than asking the user for a dollar amount
  // because percentage is how lenders and contracts express it.
  const deposit = propertyPrice * (exchangeDepositPct / 100);
  const loanAmount = propertyPrice - deposit;
  const lvr = (loanAmount / propertyPrice) * 100;

  // How much cash remains after handing over the exchange deposit.
  // This goes toward stamp duty, legal fees, and building inspections.
  const cashAfterDeposit = totalSavings - deposit;

  // Conservative borrowing estimate: 5× gross annual salary.
  // Actual lender assessment is more complex (HEM, existing debts, etc.)
  const borrowingCapacity = salary * 5;

  // Standard amortisation formula — P × [r(1+r)^n] / [(1+r)^n - 1]
  // Assumes 6.5% p.a. interest rate, 30-year loan term.
  // This is an estimate — actual rate depends on lender and credit profile.
  const annualRate = 0.065;
  const monthlyRate = annualRate / 12;
  const numPayments = 30 * 12;
  const monthlyRepayment =
    (loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, numPayments))) /
    (Math.pow(1 + monthlyRate, numPayments) - 1);

  const monthlyIncome = salary / 12;

  // Positive = you have money left after bills and mortgage.
  // Negative = the repayment alone exceeds your income minus expenses.
  const disposableAfterRepayment = monthlyIncome - expenses - monthlyRepayment;

  const stampDuty = estimateStampDuty(propertyPrice);

  // LMI threshold: if LVR exceeds 80%, lender requires insurance.
  const lmiRequired = lvr > 80;
  const lmiCost = estimateLMI(loanAmount, lvr);

  // 20% is the magic number — it brings LVR to exactly 80% and eliminates LMI.
  const idealDeposit = propertyPrice * 0.20;

  // Deposit verdict: tells the buyer whether their deposit strategy is optimal.
  // If they have spare cash after exchange, they could add it to the deposit
  // to reduce their loan amount and potentially avoid LMI.
  const depositVerdict =
    deposit >= idealDeposit
      ? "STRONG — 20%+ deposit, no LMI"
      : cashAfterDeposit > 0
      ? `CONSIDER TOPPING UP — you have $${Math.round(cashAfterDeposit).toLocaleString()} spare after exchange, adding it to your deposit reduces LMI`
      : "LOW — LMI will apply, consider saving more before buying";

  // Fixed estimate for solicitor/conveyancer + building & pest inspection.
  // Real costs: conveyancer $1,500–$3,000 + inspection $400–$700.
  const legalAndInspection = 3_000;

  // Total cash you need on day one:
  //   exchange deposit + stamp duty + legal & inspection fees
  // Note: LMI is usually capitalised into the loan, so not included here.
  const totalUpfrontNeeded = deposit + stampDuty + legalAndInspection;
  const canAffordUpfront = totalSavings >= totalUpfrontNeeded;
  const upfrontGap = Math.max(0, totalUpfrontNeeded - totalSavings);

  // How long it would take to save the gap based on monthly surplus.
  const monthlySurplus = monthlyIncome - expenses;
  const monthsToSave = monthlySurplus > 0 && upfrontGap > 0
    ? Math.ceil(upfrontGap / monthlySurplus)
    : null;

  return {
    deposit: Math.round(deposit),
    loanAmount: Math.round(loanAmount),
    lvr: lvr.toFixed(1),
    cashAfterDeposit: Math.round(cashAfterDeposit),
    borrowingCapacity,
    canBorrow: loanAmount <= borrowingCapacity,
    monthlyRepayment: Math.round(monthlyRepayment),
    disposableAfterRepayment: Math.round(disposableAfterRepayment),
    stampDuty: Math.round(stampDuty),
    lmiRequired,
    lmiCost: Math.round(lmiCost),
    idealDeposit: Math.round(idealDeposit),
    depositVerdict,
    legalAndInspection,
    totalUpfrontNeeded: Math.round(totalUpfrontNeeded),
    canAffordUpfront,
    upfrontGap: Math.round(upfrontGap),
    monthsToSave,
  };
}

export { calculate };
