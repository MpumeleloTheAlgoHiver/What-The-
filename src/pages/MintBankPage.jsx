import React, { useRef, useState, useEffect, useCallback } from "react";
import { ArrowLeft, Landmark, ShieldCheck, CheckCircle2, Shield, X, XCircle, Lock, Info, ChevronDown, ChevronUp, CreditCard, Wallet, Plus, Unlink, AlertTriangle, Eye, EyeOff, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useRequiredActions } from "../lib/useRequiredActions";
import fnbLogo from "../assets/banks/fnb.svg";
import standardBankLogo from "../assets/banks/standard-bank.svg";
import absaLogo from "../assets/banks/absa.svg";
import nedbankLogo from "../assets/banks/nedbank.svg";
import capitecLogo from "../assets/banks/capitec.svg";
import investecLogo from "../assets/banks/investec.svg";
import discoveryLogo from "../assets/banks/discovery.svg";
import tymebankLogo from "../assets/banks/tymebank.svg";
import africanBankLogo from "../assets/banks/african-bank.svg";
import bankZeroLogo from "../assets/banks/bank-zero.svg";
import defaultBankLogo from "../assets/banks/default.svg";

const SA_BANKS = [
  { id: "fnb", label: "FNB (First National Bank)", logo: fnbLogo },
  { id: "standard-bank", label: "Standard Bank", logo: standardBankLogo },
  { id: "absa", label: "ABSA", logo: absaLogo },
  { id: "nedbank", label: "Nedbank", logo: nedbankLogo },
  { id: "capitec", label: "Capitec Bank", logo: capitecLogo },
  { id: "investec", label: "Investec", logo: investecLogo },
  { id: "discovery", label: "Discovery Bank", logo: discoveryLogo },
  { id: "tymebank", label: "TymeBank", logo: tymebankLogo },
  { id: "african-bank", label: "African Bank", logo: africanBankLogo },
  { id: "bank-zero", label: "Bank Zero", logo: bankZeroLogo },
];

const ACCOUNT_TYPES = ["Cheque Account", "Savings Account", "Credit Card", "Transmission Account", "Business Account"];

const getBankLogo = (bankId) => {
  const bank = SA_BANKS.find(b => b.id === bankId);
  return bank ? bank.logo : defaultBankLogo;
};

const getBankLabel = (bankId) => {
  const bank = SA_BANKS.find(b => b.id === bankId);
  return bank ? bank.label : bankId || "Bank Account";
};

const matchBankId = (bankName) => {
  if (!bankName) return "";
  const lower = bankName.toLowerCase().trim();
  const patterns = [
    { id: "fnb", keys: ["fnb", "first national"] },
    { id: "standard-bank", keys: ["standard bank", "standard"] },
    { id: "absa", keys: ["absa"] },
    { id: "nedbank", keys: ["nedbank", "ned "] },
    { id: "capitec", keys: ["capitec"] },
    { id: "investec", keys: ["investec"] },
    { id: "discovery", keys: ["discovery"] },
    { id: "tymebank", keys: ["tymebank", "tyme"] },
    { id: "african-bank", keys: ["african bank"] },
    { id: "bank-zero", keys: ["bank zero"] },
  ];
  for (const p of patterns) {
    if (p.keys.some(k => lower.includes(k))) return p.id;
  }
  return "";
};

const matchAccountType = (type) => {
  if (!type) return "Cheque Account";
  const lower = type.toLowerCase();
  if (lower.includes("saving")) return "Savings Account";
  if (lower.includes("credit")) return "Credit Card";
  if (lower.includes("transmission")) return "Transmission Account";
  if (lower.includes("business")) return "Business Account";
  return "Cheque Account";
};

const maskAccountNumber = (num) => {
  if (!num || num.trim().length === 0) return "";
  const cleaned = num.replace(/\s/g, "");
  if (cleaned.length <= 4) return cleaned;
  return "•••• " + cleaned.slice(-4);
};

