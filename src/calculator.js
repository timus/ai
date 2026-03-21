/**
 * Financial calculations for property buying
 * These are estimates — real numbers come from a broker/lender
 */

function estimateStampDuty(propertyPrice) {
  if (propertyPrice <= 300_000) return propertyPrice * 0.025;
  if (propertyPrice <= 500_000) return propertyPrice * 0.035;
  if (propertyPrice <= 1_000_000) return propertyPrice * 0.045;
  return propertyPrice * 0.055;
}

function estimateLMI(loanAmount, lvr) {
  if (lvr <= 80) return 0;
  if (lvr <= 85) return loanAmount * 0.008;
  if (lvr <= 90) return loanAmount * 0.018;
  if (lvr <= 95) return loanAmount * 0.035;
  return loanAmount * 0.045;
}

function calculate(totalSavings, propertyPrice, salary, expenses, exchangeDepositPct) {
  // Deposit IS the exchange deposit — derived from the percentage
  const deposit = propertyPrice * (exchangeDepositPct / 100);
  const loanAmount = propertyPrice - deposit;
  const lvr = (loanAmount / propertyPrice) * 100;

  // Cash remaining after paying the exchange deposit
  const cashAfterDeposit = totalSavings - deposit;

  // Borrowing capacity: ~5x gross annual salary
  const borrowingCapacity = salary * 5;

  // Monthly repayment at ~6.5% over 30 years
  const annualRate = 0.065;
  const monthlyRate = annualRate / 12;
  const numPayments = 30 * 12;
  const monthlyRepayment =
    (loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, numPayments))) /
    (Math.pow(1 + monthlyRate, numPayments) - 1);

  const monthlyIncome = salary / 12;
  const disposableAfterRepayment = monthlyIncome - expenses - monthlyRepayment;

  // Stamp duty & LMI
  const stampDuty = estimateStampDuty(propertyPrice);
  const lmiRequired = lvr > 80;
  const lmiCost = estimateLMI(loanAmount, lvr);

  // Ideal deposit to avoid LMI = 20%
  const idealDeposit = propertyPrice * 0.20;
  const depositVerdict =
    deposit >= idealDeposit
      ? "STRONG — 20%+ deposit, no LMI"
      : cashAfterDeposit > 0
      ? `CONSIDER TOPPING UP — you have $${Math.round(cashAfterDeposit).toLocaleString()} spare after exchange, adding it to your deposit reduces LMI`
      : "LOW — LMI will apply, consider saving more before buying";

  // Upfront cash needed: exchange deposit + stamp duty + legal/inspection
  const legalAndInspection = 3_000;
  const totalUpfrontNeeded = deposit + stampDuty + legalAndInspection;
  const canAffordUpfront = totalSavings >= totalUpfrontNeeded;
  const upfrontGap = Math.max(0, totalUpfrontNeeded - totalSavings);

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
