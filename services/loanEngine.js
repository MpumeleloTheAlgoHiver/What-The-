const CREDIT_SCORE_MIN = 300;
const CREDIT_SCORE_MAX = 850;
const CREDIT_SCORE_WEIGHT = 25; // percent
const CREDIT_UTILIZATION_WEIGHT = 5; // percent
const ADVERSE_LISTINGS_WEIGHT = 10; // percent
const INCOME_STABILITY_WEIGHT = 10; // percent
const DTI_WEIGHT = 10; // percent
const BANK_STATEMENT_CASHFLOWS_WEIGHT = 10; // percent
const EMPLOYMENT_TENURE_WEIGHT = 5; // percent
const EMPLOYMENT_CATEGORY_WEIGHT = 5; // percent
const CONTRACT_TYPE_WEIGHT = 5; // percent
const ALGOHIVE_BEHAVIOURAL_WEIGHT = 15; // percent

const TOTAL_LOAN_ENGINE_WEIGHT = CREDIT_SCORE_WEIGHT
  + CREDIT_UTILIZATION_WEIGHT
  + ADVERSE_LISTINGS_WEIGHT
  + INCOME_STABILITY_WEIGHT
  + DTI_WEIGHT
  + BANK_STATEMENT_CASHFLOWS_WEIGHT
  + EMPLOYMENT_TENURE_WEIGHT
  + EMPLOYMENT_CATEGORY_WEIGHT
  + CONTRACT_TYPE_WEIGHT
  + ALGOHIVE_BEHAVIOURAL_WEIGHT;

function clampToRange(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toFiniteNumber(value, fallback = null) {
  const normalized = typeof value === 'string'
    ? value.replace(/[^0-9.-]/g, '')
    : value;
  if (normalized === '' || normalized === null || typeof normalized === 'undefined') {
    return fallback;
  }
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function readSummaryNumber(row = {}, keys = [], fallback = 0) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const numeric = toFiniteNumber(row[key], null);
      if (Number.isFinite(numeric)) return numeric;
    }
  }
  return fallback;
}

function summarizeTruidSummaryData(summaryData = []) {
  const rows = Array.isArray(summaryData) ? summaryData.filter(Boolean) : [];
  const monthCount = rows.length;

  const monthlyRows = rows.map((row) => {
    const mainIncome = readSummaryNumber(row, ['main_income', 'mainIncome'], 0);
    const totalIncome = readSummaryNumber(row, ['total_income', 'totalIncome', 'income'], 0);
    const totalExpenses = readSummaryNumber(row, ['total_expenses', 'totalExpenses', 'expenses'], 0);
    const averageExpenses = readSummaryNumber(row, ['average_expenses', 'averageExpenses'], 0);
    const totalDebtRepayments = readSummaryNumber(row, ['total_debt_repayments', 'totalDebtRepayments'], 0);
    const averageDebtRepayments = readSummaryNumber(row, [
      'average_debt_repayments',
      'average__debt_repayments',
      'averageDebtRepayments'
    ], 0);

    return {
      year: row.year ?? null,
      month: row.month ?? null,
      mainIncome,
      totalIncome,
      totalExpenses,
      averageExpenses,
      totalDebtRepayments,
      averageDebtRepayments,
      netCashflow: totalIncome - totalExpenses
    };
  });

  const totals = monthlyRows.reduce((acc, row) => {
    acc.mainIncome += row.mainIncome;
    acc.totalIncome += row.totalIncome;
    acc.totalExpenses += row.totalExpenses;
    acc.totalDebtRepayments += row.totalDebtRepayments || row.averageDebtRepayments || 0;
    acc.averageExpenses += row.averageExpenses;
    return acc;
  }, {
    mainIncome: 0,
    totalIncome: 0,
    totalExpenses: 0,
    totalDebtRepayments: 0,
    averageExpenses: 0
  });

  const divisor = monthCount || 1;
  const averageMonthlyIncome = totals.totalIncome / divisor;
  const averageMonthlyMainIncome = totals.mainIncome / divisor;
  const averageMonthlyExpenses = totals.totalExpenses / divisor;
  const averageMonthlyDebtRepayments = totals.totalDebtRepayments / divisor;
  const averageMonthlyNetCashflow = averageMonthlyIncome - averageMonthlyExpenses;

  return {
    monthCount,
    monthlyRows,
    totalIncome: totals.totalIncome,
    totalMainIncome: totals.mainIncome,
    totalExpenses: totals.totalExpenses,
    totalDebtRepayments: totals.totalDebtRepayments,
    averageMonthlyIncome,
    averageMonthlyMainIncome,
    incomeForDti: averageMonthlyIncome > 0 ? averageMonthlyIncome : averageMonthlyMainIncome,
    averageMonthlyExpenses,
    averageMonthlyDebtRepayments,
    averageMonthlyNetCashflow
  };
}

