import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import { initLoanStep, updateLoan } from "./loanApplication";
import employerCsvUrl from "@/assets/2025-10-16-jse-listed-companies.csv?url";

const normalizeContractTypeValue = (value) => {
  if (!value) return null;
  const normalized = String(value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const aliasMap = {
    PERMANENT: "PERMANENT",
    PERMANENT_EMPLOYEE: "PERMANENT",
    FULL_TIME: "PERMANENT",
    PROBATION: "PERMANENT_ON_PROBATION",
    PERMANENT_ON_PROBATION: "PERMANENT_ON_PROBATION",
    FIXED_TERM: "FIXED_TERM_LT_12",
    FIXED_TERM_12_PLUS: "FIXED_TERM_12_PLUS",
    FIXED_TERM_12_MONTHS: "FIXED_TERM_12_PLUS",
    FIXED_TERM_12_MONTHS_PLUS: "FIXED_TERM_12_PLUS",
    FIXED_TERM_LT_12: "FIXED_TERM_LT_12",
    FIXED_TERM_LT_12_MONTHS: "FIXED_TERM_LT_12",
    FIXED_TERM_UNDER_12: "FIXED_TERM_LT_12",
    FIXED_TERM_UNDER_12_MONTHS: "FIXED_TERM_LT_12",
    SELF_EMPLOYED: "SELF_EMPLOYED_12_PLUS",
    SELF_EMPLOYED_12_PLUS: "SELF_EMPLOYED_12_PLUS",
    SELF_EMPLOYED_12_MONTHS_PLUS: "SELF_EMPLOYED_12_PLUS",
    CONTRACTOR: "FIXED_TERM_LT_12",
    PART_TIME: "PART_TIME",
    PARTTIME: "PART_TIME",
    PART_TIME_EMPLOYEE: "PART_TIME",
    UNEMPLOYED: "UNEMPLOYED_OR_UNKNOWN",
    UNKNOWN: "UNEMPLOYED_OR_UNKNOWN",
    UNEMPLOYED_OR_UNKNOWN: "UNEMPLOYED_OR_UNKNOWN"
  };

  return aliasMap[normalized] || normalized || null;
};

const CONTRACT_TYPE_VALUES = new Set([
  "PERMANENT",
  "FIXED_TERM_12_PLUS",
  "FIXED_TERM_LT_12",
  "SELF_EMPLOYED_12_PLUS"
]);

const normalizeSectorValue = (value) => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "listed company" || normalized === "listed") return "listed";
  if (normalized === "government" || normalized === "gov" || normalized === "public") return "government";
  if (normalized === "private") return "private";
  if (normalized === "other") return "other";
  return null;
};

const normalizeYearsAtEmployerValue = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim().toLowerCase();
  if (raw === "<1" || raw === "less than 1" || raw === "lt1") return "<1";
  if (raw === "4+" || raw === "4 plus" || raw === "4plus" || raw === "4+") return "4+";
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;
  if (numeric >= 4) return "4+";
  if (numeric > 0 && numeric < 1) return "<1";
  if (numeric === 1 || numeric === 2 || numeric === 3) return String(numeric);
  return null;
};

const normalizeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseYearsAtEmployerNumber = (value) => {
  if (value === "<1") return 0.5;
  if (value === "4+") return 4;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const buildWarningList = (form, profile) => {
  const warnings = [];
  if (!form.identityNumber) warnings.push("Missing ID number.");
  if (!form.firstName) warnings.push("Missing first name.");
  if (!form.lastName) warnings.push("Missing surname.");
  if (!form.postalCode) warnings.push("Missing postal code.");
  if (!profile?.id_number) warnings.push("Profile ID number not found in Supabase.");
  return warnings;
};

export function useCreditCheck() {
  const [loanRecord, setLoanRecord] = useState(null);
  const [profile, setProfile] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [bankLinked, setBankLinked] = useState(false);
  const [onboardingEmployerName, setOnboardingEmployerName] = useState(null);
  const [onboardingEmploymentType, setOnboardingEmploymentType] = useState(null);
  const [onboardingEmploymentSector, setOnboardingEmploymentSector] = useState(null);
  const [onboardingYearsAtEmployer, setOnboardingYearsAtEmployer] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [intakeError, setIntakeError] = useState("");
  const [locked, setLocked] = useState(false);
  const [engineResult, setEngineResult] = useState(null);
  const [engineStatus, setEngineStatus] = useState("Idle");
  const [mockMode, setMockMode] = useState(null);
  const [employerCsv, setEmployerCsv] = useState([]);
  const [isUpdatingLoan, setIsUpdatingLoan] = useState(false);

  const [form, setForm] = useState({
    identityNumber: "",
    firstName: "",
    lastName: "",
    gender: "",
    dateOfBirth: "",
    address: "",
    postalCode: "0152",
    annualIncome: "",
    annualExpenses: "",
    yearsCurrentEmployer: "",
    contractType: "",
    isNewBorrower: "",
    employmentSector: "",
    employerName: ""
  });



  const setField = useCallback((key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const normalizedContractType = useMemo(
    () => normalizeContractTypeValue(form.contractType),
    [form.contractType]
  );

  const warnings = useMemo(() => buildWarningList(form, profile), [form, profile]);

  useEffect(() => {
    initLoanStep(2, { allowRedirect: false })
      .then((record) => setLoanRecord(record))
      .catch(() => null);
  }, []);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      setLoadingProfile(true);
      setIntakeError("");

      if (!supabase) {
        setIntakeError("Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
        setLoadingProfile(false);
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData?.session;
      if (!session) {
        setIntakeError("Please sign in to continue.");
        setLoadingProfile(false);
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("first_name,last_name,id_number,date_of_birth,gender,address,phone_number")
        .eq("id", session.user.id)
        .maybeSingle();

      if (profileError) {
        console.warn("Profile load error:", profileError?.message);
      }

      const { data: snapshotData } = await supabase
        .from("truid_bank_snapshots")
        .select("avg_monthly_income,avg_monthly_expenses,net_monthly_income")
        .eq("user_id", session.user.id)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: actionsData } = await supabase
        .from("required_actions")
        .select("bank_linked")
        .eq("user_id", session.user.id)
        .maybeSingle();

      const { data: packDetailsRow } = await supabase
        .from("user_onboarding_pack_details")
        .select("pack_details")
        .eq("user_id", session.user.id)
        .maybeSingle();

      const { data: onboardingData } = await supabase
        .from("user_onboarding")
        .select("employer_name,employment_type,employer_industry")
        .eq("user_id", session.user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: engineData } = await supabase
        .from("loan_engine_score")
        .select("years_current_employer")
        .eq("user_id", session.user.id)
        .limit(1)
        .maybeSingle();

      const { count: loanCount } = await supabase
        .from("loan_application")
        .select("id", { count: "exact", head: true })
        .eq("user_id", session.user.id);

      if (!active) return;

      setProfile(profileData || null);
      setSnapshot(snapshotData || null);
      setBankLinked(Boolean(snapshotData || actionsData?.bank_linked));
      const normalizedEmploymentType = normalizeContractTypeValue(onboardingData?.employment_type);
      const contractTypeLocked = Boolean(
        normalizedEmploymentType && CONTRACT_TYPE_VALUES.has(normalizedEmploymentType)
      );

      const normalizedSector = normalizeSectorValue(onboardingData?.employer_industry);
      const sectorLocked = Boolean(normalizedSector);

      const normalizedYearsAtEmployer = normalizeYearsAtEmployerValue(engineData?.years_current_employer);
      const yearsLocked = Boolean(normalizedYearsAtEmployer);

      const packDetails = packDetailsRow?.pack_details || {};
      const packInfo = packDetails?.info || {};
      const packAddresses = Array.isArray(packInfo?.addresses) ? packInfo.addresses : [];
      const packIdDocs = Array.isArray(packInfo?.idDocs) ? packInfo.idDocs : [];
      const firstPackAddress = packAddresses.find((entry) => entry && (entry.street || entry.town || entry.formattedAddress || entry.postCode)) || null;
      const packAddressDoc = packIdDocs.find((entry) => entry?.address?.street || entry?.address?.town || entry?.address?.formattedAddress || entry?.address?.postCode || entry?.rawAddress) || null;

      const packStreet = firstPackAddress?.street || packAddressDoc?.address?.street || null;
      const packTown = firstPackAddress?.town || packAddressDoc?.address?.town || null;
      const packFormattedAddress = firstPackAddress?.formattedAddress || packAddressDoc?.address?.formattedAddress || packAddressDoc?.rawAddress || null;
      const packPostalCode = firstPackAddress?.postCode || packAddressDoc?.address?.postCode || null;

      const resolvedAddress = [packStreet, packTown].filter(Boolean).join(", ") || packFormattedAddress || null;
      const resolvedPostalCodeFromPack = packPostalCode ? String(packPostalCode).trim() : null;

      setOnboardingEmployerName(onboardingData?.employer_name || null);
      setOnboardingEmploymentType(normalizedEmploymentType || null);
      setOnboardingEmploymentSector(normalizedSector || null);
      setOnboardingYearsAtEmployer(normalizedYearsAtEmployer || null);

      setForm((prev) => ({
        ...prev,
        identityNumber: profileData?.id_number || prev.identityNumber,
        firstName: profileData?.first_name || prev.firstName,
        lastName: profileData?.last_name || prev.lastName,
        gender: profileData?.gender || prev.gender,
        dateOfBirth: profileData?.date_of_birth || prev.dateOfBirth,
        address: profileData?.address || resolvedAddress || prev.address,
        postalCode: resolvedPostalCodeFromPack || prev.postalCode || "0152",
        annualIncome: snapshotData?.avg_monthly_income
          ? String(snapshotData.avg_monthly_income * 12)
          : prev.annualIncome,
        annualExpenses: snapshotData?.avg_monthly_expenses
          ? String(snapshotData.avg_monthly_expenses * 12)
          : prev.annualExpenses,
        employerName: onboardingData?.employer_name || prev.employerName,
        contractType: contractTypeLocked
          ? normalizedEmploymentType || prev.contractType
          : prev.contractType,
        employmentSector: sectorLocked
          ? normalizedSector || prev.employmentSector
          : prev.employmentSector,
        yearsCurrentEmployer: yearsLocked
          ? normalizedYearsAtEmployer || prev.yearsCurrentEmployer
          : prev.yearsCurrentEmployer,
        isNewBorrower: (prev.isNewBorrower || "")
          ? prev.isNewBorrower
          : loanCount === 1
            ? "yes"
            : prev.isNewBorrower
      }));

      setLoadingProfile(false);
    }

    loadProfile();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    fetch(employerCsvUrl)
      .then((res) => res.text())
      .then((text) => {
        const lines = text.split(/\r?\n/).filter(Boolean);
        setEmployerCsv(lines.slice(1));
      })
      .catch(() => setEmployerCsv([]));
  }, []);

  const fetchMockMode = useCallback(async () => {
    try {
      const response = await fetch("/api/mock-mode");
      const payload = await response.json();
      const value = payload?.mockMode ?? payload?.mock ?? null;
      setMockMode(value === null ? null : Boolean(value));
    } catch {
      setMockMode(null);
    }
  }, []);

  useEffect(() => {
    fetchMockMode();
  }, [fetchMockMode]);

  const lockInputs = useCallback(() => {
    if (!form.identityNumber || !form.firstName || !form.lastName) {
      setIntakeError("Please complete identity fields before locking inputs.");
      return;
    }
    setLocked(true);
    setIntakeError("");
  }, [form]);

  const editInputs = useCallback(() => {
    setLocked(false);
  }, []);

  const runEngine = useCallback(async () => {
    setEngineStatus("Running");
    setEngineResult(null);

    if (!supabase) {
      setEngineStatus("Failed");
      setIntakeError("Supabase is not configured.");
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;

    const annualIncome = normalizeNumber(form.annualIncome);
    const annualExpenses = normalizeNumber(form.annualExpenses);

    const resolvedPostalCode = String(form.postalCode || "0152").trim() || "0152";

    const payload = {
      loanApplicationId: loanRecord?.id || undefined,
      userData: {
        identity_number: form.identityNumber,
        surname: form.lastName,
        forename: form.firstName,
        gender: form.gender || undefined,
        date_of_birth: form.dateOfBirth || undefined,
        address1: form.address || undefined,
        postal_code: resolvedPostalCode,
        annual_income: annualIncome,
        annual_expenses: annualExpenses,
        gross_monthly_income: annualIncome ? annualIncome / 12 : 0,
        net_monthly_income: annualIncome && annualExpenses ? (annualIncome - annualExpenses) / 12 : 0,
        years_in_current_job: parseYearsAtEmployerNumber(form.yearsCurrentEmployer),
        months_in_current_job: parseYearsAtEmployerNumber(form.yearsCurrentEmployer) * 12,
        contract_type: normalizedContractType,
        employment_sector_type: form.employmentSector,
        employment_employer_name: form.employerName,
        algolend_is_new_borrower: form.isNewBorrower === "yes"
      }
    };

    try {
      const response = await fetch("/api/credit-check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      console.group("[CreditCheck] API Debug");
      console.log("HTTP status:", response.status);
      console.log("success:", result?.success, "ok:", result?.ok);
      console.log("debug:", result?.debug || null);
      console.log("raw.mockMode:", result?.raw?.mockMode);
      console.log("raw.message:", result?.raw?.message);
      console.log("raw.error:", result?.raw?.error);
      console.log("zipDataLength:", result?.debug?.zipDataLength ?? (typeof result?.raw?.zipData === "string" ? result.raw.zipData.length : 0));
      console.groupEnd();
      setEngineResult(result);
      setEngineStatus(result?.success === false || result?.ok === false ? "Failed" : "Complete");
      return result;
    } catch (err) {
      console.error("Credit check engine error:", err);
      const errResult = { success: false, error: err.message || "Network error" };
      setEngineResult(errResult);
      setEngineStatus("Failed");
      return errResult;
    }
  }, [form, normalizedContractType, loanRecord]);

  const proceedToStep3 = useCallback(async () => {
    if (!loanRecord?.id) return;
    setIsUpdatingLoan(true);
    await updateLoan(loanRecord.id, { step_number: 3 });
    setIsUpdatingLoan(false);
  }, [loanRecord]);

  // Hydrate existing score from DB so ResultStage shows previous results
  const hydrateExistingScore = useCallback((dbRow) => {
    if (!dbRow) return;
    const result = dbRow.engine_result || {};
    const score = Number(dbRow.engine_score ?? 0);
    const normalized = {
      ...result,
      success: true,
      loanEngineScoreNormalized: score,
      loanEngineScore: score,
      creditScore: dbRow.experian_score ?? result.creditScore ?? null,
      scoreReasons: dbRow.score_reasons || result.scoreReasons || [],
      // result may be the flat engineResultPayload (factor keys at top level) or
      // a full API response that already has a nested .breakdown key — handle both.
      breakdown: result.breakdown || result,
      creditExposure: {
        totalBalance: dbRow.exposure_total_balance ?? null,
        totalLimits: dbRow.exposure_total_limit ?? null,
        totalMonthlyInstallment: result.totalMonthlyInstallment ?? null,
      },
    };
    setEngineResult(normalized);
    setEngineStatus("Complete");
  }, []);

  const contractTypeLocked = Boolean(
    onboardingEmploymentType && CONTRACT_TYPE_VALUES.has(onboardingEmploymentType)
  );

  const yearsAtEmployerLocked = Boolean(onboardingYearsAtEmployer);
  const sectorLocked = Boolean(onboardingEmploymentSector);

  return {
    form,
    setField,
    normalizedContractType,
    profile,
    snapshot,
    bankLinked,
    loadingProfile,
    intakeError,
    locked,
    lockInputs,
    editInputs,
    engineResult,
    engineStatus,
    runEngine,
    mockMode,
    employerCsv,
    warnings,
    onboardingEmployerName,
    onboardingEmploymentType,
    contractTypeLocked,
    onboardingEmploymentSector,
    sectorLocked,
    onboardingYearsAtEmployer,
    yearsAtEmployerLocked,
    proceedToStep3,
    isUpdatingLoan,
    hydrateExistingScore
  };
}
