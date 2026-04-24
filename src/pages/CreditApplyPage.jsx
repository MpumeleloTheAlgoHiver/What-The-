import React, { useRef, useState, useEffect, useCallback } from "react";
import { ArrowLeft, ArrowRight, ShieldCheck, Landmark, CheckCircle2, UserPen, Zap, TrendingUp, Search, ChevronDown, ChevronUp, Briefcase, Info, X, Shield, XCircle, AlertCircle, Check, User, Users, Baby, Shirt, ShoppingCart, Mountain, FileText, Loader2 } from "lucide-react";
import { MintGradientLayout } from "../components/credit/ui/MintGradientLayout";
import { MintCard } from "../components/credit/ui/MintCard";
import { MintRadarChart } from "../components/credit/ui/MintRadarChart";
import { useProfile } from "../lib/useProfile";
import { supabase } from "../lib/supabase";
import { useCreditCheck } from "../lib/useCreditCheck";
import NotificationBell from "../components/NotificationBell";
import CreditApplySkeleton from "../components/CreditApplySkeleton";

const normalizeLoanType = (value, fallback = "unsecured") => {
   const normalized = String(value || "").trim().toLowerCase();
   if (normalized === "secured" || normalized === "unsecured") return normalized;
   return fallback;
};

// --- Subcomponents for Stages ---