function standardDeviation(values = []) {
  const numericValues = values.map((value) => Number(value)).filter(Number.isFinite);
  if (!numericValues.length) return null;
  const mean = numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
  const variance = numericValues.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / numericValues.length;
  return Math.sqrt(variance);
}

function computeCreditScoreContribution(score = 0) {
  const clampedScore = Number.isFinite(score) ? score : 0;
  const range = CREDIT_SCORE_MAX - CREDIT_SCORE_MIN;
  const delta = clampedScore - CREDIT_SCORE_MIN;
  const normalizedRatio = range > 0 ? clampToRange(delta / range, 0, 1) : 0;
  const normalizedPercent = normalizedRatio * 100;
  const contributionPercent = normalizedPercent * (CREDIT_SCORE_WEIGHT / 100);

  return {
    score: clampedScore,
    min: CREDIT_SCORE_MIN,
    max: CREDIT_SCORE_MAX,
    delta,
    range,
    normalizedPercent,
    valuePercent: normalizedPercent,
    weightPercent: CREDIT_SCORE_WEIGHT,
    contributionPercent
  };
}

function computeAdverseListingsContribution(creditScoreData = {}) {
  const adverseAccounts = creditScoreData.accountSummary?.adverseAccounts || 0;
  const adverseStatsTotal = creditScoreData.adverseStats?.adverseTotal || 0;
  const totalAdverse = Math.max(adverseAccounts, adverseStatsTotal);

  let valuePercent;
  if (totalAdverse === 0) {
    valuePercent = 100;
  } else if (totalAdverse === 1) {
    valuePercent = 40;
  } else {
    valuePercent = 0;
  }

  const contributionPercent = valuePercent * (ADVERSE_LISTINGS_WEIGHT / 100);

  return {
    totalAdverse,
    valuePercent,
    weightPercent: ADVERSE_LISTINGS_WEIGHT,
    contributionPercent
  };
}

function computeCreditUtilizationContribution(accountMetrics = {}) {
  const rawRatio = accountMetrics.revolvingUtilizationRatio ?? accountMetrics.revolvingUtilizationPercent;
  const ratio = Number.isFinite(rawRatio)
    ? rawRatio
    : Number.isFinite(Number(rawRatio))
      ? Number(rawRatio)
      : null;
  const percentRatio = ratio === null
    ? null
    : ratio > 1 && ratio <= 100
      ? ratio
      : ratio * 100;

  let valuePercent;
  if (!Number.isFinite(percentRatio)) {
    valuePercent = 0;
  } else if (percentRatio <= 30) {
    valuePercent = 100;
  } else if (percentRatio <= 50) {
    valuePercent = 70;
  } else if (percentRatio <= 75) {
    valuePercent = 40;
  } else if (percentRatio <= 90) {
    valuePercent = 20;
  } else {
    valuePercent = 5;
  }

  const contributionPercent = valuePercent * (CREDIT_UTILIZATION_WEIGHT / 100);

  return {
    ratioPercent: Number.isFinite(percentRatio) ? percentRatio : null,
    totalRevolvingLimit: accountMetrics.revolvingLimits || 0,
    totalRevolvingBalance: accountMetrics.revolvingBalance || 0,
    totalLimits: accountMetrics.totalLimits || 0,
    totalBalance: accountMetrics.totalBalance || 0,
    weightPercent: CREDIT_UTILIZATION_WEIGHT,
    valuePercent,
    contributionPercent
  };
}

function normalizeIp(ipAddress) {
  if (!ipAddress) {
    return null;
  }

  const value = typeof ipAddress === 'string' ? ipAddress : String(ipAddress);

  if (value.startsWith('::ffff:')) {
    return value.slice(7);
  }

  return value;
}

