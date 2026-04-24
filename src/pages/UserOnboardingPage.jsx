import React, { useEffect, useRef, useState } from "react";
import SumsubVerification from "../components/SumsubVerification";
import MandateViewer from "../components/MandateViewer";
import AccountAgreementStep from "../components/AccountAgreementStep";
import { supabase } from "../lib/supabase";
import { useProfile } from "../lib/useProfile";
import AddressAutocomplete from "../components/AddressAutocomplete";
import "../styles/onboarding-process.css";

const ClipboardCheckIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 5.25H7.5A1.5 1.5 0 0 0 6 6.75v10.5A1.5 1.5 0 0 0 7.5 18.75h9A1.5 1.5 0 0 0 18 17.25V6.75A1.5 1.5 0 0 0 16.5 5.25H15M9 5.25A1.5 1.5 0 0 0 10.5 6.75h3A1.5 1.5 0 0 0 15 5.25M9 5.25A1.5 1.5 0 0 1 10.5 3.75h3A1.5 1.5 0 0 1 15 5.25M9.75 13.5l1.5 1.5 3-3"
    />
  </svg>
);

const ArrowLeftIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
  </svg>
);

const FileContractIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14.25 3.75H8.25a1.5 1.5 0 0 0-1.5 1.5v13.5a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5V9.75m-3-6 3 3m-3-3v3h3"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 13.5h6m-6 3h4"
    />
  </svg>
);

const ShieldIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
    />
  </svg>
);

const WalletIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1 0 6h3.75A2.25 2.25 0 0 0 21 13.5V12Zm0 0V9.75a2.25 2.25 0 0 0-2.25-2.25h-13.5A2.25 2.25 0 0 0 3 9.75v7.5A2.25 2.25 0 0 0 5.25 19.5h13.5A2.25 2.25 0 0 0 21 17.25V12ZM5.25 7.5h13.5A2.25 2.25 0 0 1 21 9.75M5.25 7.5A2.25 2.25 0 0 0 3 9.75M5.25 7.5V6a2.25 2.25 0 0 1 2.25-2.25h9A2.25 2.25 0 0 1 18.75 6v1.5"
    />
  </svg>
);

const BankIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6M4.5 9.75v10.5h15V9.75" />
  </svg>
);

const southAfricanBanks = [
  { value: "", label: "Select your bank", logo: null, branchCode: "" },
  { value: "absa", label: "Absa Bank", logo: "https://logo.clearbit.com/absa.co.za", branchCode: "632005" },
  { value: "access_bank", label: "Access Bank", logo: "https://logo.clearbit.com/accessbank.co.za", branchCode: "410506" },
  { value: "african_bank", label: "African Bank", logo: "https://logo.clearbit.com/africanbank.co.za", branchCode: "430000" },
  { value: "zero", label: "Bank Zero", logo: "https://logo.clearbit.com/bankzero.co.za", branchCode: "888000" },
  { value: "bidvest_bank", label: "Bidvest Bank", logo: "https://logo.clearbit.com/bidvestbank.co.za", branchCode: "462005" },
  { value: "capitec", label: "Capitec Bank", logo: "https://logo.clearbit.com/capitecbank.co.za", branchCode: "470010" },
  { value: "capitec_business", label: "Capitec Business Bank", logo: "https://logo.clearbit.com/capitecbank.co.za", branchCode: "450105" },
  { value: "discovery_bank", label: "Discovery Bank", logo: "https://logo.clearbit.com/discovery.co.za", branchCode: "679000" },
  { value: "fnb", label: "First National Bank (FNB)", logo: "https://logo.clearbit.com/fnb.co.za", branchCode: "250655" },
  { value: "investec", label: "Investec", logo: "https://logo.clearbit.com/investec.com", branchCode: "580105" },
  { value: "nedbank", label: "Nedbank", logo: "https://logo.clearbit.com/nedbank.co.za", branchCode: "198765" },
  { value: "old_mutual", label: "Old Mutual", logo: "https://logo.clearbit.com/oldmutual.co.za", branchCode: "462005" },
  { value: "sasfin", label: "Sasfin Bank", logo: "https://logo.clearbit.com/sasfin.com", branchCode: "683000" },
  { value: "standard_bank", label: "Standard Bank", logo: "https://logo.clearbit.com/standardbank.co.za", branchCode: "051001" },
  { value: "tyme_bank", label: "TymeBank", logo: "https://logo.clearbit.com/tymebank.co.za", branchCode: "678910" },
  { value: "ubank", label: "UBank", logo: "https://logo.clearbit.com/ubank.co.za", branchCode: "431010" },
  { value: "other", label: "Other", logo: null, branchCode: "" },
];

const employmentOptions = [
  { value: "", label: "Select your status" },
  { value: "employed", label: "Employed" },
  { value: "self-employed", label: "Self-Employed" },
  { value: "unemployed", label: "Unemployed" },
  { value: "student", label: "Student" },
  { value: "contractor", label: "Contractor" },
  { value: "retired", label: "Retired" },
];

const sourceOfFundsOptions = [
  { value: "", label: "Select source of funds" },
  { value: "salary", label: "Salary / Employment Income" },
  { value: "business", label: "Business Income" },
  { value: "savings", label: "Savings" },
  { value: "investment_returns", label: "Investment Returns" },
  { value: "inheritance", label: "Inheritance" },
  { value: "gift", label: "Gift" },
  { value: "pension", label: "Pension / Retirement Fund" },
  { value: "property_sale", label: "Sale of Property" },
  { value: "other", label: "Other" },
];

const monthlyInvestmentOptions = [
  { value: "", label: "Select amount range" },
  { value: "under_1000", label: "Less than R1,000" },
  { value: "1000_5000", label: "R1,000 - R5,000" },
  { value: "5000_10000", label: "R5,000 - R10,000" },
  { value: "10000_50000", label: "R10,000 - R50,000" },
  { value: "50000_100000", label: "R50,000 - R100,000" },
  { value: "over_100000", label: "More than R100,000" },
];