const MintBankPage = ({ onBack, onComplete }) => {
  const { bankLinked, refetch: refetchActions } = useRequiredActions();
  const [step, setStep] = useState("intro");
  const [showDetails, setShowDetails] = useState(false);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [consumerUrl, setConsumerUrl] = useState(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [linkedBanks, setLinkedBanks] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const collectionIdRef = useRef(null);
  const pollingRef = useRef(null);
  const [showUnlinkModal, setShowUnlinkModal] = useState(false);
  const [unlinkPassword, setUnlinkPassword] = useState("");
  const [unlinkError, setUnlinkError] = useState("");
  const [unlinkLoading, setUnlinkLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [unlinkSuccess, setUnlinkSuccess] = useState(false);
  const [unlinkingIndex, setUnlinkingIndex] = useState(null);
  const [confirmBank, setConfirmBank] = useState("");
  const [confirmAccountNum, setConfirmAccountNum] = useState("");
  const [confirmAccountType, setConfirmAccountType] = useState("Cheque Account");
  const [confirmSaving, setConfirmSaving] = useState(false);
  const [showBankDropdown, setShowBankDropdown] = useState(false);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [pendingTruidAccounts, setPendingTruidAccounts] = useState([]);

  useEffect(() => {
    // Clear any stale TrueID verification state on mount
    localStorage.removeItem('truid_collection_id');
    localStorage.removeItem('truid_consumer_url');
    sessionStorage.removeItem('truid_consent_token');
  }, []);

  const fetchBankAccounts = useCallback(async () => {
    try {
      setLoadingAccounts(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch("/api/banking/accounts", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (data.success && data.accounts) {
        setLinkedBanks(data.accounts);
      }
    } catch (e) {
      console.error("Failed to fetch bank accounts:", e);
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  const saveConfirmedAccount = async () => {
    if (!confirmBank) return;
    setConfirmSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No session");

      const newAccount = {
        bankId: confirmBank,
        bankName: getBankLabel(confirmBank),
        accountNumber: confirmAccountNum.trim(),
        accountType: confirmAccountType,
        linkedAt: new Date().toISOString(),
      };

      const allAccounts = [...linkedBanks, newAccount];

      const res = await fetch("/api/banking/capture-confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ accounts: allAccounts }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Save failed");

      setLinkedBanks(allAccounts);
      setStep("success");
    } catch (err) {
      console.error("Save confirmed account error:", err);
    } finally {
      setConfirmSaving(false);
    }
  };

  useEffect(() => {
    if (bankLinked) {
      fetchBankAccounts();
      setStep("already_linked");
    }
  }, [bankLinked, fetchBankAccounts]);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const startSession = async () => {
    setStatus("connecting");
    setMessage("Initializing secure connection...");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Authentication required");

      const response = await fetch("/api/banking/initiate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      });

      const data = await response.json();
      if (!data.success) {
        const errMsg = typeof data.error === "string" ? data.error : data.error?.message || "Connection failed";
        throw new Error(errMsg);
      }

      collectionIdRef.current = data.collectionId;
      setIframeLoaded(false);
      setConsumerUrl(data.consumerUrl);
      setStatus("banking");
      setMessage("");
      startPolling(data.collectionId);
    } catch (err) {
      console.error("Banking initiate error:", err);
      setStatus("error");
      setMessage(err.message);
    }
  };

  const handleCancel = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setConsumerUrl(null);
    setStatus("cancelled");
    setMessage("Bank linking was cancelled. You can try again when you're ready.");
  }, []);

  const handleUnlink = (accountIdx) => {
    setUnlinkingIndex(accountIdx);
    setShowUnlinkModal(true);
    setUnlinkPassword("");
    setUnlinkError("");
    setShowPassword(false);
  };

  const confirmUnlink = async () => {
    if (!unlinkPassword.trim()) {
      setUnlinkError("Password is required");
      return;
    }
    setUnlinkLoading(true);
    setUnlinkError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const email = session?.user?.email;
      if (!email) throw new Error("No email found");

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: unlinkPassword });
      if (signInError) {
        setUnlinkError("Incorrect password. Please try again.");
        setUnlinkLoading(false);
        return;
      }

      const res = await fetch("/api/banking/unlink", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(unlinkingIndex < 0 ? { unlinkAll: true } : { accountIndex: unlinkingIndex }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to unlink");

      localStorage.removeItem("mint_linked_banks");

      setShowUnlinkModal(false);

      if (data.remainingAccounts && data.remainingAccounts.length > 0) {
        setLinkedBanks(data.remainingAccounts);
      } else {
        setUnlinkSuccess(true);
        if (refetchActions) refetchActions();
        setTimeout(() => {
          setUnlinkSuccess(false);
          setLinkedBanks([]);
          setStep("intro");
          setStatus("idle");
          setMessage("");
        }, 2000);
      }
    } catch (e) {
      setUnlinkError(e.message);
    } finally {
      setUnlinkLoading(false);
    }
  };

  const pollCountRef = useRef(0);
  const MAX_POLLS = 120;

  const startPolling = (collectionId) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollCountRef.current = 0;

    pollingRef.current = setInterval(async () => {
      pollCountRef.current += 1;
      if (pollCountRef.current > MAX_POLLS) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
        setConsumerUrl(null);
        setStatus("error");
        setMessage("Connection timed out. Please try again.");
        return;
      }

      try {
        const res = await fetch(`/api/banking/status?collectionId=${collectionId}`);
        const data = await res.json();
        const outcome = data.outcome;

        if (outcome === "completed") {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
          setConsumerUrl(null);
          setStatus("capturing");
          setMessage("Verifying banking data...");

          try {
            const { data: { session } } = await supabase.auth.getSession();
            const captureRes = await fetch("/api/banking/capture", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: session ? `Bearer ${session.access_token}` : "",
              },
              body: JSON.stringify({ collectionId }),
            });

            const captureData = await captureRes.json();
            if (!captureRes.ok || !captureData.success) {
              throw new Error(captureData.error || "Capture failed");
            }

            const newAccounts = (captureData.bankAccounts || []).map(acc => ({
              ...acc,
              linkedAt: new Date().toISOString(),
            }));
            setPendingTruidAccounts(newAccounts);
            const firstAcc = newAccounts[0] || {};
            setConfirmBank(matchBankId(firstAcc.bankName) || "");
            setConfirmAccountNum(firstAcc.accountNumber || "");
            setConfirmAccountType(matchAccountType(firstAcc.accountType));
            setStep("confirm");
          } catch (captureErr) {
            console.error("Capture error:", captureErr);
            setStatus("error");
            setMessage("Failed to verify banking data. Please try again.");
          }
        } else if (outcome === "failed") {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
          setConsumerUrl(null);
          setStatus("error");
          setMessage("Bank connection was cancelled or failed.");
        }
      } catch (e) {
        console.error("Polling error:", e);
      }
    }, 3000);
  };

  if (step === "confirm") {
    return (
      <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 flex flex-col px-6 pb-10 min-h-screen bg-white">
        <header className="w-full flex items-center justify-between pt-10 pb-6">
          <button
            onClick={() => { setStep("connect"); setStatus("idle"); }}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition active:scale-95"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold text-slate-900">Confirm Details</h1>
          <div className="h-10 w-10" aria-hidden="true" />
        </header>

        <div className="flex items-center gap-3 p-4 rounded-2xl bg-green-50 border border-green-100 mb-6">
          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
          <p className="text-sm text-green-800">Bank verified successfully via TruID. Please confirm your account details below.</p>
        </div>

        <div className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Select Your Bank</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => { setShowBankDropdown(!showBankDropdown); setShowTypeDropdown(false); }}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-slate-200 bg-slate-50 text-left transition-all focus:ring-2 focus:ring-blue-200"
              >
                {confirmBank ? (
                  <>
                    <img src={getBankLogo(confirmBank)} alt="" className="h-8 w-8 rounded-lg" />
                    <span className="text-sm font-medium text-slate-900">{getBankLabel(confirmBank)}</span>
                  </>
                ) : (
                  <span className="text-sm text-slate-400">Choose your bank...</span>
                )}
                <ChevronDown className="h-4 w-4 text-slate-400 ml-auto" />
              </button>
              {showBankDropdown && (
                <div className="absolute z-20 mt-1 w-full bg-white rounded-xl border border-slate-200 shadow-xl max-h-64 overflow-y-auto">
                  {SA_BANKS.map(bank => (
                    <button
                      key={bank.id}
                      type="button"
                      onClick={() => { setConfirmBank(bank.id); setShowBankDropdown(false); }}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors ${confirmBank === bank.id ? "bg-blue-50" : ""}`}
                    >
                      <img src={bank.logo} alt="" className="h-8 w-8 rounded-lg" />
                      <span className="text-sm font-medium text-slate-900">{bank.label}</span>
                      {confirmBank === bank.id && <CheckCircle2 className="h-4 w-4 text-blue-600 ml-auto" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Account Number</label>
            <input
              type="text"
              value={confirmAccountNum}
              onChange={e => setConfirmAccountNum(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="Enter account number"
              maxLength={16}
              inputMode="numeric"
              className="w-full px-4 py-3.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Account Type</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => { setShowTypeDropdown(!showTypeDropdown); setShowBankDropdown(false); }}
                className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl border border-slate-200 bg-slate-50 text-left transition-all focus:ring-2 focus:ring-blue-200"
              >
                <span className="text-sm font-medium text-slate-900">{confirmAccountType}</span>
                <ChevronDown className="h-4 w-4 text-slate-400" />
              </button>
              {showTypeDropdown && (
                <div className="absolute z-20 mt-1 w-full bg-white rounded-xl border border-slate-200 shadow-xl">
                  {ACCOUNT_TYPES.map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => { setConfirmAccountType(type); setShowTypeDropdown(false); }}
                      className={`w-full px-4 py-3 text-left text-sm hover:bg-slate-50 transition-colors ${confirmAccountType === type ? "bg-blue-50 font-medium text-blue-700" : "text-slate-700"}`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={saveConfirmedAccount}
          disabled={!confirmBank || confirmSaving}
          className="w-full mt-8 py-4 rounded-full bg-slate-900 text-white font-semibold text-sm uppercase tracking-[0.15em] shadow-lg shadow-slate-900/20 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {confirmSaving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            "Confirm & Link"
          )}
        </button>

        <p className="text-xs text-slate-400 text-center mt-4">Account number is optional but recommended for your records.</p>
      </div>
    );
  }

  if (step === "success") {
    return (
      <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 flex flex-col items-center justify-center px-6 pb-10 min-h-screen bg-white">
        <div className="flex flex-col items-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-green-100 mb-6">
            <CheckCircle2 className="h-12 w-12 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Successful</h2>
          <p className="text-sm text-slate-500 mt-3 text-center max-w-[280px]">Your bank account has been securely linked and verified via TruID.</p>
        </div>

        <div className="w-full mt-12 space-y-3">
          <button
            type="button"
            onClick={() => setStep("linked_accounts")}
            className="w-full py-4 rounded-full bg-slate-900 text-white font-semibold text-sm uppercase tracking-[0.15em] shadow-lg shadow-slate-900/20 active:scale-95 transition-all"
          >
            View Linked Accounts
          </button>
          <button
            type="button"
            onClick={() => onComplete ? onComplete() : onBack ? onBack() : window.history.back()}
            className="w-full py-4 rounded-full bg-slate-100 text-slate-700 font-semibold text-sm uppercase tracking-[0.15em] active:scale-95 transition-all"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  if (step === "linked_accounts" || step === "already_linked") {
    const hasStoredAccounts = linkedBanks.length > 0;
    return (
      <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 flex flex-col px-6 pb-10 min-h-screen bg-white">
        <header className="w-full flex items-center justify-between pt-10 pb-6">
          <button
            onClick={() => onBack ? onBack() : window.history.back()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition active:scale-95"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold text-slate-900">Linked Accounts</h1>
          <div className="h-10 w-10" aria-hidden="true" />
        </header>

        {loadingAccounts ? (
          <div className="mt-12 flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 text-slate-400 animate-spin" />
            <p className="text-sm text-slate-400">Loading accounts...</p>
          </div>
        ) : hasStoredAccounts ? (
          <div className="mt-6 space-y-3">
            {linkedBanks.map((bank, idx) => {
              const logoSrc = bank.bankId ? getBankLogo(bank.bankId) : defaultBankLogo;
              const maskedNum = maskAccountNumber(bank.accountNumber);
              return (
                <div key={idx} className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100">
                  <img src={logoSrc} alt="" className="h-12 w-12 rounded-2xl shrink-0 shadow-sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{bank.bankId ? getBankLabel(bank.bankId) : bank.bankName || "Bank Account"}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {bank.accountType || "Current"}{maskedNum ? ` • ${maskedNum}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleUnlink(idx)}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-500 transition-colors shrink-0"
                    title="Unlink account"
                  >
                    <Unlink className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-6">
            <div className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl shrink-0 bg-green-100">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900">Bank Account Linked</p>
                <p className="text-xs text-slate-500 mt-0.5">Verified via TruID</p>
              </div>
              <button
                type="button"
                onClick={() => handleUnlink(-1)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-500 transition-colors shrink-0"
                title="Unlink account"
              >
                <Unlink className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-slate-400 text-center mt-4">Re-link your account to view full bank details.</p>
          </div>
        )}

        <div className="mt-8 space-y-3">
          <button
            type="button"
            onClick={() => {
              setStep("intro");
              setStatus("idle");
              setMessage("");
            }}
            className="w-full py-4 rounded-full bg-slate-900 text-white font-semibold text-sm uppercase tracking-[0.15em] shadow-lg shadow-slate-900/20 active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <Plus className="h-4 w-4" />
            {hasStoredAccounts ? "Link Another Account" : "Re-link Account"}
          </button>
          <button
            type="button"
            onClick={() => onComplete ? onComplete() : onBack ? onBack() : window.history.back()}
            className="w-full py-4 rounded-full bg-slate-100 text-slate-700 font-semibold text-sm uppercase tracking-[0.15em] active:scale-95 transition-all"
          >
            Done
          </button>
        </div>

        <div className="mt-8 flex items-center justify-center gap-2 text-xs text-slate-400">
          <Shield className="h-4 w-4" />
          <span>All accounts are securely verified through TruID Connect.</span>
        </div>

        {unlinkSuccess && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl p-8 flex flex-col items-center gap-4 shadow-2xl animate-in zoom-in-95 duration-300">
              <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
              <p className="text-lg font-semibold text-slate-900">Bank Unlinked</p>
              <p className="text-sm text-slate-500 text-center">Your bank account has been successfully unlinked.</p>
            </div>
          </div>
        )}

        {showUnlinkModal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 animate-in fade-in duration-200" onClick={() => setShowUnlinkModal(false)}>
            <div
              className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-6 pb-8 shadow-2xl animate-in slide-in-from-bottom-8 duration-300"
              style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-slate-900">Unlink Bank Account</h3>
                <button
                  type="button"
                  onClick={() => setShowUnlinkModal(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 border border-amber-100 mb-6">
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">Are you sure you want to unlink this bank account?</p>
                  <p className="text-xs text-amber-600 mt-1">This will remove your linked bank details. You can re-link anytime.</p>
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={unlinkPassword}
                    onChange={(e) => { setUnlinkPassword(e.target.value); setUnlinkError(""); }}
                    placeholder="Enter your password"
                    className="w-full px-4 py-3.5 pr-12 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-300 transition-all"
                    autoComplete="current-password"
                    onKeyDown={(e) => { if (e.key === "Enter") confirmUnlink(); }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                {unlinkError && (
                  <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
                    <XCircle className="h-3 w-3" />
                    {unlinkError}
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={confirmUnlink}
                  disabled={unlinkLoading}
                  className="w-full py-4 rounded-full bg-red-500 text-white font-semibold text-sm uppercase tracking-[0.15em] shadow-lg shadow-red-500/20 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {unlinkLoading ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                      Unlinking...
                    </>
                  ) : (
                    <>
                      <Unlink className="h-4 w-4" />
                      Unlink Account
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowUnlinkModal(false)}
                  className="w-full py-4 rounded-full bg-slate-100 text-slate-700 font-semibold text-sm uppercase tracking-[0.15em] active:scale-95 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (step === "connect" && status === "banking" && consumerUrl) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-slate-50">
        <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 shadow-sm"
          style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
          <div className="flex items-center gap-3">
            <Landmark className="h-5 w-5 text-blue-600" />
            <span className="text-sm font-semibold text-slate-800">Bank Verification</span>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 relative">
          {!iframeLoaded && (
            <div className="absolute inset-0 z-10 bg-white p-6 animate-pulse">
              <div className="mx-auto max-w-md space-y-6 pt-8">
                <div className="flex justify-center">
                  <div className="h-16 w-16 rounded-full bg-slate-200" />
                </div>
                <div className="space-y-3">
                  <div className="mx-auto h-5 w-48 rounded-lg bg-slate-200" />
                  <div className="mx-auto h-3 w-64 rounded bg-slate-100" />
                </div>
                <div className="space-y-4 pt-4">
                  <div className="h-12 w-full rounded-xl bg-slate-200" />
                  <div className="h-12 w-full rounded-xl bg-slate-200" />
                  <div className="h-12 w-full rounded-xl bg-slate-100" />
                </div>
                <div className="pt-4">
                  <div className="h-14 w-full rounded-full bg-slate-200" />
                </div>
              </div>
            </div>
          )}
          <iframe
            src={consumerUrl}
            title="TruID Bank Verification"
            className={`absolute inset-0 w-full h-full border-0 transition-opacity duration-300 ${iframeLoaded ? "opacity-100" : "opacity-0"}`}
            allow="camera; microphone"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation allow-modals"
            onLoad={() => setIframeLoaded(true)}
          />
        </div>

        <div className="px-4 py-2 bg-white border-t border-slate-200 flex items-center justify-center gap-2 text-xs text-slate-400"
          style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}>
          <Shield className="h-3 w-3" />
          <span>Secured by TruID Connect</span>
        </div>
      </div>
    );
  }

  if (step === "connect") {
    return (
      <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 flex flex-col items-center px-6 pb-10 min-h-screen bg-white">
        <header className="w-full flex items-center justify-start pt-10 pb-6">
          <button
            onClick={() => setStep("intro")}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition active:scale-95"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        </header>

        <div className="w-full rounded-3xl bg-white p-6 shadow-sm border border-slate-100">
          <div className="flex flex-col items-center gap-6 py-4">
            <div className={`h-20 w-20 rounded-full flex items-center justify-center transition-all duration-500 ${
              status === "capturing"
                ? "bg-amber-100 text-amber-600 animate-pulse"
                : status === "error"
                ? "bg-red-100 text-red-500"
                : status === "cancelled"
                ? "bg-slate-100 text-slate-500"
                : "bg-blue-100 text-blue-600"
            }`}>
              {status === "cancelled" ? (
                <XCircle className="h-8 w-8" />
              ) : (
                <Landmark className="h-8 w-8" />
              )}
            </div>

            <div className="text-center max-w-xs">
              <h2 className="text-lg font-semibold text-slate-900 mb-2">
                {status === "cancelled" ? "Linking Cancelled" : "Bank Verification"}
              </h2>
              <p className="text-sm text-slate-500">
                {message || "Securely link your bank account through TruID to enable withdrawals and payouts."}
              </p>
              {status === "error" && (
                <p className="text-xs text-red-500 font-semibold mt-2">{message}</p>
              )}
            </div>

            {(status === "idle" || status === "error" || status === "cancelled") && (
              <button
                type="button"
                onClick={startSession}
                className="w-full py-4 rounded-full bg-slate-900 text-white font-semibold text-sm shadow-lg hover:bg-slate-800 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <ShieldCheck className="h-5 w-5" />
                {status === "error" || status === "cancelled" ? "Try Again" : "Connect Bank"}
              </button>
            )}

            {status === "connecting" && (
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                <span className="w-2 h-2 rounded-full bg-slate-500 animate-ping" />
                Connecting...
              </div>
            )}

            {status === "capturing" && (
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-600">
                <span className="w-2 h-2 rounded-full bg-amber-600 animate-spin" />
                Verifying...
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400">
          <Shield className="h-4 w-4" />
          <span>Your bank details are securely verified through TruID Connect.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 flex flex-col items-center px-6 pb-10 min-h-screen bg-white">
      <header className="w-full flex items-center justify-start pt-10 pb-6">
        <button
          onClick={() => onBack ? onBack() : window.history.back()}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
      </header>

      <div className="mb-6 relative z-10 mt-4">
        <div style={{ animation: "subtleBounce 3s ease-in-out infinite" }}>
          <img
            src="/assets/images/coinAlgoMoney.png"
            alt="Mint"
            className="h-20 w-20 object-contain drop-shadow-2xl"
          />
        </div>
        <div
          className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-12 h-1 bg-black/10 blur-md rounded-[100%]"
          style={{ animation: "shadowScale 3s ease-in-out infinite" }}
        ></div>
        <style>{`
          @keyframes subtleBounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
          @keyframes shadowScale {
            0%, 100% { transform: translateX(-50%) scale(1); opacity: 0.2; }
            50% { transform: translateX(-50%) scale(0.8); opacity: 0.1; }
          }
        `}</style>
      </div>

      <h2 className="text-3xl font-light tracking-tight text-center text-slate-900 mb-2 leading-tight">
        <span className="mint-brand font-bold uppercase mr-1.5">MINT</span><br />Bank Linking
      </h2>
      <p className="text-sm text-slate-500 text-center max-w-[280px] mb-8">
        "Securely connect your bank account to unlock the full Mint experience."
      </p>

      <div className="w-full space-y-3 mb-6">
        {[
          { icon: <Lock size={18} />, title: "1. Secure Connection", desc: "Bank-grade encryption via TruID." },
          { icon: <Landmark size={18} />, title: "2. Account Verification", desc: "Verify your primary bank account." },
          { icon: <Wallet size={18} />, title: "3. Enable Transactions", desc: "Deposits, withdrawals & payouts." }
        ].map((s, i) => (
          <div key={i} className="flex items-center gap-4 p-3 rounded-2xl bg-white/60 border border-white/40 shadow-sm backdrop-blur-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-900 shadow-sm shrink-0">
              {s.icon}
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-xs tracking-tight uppercase">{s.title}</h3>
              <p className="text-[10px] text-slate-500 leading-tight">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center gap-2 text-slate-400 text-[10px] font-bold uppercase tracking-widest hover:text-slate-600 transition mb-2"
      >
        <Info size={14} /> How it works {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {showDetails && (
        <div className="mb-6 p-4 rounded-xl bg-slate-50 border border-slate-100 text-[10px] text-slate-500 leading-relaxed animate-in fade-in zoom-in-95">
          We use <strong>TruID Connect</strong> to securely verify your bank account. Your credentials are never stored by Mint — 
          all verification happens directly with your bank through an encrypted channel. Once linked, you can make deposits, 
          withdrawals, and receive payouts seamlessly.
        </div>
      )}

      <button
        onClick={() => setStep("connect")}
        className="w-full py-4 bg-slate-900 text-white rounded-full text-sm font-bold uppercase tracking-widest shadow-xl shadow-slate-900/20 active:scale-95 transition-all mt-4"
      >
        Link Bank Account
      </button>

      <footer className="mt-8 text-center opacity-40">
        <p className="text-[8px] uppercase tracking-tighter text-slate-500 max-w-[340px] mx-auto leading-relaxed">
          <span className="mint-brand">MINT</span> (Pty) Ltd is an authorised Financial Services Provider (FSP 55118) and a
          Registered Credit Provider (NCRCP22892). <span className="mint-brand">MINT</span> Reg no: 2024/644796/07
        </p>
      </footer>
    </div>
  );
};

export default MintBankPage;