function extractClientDeviceMetadata(req) {
  const forwardedHeader = req.headers['x-forwarded-for'];
  const forwardedForChain = typeof forwardedHeader === 'string'
    ? forwardedHeader.split(',').map(entry => entry.trim()).filter(Boolean)
    : [];

  const rawIp = forwardedForChain[0] || req.socket?.remoteAddress || req.ip || null;
  const normalizedIp = normalizeIp(rawIp);

  return {
    ip: normalizedIp,
    rawIp,
    forwardedForChain,
    userAgent: req.headers['user-agent'] || null,
    acceptLanguage: req.headers['accept-language'] || null,
    captureTimestamp: new Date().toISOString()
  };
}

function computeDeviceFingerprintContribution(deviceFingerprint = {}) {
  const signals = ['ip', 'userAgent'];
  const signalsCaptured = signals.reduce((count, signalKey) => (
    deviceFingerprint[signalKey] ? count + 1 : count
  ), 0);
  const requiredSignals = signals.length || 1;
  const completenessRatio = signalsCaptured / requiredSignals;
  const valuePercent = completenessRatio * 100;

  return {
    ...deviceFingerprint,
    signalsCaptured,
    requiredSignals,
    valuePercent,
    weightPercent: 0,
    contributionPercent: 0
  };
}

function computeDTIContribution(totalMonthlyDebt = 0, grossMonthlyIncome = 0, overrides = {}) {
  const truidSummary = summarizeTruidSummaryData(overrides.truid_summary_data || overrides.summaryData || []);
  const truidIncome = truidSummary.incomeForDti;
  const truidDebt = truidSummary.averageMonthlyDebtRepayments;
  const incomeUsed = truidSummary.monthCount > 0 && truidIncome > 0
    ? truidIncome
    : grossMonthlyIncome;
  const debtUsed = truidSummary.monthCount > 0
    ? truidDebt
    : totalMonthlyDebt;

  if (!incomeUsed || incomeUsed <= 0) {
    return {
      dtiRatio: null,
      dtiPercent: null,
      totalMonthlyDebt: debtUsed,
      grossMonthlyIncome: incomeUsed,
      source: truidSummary.monthCount > 0 ? 'truid_summary_data' : 'bureau',
      truidSummary,
      valuePercent: 0,
      weightPercent: DTI_WEIGHT,
      contributionPercent: 0
    };
  }

  const dtiRatio = debtUsed / incomeUsed;
  const dtiPercent = dtiRatio * 100;

  let valuePercent;
  if (dtiPercent <= 35) {
    valuePercent = 100;
  } else if (dtiPercent <= 50) {
    valuePercent = 85;
  } else if (dtiPercent <= 65) {
    valuePercent = 60;
  } else if (dtiPercent <= 75) {
    valuePercent = 35;
  } else {
    valuePercent = 0;
  }

  const contributionPercent = valuePercent * (DTI_WEIGHT / 100);

  return {
    dtiRatio,
    dtiPercent,
    totalMonthlyDebt: debtUsed,
    grossMonthlyIncome: incomeUsed,
    source: truidSummary.monthCount > 0 ? 'truid_summary_data' : 'bureau',
    truidSummary,
    valuePercent,
    weightPercent: DTI_WEIGHT,
    contributionPercent
  };
}

function computeEmploymentTenureContribution(monthsInCurrentJob = null) {
  const numericMonths = Number(monthsInCurrentJob);
  const monthsValue = Number.isFinite(numericMonths) ? Math.max(0, numericMonths) : null;

  let valuePercent;
  if (!Number.isFinite(monthsValue) || monthsValue === null || monthsValue <= 0) {
    valuePercent = 0;
  } else if (monthsValue >= 36) {
    valuePercent = 100;
  } else if (monthsValue >= 24) {
    valuePercent = 80;
  } else if (monthsValue >= 12) {
    valuePercent = 75;
  } else if (monthsValue >= 6) {
    valuePercent = 60;
  } else if (monthsValue >= 3) {
    valuePercent = 55;
  } else if (monthsValue >= 2) {
    valuePercent = 25;
  } else {
    valuePercent = 0;
  }

  const contributionPercent = valuePercent * (EMPLOYMENT_TENURE_WEIGHT / 100);

  return {
    monthsInCurrentJob: monthsValue,
    yearsInCurrentJob: Number.isFinite(monthsValue) && monthsValue !== null ? monthsValue / 12 : null,
    valuePercent,
    weightPercent: EMPLOYMENT_TENURE_WEIGHT,
    contributionPercent
  };
}

