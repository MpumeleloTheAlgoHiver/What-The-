/**
 * LendingEngine.js
 * NCR-compliant lending engine for South Africa (National Credit Act).
 * 
 * Features:
 * - Daily interest accrual (monthly_rate / 30)
 * - 4-Day Salary Rule for first repayment
 * - Pro-rated monthly service fee (daily)
 * - Initiation fee with legal caps (R165 + 10% > R1000, capped at R1050)
 * - Identical fixed installments (DebiCheck ready)
 * - Bankers Rounding (ROUND_HALF_UP as specified)
 */

export class LendingEngine {
  constructor({ loanType, principal, originationDate, nextSalaryDate, termMonths }) {
    this.loanType = loanType; // 'unsecured' or 'securitised'
    this.principal = Number(principal);
    this.originationDate = new Date(originationDate);
    this.nextSalaryDate = new Date(nextSalaryDate);
    this.termMonths = Number(termMonths) || 1;

    // NCR Constants
    this.unsecuredRate = 0.048; // 4.8% per month
    this.securitisedRate = 0.040; // 4.0% per month
    this.serviceFeeMonthly = 69.00;
  }

  /**
   * Rounds a number to 2 decimal places using ROUND_HALF_UP (as requested).
   */
  round(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  getMonthlyRate() {
    return this.loanType === 'securitised' ? this.securitisedRate : this.unsecuredRate;
  }

  calculateInitiationFee() {
    let fee = 0;
    if (this.principal <= 1000) {
      fee = 165;
    } else {
      fee = 165 + (this.principal - 1000) * 0.10;
    }
    return this.round(Math.min(fee, 1050));
  }

  /**
   * Implements the 4-Day Rule:
   * IF (next_salary_date - origination_date) <= 4 days:
   *   first_payment_date = following_month_salary_date
   */
  determinePaymentDates() {
    const dates = [];
    const diffTime = this.nextSalaryDate - this.originationDate;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let currentDate = new Date(this.nextSalaryDate);

    // 4-Day Rule Check
    if (diffDays <= 4) {
      currentDate.setMonth(currentDate.getMonth() + 1);
    }

    const salaryDay = this.nextSalaryDate.getDate();

    for (let i = 0; i < this.termMonths; i++) {
      const pDate = new Date(currentDate);
      // Ensure we hit the same day of the month
      pDate.setDate(salaryDay);
      dates.push(pDate);

      // Move to next month
      currentDate.setMonth(currentDate.getMonth() + 1);
    }

    return dates;
  }

  calculateLoan() {
    const initiationFee = this.calculateInitiationFee();
    const paymentDates = this.determinePaymentDates();
    const schedule = [];

    let totalInterest = 0;
    let totalServiceFees = 0;
    let lastDate = new Date(this.originationDate);

    const monthlyRate = this.getMonthlyRate();
    const dailyRate = monthlyRate / 30;
    const dailyServiceFee = this.serviceFeeMonthly / 30;

    for (let i = 0; i < paymentDates.length; i++) {
      const pDate = paymentDates[i];
      const diffTime = pDate - lastDate;
      const days = Math.round(diffTime / (1000 * 60 * 60 * 24));

      const interest = this.round(this.principal * dailyRate * days);
      const serviceFee = this.round(dailyServiceFee * days);

      totalInterest += interest;
      totalServiceFees += serviceFee;

      schedule.push({
        period: i + 1,
        date: pDate.toISOString().split('T')[0],
        days,
        interest,
        serviceFee
      });

      lastDate = pDate;
    }

    const totalRepayable = this.round(this.principal + totalInterest + totalServiceFees + initiationFee);
    const baseInstallment = Math.floor((totalRepayable / this.termMonths) * 100) / 100;

    // Adjust last installment for rounding
    const installments = Array(this.termMonths).fill(baseInstallment);
    const currentSum = this.round(baseInstallment * this.termMonths);
    const diff = this.round(totalRepayable - currentSum);

    if (diff !== 0) {
      installments[this.termMonths - 1] = this.round(installments[this.termMonths - 1] + diff);
    }

    return {
      principal: this.principal,
      totalInterest: this.round(totalInterest),
      totalServiceFees: this.round(totalServiceFees),
      initiationFee,
      totalRepayable,
      installmentAmount: installments[0], // Primary for DebiCheck
      installments,
      schedule: schedule.map((s, idx) => ({
        ...s,
        installment: installments[idx]
      })),
      paymentDates,
      termMonths: this.termMonths,
      monthlyRate: monthlyRate
    };
  }
}