// Stage 1: TruID Connect (in-app iframe)
const ConnectionStage = ({ onComplete, onError, autoStart = false }) => {
   const [status, setStatus] = useState("idle");
   const [message, setMessage] = useState("");
   const [consumerUrl, setConsumerUrl] = useState(null);
   const [iframeLoaded, setIframeLoaded] = useState(false);
   const collectionIdRef = useRef(null);
   const pollingRef = useRef(null);

   useEffect(() => {
      // Clear any stale TrueID verification state on mount
      localStorage.removeItem('truid_collection_id');
      localStorage.removeItem('truid_consumer_url');
      sessionStorage.removeItem('truid_consent_token');

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
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
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
         console.error(err);
         setStatus("error");
         setMessage(err.message);
         onError(err.message);
      }
   };

   useEffect(() => {
      if (autoStart && status === "idle") {
         startSession();
      }
   }, [autoStart, status]);

   const handleCancel = useCallback(() => {
      if (pollingRef.current) {
         clearInterval(pollingRef.current);
         pollingRef.current = null;
      }
      setConsumerUrl(null);
      setStatus("cancelled");
      setMessage("Bank linking was cancelled. You can try again when you're ready.");
   }, []);

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
               setMessage("Analyzing banking data...");

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

                  const captureText = await captureRes.text();
                  let captureData;
                  try {
                     captureData = JSON.parse(captureText);
                  } catch (e) {
                     throw new Error("Invalid response from server");
                  }

                  if (!captureRes.ok || !captureData.success) {
                     throw new Error(captureData.error || "Capture failed");
                  }

                  if (captureData.bankAccounts && captureData.bankAccounts.length > 0) {
                     try {
                        const existing = JSON.parse(localStorage.getItem("mint_linked_banks") || "[]");
                        const newAccounts = captureData.bankAccounts.map(acc => ({ ...acc, linkedAt: new Date().toISOString() }));
                        localStorage.setItem("mint_linked_banks", JSON.stringify([...existing, ...newAccounts]));
                     } catch (e) { console.error("Failed to save bank data:", e); }
                  }
                  setStatus("success");
                  setMessage("Bank account linked successfully!");
                  onComplete(collectionId, captureData.success ? captureData.snapshot : null);
               } catch (err) {
                  console.error("Capture error", err);
                  setStatus("error");
                  setMessage("Failed to retrieve banking data.");
               }
            } else if (outcome === "failed") {
               clearInterval(pollingRef.current);
               pollingRef.current = null;
               setConsumerUrl(null);
               setStatus("error");
               setMessage("Bank connection was cancelled or failed.");
            }
         } catch (e) {
            console.error("Polling error", e);
         }
      }, 3000);
   };

   if (status === "banking" && consumerUrl) {
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

   return (
      <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-6 duration-700">

         {/* ── Hero banner ── */}
         <div className="relative overflow-hidden rounded-3xl bg-[#160d2a] px-6 pt-8 pb-9">
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 w-72 h-40 bg-violet-600/20 rounded-full blur-3xl pointer-events-none" />
            <div className="relative z-10 flex flex-col items-center text-center gap-3">
               <div className="h-16 w-16 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center border border-white/10 shadow-inner">
                  <Landmark className="h-7 w-7 text-white" />
               </div>
               <div>
                  <h2 className="text-[19px] font-semibold text-white tracking-tight leading-snug">Link Your Bank Account</h2>
                  <p className="text-[12px] text-white/45 mt-1 max-w-[230px] leading-relaxed">
                     Securely connect your primary bank to verify affordability
                  </p>
               </div>
               <div className="flex flex-wrap items-center justify-center gap-1.5 mt-1">
                  {["ABSA", "FNB", "Standard", "Nedbank", "Capitec"].map(b => (
                     <span key={b} className="text-[9px] font-black uppercase tracking-wider text-white/30 border border-white/10 rounded-full px-2.5 py-0.5">
                        {b}
                     </span>
                  ))}
               </div>
            </div>
         </div>

         {/* ── Process steps ── */}
         <div className="space-y-2">
            {[
               { n: "1", label: "Consent & Authenticate", sub: "Approve read-only access via TruID" },
               { n: "2", label: "Transaction Analysis", sub: "We scan your last 3 months of data" },
               { n: "3", label: "Encrypted Handoff", sub: "Only an income summary is stored" },
            ].map(row => (
               <div key={row.n} className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white border border-slate-100 shadow-sm">
                  <span className="w-7 h-7 rounded-full bg-violet-50 text-violet-700 text-[11px] font-black flex items-center justify-center shrink-0 ring-1 ring-violet-100">
                     {row.n}
                  </span>
                  <div>
                     <p className="text-[13px] font-semibold text-slate-800 leading-tight">{row.label}</p>
                     <p className="text-[11px] text-slate-400 leading-tight mt-0.5">{row.sub}</p>
                  </div>
               </div>
            ))}
         </div>

         {/* ── Status messages ── */}
         {status === "error" && (
            <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-100 flex items-start gap-2">
               <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
               <p className="text-[12px] text-red-600 font-medium">{message}</p>
            </div>
         )}
         {status === "cancelled" && (
            <div className="px-4 py-3 rounded-xl bg-amber-50 border border-amber-100">
               <p className="text-[12px] text-amber-700 font-medium">{message}</p>
            </div>
         )}

         {/* ── CTA ── */}
         {(status === "idle" || status === "error" || status === "cancelled") && (
            <button
               onClick={startSession}
               className="w-full py-4 rounded-2xl bg-[#160d2a] text-white font-bold text-[14px] tracking-wide shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2 mt-1"
            >
               <ShieldCheck size={18} />
               {status === "error" || status === "cancelled" ? "Try Again" : "Connect Bank Account"}
            </button>
         )}

         {status === "connecting" && (
            <div className="flex flex-col items-center gap-3 py-3">
               <div className="flex gap-1.5">
                  {[0, 1, 2].map(i => (
                     <span key={i} className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
               </div>
               <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Initializing secure session…</p>
            </div>
         )}

         {status === "capturing" && (
            <div className="flex flex-col items-center gap-3 py-3">
               <div className="relative h-12 w-12">
                  <div className="absolute inset-0 rounded-full border-2 border-violet-100" />
                  <div className="absolute inset-0 rounded-full border-2 border-t-violet-600 animate-spin" />
               </div>
               <p className="text-[11px] font-bold text-violet-600 uppercase tracking-widest">Analyzing transactions…</p>
            </div>
         )}

         {status === "success" && (
            <div className="flex flex-col items-center gap-3 py-3">
               <div className="h-12 w-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center ring-1 ring-emerald-100">
                  <CheckCircle2 size={24} />
               </div>
               <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-widest">Verified</p>
            </div>
         )}

         {/* ── Trust strip ── */}
         <p className="text-center text-[10px] text-slate-400 mt-1 flex items-center justify-center gap-1">
            <Shield size={10} className="shrink-0" /> Powered by TruID · Bank-grade 256-bit encryption
         </p>
      </div>
   );
};


// Stage 2: Enrichment (Review Details)
const EnrichmentStage = ({ onSubmit, defaultValues, employerOptions, employerLocked, contractLocked, sectorLocked, yearsLocked }) => {
   const [formData, setFormData] = useState({
      employerName: defaultValues?.employerName || "",
      employmentSector: defaultValues?.employmentSector || "",
      contractType: defaultValues?.contractType || "",
      yearsCurrentEmployer: defaultValues?.yearsCurrentEmployer || "",
      ...defaultValues
   });

   const formatContractLabel = (value) => {
      switch (value) {
         case "PERMANENT":
            return "Permanent";
         case "FIXED_TERM_12_PLUS":
            return "Fixed Term (>12m)";
         case "FIXED_TERM_LT_12":
            return "Fixed Term (<12m)";
         case "SELF_EMPLOYED_12_PLUS":
            return "Self Employed";
         default:
            return value ? value.replace(/_/g, " ") : "--";
      }
   };

   useEffect(() => {
      // Keep internal state in sync if defaultValues updates from parent
      setFormData(prev => ({
         ...prev,
         ...defaultValues
      }));
   }, [defaultValues]);

   const handleChange = (f, v) => setFormData(prev => ({ ...prev, [f]: v }));
   const canContinue = Boolean(
      formData.employerName && formData.employmentSector && formData.contractType && formData.yearsCurrentEmployer
   );

   return (
      <div className="space-y-4 animate-in fade-in slide-in-from-bottom-8 duration-700">

         {/* ── Header banner ── */}
         <div className="relative overflow-hidden rounded-3xl bg-[#160d2a] px-5 py-5 flex items-center gap-4">
            <div className="absolute right-0 top-0 w-40 h-full bg-violet-600/10 blur-2xl pointer-events-none" />
            <div className="h-12 w-12 rounded-2xl bg-white/10 flex items-center justify-center border border-white/10 shrink-0">
               <Briefcase className="h-5 w-5 text-white" />
            </div>
            <div>
               <h2 className="text-[17px] font-semibold text-white tracking-tight">Employment Details</h2>
               <p className="text-[11px] text-white/45 mt-0.5">Used for your affordability assessment</p>
            </div>
         </div>

         {/* ── Employer Name ── */}
         <div className="rounded-2xl bg-white border border-slate-100 shadow-sm px-4 pt-4 pb-4">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-2">Employer Name</span>
            <input
               list="employer-list"
               className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm font-semibold text-slate-800 placeholder-slate-300 focus:border-violet-400 focus:ring-2 focus:ring-violet-100 focus:outline-none transition"
               value={formData.employerName}
               onChange={(e) => handleChange("employerName", e.target.value)}
               placeholder="e.g. Acme Corporation"
            />
            {employerOptions?.length > 0 && (
               <datalist id="employer-list">
                  {employerOptions.map((name) => (
                     <option key={name} value={name} />
                  ))}
               </datalist>
            )}
         </div>

         {/* ── Sector pill grid ── */}
         <div className="rounded-2xl bg-white border border-slate-100 shadow-sm px-4 pt-4 pb-4">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-3">Employment Sector</span>
            <div className="grid grid-cols-2 gap-2">
               {[
                  { value: "government", label: "Government" },
                  { value: "private", label: "Private" },
                  { value: "listed", label: "Listed Company" },
                  { value: "other", label: "Other" },
               ].map(opt => (
                  <button
                     key={opt.value}
                     type="button"
                     onClick={() => handleChange("employmentSector", opt.value)}
                     className={`py-3 rounded-xl text-[12px] font-bold transition-all border active:scale-95 ${
                        formData.employmentSector === opt.value
                           ? "bg-[#160d2a] text-white border-[#160d2a] shadow-md"
                           : "bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300 hover:bg-slate-100"
                     }`}
                  >
                     {opt.label}
                  </button>
               ))}
            </div>
         </div>

         {/* ── Contract type pill grid ── */}
         <div className="rounded-2xl bg-white border border-slate-100 shadow-sm px-4 pt-4 pb-4">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-3">Contract Type</span>
            <div className="grid grid-cols-2 gap-2">
               {[
                  { value: "PERMANENT", label: "Permanent" },
                  { value: "FIXED_TERM_12_PLUS", label: "Fixed Term >12m" },
                  { value: "FIXED_TERM_LT_12", label: "Fixed Term <12m" },
                  { value: "SELF_EMPLOYED_12_PLUS", label: "Self-Employed" },
               ].map(opt => (
                  <button
                     key={opt.value}
                     type="button"
                     onClick={() => handleChange("contractType", opt.value)}
                     className={`py-3 rounded-xl text-[12px] font-bold transition-all border active:scale-95 ${
                        formData.contractType === opt.value
                           ? "bg-violet-600 text-white border-violet-600 shadow-md"
                           : "bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300 hover:bg-slate-100"
                     }`}
                  >
                     {opt.label}
                  </button>
               ))}
            </div>
         </div>

         {/* ── Years at employer chip row ── */}
         <div className="rounded-2xl bg-white border border-slate-100 shadow-sm px-4 pt-4 pb-4">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-3">Years at Current Employer</span>
            <div className="flex gap-2">
               {[
                  { value: "<1", label: "< 1yr" },
                  { value: "1", label: "1yr" },
                  { value: "2", label: "2yr" },
                  { value: "3", label: "3yr" },
                  { value: "4+", label: "4yr+" },
               ].map(opt => (
                  <button
                     key={opt.value}
                     type="button"
                     onClick={() => handleChange("yearsCurrentEmployer", opt.value)}
                     className={`flex-1 py-3 rounded-xl text-[11px] font-black transition-all border active:scale-95 ${
                        formData.yearsCurrentEmployer === opt.value
                           ? "bg-emerald-600 text-white border-emerald-600 shadow-md"
                           : "bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300 hover:bg-slate-100"
                     }`}
                  >
                     {opt.label}
                  </button>
               ))}
            </div>
         </div>

         {/* ── Continue CTA ── */}
         <button
            onClick={() => onSubmit(formData)}
            disabled={!canContinue}
            className="w-full py-4 rounded-2xl bg-[#160d2a] text-white font-bold text-[14px] tracking-wide shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed mt-1"
         >
            Continue <ArrowRight size={18} />
         </button>
      </div>
   );
};


// Stage 3: Results
const ResultStage = ({ score, isCalculating, engineFailed, breakdown, engineResult, onRunAssessment, onContinue, isPrefetching = false, onReapply }) => {
   const [showAllData, setShowAllData] = useState(false);
   const [loaderValue, setLoaderValue] = useState(0);

   useEffect(() => {
      let interval;
      if (isCalculating) {
         setLoaderValue(0);
         interval = setInterval(() => {
            setLoaderValue(prev => {
               if (prev >= 99) return 99;
               return prev + 0.5;
            });
         }, 20);
      } else if (score > 0) {
         setLoaderValue(score);
      } else if (engineFailed) {
         setLoaderValue(0);
      }
      return () => clearInterval(interval);
   }, [isCalculating, score, engineFailed]);

   const sanitizeData = (value) => {
      if (Array.isArray(value)) return value.map(sanitizeData);
      if (value && typeof value === "object") {
         return Object.entries(value).reduce((acc, [key, val]) => {
            const blockedKeys = new Set([
               "gross_monthly_income",
               "net_monthly_income",
               "avg_monthly_income",
               "avg_monthly_expenses",
               "monthly_income",
               "monthlyIncome",
               "monthly_expenses",
               "monthlyExpenses"
            ]);
            if (blockedKeys.has(key)) return acc;
            acc[key] = sanitizeData(val);
            return acc;
         }, {});
      }
      return value;
   };

   const safeResult = engineResult ? sanitizeData(engineResult) : null;
   const scoreReasons = engineResult?.scoreReasons || [];
   const tenureMonths = engineResult?.breakdown?.employmentTenure?.monthsInCurrentJob;

   const hasAssessment = score > 0 || isCalculating || engineFailed;
   const isDeclined = !isCalculating && score > 0 && score < 50;
   const scoreOutcome = score >= 80
      ? "Auto-approval at best rate"
      : score >= 70
         ? "Approval with risk-adjusted pricing"
         : score >= 50
            ? "Borderline – manual review"
            : "Decline";

   const progressDeg = (isCalculating ? loaderValue : score) * 3.6;

   const statusMessages = [
      'Initializing...',
      'Connecting...',
      'Processing...',
      'Analyzing...',
      'Finalizing...'
   ];
   const messageIndex = Math.min(statusMessages.length - 1, Math.floor((loaderValue / 100) * statusMessages.length));
   const statusText = hasAssessment
      ? (engineFailed ? "Error" : isCalculating ? statusMessages[messageIndex] : "Trust Score")
      : "Start Check";

   if (isPrefetching) {
      return (
         <MintCard className="animate-in zoom-in-95 duration-500 min-h-[360px]">
            <div className="flex flex-col items-center justify-center py-20 text-center">
               <div className="h-16 w-16 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mb-4">
                  <Loader2 className="h-7 w-7 animate-spin" />
               </div>
               <p className="text-sm font-semibold text-slate-800">Fetching Assessment Result</p>
               <p className="text-xs text-slate-500 mt-1">Loading your latest credit engine score...</p>
            </div>
         </MintCard>
      );
   }


   return (
      <MintCard className="animate-in zoom-in-95 duration-500 min-h-[400px]">
         <div className="flex flex-col items-center justify-center py-16">
            <button
               onClick={hasAssessment ? undefined : onRunAssessment}
               disabled={hasAssessment}
               className="group relative outline-none focus-visible:ring-4 focus-visible:ring-purple-500/40 rounded-full transition-all duration-300"
            >
               <div
                  className="w-[190px] h-[190px] rounded-full relative grid place-items-center transition-transform duration-300 ease-out group-hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                     background: `
                                    radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.98), rgba(255, 255, 255, 0.6) 55%, rgba(255, 255, 255, 0)),
                                    conic-gradient(
                                    from -90deg,
                                    #6a43ff 0deg,
                                    #9370ff ${Math.max(0.1, progressDeg * 0.8)}deg,
                                    #8d6bff ${Math.max(0.1, progressDeg)}deg,
                                    rgba(106, 67, 255, 0.15) ${Math.max(0.1, progressDeg)}deg,
                                    rgba(106, 67, 255, 0.08) 360deg
                                    )
                                `,
                     boxShadow: `
                                    inset 0 4px 10px rgba(255, 255, 255, 0.8),
                                    inset 0 -6px 12px rgba(75, 34, 214, 0.1),
                                    inset 1px 1px 4px rgba(255, 255, 255, 0.4),
                                    0 10px 24px rgba(75, 34, 214, 0.15),
                                    0 4px 8px rgba(106, 67, 255, 0.1)
                                `
                  }}
               >
                  {/* Inner White Circle */}
                  <div
                     className="absolute inset-[10px] rounded-full bg-gradient-to-br from-white via-[#faf8ff] to-[#f2edff] z-10"
                     style={{
                        boxShadow: `
                                        0 2px 6px rgba(75, 34, 214, 0.05),
                                        inset 0 4px 8px rgba(0, 0, 0, 0.01),
                                        inset 0 -2px 6px rgba(106, 67, 255, 0.02)
                                    `
                     }}
                  >
                     {/* Glare */}
                     <div className="absolute top-[14px] left-[14px] right-[14px] h-1/2 rounded-t-full bg-gradient-to-b from-white/60 to-transparent blur-md pointer-events-none z-20" />
                  </div>

                  {/* Content */}
                  <div className="relative z-30 text-center flex flex-col items-center">
                     <span
                        className="text-5xl font-light tracking-tight"
                        style={{
                           background: 'linear-gradient(135deg, #4b22d6 0%, #6a43ff 50%, #8d6bff 100%)',
                           WebkitBackgroundClip: 'text',
                           WebkitTextFillColor: 'transparent',
                           filter: 'drop-shadow(0 1px 2px rgba(75, 34, 214, 0.1))'
                        }}
                     >
                        {Math.round(isCalculating ? loaderValue : score)}%
                     </span>
                     <span className="text-[11px] font-medium text-slate-400 mt-2 tracking-widest uppercase">
                        {statusText}
                     </span>
                  </div>
               </div>
            </button>

            {/* Instruction text — only visible before scoring starts */}
            {!hasAssessment && (
               <div className="mt-8 text-center animate-in fade-in slide-in-from-bottom-2 duration-500">
                  <p className="text-[13px] font-semibold text-slate-700">Tap the button to start scoring</p>
                  <p className="text-[11px] text-slate-400 mt-1.5 max-w-[240px] mx-auto leading-relaxed">
                     We'll run a quick affordability check using your linked data to generate your trust score.
                  </p>
               </div>
            )}
         </div>

         {engineFailed && !isCalculating && (
            <div className="pt-6 space-y-4 text-center">
               <p className="text-sm font-semibold text-red-600">Assessment could not be completed.</p>
               <p className="text-xs text-slate-500">{engineResult?.error || "Please try again."}</p>
               <button
                  onClick={onRunAssessment}
                  className="w-full py-3 rounded-full bg-[#160d2a] text-white font-semibold text-sm shadow-lg active:scale-95 transition-all"
               >
                  Retry Assessment
               </button>
            </div>
         )}

         {!isCalculating && score > 0 && (
            <div className="pt-8 border-t border-slate-50 mt-8 space-y-4">
               <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${isDeclined
                  ? "border-red-200 bg-red-50 text-red-700"
                  : score >= 80
                     ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                     : "border-amber-200 bg-amber-50 text-amber-700"
                  }`}>
                  {scoreOutcome}
               </div>
               <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-50 p-3 rounded-xl text-center">
                     <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Credit Score</p>
                     <p className="text-lg font-black text-slate-800">{engineResult?.creditScore ?? "--"}</p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-xl text-center">
                     <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Tenure</p>
                     <p className="text-lg font-black text-slate-800">{Number.isFinite(tenureMonths) ? `${tenureMonths} months` : "--"}</p>
                  </div>
               </div>

               <details className="group rounded-xl border border-slate-100 bg-white/80 p-4">
                  <summary className="cursor-pointer text-xs font-bold uppercase tracking-widest text-slate-500">Show Experian reasons</summary>
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                     {scoreReasons.length ? (
                        <ul className="list-disc pl-5 space-y-1">
                           {scoreReasons.map((reason, idx) => (
                              <li key={idx} className={reason.impact === "positive" ? "text-emerald-700" : reason.impact === "negative" ? "text-red-600" : "text-slate-700"}>
                                 <span className="font-semibold">{reason.factor || reason}</span>
                                 {reason.detail ? `: ${reason.detail}` : typeof reason === "string" ? "" : ""}
                              </li>
                           ))}
                        </ul>
                     ) : (
                        <p className="text-slate-500">No reasons returned.</p>
                     )}
                  </div>
               </details>

               <details className="group rounded-xl border border-slate-100 bg-white/80 p-4">
                  <summary className="cursor-pointer text-xs font-bold uppercase tracking-widest text-slate-500">Show all data</summary>
                  <div className="mt-3">
                     <button
                        type="button"
                        onClick={() => setShowAllData((prev) => !prev)}
                        className="text-xs font-semibold text-slate-500 hover:text-slate-900"
                     >
                        {showAllData ? "Hide details" : "Reveal details"}
                     </button>
                     {showAllData && (
                        <div className="mt-4 space-y-4 text-xs text-slate-700">
                           <div className="grid grid-cols-2 gap-3">
                              <div className="rounded-lg border border-slate-100 bg-white p-3">
                                 <p className="text-[10px] uppercase font-bold text-slate-400">Borrower status</p>
                                 <p className="text-sm font-semibold text-slate-800">
                                    {engineResult?.raw?.userData?.algolend_is_new_borrower ? "New borrower" : "Existing borrower"}
                                 </p>
                              </div>
                              <div className="rounded-lg border border-slate-100 bg-white p-3">
                                 <p className="text-[10px] uppercase font-bold text-slate-400">Contract type</p>
                                 <p className="text-sm font-semibold text-slate-800">
                                    {engineResult?.breakdown?.contractType?.contractType || "--"}
                                 </p>
                              </div>
                           </div>

                           <div className="rounded-lg border border-slate-100 bg-white p-3">
                              <p className="text-[10px] uppercase font-bold text-slate-400 mb-2">Exposure snapshot</p>
                              <div className="grid grid-cols-2 gap-3">
                                 <div>
                                    <p className="text-[10px] text-slate-400">Revolving utilization</p>
                                    <p className="font-semibold text-slate-800">
                                       {Number.isFinite(engineResult?.breakdown?.creditUtilization?.ratioPercent)
                                          ? `${engineResult.breakdown.creditUtilization.ratioPercent.toFixed(1)}%`
                                          : "--"}
                                    </p>
                                 </div>
                                 <div>
                                    <p className="text-[10px] text-slate-400">Total balance</p>
                                    <p className="font-semibold text-slate-800">
                                       {Number.isFinite(engineResult?.creditExposure?.totalBalance)
                                          ? `R ${engineResult.creditExposure.totalBalance.toLocaleString()}`
                                          : "--"}
                                    </p>
                                 </div>
                                 <div>
                                    <p className="text-[10px] text-slate-400">Total limits</p>
                                    <p className="font-semibold text-slate-800">
                                       {Number.isFinite(engineResult?.creditExposure?.totalLimits)
                                          ? `R ${engineResult.creditExposure.totalLimits.toLocaleString()}`
                                          : "--"}
                                    </p>
                                 </div>
                                 <div>
                                    <p className="text-[10px] text-slate-400">Monthly installments</p>
                                    <p className="font-semibold text-slate-800">
                                       {Number.isFinite(engineResult?.creditExposure?.totalMonthlyInstallment)
                                          ? `R ${engineResult.creditExposure.totalMonthlyInstallment.toLocaleString()}`
                                          : "--"}
                                    </p>
                                 </div>
                              </div>
                           </div>

                           <div className="rounded-lg border border-slate-100 bg-white p-3">
                              <p className="text-[10px] uppercase font-bold text-slate-400 mb-2">Score breakdown</p>
                              <div className="space-y-2">
                                 {Object.entries(engineResult?.breakdown || {}).map(([key, value]) => (
                                    <div key={key} className="flex items-center justify-between">
                                       <span className="text-slate-500">
                                          {key.replace(/([A-Z])/g, " $1").trim()}
                                       </span>
                                       <span className="font-semibold text-slate-800">
                                          {Number.isFinite(value?.contributionPercent)
                                             ? `${(value.contributionPercent * 100).toFixed(1)}%`
                                             : "--"}
                                       </span>
                                    </div>
                                 ))}
                              </div>
                           </div>
                        </div>
                     )}
                  </div>
               </details>

               {onContinue && (
                  <button
                     type="button"
                     onClick={onContinue}
                     disabled={isDeclined}
                     className="w-full mt-2 py-4 rounded-full bg-[#160d2a] text-white text-sm font-semibold uppercase tracking-[0.2em] shadow-lg shadow-violet-950/25 hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                     {isDeclined ? "Loan declined" : "Continue to loan configuration"}
                  </button>
               )}

               {isDeclined && onReapply && (
                  <button
                     type="button"
                     onClick={onReapply}
                     className="w-full mt-2 py-3 rounded-full border border-slate-300 bg-white text-slate-700 text-xs font-semibold uppercase tracking-[0.16em]"
                  >
                     Reapply
                  </button>
               )}
            </div>
         )}
      </MintCard>
   );
};