function computeContractTypeContribution(contractType = null) {
  const raw = typeof contractType === 'string' ? contractType.trim() : null;
  const normalizedRaw = raw
    ? raw.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    : null;

  const aliasMap = {
    PERMANENT: 'PERMANENT',
    PERMANENT_EMPLOYEE: 'PERMANENT',
    FULL_TIME: 'PERMANENT',
    PROBATION: 'PERMANENT_ON_PROBATION',
    PERMANENT_ON_PROBATION: 'PERMANENT_ON_PROBATION',
    FIXED_TERM: 'FIXED_TERM_LT_12',
    FIXED_TERM_12_PLUS: 'FIXED_TERM_12_PLUS',
    FIXED_TERM_12_MONTHS: 'FIXED_TERM_12_PLUS',
    FIXED_TERM_12_MONTHS_PLUS: 'FIXED_TERM_12_PLUS',
    FIXED_TERM_LT_12: 'FIXED_TERM_LT_12',
    FIXED_TERM_LT_12_MONTHS: 'FIXED_TERM_LT_12',
    FIXED_TERM_UNDER_12: 'FIXED_TERM_LT_12',
    FIXED_TERM_UNDER_12_MONTHS: 'FIXED_TERM_LT_12',
    SELF_EMPLOYED: 'SELF_EMPLOYED_12_PLUS',
    SELF_EMPLOYED_12_PLUS: 'SELF_EMPLOYED_12_PLUS',
    SELF_EMPLOYED_12_MONTHS_PLUS: 'SELF_EMPLOYED_12_PLUS',
    CONTRACTOR: 'FIXED_TERM_LT_12',
    PART_TIME: 'PART_TIME',
    PARTTIME: 'PART_TIME',
    PART_TIME_EMPLOYEE: 'PART_TIME',
    UNEMPLOYED: 'UNEMPLOYED_OR_UNKNOWN',
    UNKNOWN: 'UNEMPLOYED_OR_UNKNOWN',
    UNEMPLOYED_OR_UNKNOWN: 'UNEMPLOYED_OR_UNKNOWN'
  };

  const normalized = normalizedRaw && aliasMap[normalizedRaw]
    ? aliasMap[normalizedRaw]
    : normalizedRaw;

  const valueMap = {
    PERMANENT: 100,
    PERMANENT_ON_PROBATION: 80,
    FIXED_TERM_12_PLUS: 70,
    FIXED_TERM_LT_12: 50,
    SELF_EMPLOYED_12_PLUS: 60,
    PART_TIME: 40,
    UNEMPLOYED_OR_UNKNOWN: 0
  };

  const valuePercent = normalized && Object.prototype.hasOwnProperty.call(valueMap, normalized)
    ? valueMap[normalized]
    : 0;

  const contributionPercent = valuePercent * (CONTRACT_TYPE_WEIGHT / 100);

  const fixedTermMonthsRemaining = normalized === 'FIXED_TERM_12_PLUS'
    ? '12+'
    : normalized === 'FIXED_TERM_LT_12'
      ? '<12'
      : null;

  return {
    contractType: normalized,
    fixedTermMonthsRemaining,
    valuePercent,
    weightPercent: CONTRACT_TYPE_WEIGHT,
    contributionPercent
  };
}

function computeEmploymentCategoryContribution(overrides = {}) {
  const rawSector = typeof overrides.employment_sector_type === 'string'
    ? overrides.employment_sector_type.toUpperCase()
    : null;
  const employerName = overrides.employment_employer_name || null;
  const rawMatch = typeof overrides.employment_employer_match === 'string'
    ? overrides.employment_employer_match.toUpperCase()
    : null;
  const listedMatchName = overrides.employment_listed_match_name || null;

  let valuePercent = 0;
  let matchLabel = 'UNKNOWN';

  if (rawSector === 'GOVERNMENT' && employerName) {
    valuePercent = 100;
    matchLabel = 'GOVERNMENT';
  } else if ((rawSector === 'LISTED' || (rawSector === 'PRIVATE' && rawMatch === 'LISTED')) && employerName) {
    valuePercent = 80;
    matchLabel = 'LISTED';
  } else if (rawSector === 'PRIVATE' && rawMatch === 'HIGH_RISK_MANUAL') {
    valuePercent = 50;
    matchLabel = 'HIGH_RISK';
  } else if (rawMatch === 'BLACKLISTED' || rawMatch === 'NOT_FOUND') {
    valuePercent = 0;
    matchLabel = 'NOT_FOUND';
  } else if (rawSector === 'PRIVATE' && employerName) {
    valuePercent = 50;
    matchLabel = 'HIGH_RISK';
  }

  const contributionPercent = valuePercent * (EMPLOYMENT_CATEGORY_WEIGHT / 100);

  return {
    sector: rawSector,
    employerName,
    matchLabel,
    listedMatchName,
    valuePercent,
    weightPercent: EMPLOYMENT_CATEGORY_WEIGHT,
    contributionPercent
  };
}