const OnboardingProcessPage = ({ onBack, onComplete }) => {
  const { profile, loading: profileLoading } = useProfile();
  const [step, setStep] = useState(0);
  const [isFading, setIsFading] = useState(false);
  const [employmentStatus, setEmploymentStatus] = useState("");
  const [employerName, setEmployerName] = useState("");
  const [employerIndustry, setEmployerIndustry] = useState("");
  const [employmentType, setEmploymentType] = useState("");
  const [institutionName, setInstitutionName] = useState("");
  const [courseName, setCourseName] = useState("");
  const [graduationDate, setGraduationDate] = useState("");
  const [incomeCurrency, setIncomeCurrency] = useState("USD");
  const [annualIncome, setAnnualIncome] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [showProceed, setShowProceed] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedPrivacy, setAgreedPrivacy] = useState(false);
  const [existingOnboardingId, setExistingOnboardingId] = useState(null);
  const [agreedRiskDisclosure, setAgreedRiskDisclosure] = useState(false);
  const [agreedMandate, setAgreedMandate] = useState(false);
  const [mandateValid, setMandateValid] = useState(false);
  const mandateDataRef = useRef(null);
  const [sourceOfFunds, setSourceOfFunds] = useState("");
  const [sourceOfFundsOther, setSourceOfFundsOther] = useState("");
  const [expectedMonthlyInvestment, setExpectedMonthlyInvestment] = useState("");
  const [agreedSourceOfFunds, setAgreedSourceOfFunds] = useState(false);
  const [sofDropdownOpen, setSofDropdownOpen] = useState(false);
  const [bankName, setBankName] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");
  const [bankAccountType, setBankAccountType] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankBranchCode, setBankBranchCode] = useState("");
  const [identityNumber, setIdentityNumber] = useState("");
  const [identityCheckLoading, setIdentityCheckLoading] = useState(false);
  const [identityCheckError, setIdentityCheckError] = useState("");
  const [applicantId, setApplicantId] = useState(null);
  const [bankDropdownOpen, setBankDropdownOpen] = useState(false);
  const bankDropdownRef = useRef(null);
  const [kycAlreadyVerified, setKycAlreadyVerified] = useState(false);
  const [bankDone, setBankDone] = useState(false);
  const [bankLetterDone, setBankLetterDone] = useState(false);
  const [mandateDone, setMandateDone] = useState(false);
  const [riskDone, setRiskDone] = useState(false);
  const [sofDone, setSofDone] = useState(false);
  const [taxDone, setTaxDone] = useState(false);
  const [taxNumber, setTaxNumber] = useState("");
  const [address, setAddress] = useState("");
  const [addressDone, setAddressDone] = useState(false);
  const [addressLoading, setAddressLoading] = useState(false);
  const [termsDone, setTermsDone] = useState(false);
  const [authStatus, setAuthStatus] = useState({
    isChecked: false,
    isAuthenticated: false,
    displayName: "",
  });
  const dropdownRef = useRef(null);
  const sofDropdownRef = useRef(null);

  const selectedOption = employmentOptions.find(
    (option) => option.value === employmentStatus
  );

  const selectedSofOption = sourceOfFundsOptions.find(
    (option) => option.value === sourceOfFunds
  );

  const selectedBankOption = southAfricanBanks.find(
    (option) => option.value === bankName
  );

  const handleBankSelect = (value) => {
    setBankName(value);
    setBankDropdownOpen(false);
    const selected = southAfricanBanks.find((b) => b.value === value);
    if (selected?.branchCode) {
      setBankBranchCode(selected.branchCode);
    } else {
      setBankBranchCode("");
    }
  };

  const bankDetailsReady = bankName && bankAccountName.trim() && bankAccountType && bankAccountNumber && bankBranchCode;

  const goToStep = (nextStep) => {
    setIsFading(true);
    window.setTimeout(() => {
      setStep(nextStep);
      setIsFading(false);
    }, 260);
  };

  const ensureOnboardingRecord = async () => {
    if (existingOnboardingId) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const res = await fetch("/api/onboarding/save-employment", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ employment_status: "not_provided", annual_income_currency: "ZAR" }),
      });
      const result = await res.json();
      if (result.success && result.onboarding_id) {
        setExistingOnboardingId(result.onboarding_id);
      }
    } catch (err) {
      console.error("[Onboarding] Failed to ensure onboarding record:", err);
    }
  };

  const saveProgressFlag = async (flagKey, extraFields) => {
    if (!supabase) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;
      const id = existingOnboardingId || null;
      const query = supabase.from("user_onboarding").select("sumsub_raw");
      const { data: record } = id
        ? await query.eq("id", id).eq("user_id", userId).maybeSingle()
        : await query.eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      let raw = {};
      try { raw = typeof record?.sumsub_raw === "string" ? JSON.parse(record.sumsub_raw) : (record?.sumsub_raw || {}); } catch { }
      raw[flagKey] = true;
      if (extraFields) Object.assign(raw, extraFields);
      const updateQuery = supabase.from("user_onboarding").update({ sumsub_raw: JSON.stringify(raw) });
      const { error } = id
        ? await updateQuery.eq("id", id).eq("user_id", userId)
        : await updateQuery.eq("user_id", userId);
      if (error) console.error("[Onboarding] saveProgressFlag failed for", flagKey, error.message);
    } catch (err) {
      console.error("[Onboarding] saveProgressFlag error for", flagKey, err?.message);
    }
  };

  const getNextIncompleteStep = (afterStep, justCompletedStep) => {
    const identityCheckDone = !!existingOnboardingId || kycAlreadyVerified;
    const steps = [
      { step: 1, done: identityCheckDone },
      { step: 2, done: true },
      { step: 3, done: addressDone },
      { step: 4, done: taxDone },
      { step: 5, done: bankDone },
      { step: 6, done: bankLetterDone },
      { step: 7, done: mandateDone },
      { step: 8, done: riskDone },
      { step: 9, done: sofDone },
      { step: 10, done: termsDone },
      { step: 11, done: agreementSignedDone },
    ];
    for (const s of steps) {
      if (s.step > afterStep && !s.done && s.step !== justCompletedStep) return s.step;
    }
    return 11;
  };

  const handleContinue = async () => {
    if (step === 0) {
      await ensureOnboardingRecord();
      goToStep(getNextIncompleteStep(0));
    }
  };

  const handleIdentityCheckContinue = async () => {
    setIdentityCheckError("");

    const cleanIdNumber = identityNumber.replace(/\D/g, "");
    if (!/^\d{13}$/.test(cleanIdNumber)) {
      setIdentityCheckError("Please enter a valid 13-digit ID number.");
      return;
    }

    if (!supabase) {
      setIdentityCheckError("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      return;
    }

    setIdentityCheckLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setIdentityCheckError("You must be signed in to continue.");
        return;
      }

      const res = await fetch("/api/onboarding/check-id-number", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id_number: cleanIdNumber }),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || "Failed to verify ID number.");
      }

      if (result.exists) {
        const maskedEmail = typeof result.masked_email === "string" ? result.masked_email.trim() : "";
        if (maskedEmail) {
          setIdentityCheckError(`ID already exists, please sign in on ${maskedEmail} to continue.`);
        } else {
          setIdentityCheckError("ID already exists");
        }
        return;
      }

      await ensureOnboardingRecord();

      if (result.applicantId) {
        setApplicantId(result.applicantId);
      }

      // Save the ID number and applicant ID to the onboarding record we just ensured exists
      await saveProgressFlag("identity_details_saved", {
        identity_details: { identity_number: cleanIdNumber, applicantId: result.applicantId, savedAt: new Date().toISOString() },
      });

      goToStep(getNextIncompleteStep(1));
    } catch (err) {
      setIdentityCheckError(err?.message || "Failed to verify ID number.");
    } finally {
      setIdentityCheckLoading(false);
    }
  };

  const getPrevIncompleteStep = (beforeStep) => {
    const identityCheckDone = !!existingOnboardingId || kycAlreadyVerified;
    const steps = [
      { step: 9, done: termsDone },
      { step: 8, done: sofDone },
      { step: 7, done: riskDone },
      { step: 6, done: mandateDone },
      { step: 5, done: bankLetterDone },
      { step: 4, done: bankDone },
      { step: 3, done: taxDone },
      { step: 2, done: true },
      { step: 1, done: identityCheckDone },
    ];
    for (const s of steps) {
      if (s.step < beforeStep && !s.done) return s.step;
    }
    return 0;
  };

  const handleBack = () => {
    if (step >= 1) {
      goToStep(getPrevIncompleteStep(step));
    } else if (onBack) {
      onBack();
    }
  };

  const handleSelect = (value) => {
    setEmploymentStatus(value);
    setIsDropdownOpen(false);
  };

  const handleSofSelect = (value) => {
    setSourceOfFunds(value);
    setSofDropdownOpen(false);
  };

  const toNumericIncome = (value) => {
    if (!value) return null;
    const normalized = value.replace(/[\s,]/g, "");
    const parsed = Number.parseFloat(normalized);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const toGraduationDate = (value) => {
    if (!value) return null;
    return `${value}-01`;
  };

  const handleSubmit = async () => {
    setSubmitError("");
    setSubmitSuccess("");

    if (!employmentStatus) {
      setSubmitError("Please select your employment status.");
      return;
    }

    if (!supabase) {
      setSubmitError("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setSubmitError("You must be signed in to continue.");
        return;
      }

      const payload = {
        employment_status: employmentStatus,
        employer_name: showEmployedSection ? employerName || null : null,
        employer_industry: showEmployedSection ? employerIndustry || null : null,
        employment_type: showEmployedSection ? employmentType || null : null,
        institution_name: showStudentSection ? institutionName || null : null,
        course_name: showStudentSection ? courseName || null : null,
        graduation_date: showStudentSection ? toGraduationDate(graduationDate) : null,
        annual_income_amount: toNumericIncome(annualIncome),
        annual_income_currency: incomeCurrency || "USD",
        existing_onboarding_id: existingOnboardingId || null,
      };

      const res = await fetch("/api/onboarding/save-employment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error || "Failed to save onboarding details.");
      if (result.onboarding_id) {
        setExistingOnboardingId(result.onboarding_id);
      }

      setSubmitSuccess("Onboarding details saved successfully.");
      goToStep(2);
    } catch (err) {
      setSubmitError(err?.message || "Failed to save onboarding details.");
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
      if (sofDropdownRef.current && !sofDropdownRef.current.contains(event.target)) {
        setSofDropdownOpen(false);
      }
      if (bankDropdownRef.current && !bankDropdownRef.current.contains(event.target)) {
        setBankDropdownOpen(false);
      }
    };

    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, []);

  useEffect(() => {
    const loadAuthUser = async () => {
      if (!supabase) {
        setAuthStatus({ isChecked: true, isAuthenticated: false, displayName: "" });
        return;
      }

      try {
        const { data } = await supabase.auth.getUser();
        const user = data?.user;
        if (!user) {
          setAuthStatus({ isChecked: true, isAuthenticated: false, displayName: "" });
          return;
        }

        const displayName =
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.email ||
          "Signed in";

        setAuthStatus({ isChecked: true, isAuthenticated: true, displayName });
      } catch {
        setAuthStatus({ isChecked: true, isAuthenticated: false, displayName: "" });
      }
    };

    loadAuthUser();
  }, []);

  useEffect(() => {
    const loadExistingOnboarding = async () => {
      if (!supabase) return;

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const userId = session?.user?.id;
        if (!token || !userId) return;

        const res = await fetch("/api/onboarding/status", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const result = await res.json();
        if (result.success && result.onboarding_id) {
          setExistingOnboardingId(result.onboarding_id);
        }

        const onboardingId = result.success && result.onboarding_id ? result.onboarding_id : null;
        const recordQuery = supabase
          .from("user_onboarding")
          .select("bank_name, bank_account_number, bank_branch_code, sumsub_raw, kyc_status")
          .eq("user_id", userId);
        const { data: record } = onboardingId
          ? await recordQuery.eq("id", onboardingId).maybeSingle()
          : await recordQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();

        if (record) {
          if (record.bank_name && record.bank_account_number && record.bank_branch_code) {
            setBankDone(true);
            setBankName(record.bank_name);
            setBankAccountNumber(record.bank_account_number);
            setBankBranchCode(record.bank_branch_code);
          }
          let raw = {};
          try { raw = typeof record.sumsub_raw === "string" ? JSON.parse(record.sumsub_raw) : (record.sumsub_raw || {}); } catch { }
          if (raw.bank_details?.bank_account_name) setBankAccountName(raw.bank_details.bank_account_name);
          if (raw.identity_details?.identity_number) {
            setIdentityNumber(raw.identity_details.identity_number);
          }
          if (raw.bank_details?.bank_account_type) setBankAccountType(raw.bank_details.bank_account_type);
          if (raw.tax_details?.tax_number) {
            setTaxNumber(raw.tax_details.tax_number);
            setTaxDone(true);
          }
          if (raw.address_details?.address || record.address) {
            setAddress(raw.address_details?.address || record.address);
            setAddressDone(true);
          }
          if (raw.mandate_data?.agreedMandate === true || raw.mandate_accepted === true) setMandateDone(true);
          if (raw.risk_disclosure_accepted === true) setRiskDone(true);
          if (raw.source_of_funds_accepted === true) setSofDone(true);
          if (raw.source_of_funds_details) {
            const { source_of_funds, source_of_funds_other, expected_monthly_investment } = raw.source_of_funds_details;
            if (source_of_funds) setSourceOfFunds(source_of_funds);
            if (source_of_funds_other) setSourceOfFundsOther(source_of_funds_other);
            if (expected_monthly_investment) setExpectedMonthlyInvestment(expected_monthly_investment);
          }
          if (raw.bank_details_saved === true) setBankDone(true);
          if (raw.bank_letter_uploaded === true) setBankLetterDone(true);
          if (raw.address_saved === true) setAddressDone(true);
          if (raw.terms_accepted === true) setTermsDone(true);
        }
      } catch (err) {
        // ignore; user can still proceed normally
      }
    };

    loadExistingOnboarding();
  }, []);

  useEffect(() => {
    if (!profileLoading && profile && !bankAccountName) {
      const nameFromProfile = [profile.first_name || profile.firstName, profile.last_name || profile.lastName]
        .filter(Boolean).join(" ");
      if (nameFromProfile) {
        setBankAccountName(nameFromProfile);
      }
    }
  }, [profile, profileLoading, bankAccountName]);

  useEffect(() => {
    if (step !== 2) {
      setShowProceed(false);
    }
    if (step !== 8) {
      setAgreedTerms(false);
      setAgreedPrivacy(false);
    }
  }, [step]);

  useEffect(() => {
    const checkKycStatus = async () => {
      try {
        // No apiBase prefix to force relative path
      const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id;
        if (!userId) return;
        const res = await fetch("/api/sumsub/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        const data = await res.json();
        if (data.success && data.status === "verified") {
          setKycAlreadyVerified(true);
          if (step === 2) setShowProceed(true);
        }
      } catch {
      }
    };
    checkKycStatus();
  }, [step]);

  const showEmployedSection =
    employmentStatus === "employed" ||
    employmentStatus === "self-employed" ||
    employmentStatus === "contractor";

  const showStudentSection = employmentStatus === "student";
  const agreementReady = agreedTerms && agreedPrivacy;
  const sofReady =
    sourceOfFunds &&
    (sourceOfFunds !== "other" || sourceOfFundsOther.trim().length > 0) &&
    expectedMonthlyInvestment &&
    agreedSourceOfFunds;

  const handleFinalComplete = async (signingResults = {}) => {
    if (!supabase) {
      if (onComplete) onComplete();
      return;
    }

    let completionSuccess = false;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (token) {
        if (mandateDataRef.current) {
          const savePayload = { ...mandateDataRef.current, agreedMandate };
          try {
            const mandateRes = await fetch("/api/onboarding/save-mandate", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ mandate_data: savePayload, existing_onboarding_id: existingOnboardingId || null }),
            });
            const mandateResult = await mandateRes.json();
            if (mandateResult.onboarding_id) setExistingOnboardingId(mandateResult.onboarding_id);
          } catch (e) {
            console.error("Mandate save error during completion:", e);
          }
        }

        const completePayload = {
          existing_onboarding_id: existingOnboardingId || null,
          risk_disclosure_agreed: agreedRiskDisclosure || false,
          source_of_funds: sourceOfFunds || null,
          source_of_funds_other: sourceOfFunds === "other" ? (sourceOfFundsOther || null) : null,
          expected_monthly_investment: expectedMonthlyInvestment || null,
          agreed_terms: agreedTerms || false,
          agreed_privacy: agreedPrivacy || false,
          tax_number: taxNumber || null,
          bank_name: bankName || null,
          bank_account_name: bankAccountName || null,
          bank_account_type: bankAccountType || null,
          bank_account_number: bankAccountNumber || null,
          bank_branch_code: bankBranchCode || null,
          // Pass signing results if available
          signed_agreement_url: signingResults.signed_agreement_url || null,
          signed_at: signingResults.signed_at || null,
          downloaded_at: signingResults.downloaded_at || null,
        };

        console.log("[Onboarding] Completing with payload:", completePayload);

        const res = await fetch("/api/onboarding/complete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(completePayload),
        });
        const result = await res.json();
        if (result.success) {
          completionSuccess = true;
        } else {
          console.error("Failed to complete onboarding via API:", result.error);
          throw new Error(result.error?.message || "Failed to save completion status. Please try again.");
        }

        if (!completionSuccess) {
          console.warn("[Onboarding] Completion API failed. Skipping risky Supabase fallback.");
        }
      }
    } catch (err) {
      console.error("Failed to update KYC status:", err);
    }

    if (onComplete) onComplete();
  };

  return (
    <div
      className={`onboarding-process ${isFading ? "fade-out" : "fade-in"} ${isDropdownOpen || sofDropdownOpen || bankDropdownOpen ? "dropdown-open" : ""
        }`}
    >
      <div className="min-h-screen flex items-center justify-center px-4 py-8 relative">
        <button
          type="button"
          onClick={handleBack}
          className="back-button animate-fade-in delay-1"
          aria-label="Go back"
        >
          <ArrowLeftIcon width={20} height={20} />
        </button>
        <div className="w-full max-w-2xl onboarding-process-stage">
          {step === 0 ? (
            <div>
              <div className="text-center animate-fade-in delay-1">
                <div className="hero-icon">
                  <ClipboardCheckIcon width={48} height={48} />
                </div>
                <h2
                  className="text-3xl font-light tracking-tight mb-2"
                  style={{ color: "hsl(270 30% 25%)" }}
                >
                  First time onboarding process
                </h2>
                <p className="text-sm mb-6" style={{ color: "hsl(270 20% 50%)" }}>
                  We need to verify a few details before you fully onboard
                </p>
              </div>

              {(() => {
                const tick = (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                );
                const tickSm = (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                );
                const identityCheckDone = !!existingOnboardingId || kycAlreadyVerified;
                const steps = [
                  { done: identityCheckDone, title: "Identity Check", doneDesc: "ID number confirmed", pendingDesc: "Confirm your ID number is unique in our records", badge: "Confirmed" },
                  { done: kycAlreadyVerified, title: "Identification", doneDesc: "Identity verification complete", pendingDesc: "Verify your identity for security purposes", badge: "Verified" },
                  { done: addressDone, title: "Residential Address", doneDesc: "Address captured", pendingDesc: "Provide your current residential address", badge: "Captured" },
                  { done: taxDone, title: "Tax Details", doneDesc: "Tax details captured", pendingDesc: "Provide your tax reference number", badge: "Captured" },
                  { done: bankDone, title: "Bank Account", doneDesc: "Bank details saved", pendingDesc: "Add your bank account details", badge: "Saved" },
                  { done: bankLetterDone, title: "Bank Confirmation Letter", doneDesc: "Letter uploaded", pendingDesc: "Upload your bank confirmation letter", badge: "Uploaded" },
                  { done: mandateDone, title: "Discretionary Mandate", doneDesc: "Mandate accepted", pendingDesc: "Review and accept the FSP investment mandate", badge: "Accepted" },
                  { done: riskDone, title: "Risk Disclosure", doneDesc: "Risk disclosure acknowledged", pendingDesc: "Review investment risk disclosure", badge: "Acknowledged" },
                  { done: sofDone, title: "Source of Funds", doneDesc: "Source of funds declared", pendingDesc: "Declare the origin of your investment funds", badge: "Declared" },
                  { done: termsDone, title: "General Terms", doneDesc: "Terms and conditions accepted", pendingDesc: "Review and accept terms and conditions", badge: "Accepted" },
                  { done: agreementSignedDone, title: "Account Agreement", doneDesc: "Agreement signed", pendingDesc: "Review and sign the formal account agreement", badge: "Signed" },
                ];
                return (
                  <>
                    <div className="steps-container animate-fade-in delay-2">
                      {steps.map((s, i) => (
                        <React.Fragment key={i}>
                          <div className={`step-circle ${s.done ? 'step-circle-complete' : ''}`}>
                            {s.done ? tick : i + 1}
                          </div>
                          {i < steps.length - 1 && <div className={`step-line ${s.done ? 'step-line-complete' : ''}`}></div>}
                        </React.Fragment>
                      ))}
                    </div>
                    <div className="step-info animate-fade-in delay-3">
                      {steps.map((s, i) => (
                        <div key={i} className={`step-item ${s.done ? 'step-item-complete' : ''}`}>
                          <div className={`step-number ${s.done ? 'step-number-complete' : ''}`}>
                            {s.done ? tickSm : i + 1}
                          </div>
                          <div className="step-content">
                            <div className="step-title">
                              {s.title}
                              {s.done && <span className="step-verified-badge">{s.badge}</span>}
                            </div>
                            <div className="step-description">
                              {s.done ? s.doneDesc : s.pendingDesc}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}

              <div className="text-center mt-8 animate-fade-in delay-4">
                <button
                  type="button"
                  className="continue-button"
                  onClick={handleContinue}
                >
                  Continue
                </button>
              </div>

              <div className="text-center mt-6 animate-fade-in delay-4">
                <p className="text-xs" style={{ color: "hsl(270 15% 60%)" }}>
                  You'll be taken through our ten-step process
                </p>
              </div>
            </div>
          ) : step === 1 ? (
            <div className="w-full max-w-xl mx-auto">
              <div className="text-center mb-8 animate-fade-in delay-1">
                <p
                  className="text-xs uppercase tracking-[0.2em] mb-2"
                  style={{ color: "hsl(270 20% 55%)" }}
                >
                  Step 1 of 11
                </p>
                <h2
                  className="text-3xl font-light tracking-tight mb-2"
                  style={{ color: "hsl(270 30% 25%)" }}
                >
                  Identity Check
                </h2>
                <p className="text-sm" style={{ color: "hsl(270 20% 50%)" }}>
                  Enter your South African ID number before continuing
                </p>
              </div>

              <div className="space-y-5">
                <div className="animate-fade-in delay-2">
                  <label htmlFor="identity-number">ID Number</label>
                  <div className="glass-field">
                    <input
                      type="text"
                      id="identity-number"
                      placeholder="Enter your 13-digit ID number"
                      value={identityNumber}
                      onChange={(event) => setIdentityNumber(event.target.value.replace(/\D/g, "").slice(0, 13))}
                      inputMode="numeric"
                      autoComplete="off"
                    />
                  </div>
                </div>

                <div className="text-xs" style={{ color: "hsl(270 15% 60%)" }}>
                  We will check this number in onboarding pack records before allowing you to proceed.
                </div>

                <div className="pt-2 animate-fade-in delay-3">
                  <button
                    type="button"
                    className="submit-btn"
                    onClick={handleIdentityCheckContinue}
                    disabled={identityCheckLoading}
                  >
                    {identityCheckLoading ? "Checking..." : "Continue"}
                  </button>
                  {identityCheckError ? (
                    <p className="form-error" role="alert">
                      {identityCheckError}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : step === 2 ? (
            <div className="w-full max-w-xl mx-auto">
              <div className="text-center mb-8 animate-fade-in delay-1">
                <p className="text-xs uppercase tracking-[0.2em] mb-2" style={{ color: "hsl(270 20% 55%)" }}>
                  Step 2 of 11
                </p>
                <div className="hero-icon">
                  <CheckCircleIcon width={48} height={48} />
                </div>
                <h2 className="text-3xl font-light tracking-tight mb-2" style={{ color: "hsl(270 30% 25%)" }}>
                  KYC Verification
                </h2>
                <p className="text-sm" style={{ color: "hsl(270 20% 50%)" }}>
                  Verifying your identity...
                </p>
              </div>
              <div className="text-center">
                <div className="inline-flex items-center justify-center">
                  <div className="animate-spin h-8 w-8 border-4 border-violet-200 border-t-violet-600 rounded-full"></div>
                </div>
              </div>
            </div>
          ) : step === 3 ? (
            <div className="w-full max-w-xl mx-auto">
              <div className="text-center mb-8 animate-fade-in delay-1">
                <p className="text-xs uppercase tracking-[0.2em] mb-2" style={{ color: "hsl(270 20% 55%)" }}>
                  Step 3 of 11
                </p>
                <div className="hero-icon">
                  <WalletIcon width={48} height={48} />
                </div>
                <h2 className="text-3xl font-light tracking-tight mb-2" style={{ color: "hsl(270 30% 25%)" }}>
                  Residential Address
                </h2>
                <p className="text-sm" style={{ color: "hsl(270 20% 50%)" }}>
                  Please provide your current residential address for FICA compliance
                </p>
              </div>

              <div className="space-y-6">
                <div className="animate-fade-in delay-2">
                  <label htmlFor="residential-address">Street Address</label>
                  <AddressAutocomplete
                    value={address}
                    onChange={(value) => setAddress(value)}
                    placeholder="Search for your residential address"
                    containerClassName="glass-field-container"
                    inputClassName="w-full bg-transparent border-none focus:ring-0 text-base py-1"
                  />
                  <p className="text-xs mt-2" style={{ color: "hsl(270 15% 60%)" }}>
                    Your address is required for regulatory compliance and credit assessment.
                  </p>
                </div>

                <div className="pt-4 text-center animate-fade-in delay-3">
                  <button
                    type="button"
                    className="continue-button"
                    onClick={async () => {
                      if (address && address.length > 5) {
                        setAddressLoading(true);
                        try {
                          if (!supabase) {
                            throw new Error("Supabase not initialized");
                          }
                          const { data: { session } } = await supabase.auth.getSession();
                          if (session?.user) {
                            // Save to profiles table
                            await supabase
                              .from("profiles")
                              .update({ address: address })
                              .eq("id", session.user.id);

                            // Save flag to user_onboarding
                            await saveProgressFlag("address_saved", {
                              address_details: { address: address, savedAt: new Date().toISOString() },
                            });

                            setAddressDone(true);
                            goToStep(getNextIncompleteStep(3));
                          }
                        } catch (err) {
                          console.error("Failed to save address:", err);
                        } finally {
                          setAddressLoading(false);
                        }
                      }
                    }}
                    disabled={!address || address.length < 5 || addressLoading}
                  >
                    {addressLoading ? "Saving..." : "Continue"}
                  </button>
                </div>
              </div>
            </div>
          ) : step === 4 ? (
            <div className="w-full max-w-xl mx-auto">
              <div className="text-center mb-8 animate-fade-in delay-1">
                <p className="text-xs uppercase tracking-[0.2em] mb-2" style={{ color: "hsl(270 20% 55%)" }}>
                  Step 4 of 11
                </p>
                <div className="hero-icon">
                  <FileContractIcon width={48} height={48} />
                </div>
                <h2 className="text-3xl font-light tracking-tight mb-2" style={{ color: "hsl(270 30% 25%)" }}>
                  Tax Information
                </h2>
                <p className="text-sm" style={{ color: "hsl(270 20% 50%)" }}>
                  Please provide your Tax Reference Number for compliance
                </p>
              </div>

              <div className="space-y-6">
                <div className="animate-fade-in delay-2">
                  <label htmlFor="tax-number">Tax Reference Number</label>
                  <div className="glass-field">
                    <input
                      type="text"
                      id="tax-number"
                      placeholder="Enter your 10-digit tax number"
                      value={taxNumber}
                      onChange={(event) => setTaxNumber(event.target.value.replace(/\D/g, "").slice(0, 10))}
                      inputMode="numeric"
                      autoComplete="off"
                    />
                  </div>
                  <p className="text-xs mt-2" style={{ color: "hsl(270 15% 60%)" }}>
                    Your tax number is required by SARS for investment reporting.
                  </p>
                </div>

                <div className="pt-4 text-center animate-fade-in delay-3">
                  <button
                    type="button"
                    className="continue-button"
                    onClick={async () => {
                      if (taxNumber && taxNumber.length > 5) {
                        await saveProgressFlag("tax_details_saved", {
                          tax_details: { tax_number: taxNumber, savedAt: new Date().toISOString() },
                        });
                        setTaxDone(true);
                        goToStep(getNextIncompleteStep(4));
                      }
                    }}
                    disabled={!taxNumber || taxNumber.length < 5}
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>
          ) : step === 5 ? (
            <div className="w-full max-w-3xl mx-auto bank-step-wrapper">
              <div className="text-center animate-fade-in delay-1">
                <div className="hero-icon">
                  <BankIcon width={48} height={48} />
                </div>
                <h2
                  className="text-3xl font-light tracking-tight mb-2"
                  style={{ color: "hsl(270 30% 25%)" }}
                >
                  Bank Account Details
                </h2>
                <p className="text-sm mb-6" style={{ color: "hsl(270 20% 50%)" }}>
                  Link your South African bank account to <span className="mint-brand">MINT</span>
                </p>
              </div>

              <div className="progress-bar animate-fade-in delay-1">
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step"></div>
                <div className="progress-step"></div>
                <div className="progress-step"></div>
                <div className="progress-step"></div>
                <div className="progress-step"></div>
                <div className="progress-step"></div>
              </div>

              <div className="bank-section animate-fade-in delay-2">
                <div className="bank-section-label">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="15" height="15">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75Z" />
                  </svg>
                  Select Your Bank
                </div>
                <div className="custom-select" ref={bankDropdownRef}>
                  <div
                    className={`bank-select-trigger ${bankDropdownOpen ? "active" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setBankDropdownOpen((prev) => !prev)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setBankDropdownOpen((prev) => !prev);
                      }
                    }}
                  >
                    {bankName ? (
                      <span className="bank-select-value">
                        {selectedBankOption?.logo && (
                          <img
                            src={selectedBankOption.logo}
                            alt=""
                            className="bank-option-logo"
                            onError={(e) => { e.target.style.display = "none"; }}
                          />
                        )}
                        <span>{selectedBankOption?.label}</span>
                      </span>
                    ) : (
                      <span className="bank-select-placeholder">Choose a bank</span>
                    )}
                    <svg className="bank-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                    </svg>
                  </div>
                  <div className={`bank-dropdown-list ${bankDropdownOpen ? "active" : ""}`}>
                    {southAfricanBanks.map((option) => (
                      <div
                        key={option.value || "placeholder"}
                        className={`bank-dropdown-option ${bankName === option.value ? "selected" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleBankSelect(option.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleBankSelect(option.value);
                          }
                        }}
                      >
                        {option.logo && (
                          <img
                            src={option.logo}
                            alt=""
                            className="bank-option-logo"
                            onError={(e) => { e.target.style.display = "none"; }}
                          />
                        )}
                        <span>{option.label}</span>
                        {bankName === option.value && (
                          <svg className="bank-option-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                          </svg>
                        )}
                      </div>
                    ))}
                  </div>
                  <input type="hidden" id="bank-name" name="bank-name" value={bankName} />
                </div>
              </div>

              <div className="bank-account-fields animate-fade-in delay-3 hide-when-dropdown-open">
                <div className="bank-section-label">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="15" height="15">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 8.25h15m-16.5 7.5h15m-1.8-13.5-3.9 19.5m-2.1-19.5-3.9 19.5" />
                  </svg>
                  Account Details
                </div>
                <div className="bank-inputs-card">
                  <div className="bank-input-row">
                    <label htmlFor="bank-account-name">Account Holder Name</label>
                    <div className="bank-input-field">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18" className="bank-input-icon">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6.75a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.118a7.5 7.5 0 0 1 15 0A17.933 17.933 0 0 1 12 21.75a17.933 17.933 0 0 1-7.5-1.632Z" />
                      </svg>
                      <input
                        type="text"
                        id="bank-account-name"
                        placeholder="Enter account holder full name"
                        value={bankAccountName}
                        onChange={(event) => setBankAccountName(event.target.value)}
                        autoComplete="name"
                      />
                    </div>
                  </div>
                  <div className="bank-input-divider"></div>
                  <div className="bank-input-row">
                    <label htmlFor="bank-account-type">Account Type</label>
                    <div className="bank-input-field">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18" className="bank-input-icon">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5m-16.5 5.25h16.5m-16.5 5.25h10.5" />
                      </svg>
                      <select
                        id="bank-account-type"
                        value={bankAccountType}
                        onChange={(event) => setBankAccountType(event.target.value)}
                      >
                        <option value="">Select account type</option>
                        <option value="savings">Savings</option>
                        <option value="cheque">Cheque / Current</option>
                        <option value="business">Business</option>
                        <option value="transmission">Transmission</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                  </div>
                  <div className="bank-input-divider"></div>
                  <div className="bank-input-row">
                    <label htmlFor="bank-account-number">Account Number</label>
                    <div className="bank-input-field">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18" className="bank-input-icon">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
                      </svg>
                      <input
                        type="text"
                        id="bank-account-number"
                        placeholder="Enter your account number"
                        value={bankAccountNumber}
                        onChange={(event) => setBankAccountNumber(event.target.value.replace(/\D/g, ""))}
                        inputMode="numeric"
                        autoComplete="off"
                      />
                    </div>
                  </div>
                  <div className="bank-input-divider"></div>
                  <div className="bank-input-row">
                    <label htmlFor="bank-branch-code">Branch Code</label>
                    <div className="bank-input-field">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18" className="bank-input-icon">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                      </svg>
                      <input
                        type="text"
                        id="bank-branch-code"
                        placeholder={bankName === "other" ? "Enter your branch code" : "Select a bank above"}
                        value={bankBranchCode}
                        onChange={(event) => setBankBranchCode(event.target.value.replace(/\D/g, ""))}
                        readOnly={bankName !== "other" && bankName !== ""}
                        style={bankName !== "other" && bankName !== "" ? { opacity: 0.7, cursor: "default" } : {}}
                        inputMode="numeric"
                        autoComplete="off"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="bank-security-notice animate-fade-in delay-3 hide-when-dropdown-open">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16" className="bank-security-icon">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                </svg>
                <span>Your banking details are encrypted and stored securely. They will only be used for transactions you authorise.</span>
              </div>

              <div className="text-center mt-8 animate-fade-in delay-4 hide-when-dropdown-open">
                <button
                  type="button"
                  className={`continue-button agreement-continue ${bankDetailsReady ? "enabled" : ""}`}
                  disabled={!bankDetailsReady}
                  onClick={async () => {
                    try {
                      const { data: { session } } = await supabase.auth.getSession();
                      const userId = session?.user?.id;
                      if (userId) {
                        await supabase.from("user_onboarding").update({
                          bank_name: bankName || null,
                          bank_account_number: bankAccountNumber || null,
                          bank_branch_code: bankBranchCode || null,
                        }).eq("user_id", userId);
                      }
                    } catch { }
                    await saveProgressFlag("bank_details_saved", {
                      bank_details: {
                        bank_name: bankName || null,
                        bank_account_name: bankAccountName || null,
                        bank_account_type: bankAccountType || null,
                        bank_account_number: bankAccountNumber || null,
                        bank_branch_code: bankBranchCode || null,
                        savedAt: new Date().toISOString(),
                      },
                    });
                    setBankDone(true);
                    goToStep(getNextIncompleteStep(5, 5));
                  }}
                >
                  Continue
                </button>
              </div>

              <div className="text-center mt-6 animate-fade-in delay-4 hide-when-dropdown-open">
                <p className="text-xs" style={{ color: "hsl(270 15% 60%)" }}>
                  Step 5 of 11
                </p>
              </div>
            </div>
          ) : step === 6 ? (
            <div className="w-full max-w-xl mx-auto">
              <div className="text-center mb-8 animate-fade-in delay-1">
                <p className="text-xs uppercase tracking-[0.2em] mb-2" style={{ color: "hsl(270 20% 55%)" }}>
                  Step 6 of 11
                </p>
                <div className="hero-icon">
                  <FileContractIcon width={48} height={48} />
                </div>
                <h2 className="text-3xl font-light tracking-tight mb-2" style={{ color: "hsl(270 30% 25%)" }}>
                  Bank Confirmation Letter
                </h2>
                <p className="text-sm" style={{ color: "hsl(270 20% 50%)" }}>
                  Please upload a bank confirmation letter (PDF or Image) not older than 3 months.
                </p>
              </div>

              <div className="space-y-6">
                <div className="animate-fade-in delay-2">
                  <div 
                    className="glass-field py-8 flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-slate-400 transition-colors"
                    onClick={() => document.getElementById('bank-letter-upload').click()}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="40" height="40" className="text-slate-400 mb-3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                    </svg>
                    <p className="text-sm font-medium" style={{ color: "hsl(270 30% 25%)" }}>
                      {bankLetterDone ? "File uploaded successfully" : "Click to upload your letter"}
                    </p>
                    <p className="text-xs mt-1" style={{ color: "hsl(270 15% 60%)" }}>
                      PDF, JPG or PNG (max 5MB)
                    </p>
                    <input 
                      type="file" 
                      id="bank-letter-upload" 
                      className="hidden" 
                      accept=".pdf,image/*"
                      onChange={async (e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        
                        setIsSubmitting(true);
                        setSubmitError("");
                        
                        try {
                          if (!supabase) {
                            setSubmitError("Supabase not initialized");
                            setIsSubmitting(false);
                            return;
                          }
                          const reader = new FileReader();
                          reader.onload = async (event) => {
                            const base64 = event.target.result;
                            const { data: { session } } = await supabase.auth.getSession();
                            const token = session?.access_token;
                            
                            const res = await fetch("/api/onboarding/upload-bank-letter", {
                              method: "POST",
                              headers: { 
                                "Content-Type": "application/json",
                                "Authorization": `Bearer ${token}`
                              },
                              body: JSON.stringify({ 
                                fileBase64: base64,
                                fileType: file.type
                              })
                            });
                            
                            const result = await res.json();
                            if (result.success) {
                              setBankLetterDone(true);
                              await saveProgressFlag("bank_letter_uploaded", {
                                bank_letter_url: result.publicUrl,
                                bank_letter_uploaded_at: new Date().toISOString()
                              });
                            } else {
                              setSubmitError(result.error || "Failed to upload file");
                            }
                            setIsSubmitting(false);
                          };
                          reader.readAsDataURL(file);
                        } catch (err) {
                          setSubmitError("An error occurred during upload");
                          setIsSubmitting(false);
                        }
                      }}
                    />
                  </div>
                  
                  {bankLetterDone && (
                    <div className="mt-4 flex items-center justify-center gap-2 text-green-600 animate-fade-in">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                      <span className="text-sm font-medium">Upload Complete</span>
                    </div>
                  )}

                  {submitError && (
                    <p className="text-center mt-4 text-red-500 text-xs animate-fade-in">{submitError}</p>
                  )}
                  
                  {isSubmitting && (
                    <div className="mt-4 flex flex-col items-center justify-center gap-2 animate-fade-in">
                       <div className="w-5 h-5 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin"></div>
                       <span className="text-xs text-slate-500">Uploading...</span>
                    </div>
                  )}
                </div>

                <div className="pt-4 text-center animate-fade-in delay-3">
                  <button
                    type="button"
                    className={`continue-button ${bankLetterDone ? "" : "opacity-50 cursor-not-allowed"}`}
                    disabled={!bankLetterDone || isSubmitting}
                    onClick={() => goToStep(getNextIncompleteStep(6, 6))}
                  >
                    Continue
                  </button>
                </div>
              </div>
              
              <div className="text-center mt-6 animate-fade-in delay-4">
                <p className="text-xs" style={{ color: "hsl(270 15% 60%)" }}>
                  Step 7 of 11
                </p>
              </div>
            </div>
          ) : step === 7 ? (
            <div className="w-full max-w-3xl mx-auto">
              <div className="text-center animate-fade-in delay-1">
                <div className="hero-icon">
                  <FileContractIcon width={48} height={48} />
                </div>
                <h2
                  className="text-3xl font-light tracking-tight mb-2"
                  style={{ color: "hsl(270 30% 25%)" }}
                >
                  Discretionary FSP Mandate
                </h2>
                <p className="text-sm mb-6" style={{ color: "hsl(270 20% 50%)" }}>
                  Please review and accept the investment management mandate
                </p>
              </div>

              <div className="progress-bar animate-fade-in delay-1">
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step"></div>
                <div className="progress-step"></div>
                <div className="progress-step"></div>
                <div className="progress-step"></div>
              </div>

              {(() => {
                if (profileLoading) return null;
                const missingFields = [
                  !(profile?.firstName?.trim() || profile?.first_name?.trim()) && "First Name",
                  !(profile?.lastName?.trim() || profile?.last_name?.trim()) && "Surname",
                  !profile?.idNumber?.trim() && "ID Number",
                  !profile?.address?.trim() && "Address",
                  !profile?.phoneNumber?.trim() && "Cell Number",
                  !profile?.email?.trim() && "Email Address",
                ].filter(Boolean);
                if (missingFields.length === 0) return null;
                return (
                  <div className="animate-fade-in delay-2" style={{
                    background: "hsl(38 100% 97%)",
                    border: "1px solid hsl(38 80% 75%)",
                    borderRadius: "12px",
                    padding: "14px 18px",
                    marginBottom: "16px",
                  }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="hsl(38 90% 45%)" strokeWidth="2" width="18" height="18" style={{ flexShrink: 0, marginTop: "1px" }}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                      </svg>
                      <div>
                        <p style={{ fontSize: "12px", fontWeight: "600", color: "hsl(38 70% 30%)", marginBottom: "6px" }}>
                          Your profile is missing the following required fields. Please fill them in on the first tab of the mandate document below before you can continue:
                        </p>
                        <ul style={{ margin: 0, paddingLeft: "16px", listStyleType: "disc" }}>
                          {missingFields.map((field) => (
                            <li key={field} style={{ fontSize: "12px", color: "hsl(38 70% 30%)", marginBottom: "2px" }}>{field}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="animate-fade-in delay-2" style={{
                borderRadius: '16px',
                overflow: 'hidden',
                border: '1px solid hsl(270 20% 90%)',
                boxShadow: '0 4px 20px rgba(100, 60, 140, 0.08)',
                background: 'white',
              }}>
                <MandateViewer
                  profile={profile}
                  onValidChange={setMandateValid}
                  onDataChange={(data) => { mandateDataRef.current = data; }}
                />
              </div>

              <div className="checkbox-container animate-fade-in delay-3" style={{ display: 'block' }}>
                <label className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={agreedMandate}
                    onChange={(event) => setAgreedMandate(event.target.checked)}
                  />
                  <span className="checkbox-label">
                    I have read and agree to the Discretionary FSP Mandate and authorise ALGOHIVE to manage my investments as described
                  </span>
                </label>
              </div>

              {!mandateValid && agreedMandate && (
                <div className="animate-fade-in" style={{ marginTop: "10px" }}>
                  {(() => {
                    const missing = [
                      !(profile?.firstName?.trim() || profile?.first_name?.trim()) && "First Name",
                      !(profile?.lastName?.trim() || profile?.last_name?.trim()) && "Surname",
                      !profile?.idNumber?.trim() && "ID Number",
                      !profile?.address?.trim() && "Address",
                      !profile?.phoneNumber?.trim() && "Cell Number",
                      !profile?.email?.trim() && "Email Address",
                    ].filter(Boolean);
                    if (missing.length > 0) {
                      return (
                        <p style={{ color: "#ef4444", fontSize: "12px", textAlign: "center" }}>
                          Cannot continue — the following required fields are still empty in the mandate: <strong>{missing.join(", ")}</strong>. Please fill them in on Tab 1 of the mandate document above.
                        </p>
                      );
                    }
                    return (
                      <p style={{ color: "#ef4444", fontSize: "12px", textAlign: "center" }}>
                        Please enter your initials and complete all checkbox selections on the Schedules tab before continuing.
                      </p>
                    );
                  })()}
                </div>
              )}

              {submitError && (
                <p className="text-center animate-fade-in" style={{ color: "#ef4444", fontSize: "12px", marginTop: "8px" }}>
                  {submitError}
                </p>
              )}

              <div className="text-center mt-8 animate-fade-in delay-4">
                <button
                  type="button"
                  className={`continue-button agreement-continue ${agreedMandate && mandateValid ? "enabled" : ""}`}
                  disabled={!agreedMandate || !mandateValid}
                  onClick={async () => { await saveProgressFlag("mandate_accepted"); setMandateDone(true); goToStep(getNextIncompleteStep(7, 7)); }}
                >
                  Continue
                </button>
              </div>

              <div className="text-center mt-6 animate-fade-in delay-4">
                <p className="text-xs" style={{ color: "hsl(270 15% 60%)" }}>
                  Step 7 of 11
                </p>
              </div>
            </div>
          ) : step === 8 ? (
            <div className="w-full max-w-3xl mx-auto">
              <div className="text-center animate-fade-in delay-1">
                <div className="hero-icon">
                  <ShieldIcon width={48} height={48} />
                </div>
                <h2
                  className="text-3xl font-light tracking-tight mb-2"
                  style={{ color: "hsl(270 30% 25%)" }}
                >
                  Risk Disclosure
                </h2>
                <p className="text-sm mb-6" style={{ color: "hsl(270 20% 50%)" }}>
                  Please review the investment risk disclosure
                </p>
              </div>

              <div className="progress-bar animate-fade-in delay-1">
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step"></div>
                <div className="progress-step"></div>
                <div className="progress-step"></div>
              </div>

              <div className="agreement-card animate-fade-in delay-2">
                <div className="agreement-title">Investment Risk Disclosure</div>

                <div className="agreement-section">
                  <div className="section-title">1. Investment Risk Warning</div>
                  <div className="agreement-text">
                    Investing in financial instruments involves risk, including the possible loss of some or all of your principal investment. Past performance is not indicative of future results. The value of investments and the income derived from them may go down as well as up.
                  </div>
                </div>

                <div className="agreement-section">
                  <div className="section-title">2. Market Volatility</div>
                  <div className="agreement-text">
                    Financial markets can be volatile and unpredictable. Prices of securities, including those listed on the JSE, can fluctuate significantly due to various factors including economic conditions, political events, company performance, and market sentiment.
                  </div>
                </div>

                <div className="agreement-section">
                  <div className="section-title">3. No Guaranteed Returns</div>
                  <div className="agreement-text">
                    MINT does not guarantee any returns on investments. All investment decisions are made at your own risk. You should only invest money that you can afford to lose without affecting your standard of living.
                  </div>
                </div>

                <div className="agreement-section">
                  <div className="section-title">4. Regulatory Compliance</div>
                  <div className="agreement-text">
                    MINT operates in compliance with South African financial regulations. We are committed to transparency and providing you with the information needed to make informed investment decisions. However, we do not provide personalised financial advice.
                  </div>
                </div>

                <div className="agreement-section">
                  <div className="section-title">5. Diversification Notice</div>
                  <div className="agreement-text">
                    Concentrating investments in a single security, sector, or asset class increases risk. We encourage you to diversify your portfolio and seek independent financial advice if needed.
                  </div>
                </div>
              </div>

              <div className="checkbox-container animate-fade-in delay-3" style={{ display: 'block' }}>
                <label className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={agreedRiskDisclosure}
                    onChange={(event) => setAgreedRiskDisclosure(event.target.checked)}
                  />
                  <span className="checkbox-label">
                    I acknowledge that I have read and understand the investment risk disclosure
                  </span>
                </label>
              </div>

              <div className="text-center mt-8 animate-fade-in delay-4">
                <button
                  type="button"
                  className={`continue-button agreement-continue ${agreedRiskDisclosure ? "enabled" : ""}`}
                  disabled={!agreedRiskDisclosure}
                  onClick={async () => { await saveProgressFlag("risk_disclosure_accepted"); setRiskDone(true); goToStep(getNextIncompleteStep(8, 8)); }}
                >
                  Continue
                </button>
              </div>

              <div className="text-center mt-6 animate-fade-in delay-4">
                <p className="text-xs" style={{ color: "hsl(270 15% 60%)" }}>
                  Step 8 of 11
                </p>
              </div>
            </div>
          ) : step === 9 ? (
            <div className="w-full max-w-3xl mx-auto">
              <div className="text-center animate-fade-in delay-1">
                <div className="hero-icon">
                  <WalletIcon width={48} height={48} />
                </div>
                <h2
                  className="text-3xl font-light tracking-tight mb-2"
                  style={{ color: "hsl(270 30% 25%)" }}
                >
                  Source of Funds
                </h2>
                <p className="text-sm mb-6" style={{ color: "hsl(270 20% 50%)" }}>
                  Declare the origin of your investment funds
                </p>
              </div>

              <div className="progress-bar animate-fade-in delay-1">
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step"></div>
                <div className="progress-step"></div>
              </div>

              <div className="space-y-5">
                <div className="animate-fade-in delay-2">
                  <label htmlFor="source-of-funds">Primary Source of Funds</label>
                  <div className="custom-select" ref={sofDropdownRef}>
                    <div
                      className={`glass-field select-trigger ${sofDropdownOpen ? "active" : ""
                        }`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSofDropdownOpen((prev) => !prev)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSofDropdownOpen((prev) => !prev);
                        }
                      }}
                    >
                      <div
                        className="selected-value"
                        data-placeholder="Select source of funds"
                      >
                        {sourceOfFunds ? selectedSofOption?.label : ""}
                      </div>
                    </div>
                    <div className={`custom-dropdown ${sofDropdownOpen ? "active" : ""}`}>
                      {sourceOfFundsOptions.map((option) => (
                        <div
                          key={option.value || "placeholder"}
                          className={`custom-option ${sourceOfFunds === option.value ? "selected" : ""
                            }`}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleSofSelect(option.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              handleSofSelect(option.value);
                            }
                          }}
                        >
                          {option.label}
                        </div>
                      ))}
                    </div>
                    <input
                      type="hidden"
                      id="source-of-funds"
                      name="source-of-funds"
                      value={sourceOfFunds}
                    />
                  </div>
                </div>

                <div
                  className={`conditional-section hide-when-dropdown-open ${sourceOfFunds === "other" ? "active" : ""
                    }`}
                >
                  <label htmlFor="source-of-funds-other">Please describe your source of funds</label>
                  <div className="glass-field">
                    <input
                      type="text"
                      id="source-of-funds-other"
                      placeholder="Describe your source of funds"
                      value={sourceOfFundsOther}
                      onChange={(event) => setSourceOfFundsOther(event.target.value)}
                    />
                  </div>
                </div>

                <div className="animate-fade-in delay-3 hide-when-dropdown-open">
                  <label htmlFor="expected-monthly-investment">Expected Monthly Investment Amount</label>
                  <div className="glass-field">
                    <select
                      id="expected-monthly-investment"
                      value={expectedMonthlyInvestment}
                      onChange={(event) => setExpectedMonthlyInvestment(event.target.value)}
                    >
                      {monthlyInvestmentOptions.map((option) => (
                        <option key={option.value || "placeholder"} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="animate-fade-in delay-3 hide-when-dropdown-open" style={{ display: 'block' }}>
                  <label className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={agreedSourceOfFunds}
                      onChange={(event) => setAgreedSourceOfFunds(event.target.checked)}
                    />
                    <span className="checkbox-label">
                      I declare that the funds I will use for investing are from legitimate sources and I am the beneficial owner of these funds
                    </span>
                  </label>
                </div>

                <div className="text-center mt-8 animate-fade-in delay-4 hide-when-dropdown-open">
                  <button
                    type="button"
                    className={`continue-button agreement-continue ${sofReady ? "enabled" : ""}`}
                    disabled={!sofReady}
                    onClick={async () => {
                      await saveProgressFlag("source_of_funds_accepted", {
                        source_of_funds_details: {
                          source_of_funds: sourceOfFunds,
                          source_of_funds_other: sourceOfFunds === "other" ? sourceOfFundsOther : null,
                          expected_monthly_investment: expectedMonthlyInvestment,
                        },
                      });
                      setSofDone(true); goToStep(getNextIncompleteStep(9, 9));
                    }}
                  >
                    Continue
                  </button>
                </div>

                <div className="text-center mt-6 animate-fade-in delay-4 hide-when-dropdown-open">
                  <p className="text-xs" style={{ color: "hsl(270 15% 60%)" }}>
                    Step 9 of 11
                  </p>
                </div>
              </div>
            </div>
          ) : step === 10 ? (
            <div className="w-full max-w-3xl mx-auto">
              <div className="text-center animate-fade-in delay-1">
                <div className="hero-icon">
                  <FileContractIcon width={48} height={48} />
                </div>
                <h2
                  className="text-3xl font-light tracking-tight mb-2"
                  style={{ color: "hsl(270 30% 25%)" }}
                >
                  Contract Agreement
                </h2>
                <p className="text-sm mb-6" style={{ color: "hsl(270 20% 50%)" }}>
                  Please review and accept our <span className="mint-brand">MINT</span> terms and conditions
                </p>
              </div>

              <div className="progress-bar animate-fade-in delay-1">
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step active"></div>
                <div className="progress-step"></div>
              </div>

              <div className="agreement-card animate-fade-in delay-2">
                <div className="agreement-title">Terms and Conditions</div>

                <div className="agreement-section">
                  <div className="section-title">1. Introduction</div>
                  <div className="agreement-text">
                    Welcome to MINT. By accessing or using our services, you agree to be bound by these Terms and Conditions. Please read them carefully before proceeding. These terms govern your use of our platform and all related services.
                  </div>
                </div>

                <div className="agreement-section">
                  <div className="section-title">2. User Account</div>
                  <div className="agreement-text">
                    To use MINT, you must create an account. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to provide accurate and complete information during the onboarding process.
                  </div>
                </div>

                <div className="agreement-section">
                  <div className="section-title">3. Investment Services</div>
                  <div className="agreement-text">
                    MINT provides a platform for fractional investment in various assets. We are not a financial advisor, and the information provided through our platform does not constitute financial, investment, or tax advice. You should perform your own research or consult with a qualified advisor.
                  </div>
                </div>

                <div className="agreement-section">
                  <div className="section-title">4. Fees and Charges</div>
                  <div className="agreement-text">
                    MINT may charge fees for its services. These fees will be clearly disclosed to you. You agree to pay all fees associated with your use of our platform. We reserve the right to change our fee structure with prior notice to you.
                  </div>
                </div>

                <div className="agreement-section">
                  <div className="section-title">5. Privacy and Security</div>
                  <div className="agreement-text">
                    Your privacy is important to us. We collect and process your personal information in accordance with our Privacy Policy. We use industry-standard security measures to protect your data, but we cannot guarantee absolute security.
                  </div>
                </div>
              </div>

              <div className="checkbox-container animate-fade-in delay-3">
                <label className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={agreedTerms}
                    onChange={(event) => setAgreedTerms(event.target.checked)}
                  />
                  <span className="checkbox-label">
                    I agree to the Terms and Conditions
                  </span>
                </label>
                <label className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={agreedPrivacy}
                    onChange={(event) => setAgreedPrivacy(event.target.checked)}
                  />
                  <span className="checkbox-label">
                    I agree to the Privacy Policy
                  </span>
                </label>
              </div>

              <div className="text-center mt-8 animate-fade-in delay-4">
                <button
                  type="button"
                  className={`continue-button agreement-continue ${agreementReady ? "enabled" : ""}`}
                  disabled={!agreementReady}
                  onClick={async () => {
                    await saveProgressFlag("terms_accepted");
                    setTermsDone(true);
                    goToStep(getNextIncompleteStep(10));
                  }}
                >
                  Continue
                </button>
              </div>

              <div className="text-center mt-6 animate-fade-in delay-4">
                <p className="text-xs" style={{ color: "hsl(270 15% 60%)" }}>
                  Step 10 of 11
                </p>
              </div>
            </div>
          ) : step === 11 ? (
            <AccountAgreementStep
              profile={profile}
              onboardingData={{
                bankName,
                bankAccountNumber,
                bankBranchCode,
                bankAccountType,
                taxNumber,
                identityNumber,
                sourceOfFunds,
                sourceOfFundsOther,
                expectedMonthlyInvestment,
              }}
              existingOnboardingId={existingOnboardingId}
              onComplete={handleFinalComplete}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default OnboardingProcessPage;