const LoanCalculatorStep = ({ onSignedContinue }) => {
   const LIGHT_THRESHOLD = 0.36;
   const MIN_LOAN_AMOUNT = 1000;
   const MAX_LOAN_AMOUNT = 9000;
   const AMOUNT_STEP = 100;
   const MIN_LOAN_PERIOD = 3;
   const MAX_LOAN_PERIOD = 6;
   const [loanAmount, setLoanAmount] = useState(3000);
   const [loanPeriod, setLoanPeriod] = useState(3);
   const amountTrackRef = useRef(null);
   const periodTrackRef = useRef(null);
   const dragRef = useRef({ active: false, type: null, startX: 0, startValue: 0, isTouch: false });

   const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
   const snap = (value, min, max, step) => {
      const limited = clamp(value, min, max);
      return Math.round((limited - min) / step) * step + min;
   };

   // ── NCA short-term credit fee engine ──
   // Interest base rate: 4.5% per month (capped at 27% effective)
   // Admin/service fee: R69 per month (fixed)
   // No initiation fee, no credit life insurance
   const MONTHLY_RATE = 0.045; // 4.5% per month
   const MAX_EFFECTIVE_RATE_PCT = 27;

   const monthlyServiceFee = 69; // Admin fee fixed at R69 per month

   const effectiveInterestRatePct = Math.min(
      MAX_EFFECTIVE_RATE_PCT,
      MONTHLY_RATE * loanPeriod * 100
   );

   const totalInterest = Math.max(0, loanAmount * (effectiveInterestRatePct / 100));
   const totalServiceFees = monthlyServiceFee * loanPeriod;
   const totalCostOfCredit = totalInterest + totalServiceFees;
   const totalRepayable = loanAmount + totalCostOfCredit;
   const monthlyPayment = loanPeriod > 0 ? (totalRepayable / loanPeriod) : 0;

   const [showFees, setShowFees] = useState(false);
   const [showContract, setShowContract] = useState(false);
   const [hasSignature, setHasSignature] = useState(false);
   const [signatureError, setSignatureError] = useState("");
   const [isSubmittingSignature, setIsSubmittingSignature] = useState(false);
   const signatureCanvasRef = useRef(null);
   const signatureDrawingRef = useRef(false);
   const signatureDirtyRef = useRef(false);

   const formatMoney = (value) => value.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
   const formatInt = (value) => Math.round(value).toLocaleString("en-ZA");

   const amountPct = (loanAmount - MIN_LOAN_AMOUNT) / (MAX_LOAN_AMOUNT - MIN_LOAN_AMOUNT);
   const periodPct = (loanPeriod - MIN_LOAN_PERIOD) / (MAX_LOAN_PERIOD - MIN_LOAN_PERIOD);

   const getClientX = (event, isTouch) => {
      if (isTouch) return event.touches?.[0]?.clientX ?? event.changedTouches?.[0]?.clientX ?? 0;
      return event.clientX ?? 0;
   };

   const beginDrag = (type, event, isTouch = false) => {
      const track = type === "amount" ? amountTrackRef.current : periodTrackRef.current;
      if (!track) return;

      const rect = track.getBoundingClientRect();
      const clientX = getClientX(event, isTouch);
      const x = clamp(clientX - rect.left, 0, rect.width);
      const pct = rect.width > 0 ? x / rect.width : 0;

      if (type === "amount") {
         const next = snap(
            MIN_LOAN_AMOUNT + pct * (MAX_LOAN_AMOUNT - MIN_LOAN_AMOUNT),
            MIN_LOAN_AMOUNT,
            MAX_LOAN_AMOUNT,
            AMOUNT_STEP
         );
         setLoanAmount(next);
      } else {
         const next = snap(
            MIN_LOAN_PERIOD + pct * (MAX_LOAN_PERIOD - MIN_LOAN_PERIOD),
            MIN_LOAN_PERIOD,
            MAX_LOAN_PERIOD,
            1
         );
         setLoanPeriod(next);
      }

      dragRef.current = {
         active: true,
         type,
         startX: clientX,
         startValue: type === "amount" ? loanAmount : loanPeriod,
         isTouch
      };

      if (isTouch) {
         event.preventDefault();
      }
   };

   useEffect(() => {
      const onMove = (event) => {
         if (!dragRef.current.active) return;

         const { type, startX, startValue, isTouch } = dragRef.current;
         const track = type === "amount" ? amountTrackRef.current : periodTrackRef.current;
         if (!track) return;

         const rect = track.getBoundingClientRect();
         const clientX = getClientX(event, isTouch);
         const dx = clientX - startX;
         const range = type === "amount"
            ? MAX_LOAN_AMOUNT - MIN_LOAN_AMOUNT
            : MAX_LOAN_PERIOD - MIN_LOAN_PERIOD;
         const delta = rect.width > 0 ? (dx / rect.width) * range : 0;

         if (type === "amount") {
            const next = snap(startValue + delta, MIN_LOAN_AMOUNT, MAX_LOAN_AMOUNT, AMOUNT_STEP);
            setLoanAmount(next);
         } else {
            const next = snap(startValue + delta, MIN_LOAN_PERIOD, MAX_LOAN_PERIOD, 1);
            setLoanPeriod(next);
         }

         if (isTouch) event.preventDefault();
      };

      const onEnd = () => {
         dragRef.current.active = false;
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onEnd);
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("touchend", onEnd);

      return () => {
         window.removeEventListener("mousemove", onMove);
         window.removeEventListener("mouseup", onEnd);
         window.removeEventListener("touchmove", onMove);
         window.removeEventListener("touchend", onEnd);
      };
   }, []);

   // Attach non-passive touchstart directly so preventDefault() works
   useEffect(() => {
      const amountEl = amountTrackRef.current;
      const periodEl = periodTrackRef.current;
      if (!amountEl || !periodEl) return;

      const onAmountTouch = (e) => beginDrag("amount", e, true);
      const onPeriodTouch = (e) => beginDrag("period", e, true);

      amountEl.addEventListener("touchstart", onAmountTouch, { passive: false });
      periodEl.addEventListener("touchstart", onPeriodTouch, { passive: false });

      return () => {
         amountEl.removeEventListener("touchstart", onAmountTouch);
         periodEl.removeEventListener("touchstart", onPeriodTouch);
      };
   }, []);

   useEffect(() => {
      if (!showContract) return;

      const canvas = signatureCanvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.strokeStyle = "#160d2a";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      signatureDirtyRef.current = false;
      setHasSignature(false);
      setSignatureError("");
   }, [showContract]);

   const getSignaturePoint = (event) => {
      const canvas = signatureCanvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const source = event.touches?.[0] || event.changedTouches?.[0] || event;
      return {
         x: source.clientX - rect.left,
         y: source.clientY - rect.top,
      };
   };

   const startSignature = (event) => {
      const canvas = signatureCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { x, y } = getSignaturePoint(event);
      signatureDrawingRef.current = true;
      signatureDirtyRef.current = true;
      setHasSignature(true);
      setSignatureError("");
      ctx.beginPath();
      ctx.moveTo(x, y);
      if (event.cancelable) event.preventDefault();
   };

   const moveSignature = (event) => {
      if (!signatureDrawingRef.current) return;
      const canvas = signatureCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { x, y } = getSignaturePoint(event);
      ctx.lineTo(x, y);
      ctx.stroke();
      if (event.cancelable) event.preventDefault();
   };

   const endSignature = () => {
      signatureDrawingRef.current = false;
   };

   const clearSignature = () => {
      const canvas = signatureCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const displayWidth = canvas.width / (window.devicePixelRatio || 1);
      const displayHeight = canvas.height / (window.devicePixelRatio || 1);
      ctx.clearRect(0, 0, displayWidth, displayHeight);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, displayWidth, displayHeight);
      signatureDirtyRef.current = false;
      setHasSignature(false);
      setSignatureError("");
   };

   const handleContractAccept = async () => {
      if (!hasSignature || !signatureDirtyRef.current) {
         setSignatureError("Please sign before continuing.");
         return;
      }

      setIsSubmittingSignature(true);
      try {
         const signatureDataUrl = signatureCanvasRef.current?.toDataURL("image/png") || null;
         if (onSignedContinue) {
            await onSignedContinue({
               loanAmount,
               loanPeriod,
               monthlyPayment,
               totalRepayable,
               totalCostOfCredit,
               totalInterest,
               totalServiceFees,
               signatureDataUrl,
            });
         }
         setShowContract(false);
      } finally {
         setIsSubmittingSignature(false);
      }
   };

   return (
      <div className="space-y-2 animate-in fade-in slide-in-from-bottom-6 duration-500 pb-36">

         {/* ── Hero card ── */}
         <div className="relative overflow-hidden rounded-[28px] bg-[#160d2a] px-6 pt-4 pb-5">
            {/* Decorative blobs */}
            <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-blue-600/15 blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-36 h-36 rounded-full bg-violet-600/10 blur-2xl pointer-events-none" />

            {/* Header row */}
            <div className="relative flex items-center justify-between mb-5">
               <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-2xl bg-white/[0.08] border border-white/10 flex items-center justify-center shrink-0">
                     <TrendingUp className="h-4 w-4 text-white" />
                  </div>
                  <div>
                     <p className="text-[15px] font-semibold text-white leading-tight">Loan Calculator</p>
                     <p className="text-[11px] text-white/40 leading-none mt-0.5">Personalise your offer</p>
                  </div>
               </div>
               <div className="rounded-full bg-white/[0.06] border border-white/10 px-3 py-1">
                  <span className="text-[10px] font-medium text-white/45 tracking-[0.08em]">STEP 4 / 4</span>
               </div>
            </div>

            {/* Payment figures */}
            <div className="relative flex items-end justify-between">
               <div>
                  <p className="text-[10px] font-medium text-white/30 uppercase tracking-[0.12em] mb-1.5">Monthly Repayment</p>
                  <div className="flex items-start gap-1 leading-none">
                     <span className="text-[18px] font-light text-white/50 mt-2">R</span>
                     <span className="text-[48px] font-bold tracking-[-0.04em] text-white leading-none">{formatMoney(monthlyPayment)}</span>
                  </div>
               </div>
               <div className="text-right mb-1 space-y-1.5">
                  <div>
                     <p className="text-[9px] text-white/25 uppercase tracking-[0.1em]">Cost of credit</p>
                     <p className="text-[15px] font-semibold text-white/60">R {formatMoney(totalCostOfCredit)}</p>
                  </div>
               </div>
            </div>

            {/* Total repayable footer */}
            <div className="relative mt-4 pt-3 border-t border-white/[0.07] flex items-center justify-between">
               <span className="text-[11px] text-white/35 font-medium">Total repayable</span>
               <span className="text-[13px] font-bold text-white/65">R {formatMoney(totalRepayable)}</span>
            </div>
         </div>

         {/* ── Sliders card ── */}
         <div className="bg-white rounded-[24px] px-5 py-5">
            {/* Amount slider */}
            <div className="space-y-3">
               <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Loan Amount</p>
                  <div className="flex items-baseline gap-0.5">
                     <span className="text-[12px] font-medium text-slate-400">R</span>
                     <span className="text-[17px] font-bold tracking-[-0.02em] text-slate-900">{formatInt(loanAmount)}</span>
                  </div>
               </div>
               <div
                  ref={amountTrackRef}
                  className="relative h-[54px] rounded-2xl bg-slate-100 overflow-visible cursor-pointer select-none touch-none"
                  onMouseDown={(e) => beginDrag("amount", e)}
               >
                  <div
                     className="absolute top-0 left-0 h-[54px] rounded-2xl overflow-hidden flex items-center justify-between px-4"
                     style={{
                        width: `${Math.max(4, amountPct * 100)}%`,
                        background: "linear-gradient(90deg, #160d2a 0%, #2a1a46 100%)"
                     }}
                  >
                     <div className="flex items-baseline gap-1" style={{ opacity: amountPct < LIGHT_THRESHOLD ? 0 : 1 }}>
                        <span className="text-[12px] font-medium text-white/50">R</span>
                        <span className="text-[22px] font-bold tracking-[-0.02em] text-white leading-none">{formatInt(loanAmount)}</span>
                     </div>
                     <div className="flex flex-col gap-[3px] ml-2 shrink-0">
                        <span className="block w-[3px] h-[3px] rounded-full bg-white/20" />
                        <span className="block w-[3px] h-[3px] rounded-full bg-white/20" />
                        <span className="block w-[3px] h-[3px] rounded-full bg-white/20" />
                     </div>
                  </div>
                  <div
                     className={`absolute top-1/2 -translate-y-1/2 text-[13px] font-bold text-slate-700 whitespace-nowrap transition-opacity ${amountPct < LIGHT_THRESHOLD ? "opacity-100" : "opacity-0"}`}
                     style={{ left: `calc(${Math.max(4, amountPct * 100)}% + 10px)` }}
                  >
                     R {formatInt(loanAmount)}
                  </div>
               </div>
               <div className="flex justify-between px-0.5">
                  <span className="text-[10px] text-slate-400 font-medium">R 1,000</span>
                  <span className="text-[10px] text-slate-400 font-medium">R 9,000</span>
               </div>
            </div>

            {/* Divider */}
            <div className="my-5 border-t border-slate-100" />

            {/* Period slider */}
            <div className="space-y-3">
               <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Loan Period</p>
                  <div className="flex items-baseline gap-1">
                     <span className="text-[17px] font-bold tracking-[-0.02em] text-slate-900">{loanPeriod}</span>
                     <span className="text-[12px] font-medium text-slate-400">{loanPeriod === 1 ? "month" : "months"}</span>
                  </div>
               </div>
               <div
                  ref={periodTrackRef}
                  className="relative h-[54px] rounded-2xl bg-slate-100 overflow-visible cursor-pointer select-none touch-none"
                  onMouseDown={(e) => beginDrag("period", e)}
               >
                  <div
                     className="absolute top-0 left-0 h-[54px] rounded-2xl overflow-hidden flex items-center justify-between px-4"
                     style={{
                        width: `${Math.max(4, periodPct * 100)}%`,
                        background: "linear-gradient(90deg, #160d2a 0%, #2a1a46 100%)"
                     }}
                  >
                     <div className="flex items-baseline gap-1.5" style={{ opacity: periodPct < LIGHT_THRESHOLD ? 0 : 1 }}>
                        <span className="text-[22px] font-bold tracking-[-0.02em] text-white leading-none">{loanPeriod}</span>
                        <span className="text-[12px] font-normal text-white/50">mo</span>
                     </div>
                     <div className="flex flex-col gap-[3px] ml-2 shrink-0">
                        <span className="block w-[3px] h-[3px] rounded-full bg-white/20" />
                        <span className="block w-[3px] h-[3px] rounded-full bg-white/20" />
                        <span className="block w-[3px] h-[3px] rounded-full bg-white/20" />
                     </div>
                  </div>
                  <div
                     className={`absolute top-1/2 -translate-y-1/2 text-[13px] font-bold text-slate-700 whitespace-nowrap transition-opacity ${periodPct < LIGHT_THRESHOLD ? "opacity-100" : "opacity-0"}`}
                     style={{ left: `calc(${Math.max(4, periodPct * 100)}% + 10px)` }}
                  >
                     {loanPeriod} mo
                  </div>
               </div>
               <div className="flex justify-between px-0.5">
                  <span className="text-[10px] text-slate-400 font-medium">3 months</span>
                  <span className="text-[10px] text-slate-400 font-medium">6 months</span>
               </div>
            </div>

            <p className="mt-4 text-[10px] text-slate-400 font-medium text-center">
               Min R1,000 · Max R9,000 · Term 3–6 months
            </p>
         </div>

         {/* ── Repayment summary card ── */}
         <div className="bg-white rounded-[24px] px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 mb-3">Repayment Summary</p>

            <div className="space-y-0">
               {[
                  { label: "Principal Amount",   value: `R ${formatInt(loanAmount)}`,                                    dot: "bg-[#160d2a]" },
                  { label: "Loan Period",         value: `${loanPeriod} ${loanPeriod === 1 ? "month" : "months"}`,       dot: "bg-slate-400" },
                  { label: "Monthly Repayment",   value: `R ${formatMoney(monthlyPayment)}`,                              dot: "bg-violet-600" },
                  { label: "Total Repayable",     value: `R ${formatMoney(totalRepayable)}`,                              dot: "bg-blue-600" },
               ].map((row, i, arr) => (
                  <div key={row.label} className={`flex items-center justify-between py-3 ${i < arr.length - 1 ? "border-b border-slate-100" : ""}`}>
                     <div className="flex items-center gap-2.5">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${row.dot}`} />
                        <span className="text-[13px] text-slate-500 font-medium">{row.label}</span>
                     </div>
                     <span className="text-[14px] text-slate-900 font-bold tracking-[-0.01em]">{row.value}</span>
                  </div>
               ))}
            </div>

            {/* Principal vs Cost of Credit split bar */}
            <div className="mt-4 pt-4 border-t border-slate-100">
               <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-slate-400 font-medium">Principal</span>
                  <span className="text-[10px] text-slate-400 font-medium">Cost of credit</span>
               </div>
               <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex">
                  {(() => {
                     const prinPct = totalRepayable > 0 ? (loanAmount / totalRepayable) * 100 : 100;
                     return (
                        <>
                           <div className="h-full bg-[#160d2a] rounded-l-full transition-all duration-500" style={{ width: `${prinPct}%` }} />
                           <div className="h-full bg-violet-400 flex-1 rounded-r-full" />
                        </>
                     );
                  })()}
               </div>
               <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[10px] font-bold text-slate-600">R {formatInt(loanAmount)}</span>
                  <span className="text-[10px] font-bold text-violet-500">R {formatMoney(totalCostOfCredit)}</span>
               </div>
            </div>

            {/* Fee disclosure toggle */}
            <button
               type="button"
               onClick={() => setShowFees(f => !f)}
               className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between w-full group"
            >
               <div className="flex items-center gap-2">
                  <Info className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-[11px] font-semibold text-slate-500 group-active:text-slate-700">Fee Breakdown (NCA Schedule)</span>
               </div>
               {showFees ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
            </button>

            {showFees && (
               <div className="mt-3 space-y-0 animate-in fade-in slide-in-from-top-2 duration-300">
                  {[
                     { label: "Interest (4.5% p.m.)",       value: `R ${formatMoney(totalInterest)}` },
                     { label: "Admin fees (R69 × " + loanPeriod + ")", value: `R ${formatMoney(totalServiceFees)}` },
                  ].map((row, i, arr) => (
                     <div key={row.label} className={`flex items-center justify-between py-2 ${i < arr.length - 1 ? "border-b border-dashed border-slate-100" : ""}`}>
                        <span className="text-[11px] text-slate-400">{row.label}</span>
                        <span className="text-[12px] font-semibold text-slate-700">{row.value}</span>
                     </div>
                  ))}
                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-200">
                     <span className="text-[11px] font-bold text-slate-600">Total cost of credit</span>
                     <span className="text-[13px] font-bold text-slate-900">R {formatMoney(totalCostOfCredit)}</span>
                  </div>
               </div>
            )}

            {/* NCA compliance inline */}
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2">
               <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
               <span className="text-[11px] font-medium text-slate-500">NCA-compliant · Interest: <strong className="text-slate-700">4.5% p.m.</strong> ({effectiveInterestRatePct.toFixed(0)}% over {loanPeriod} months, max 27%)</span>
            </div>
         </div>

         {/* ── CTA ── */}
         <button
            type="button"
            onClick={() => setShowContract(true)}
            className="w-full py-[18px] rounded-full bg-[#160d2a] text-white text-[15px] font-semibold tracking-[0.01em] shadow-xl shadow-violet-950/30 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
         >
            Apply for this loan
            <ArrowRight className="h-4 w-4" />
         </button>

         {showContract && (
            <div className="fixed inset-0 z-[120] bg-slate-900/70 backdrop-blur-sm flex items-end sm:items-center justify-center px-4 py-4">
               <div className="w-full max-w-2xl bg-white rounded-[28px] overflow-hidden shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300">
                  <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                     <div>
                        <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-slate-400">Loan Agreement</p>
                        <h3 className="text-[17px] font-semibold text-slate-900">Unsecured Credit Contract</h3>
                     </div>
                     <button
                        type="button"
                        onClick={() => setShowContract(false)}
                        className="h-9 w-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center"
                     >
                        <X className="h-4 w-4" />
                     </button>
                  </div>

                  <div className="px-5 py-4 max-h-[52vh] overflow-y-auto space-y-4">
                     <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs font-semibold text-slate-700 mb-2">Repayment Summary</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
                           <span className="text-slate-500">Principal</span><span className="font-semibold text-slate-900 text-right">R {formatInt(loanAmount)}</span>
                           <span className="text-slate-500">Term</span><span className="font-semibold text-slate-900 text-right">{loanPeriod} {loanPeriod === 1 ? "month" : "months"}</span>
                           <span className="text-slate-500">Monthly installment</span><span className="font-semibold text-slate-900 text-right">R {formatMoney(monthlyPayment)}</span>
                           <span className="text-slate-500">Total repayable</span><span className="font-semibold text-slate-900 text-right">R {formatMoney(totalRepayable)}</span>
                        </div>
                     </div>

                     <div className="space-y-3 text-[12px] text-slate-600 leading-relaxed">
                        <p><strong className="text-slate-800">1. Facility:</strong> This unsecured credit facility is granted subject to affordability, identity verification, and final approval checks.</p>
                        <p><strong className="text-slate-800">2. Pricing:</strong> Interest is charged at 4.5% per month (effective {effectiveInterestRatePct.toFixed(0)}% for this {loanPeriod}-month term, capped at 27%), plus a fixed R69 monthly admin fee.</p>
                        <p><strong className="text-slate-800">3. Fees Breakdown:</strong> Admin fees R {formatMoney(totalServiceFees)}, total interest R {formatMoney(totalInterest)}.</p>
                        <p><strong className="text-slate-800">4. Payment Obligation:</strong> You agree to pay the installment on scheduled due dates. Missed payments may incur default collection processes as permitted by law.</p>
                        <p><strong className="text-slate-800">5. Early Settlement:</strong> You may settle early in accordance with the National Credit Act and receive an adjusted settlement quote where applicable.</p>
                        <p><strong className="text-slate-800">6. Consent:</strong> By signing below, you confirm you understood the repayment schedule, costs, and legal obligations of this loan agreement.</p>
                     </div>

                     <div className="rounded-2xl border border-slate-200 p-4">
                        <div className="flex items-center justify-between mb-2">
                           <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Client Signature</p>
                           <button type="button" onClick={clearSignature} className="text-[11px] font-semibold text-violet-600">Clear</button>
                        </div>
                        <canvas
                           ref={signatureCanvasRef}
                           className="w-full h-32 rounded-xl border border-dashed border-slate-300 bg-white touch-none"
                           onMouseDown={startSignature}
                           onMouseMove={moveSignature}
                           onMouseUp={endSignature}
                           onMouseLeave={endSignature}
                           onTouchStart={startSignature}
                           onTouchMove={moveSignature}
                           onTouchEnd={endSignature}
                        />
                        {signatureError && <p className="mt-2 text-[11px] text-red-500 font-medium">{signatureError}</p>}
                     </div>
                  </div>

                  <div className="px-5 py-4 border-t border-slate-100 bg-white flex gap-3">
                     <button
                        type="button"
                        onClick={() => setShowContract(false)}
                        className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm"
                     >
                        Cancel
                     </button>
                     <button
                        type="button"
                        disabled={isSubmittingSignature}
                        onClick={handleContractAccept}
                        className="flex-1 py-3 rounded-xl bg-[#160d2a] text-white font-semibold text-sm disabled:opacity-60"
                     >
                        {isSubmittingSignature ? "Processing..." : "Accept & Continue"}
                     </button>
                  </div>
               </div>
            </div>
         )}

      </div>
   );
};


// --- ORCHESTRATOR ---

const CreditApplyWizard = ({ onBack, onComplete, onTabChange, onOpenNotifications }) => {
   const { profile } = useProfile();
   const [step, setStep] = useState(0); // 0=Intro, 1=Connect, 2=Enrich, 3=Result, 4=Next
   const [resolving, setResolving] = useState(true); // gate: hide UI while checkpoint resolves
   const [autoAdvance, setAutoAdvance] = useState(false);
   const [autoAdvanceCopy, setAutoAdvanceCopy] = useState({
      title: "Bank data already captured",
      subtitle: "Taking you to the review step…",
      tone: "emerald"
   });
   const [checkedExistingScore, setCheckedExistingScore] = useState(false);
   const [loanApplications, setLoanApplications] = useState([]);
   const [loadingLoans, setLoadingLoans] = useState(true);
   const [showDetails, setShowDetails] = useState(false);
   const [isCheckingTruIDRecords, setIsCheckingTruIDRecords] = useState(false);
   const [autoStartTruID, setAutoStartTruID] = useState(false);
   const [isPrefetchingAssessment, setIsPrefetchingAssessment] = useState(false);
   const [autoAdvanceFromExistingScore, setAutoAdvanceFromExistingScore] = useState(false);
   const autoAdvanceTimerRef = useRef(null);

   // Real Hook Integration
   const {
      form: checkForm,
      setField,
      runEngine,
      engineResult,
      engineStatus,
      employerCsv,
      lockInputs,
      snapshot,
      bankLinked,
      proceedToStep3, // Import this to save progress to DB
      loadingProfile,
      onboardingEmployerName,
      contractTypeLocked,
      sectorLocked,
      onboardingYearsAtEmployer,
      yearsAtEmployerLocked,
      hydrateExistingScore
   } = useCreditCheck();

   const isCalculating = engineStatus === "Running";
   const engineFailed = engineStatus === "Failed";
   const score = engineResult?.loanEngineScoreNormalized ?? engineResult?.loanEngineScore ?? 0;

   const formatAmount = (value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return "—";
      return `R ${numeric.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
   };

   const triggerAutoAdvance = useCallback((nextStep, title, subtitle, tone = "emerald") => {
      if (autoAdvanceTimerRef.current) {
         clearTimeout(autoAdvanceTimerRef.current);
      }

      setAutoAdvanceCopy({ title, subtitle, tone });
      setAutoAdvance(true);

      autoAdvanceTimerRef.current = setTimeout(() => {
         setStep(nextStep);
         setAutoAdvance(false);
      }, 900);
   }, []);

   useEffect(() => {
      return () => {
         if (autoAdvanceTimerRef.current) {
            clearTimeout(autoAdvanceTimerRef.current);
         }
      };
   }, []);

   // Sync Supabase Snapshot to Form
   useEffect(() => {
      if (snapshot) {
         if (snapshot.avg_monthly_income) setField("annualIncome", String(snapshot.avg_monthly_income * 12));
         if (snapshot.avg_monthly_expenses) setField("annualExpenses", String(snapshot.avg_monthly_expenses * 12));
      }
   }, [snapshot, setField]);

   // ── Single checkpoint resolver: runs behind the loader, determines final step ──
   useEffect(() => {
      if (!resolving || loadingProfile) return;

      const resolveCheckpoint = async () => {
         if (!supabase) { setResolving(false); return; }

         const { data: sessionData } = await supabase.auth.getSession();
         const userId = sessionData?.session?.user?.id;
         if (!userId) { setResolving(false); return; }

         // 1. If user already has loan_engine_score data, check the score.
         //    Score >= 50 → eligible, go to step 4 (calculator).
         //    Score < 50  → declined, stay on step 3 (results screen) and show previous result.
         const { data: existingStep3Data } = await supabase
            .from("loan_engine_score")
            .select("id, engine_score, engine_result, experian_score, score_reasons, exposure_total_balance, exposure_total_limit")
            .eq("user_id", userId)
            .order("run_at", { ascending: false })
            .limit(1)
            .maybeSingle();

         if (existingStep3Data?.id) {
            const existingScore = Number(existingStep3Data.engine_score ?? 0);
            setStep(3);
            setResolving(false);
            setIsPrefetchingAssessment(true);

            setTimeout(() => {
               hydrateExistingScore(existingStep3Data);
               setIsPrefetchingAssessment(false);
               setAutoAdvanceFromExistingScore(existingScore >= 50);
            }, 900);

            return;
         }

         // 2. Check loan_application checkpoint
         const { data: latestLoan } = await supabase
            .from("loan_application")
            .select("step_number")
            .eq("user_id", userId)
            .eq("status", "in_progress")
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();

         const checkpointStep = Number(latestLoan?.step_number || 0);

         // 3. If checkpoint says step 3, show assessment step
         if (checkpointStep >= 3) {
            setStep(3);
            setResolving(false);
            return;
         }

         // 4. Do not auto-resume to step 2 from in-progress drafts.
         //    Users should intentionally start at step 1 from the intro screen.
         // 5. Fresh user — stay on step 0
         setResolving(false);
      };

      resolveCheckpoint();
   }, [resolving, loadingProfile, snapshot, bankLinked, hydrateExistingScore]);

   useEffect(() => {
      if (!autoAdvanceFromExistingScore || isPrefetchingAssessment || step !== 3) return;
      if (score < 50) return;

      const timer = setTimeout(() => {
         setStep(4);
         setAutoAdvanceFromExistingScore(false);
      }, 1800);

      return () => clearTimeout(timer);
   }, [autoAdvanceFromExistingScore, isPrefetchingAssessment, step, score]);



   useEffect(() => {
      if (loadingProfile || checkedExistingScore) return;
      setCheckedExistingScore(true);
   }, [loadingProfile, checkedExistingScore]);

   useEffect(() => {
      const loadLoanApplications = async () => {
         if (!supabase) return;
         const { data: sessionData } = await supabase.auth.getSession();
         const userId = sessionData?.session?.user?.id;
         if (!userId) return;

         const { data: loanData } = await supabase
            .from("loan_application")
            .select("id,principal_amount,amount_repayable,status,created_at,first_repayment_date,number_of_months")
            .eq("user_id", userId)
            .order("updated_at", { ascending: false })
            .limit(3);

         if (Array.isArray(loanData)) {
            setLoanApplications(loanData);
         }
      };

      loadLoanApplications().finally(() => setLoadingLoans(false));
   }, []);

   const handleStart = async () => {
      setIsCheckingTruIDRecords(true);
      setAutoStartTruID(false);

      try {
         if (!supabase) {
            setStep(1);
            setAutoStartTruID(true);
            return;
         }

         const { data: sessionData } = await supabase.auth.getSession();
         const userId = sessionData?.session?.user?.id;

         if (!userId) {
            setStep(1);
            setAutoStartTruID(true);
            return;
         }

         const { data: existingSnapshot } = await supabase
            .from("truid_bank_snapshots")
            .select("id")
            .eq("user_id", userId)
            .order("captured_at", { ascending: false })
            .limit(1)
            .maybeSingle();

         if (existingSnapshot?.id) {
            setStep(2);
         } else {
            setStep(1);
            setAutoStartTruID(true);
         }
      } catch (error) {
         console.warn("TruID snapshot check failed:", error?.message || error);
         setStep(1);
         setAutoStartTruID(true);
      } finally {
         setIsCheckingTruIDRecords(false);
      }
   };

   const handleWizardBack = useCallback(() => {
      const navigateBackInApp = () => {
         if (onBack) {
            onBack();
            return;
         }

         if (typeof onTabChange === "function") {
            onTabChange("home");
            return;
         }

         window.dispatchEvent(new CustomEvent("navigate-within-app", { detail: { page: "home" } }));
      };

      if (step === "bank_success") {
         navigateBackInApp();
         return;
      }

      if (typeof step !== "number") {
         navigateBackInApp();
         return;
      }

      if (step > 0) {
         setStep(Math.max(0, step - 1));
         return;
      }

      navigateBackInApp();
   }, [step, onBack, onTabChange]);

   const handleConnectionComplete = (collectionId, snapshotData) => {
      if (snapshotData) {
         if (snapshotData.avg_monthly_income) setField("annualIncome", String(snapshotData.avg_monthly_income * 12));
         if (snapshotData.avg_monthly_expenses) setField("annualExpenses", String(snapshotData.avg_monthly_expenses * 12));
      }
      setStep(2);
   };

   const handleEnrichmentSubmit = async (finalData) => {
      // 1. Sync Form Data to Hook
      if (finalData.employerName) setField("employerName", finalData.employerName);
      if (finalData.employmentSector) setField("employmentSector", finalData.employmentSector);
      if (finalData.contractType) setField("contractType", finalData.contractType);
      if (finalData.yearsCurrentEmployer) setField("yearsCurrentEmployer", finalData.yearsCurrentEmployer);

      const yearsValue = finalData.yearsCurrentEmployer === "<1"
         ? 0.5
         : finalData.yearsCurrentEmployer === "4+"
            ? 4
            : Number(finalData.yearsCurrentEmployer);

      const isNewBorrowerValue = checkForm.isNewBorrower === "yes";

      const shouldSaveOnboarding = (!onboardingEmployerName && finalData.employerName)
         || (!contractTypeLocked && finalData.contractType)
         || (!sectorLocked && finalData.employmentSector);

      if (shouldSaveOnboarding) {
         try {
            const { data: { session } } = await supabase.auth.getSession();
            const userId = session?.user?.id;
            if (userId) {
               await supabase
                  .from("user_onboarding")
                  .upsert({
                     user_id: userId,
                     employment_status: "employed",
                     employer_name: finalData.employerName,
                     employment_type: finalData.contractType,
                     employer_industry: finalData.employmentSector
                  }, { onConflict: "user_id" });
            }
         } catch (error) {
            console.warn("Failed to save employer name:", error?.message || error);
         }
      }

      if (finalData.yearsCurrentEmployer || finalData.contractType || finalData.employmentSector || finalData.employerName) {
         try {
            const { data: { session } } = await supabase.auth.getSession();
            const userId = session?.user?.id;
            if (userId) {
               const { data: existingScore } = await supabase
                  .from("loan_engine_score")
                  .select("id")
                  .eq("user_id", userId)
                  .order("created_at", { ascending: false })
                  .limit(1)
                  .maybeSingle();

               const employmentPayload = {
                  years_current_employer: Number.isFinite(yearsValue) ? yearsValue : null,
                  contract_type: finalData.contractType || null,
                  is_new_borrower: isNewBorrowerValue,
                  employment_sector: finalData.employmentSector || null,
                  employer_name: finalData.employerName || null,
                  updated_at: new Date().toISOString()
               };

               if (existingScore?.id) {
                  await supabase
                     .from("loan_engine_score")
                     .update(employmentPayload)
                     .eq("id", existingScore.id);
               } else {
                  await supabase
                     .from("loan_engine_score")
                     .insert({
                        user_id: userId,
                        ...employmentPayload,
                        created_at: new Date().toISOString()
                     });
               }
            }
         } catch (error) {
            console.warn("Failed to save employment snapshot:", error?.message || error);
         }
      }

      // 2. Lock & Run
      lockInputs();

      // 3. Save progress to Supabase
      if (proceedToStep3) proceedToStep3();

      setStep(3);
   };

   const handleRunAssessment = async () => {
      lockInputs();
      if (proceedToStep3) proceedToStep3();
      await runEngine();
   };

   const handleLoanAgreementAccepted = useCallback(async (quote) => {
      if (!supabase) {
         alert("Unable to save your application right now. Please try again.");
         return;
      }

      try {
         const { data: sessionData } = await supabase.auth.getSession();
         const userId = sessionData?.session?.user?.id;

         if (userId) {
            // ── Derived dates ──────────────────────────────────────────────────
            const now = new Date();
            // First repayment ~30 days from today
            const firstRepayment = new Date(now);
            firstRepayment.setDate(firstRepayment.getDate() + 30);
            const firstRepaymentDateStr = firstRepayment.toISOString().split("T")[0]; // YYYY-MM-DD
            const salaryDayOfMonth = firstRepayment.getDate(); // 1-31

            // ── Repayment schedule JSON ────────────────────────────────────────
            const months = quote?.loanPeriod ?? 3;
            const monthly = quote?.monthlyPayment ?? 0;
            const scheduleEntries = Array.from({ length: months }, (_, i) => {
               const due = new Date(firstRepayment);
               due.setMonth(due.getMonth() + i);
               return {
                  month: i + 1,
                  due_date: due.toISOString().split("T")[0],
                  amount: Math.round(monthly * 100) / 100,
                  status: "pending",
               };
            });

            const repaymentSchedule = {
               monthly_payment: Math.round((quote?.monthlyPayment ?? 0) * 100) / 100,
               total_repayable: Math.round((quote?.totalRepayable ?? 0) * 100) / 100,
               total_interest: Math.round((quote?.totalInterest ?? 0) * 100) / 100,
               total_service_fees: Math.round((quote?.totalServiceFees ?? 0) * 100) / 100,
               total_cost_of_credit: Math.round((quote?.totalCostOfCredit ?? 0) * 100) / 100,
               schedule: scheduleEntries,
            };

            // ── Full payload matching loan_application schema ─────────────────
            // interest_rate stored as monthly % (4.50 = 4.5% p.m., max 27% effective)
            // step_number max allowed by CHECK constraint is 4
            const payload = {
               principal_amount: Math.round((quote?.loanAmount ?? 0) * 100) / 100,
               amount_repayable: Math.round((quote?.totalRepayable ?? 0) * 100) / 100,
               interest_rate: 4.50,           // 4.5% per month (max 27% effective)
               number_of_months: months,
               first_repayment_date: firstRepaymentDateStr,
               salary_date: salaryDayOfMonth, // day-of-month (1–31)
               step_number: 4,                // max allowed by CHECK constraint
               status: "in_progress",
               Secured_Unsecured: normalizeLoanType("unsecured"),
               repayment_schedule: repaymentSchedule,
               updated_at: new Date().toISOString(),
            };

            const { data: existingLoan } = await supabase
               .from("loan_application")
               .select("id")
               .eq("user_id", userId)
               .eq("status", "in_progress")
               .order("updated_at", { ascending: false })
               .limit(1)
               .maybeSingle();

            let persistedLoanId = existingLoan?.id || null;

            if (existingLoan?.id) {
               const { error: updateErr } = await supabase
                  .from("loan_application")
                  .update(payload)
                  .eq("id", existingLoan.id);
               if (updateErr) {
                  const { data: insertedFallbackLoan, error: insertFallbackErr } = await supabase
                     .from("loan_application")
                     .insert({
                        user_id: userId,
                        created_at: new Date().toISOString(),
                        ...payload,
                     })
                     .select("id")
                     .single();
                  if (insertFallbackErr) throw insertFallbackErr;
                  persistedLoanId = insertedFallbackLoan?.id || null;
               }
            } else {
               const { data: insertedLoan, error: insertErr } = await supabase
                  .from("loan_application")
                  .insert({
                     user_id: userId,
                     created_at: new Date().toISOString(),
                     ...payload,
                  })
                  .select("id")
                  .single();
               if (insertErr) throw insertErr;
               persistedLoanId = insertedLoan?.id || null;
            }

            if (persistedLoanId && Number(payload.principal_amount) > 0) {
               const { error: historyErr } = await supabase
                  .from("credit_transactions_history")
                  .insert({
                     user_id: userId,
                     loan_application_id: persistedLoanId,
                     loan_type: normalizeLoanType("unsecured"),
                     transaction_type: "application_created",
                     direction: "credit",
                     amount: Number(payload.principal_amount),
                     occurred_at: new Date().toISOString(),
                     description: "Unsecured loan application created",
                     metadata: {
                        number_of_months: payload.number_of_months,
                        first_repayment_date: payload.first_repayment_date,
                     },
                  });

               if (historyErr && historyErr.code !== "23505") {
                  console.warn("Failed to create unsecured credit history row:", historyErr.message || historyErr);
               }
            }
         }
         if (typeof onTabChange === "function") {
            onTabChange("unsecuredCreditDashboard");
         }
      } catch (error) {
         console.warn("Failed to save signed loan agreement:", error?.message || error);
         alert(`Could not save your loan application: ${error?.message || "Unknown error"}. Please try again.`);
      }
   }, [onTabChange]);

   // Prepare "defaultValues" for Step 2 using the hook's current form state
   const enrichmentDefaults = {
      employerName: checkForm.employerName,
      employmentSector: checkForm.employmentSector,
      contractType: checkForm.contractType,
      yearsCurrentEmployer: onboardingYearsAtEmployer || checkForm.yearsCurrentEmployer
   };

   const employerOptions = employerCsv?.map(row => row.split(";")[0]).filter(Boolean).slice(0, 50) || [];

   // Render Based on Step
   const renderContent = () => {
      if (step === "bank_success") {
         return (
            <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 flex flex-col items-center px-6 pb-10 min-h-screen bg-white">
               <header className="px-5 pt-12 pb-8 flex items-center justify-between bg-[#160d2a] text-white w-full relative">
                  <div className="flex items-center gap-2">
                     <img src="/assets/mint-logo.png" alt="Mint" className="h-5" />
                     <span className="text-[10px] font-black uppercase tracking-widest opacity-70">credit</span>
                  </div>
               </header>

               <div className="px-6 pb-6 pt-2 w-full flex items-center justify-between bg-white border-b border-slate-100 sticky top-0 z-10 shadow-sm">
                  <button
                     onClick={handleWizardBack}
                     className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition active:scale-95 z-30"
                  >
                     <ArrowLeft className="h-5 w-5" />
                  </button>
                  <div className="text-center">
                     <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Unsecured</h3>
                     <p className="text-[10px] font-bold text-violet-600">Application</p>
                  </div>
                  <div className="w-10" />
               </div>

               <div className="mt-16 flex flex-col items-center justify-center text-center">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-50 text-green-600 mb-4">
                     <CheckCircle2 className="h-10 w-10" />
                  </div>
                  <h2 className="text-lg font-semibold text-slate-900 mb-2">Bank Account Linked</h2>
                  <p className="text-sm text-slate-500 mb-8 max-w-[280px]">
                     Your bank account has been successfully verified and linked.
                  </p>
                  <button
                     type="button"
                     onClick={handleWizardBack}
                     className="inline-flex items-center justify-center rounded-full bg-[#160d2a] px-8 py-3.5 text-sm font-semibold uppercase tracking-[0.2em] text-white shadow-lg shadow-violet-950/25 transition hover:-translate-y-0.5 active:scale-95"
                  >
                     Done
                  </button>
               </div>
            </div>
         );
      }

      if (autoAdvance && (step === 0 || step === 2)) {
         const toneStyles = {
            emerald: {
               iconWrap: "bg-emerald-100 text-emerald-600",
               metaText: "text-emerald-600",
               dot: "bg-emerald-500"
            },
            violet: {
               iconWrap: "bg-violet-100 text-violet-600",
               metaText: "text-violet-600",
               dot: "bg-violet-500"
            },
            indigo: {
               iconWrap: "bg-indigo-100 text-indigo-600",
               metaText: "text-indigo-600",
               dot: "bg-indigo-500"
            }
         };
         const tone = toneStyles[autoAdvanceCopy.tone] || toneStyles.emerald;

         return (
            <MintCard className="animate-in fade-in zoom-in-95 duration-700">
               <div className="flex flex-col items-center gap-4 py-8 text-center">
                  <div className={`h-16 w-16 rounded-full flex items-center justify-center animate-pulse ${tone.iconWrap}`}>
                     <CheckCircle2 size={28} />
                  </div>
                  <div className="space-y-2">
                     <h3 className="text-lg font-bold text-slate-900">{autoAdvanceCopy.title}</h3>
                     <p className="text-sm text-slate-500">{autoAdvanceCopy.subtitle}</p>
                  </div>
                  <div className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest ${tone.metaText}`}>
                     <span className={`h-2 w-2 rounded-full animate-ping ${tone.dot}`}></span>
                     Auto‑continue
                  </div>
               </div>
            </MintCard>
         );
      }

      switch (step) {
         case 0:
            if (loadingProfile) {
               return <CreditApplySkeleton />;
            }

            return (
               <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 flex flex-col items-center px-6 pb-10 min-h-screen bg-white">

                  <div className="px-6 pb-6 pt-2 w-full flex items-center justify-between bg-white border-b border-slate-100 sticky top-0 z-10 shadow-sm">
                     <button
                        onClick={handleWizardBack}
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition active:scale-95 z-30"
                     >
                        <ArrowLeft className="h-5 w-5" />
                     </button>
                     <div className="text-center">
                        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Unsecured</h3>
                        <p className="text-[10px] font-bold text-violet-600">Application</p>
                     </div>
                     <div className="w-10" />
                  </div>

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
                     Welcome to <span className="mint-brand font-bold uppercase mr-1.5">MINT</span><br />Credit
                  </h2>
                  <p className="text-sm text-slate-500 text-center max-w-[280px] mb-8">
                     "Data-driven credit solutions that move with you."
                  </p>

                  <div className="w-full space-y-3 mb-6">
                     {[
                        { icon: <Briefcase size={18} />, title: "1. Employment Verification", desc: "Confirming occupational stability." },
                        { icon: <Landmark size={18} />, title: "2. Financial Integration", desc: "Secure data exchange via TruID." },
                        { icon: <Zap size={18} />, title: "3. Proprietary Scoring", desc: "Real-time affordability assessment." }
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
                        Our automated credit engine utilizes high-fidelity data from <strong>Experian</strong> and granular cash-flow analysis provided via TruID.
                        By assessing debt-to-income ratios and historical repayment behavior, we ensure alignment with National Credit Act affordability mandates.
                     </div>
                  )}

                  {isCheckingTruIDRecords ? (
                     <div className="w-full mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 flex items-center justify-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
                        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-amber-700">
                           Checking TruID records...
                        </p>
                     </div>
                  ) : (
                     <button
                        onClick={handleStart}
                        className="w-full py-4 bg-[#160d2a] text-white rounded-full text-sm font-bold uppercase tracking-widest shadow-xl shadow-violet-950/30 active:scale-95 transition-all mt-4"
                     >
                        Initiate Application
                     </button>
                  )}

                  <footer className="mt-8 text-center opacity-40">
                     <p className="text-[8px] uppercase tracking-tighter text-slate-500 max-w-[340px] mx-auto leading-relaxed">
                        <span className="mint-brand">MINT</span> (Pty) Ltd is an authorised Financial Services Provider (FSP 55118) and a
                        Registered Credit Provider (NCRCP22892). <span className="mint-brand">MINT</span> Reg no: 2024/644796/07
                     </p>
                  </footer>
               </div>
            );
         case 1:
            return <ConnectionStage onComplete={handleConnectionComplete} onError={() => { }} autoStart={autoStartTruID} />;
         case 2:
            return <EnrichmentStage
               defaultValues={enrichmentDefaults}
               employerOptions={employerOptions}
               onSubmit={handleEnrichmentSubmit}
               employerLocked={Boolean(onboardingEmployerName)}
               contractLocked={contractTypeLocked}
               sectorLocked={sectorLocked}
               yearsLocked={yearsAtEmployerLocked}
            />;
         case 3:
            return <ResultStage
               score={score}
               isCalculating={isCalculating}
               engineFailed={engineFailed}
               breakdown={engineResult?.breakdown}
               engineResult={engineResult}
               onRunAssessment={handleRunAssessment}
               onContinue={() => setStep(4)}
               isPrefetching={isPrefetchingAssessment}
               onReapply={() => {
                  setStep(1);
                  setAutoAdvanceFromExistingScore(false);
               }}
            />;
         case 4:
            return <LoanCalculatorStep onSignedContinue={handleLoanAgreementAccepted} />;
         default:
            return null;
      }
   };

   const getTitle = () => {
      if (step === 0) return "Credit Application";
      if (step === 1) return "Link Accounts";
      if (step === 2) return "Confirm Details";
      if (step === 3) return "Assessment Result";
      if (step === 4) return "Step 4";
      return "";
   };

   const getStepInfo = () => {
      if (step === 0) return "Start";
      return `${step} / 4`;
   };

   // ── Resolving gate: show branded loader while checkpoints resolve ──
   if (resolving) {
      return (
         <div className="flex flex-col items-center justify-center min-h-screen bg-white">
            <div className="flex flex-col items-center gap-4 animate-in fade-in duration-300">
               <div className="relative h-14 w-14">
                  <div className="absolute inset-0 rounded-full border-[3px] border-slate-100" />
                  <div className="absolute inset-0 rounded-full border-[3px] border-t-violet-600 animate-spin" />
               </div>
               <div className="text-center">
                  <p className="text-sm font-semibold text-slate-700">Loading your application</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Checking progress…</p>
               </div>
            </div>
         </div>
      );
   }

   if (step === 0 || step === "bank_success") {
      return renderContent();
   }

   return (
      <MintGradientLayout
         title={getTitle()}
         subtitle={step === 1 ? "We need to verify your income via your primary bank account." : step === 2 ? "Review the details we found." : step === 4 ? "Configure your loan and sign your agreement." : ""}
         stepInfo={getStepInfo()}
         onBack={handleWizardBack}
      >
         {renderContent()}
      </MintGradientLayout>
   );
};

export default CreditApplyWizard;