function computeIncomeStabilityContribution(overrides = {}) {
  const rawSector = typeof overrides.employment_sector_type === 'string'
    ? overrides.employment_sector_type.toUpperCase()
    : null;
  const employerName = overrides.employment_employer_name || null;
  const monthsCaptured = Number(overrides.truid_months_captured);
  const mainSalary = Number(overrides.truid_main_salary);

  let valuePercent = 0;
  let stabilityReason = 'Income stability not evaluated';

  if (Number.isFinite(monthsCaptured) && monthsCaptured >= 6 && Number.isFinite(mainSalary) && mainSalary > 0) {
    valuePercent = 100;
    stabilityReason = 'TruID snapshot: 6+ months with recurring main salary detected';
  } else if (Number.isFinite(monthsCaptured) && monthsCaptured >= 4 && Number.isFinite(mainSalary) && mainSalary > 0) {
    valuePercent = 85;
    stabilityReason = 'TruID snapshot: 4-5 months with recurring main salary detected';
  } else if (Number.isFinite(monthsCaptured) && monthsCaptured >= 3 && Number.isFinite(mainSalary) && mainSalary > 0) {
    valuePercent = 70;
    stabilityReason = 'TruID snapshot: 3 months with recurring main salary detected';
  } else if (rawSector === 'GOVERNMENT' && employerName) {
    valuePercent = 100;
    stabilityReason = 'Government employee - automatic 100%';
  } else if (Number.isFinite(monthsCaptured) && monthsCaptured >= 1) {
    // Partial TruID snapshot (1–2 months) — not enough history for a full salary pattern,
    // but the bank is connected. Grant 50% if we can see any income in the available months.
    const avgMonthlyIncome = Number(overrides.truid_avg_monthly_income);
    const hasIncomeSignal = (Number.isFinite(avgMonthlyIncome) && avgMonthlyIncome > 0)
      || (Number.isFinite(mainSalary) && mainSalary > 0);
    if (hasIncomeSignal) {
      valuePercent = 50;
      stabilityReason = `TruID snapshot: ${monthsCaptured} month(s) — income signal present, insufficient history for full assessment`;
    } else {
      valuePercent = 0;
      stabilityReason = `TruID snapshot: ${monthsCaptured} month(s) — no recurring income detected`;
    }
  } else {
    valuePercent = 0;
    stabilityReason = 'Pending bank statement or payroll analysis';
  }

  const contributionPercent = valuePercent * (INCOME_STABILITY_WEIGHT / 100);

  return {
    sector: rawSector,
    employerName,
    stabilityReason,
    valuePercent,
    weightPercent: INCOME_STABILITY_WEIGHT,
    contributionPercent
  };
}

function extractMonthlyNetCashflows(summaryData = []) {
  if (!Array.isArray(summaryData)) return [];

  return summaryData
    .map((month) => {
      const income = toFiniteNumber(
        month?.total_income ?? month?.income ?? month?.totalIncome,
        null
      );
      const expenses = toFiniteNumber(
        month?.total_expenses ?? month?.expenses ?? month?.totalExpenses,
        null
      );
      const net = toFiniteNumber(
        month?.net_income ?? month?.net_cashflow ?? month?.netCashflow,
        null
      );

      if (Number.isFinite(net)) return net;
      if (Number.isFinite(income) && Number.isFinite(expenses)) return income - expenses;
      return null;
    })
    .filter(Number.isFinite);
}

function extractAverageBalance(summaryData = [], fallback = null) {
  const fallbackBalance = toFiniteNumber(fallback, null);
  if (!Array.isArray(summaryData) || !summaryData.length) return fallbackBalance;

  const balances = summaryData
    .map((month) => toFiniteNumber(
      month?.average_balance
        ?? month?.avg_balance
        ?? month?.averageBalance
        ?? month?.closing_balance
        ?? month?.closingBalance
        ?? month?.current_balance
        ?? month?.balance,
      null
    ))
    .filter(Number.isFinite);

  if (!balances.length) return fallbackBalance;
  return balances.reduce((sum, value) => sum + value, 0) / balances.length;
}

function computeBankStatementCashflowsContribution(overrides = {}) {
  const summary = summarizeTruidSummaryData(overrides.truid_summary_data || []);
  const monthsCaptured = summary.monthCount || toFiniteNumber(overrides.truid_months_captured, 0);
  const avgMonthlyIncome = summary.monthCount > 0
    ? summary.averageMonthlyIncome
    : toFiniteNumber(overrides.truid_avg_monthly_income, 0);
  const avgMonthlyExpenses = summary.monthCount > 0
    ? summary.averageMonthlyExpenses
    : toFiniteNumber(overrides.truid_avg_monthly_expenses, 0);
  const netMonthlyIncome = summary.monthCount > 0
    ? summary.averageMonthlyNetCashflow
    : toFiniteNumber(
      overrides.truid_net_monthly_income,
      avgMonthlyIncome && avgMonthlyExpenses ? avgMonthlyIncome - avgMonthlyExpenses : 0
    );
  const summaryData = Array.isArray(overrides.truid_summary_data) ? overrides.truid_summary_data : [];
  const monthlyNetCashflows = summary.monthCount > 0
    ? summary.monthlyRows.map((row) => row.netCashflow)
    : extractMonthlyNetCashflows(summaryData);
  const averageBalance = extractAverageBalance(summaryData, overrides.truid_average_balance);

  const netCashflowRatio = avgMonthlyIncome > 0 ? netMonthlyIncome / avgMonthlyIncome : null;
  let netCashflowScore = 0;
  if (Number.isFinite(netCashflowRatio)) {
    if (netCashflowRatio >= 0.25) netCashflowScore = 100;
    else if (netCashflowRatio >= 0.15) netCashflowScore = 85;
    else if (netCashflowRatio >= 0.05) netCashflowScore = 65;
    else if (netCashflowRatio >= 0) netCashflowScore = 45;
    else netCashflowScore = 0;
  }

  let volatilityScore = 0;
  let volatilityRatio = null;
  if (monthlyNetCashflows.length >= 3) {
    const averageNet = monthlyNetCashflows.reduce((sum, value) => sum + value, 0) / monthlyNetCashflows.length;
    const deviation = standardDeviation(monthlyNetCashflows);
    const denominator = Math.max(Math.abs(averageNet), 1);
    volatilityRatio = Number.isFinite(deviation) ? deviation / denominator : null;

    if (volatilityRatio !== null && volatilityRatio <= 0.25) volatilityScore = 100;
    else if (volatilityRatio !== null && volatilityRatio <= 0.5) volatilityScore = 80;
    else if (volatilityRatio !== null && volatilityRatio <= 0.75) volatilityScore = 60;
    else if (volatilityRatio !== null && volatilityRatio <= 1) volatilityScore = 40;
    else volatilityScore = 20;
  } else if (monthsCaptured >= 3 && avgMonthlyIncome > 0) {
    volatilityScore = 50;
  }

  let monthsScore = 0;
  if (monthsCaptured >= 6) monthsScore = 100;
  else if (monthsCaptured >= 4) monthsScore = 85;
  else if (monthsCaptured >= 3) monthsScore = 70;

  let balanceScore = null;
  if (Number.isFinite(averageBalance)) {
    const incomeReference = Math.max(avgMonthlyIncome, 1);
    const balanceRatio = averageBalance / incomeReference;
    if (balanceRatio >= 0.5) balanceScore = 100;
    else if (balanceRatio >= 0.25) balanceScore = 80;
    else if (balanceRatio >= 0.1) balanceScore = 55;
    else if (balanceRatio >= 0) balanceScore = 35;
  }

  const valuePercent = balanceScore === null
    ? (netCashflowScore * 0.45) + (volatilityScore * 0.30) + (monthsScore * 0.25)
    : (netCashflowScore * 0.35) + (volatilityScore * 0.25) + (monthsScore * 0.20) + (balanceScore * 0.20);

  const contributionPercent = valuePercent * (BANK_STATEMENT_CASHFLOWS_WEIGHT / 100);

  return {
    monthsCaptured,
    avgMonthlyIncome,
    avgMonthlyExpenses,
    netMonthlyIncome,
    netCashflowRatio,
    monthlyNetCashflows,
    volatilityRatio,
    averageBalance,
    netCashflowScore,
    volatilityScore,
    monthsScore,
    balanceScore,
    monthlyRows: summary.monthlyRows,
    averageMonthlyDebtRepayments: summary.averageMonthlyDebtRepayments,
    valuePercent,
    weightPercent: BANK_STATEMENT_CASHFLOWS_WEIGHT,
    contributionPercent
  };
}

function computeAlgoHiveBehaviouralContribution(overrides = {}, deviceFingerprint = {}) {
  const hasPackDetails = Boolean(overrides.kyc_has_pack_details);
  const identityVerified = Boolean(overrides.kyc_identity_verified || overrides.identity_number);
  const addressVerified = Boolean(overrides.kyc_address_verified || overrides.address1);
  const normalizedKycResult = String(
    overrides.kyc_result
      ?? overrides.kyc_review_result
      ?? overrides.sumsub_review_result
      ?? overrides.kyc_status
      ?? ''
  ).trim().toUpperCase();
  const explicitKycScore = toFiniteNumber(overrides.kyc_score ?? overrides.algohive_kyc_score, null);

  let kycScore;
  if (Number.isFinite(explicitKycScore)) {
    kycScore = clampToRange(explicitKycScore, 0, 100);
  } else if (['GREEN', 'APPROVED', 'COMPLETED', 'VERIFIED', 'PASS'].includes(normalizedKycResult)) {
    kycScore = 100;
  } else if (['YELLOW', 'REVIEW', 'PENDING', 'MANUAL_REVIEW'].includes(normalizedKycResult)) {
    kycScore = 60;
  } else if (['RED', 'REJECTED', 'FAILED', 'DECLINED'].includes(normalizedKycResult)) {
    kycScore = 0;
  } else {
    kycScore = (hasPackDetails ? 40 : 0) + (identityVerified ? 30 : 0) + (addressVerified ? 20 : 0);
  }

  // Investment activity: any stock holdings or strategy investments on the platform
  // Signals genuine platform engagement — a meaningful trust indicator
  const hasStockHoldings = Boolean(overrides.algohive_has_stock_holdings);
  const hasStrategyInvestments = Boolean(overrides.algohive_has_strategy_investments);
  const hasAnyInvestment = hasStockHoldings || hasStrategyInvestments;
  // Both types of investment present = full score; one type = partial; none = minimal
  const investScore = hasStockHoldings && hasStrategyInvestments
    ? 100
    : hasAnyInvestment
      ? 70
      : 20;

  // Borrower behaviour: returning customers in good standing are lower risk than brand-new applicants.
  // New borrowers have no track record on this platform — they should score lower, not higher.
  const normalizedNewBorrower = typeof overrides.algolend_is_new_borrower === 'string'
    ? overrides.algolend_is_new_borrower.toLowerCase()
    : overrides.algolend_is_new_borrower;
  const isNewBorrower = normalizedNewBorrower === true || normalizedNewBorrower === 'true' || normalizedNewBorrower === 'yes';
  const borrowerBehaviourScore = isNewBorrower ? 40 : 100;

  const valuePercent = (kycScore * 0.70) + (investScore * 0.15) + (borrowerBehaviourScore * 0.15);
  const contributionPercent = valuePercent * (ALGOHIVE_BEHAVIOURAL_WEIGHT / 100);

  return {
    hasPackDetails,
    identityVerified,
    addressVerified,
    kycResult: normalizedKycResult || null,
    kycScore,
    hasStockHoldings,
    hasStrategyInvestments,
    hasAnyInvestment,
    investScore,
    isNewBorrower,
    borrowerBehaviourScore,
    valuePercent,
    weightPercent: ALGOHIVE_BEHAVIOURAL_WEIGHT,
    contributionPercent
  };
}

export {
  TOTAL_LOAN_ENGINE_WEIGHT,
  extractClientDeviceMetadata,
  computeCreditScoreContribution,
  computeAdverseListingsContribution,
  computeCreditUtilizationContribution,
  computeDeviceFingerprintContribution,
  computeDTIContribution,
  computeEmploymentTenureContribution,
  computeContractTypeContribution,
  computeEmploymentCategoryContribution,
  computeIncomeStabilityContribution,
  summarizeTruidSummaryData,
  computeBankStatementCashflowsContribution,
  computeAlgoHiveBehaviouralContribution
};
