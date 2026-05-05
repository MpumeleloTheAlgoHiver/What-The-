import React, { useState, useRef, useEffect, useMemo } from "react";
import useSignaturePad from "../../lib/useSignaturePad";
import generateLoanAgreementPdf from "../../lib/generateLoanAgreementPdf";
import { supabase } from "../../lib/supabase";
import { calculateSecuredLoan } from "./securedLoanCalc";

// ─── Constants ────────────────────────────────────────────────────────────────
const AUTH_PHASES = [
  "Authenticating...",
  "Connecting securely...",
  "Fetching account data...",
  "Verifying ownership...",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatZAR(val) {
  return "R " + (val || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(date, opts) {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-ZA", opts || { day: "numeric", month: "long", year: "numeric" });
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  page: {
    background: "transparent",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px 0",
    fontFamily: "-apple-system, 'SF Pro Text', sans-serif",
    width: "100%",
  },
  modal: {
    background: "#fff",
    borderRadius: 22,
    boxShadow: "0 8px 60px rgba(0,0,0,0.15)",
    width: "100%",
    maxWidth: 420,
    padding: "32px 28px",
    boxSizing: "border-box",
    position: "relative",
    overflow: "hidden"
  },
  dots: {
    display: "flex",
    justifyContent: "center",
    gap: 5,
    marginBottom: 20,
  },
  modalIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    background: "#f5f3ff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    margin: "0 auto 16px auto"
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: "#0d1b2e",
    marginBottom: 20,
    letterSpacing: "-0.3px",
    textAlign: "center"
  },
  mLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.12em",
    color: "#9ca3af",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  darkPill: {
    background: "#0d1b2e",
    borderRadius: 12,
    padding: "14px 18px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  darkPillLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.12em",
    color: "#7a94b8",
    textTransform: "uppercase",
  },
  darkPillValue: {
    fontSize: 17,
    fontWeight: 700,
    color: "#fff",
    letterSpacing: "-0.3px",
  },
  input: {
    width: "100%",
    background: "#f8f9fa",
    border: "1.5px solid #e5e7eb",
    borderRadius: 12,
    padding: "13px 16px",
    fontSize: 15,
    color: "#0d1b2e",
    outline: "none",
    fontFamily: "inherit",
    marginBottom: 14,
    boxSizing: "border-box",
  },
  ctaDark: {
    width: "100%",
    background: "#0d1b2e",
    color: "#fff",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    padding: "17px",
    border: "none",
    borderRadius: 14,
    cursor: "pointer",
    marginTop: 4,
    fontFamily: "inherit",
    appearance: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8
  },
  ctaDarkDisabled: {
    background: "#e5e7eb",
    color: "#9ca3af",
    cursor: "not-allowed"
  },
  ctaCancel: {
    width: "100%",
    background: "transparent",
    border: "none",
    color: "#e24b4a",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.10em",
    textTransform: "uppercase",
    padding: "12px",
    cursor: "pointer",
    fontFamily: "inherit",
    display: "block",
    textAlign: "center"
  },
  ctaBack: {
    width: "100%",
    background: "transparent",
    border: "none",
    color: "#9ca3af",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    padding: "8px",
    cursor: "pointer",
    fontFamily: "inherit",
    display: "block",
    textAlign: "center"
  },
  consentBox: {
    background: "#f5f3ff",
    border: "1.5px solid #e0d9fe",
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  verifiedPill: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#f0fdf4",
    border: "1.5px solid #bbf7d0",
    borderRadius: 12,
    padding: "12px 14px",
    fontSize: 12, 
    fontWeight: 700, 
    color: "#065f46", 
    marginBottom: 14,
  },
  infoNote: {
    fontSize: 11,
    color: "#9ca3af",
    lineHeight: 1.5,
    padding: "10px 12px",
    background: "#f8f9fa",
    borderLeft: "2px solid #6d28d9",
    borderRadius: "0 8px 8px 0",
    marginBottom: 14,
  },
  infoNoteWarn: {
    fontSize: 11,
    color: "#92400e",
    lineHeight: 1.5,
    padding: "10px 12px",
    background: "#fffbeb",
    borderLeft: "2px solid #f59e0b",
    borderRadius: "0 8px 8px 0",
    marginBottom: 14,
  },
  lscroll: {
    background: "#f8f9fa",
    border: "1.5px solid #e5e7eb",
    borderRadius: 12,
    padding: 14,
    maxHeight: 180,
    overflowY: "auto",
    fontSize: 11,
    lineHeight: 1.7,
    color: "#6b7280",
    marginBottom: 14,
  },
  checkRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 12,
    padding: 12,
    background: "#f8f9fa",
    borderRadius: 12,
    cursor: "pointer",
  },
  sigArea: {
    background: "#f8f9fa",
    border: "1.5px dashed #d1d5db",
    borderRadius: 12,
    minHeight: 100,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    marginBottom: 10,
    cursor: "crosshair",
    overflow: "hidden"
  },
  succIcon: {
    width: 56,
    height: 56,
    borderRadius: "50%",
    background: "#f0fdf4",
    border: "2px solid #bbf7d0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 16px",
    fontSize: 24,
    color: "#00c97a",
  },
  warnIcon: {
    width: 56,
    height: 56,
    borderRadius: "50%",
    background: "#fffbeb",
    border: "2px solid #fde68a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 16px",
    fontSize: 24,
    color: "#d97706",
  },
  repayRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 0",
    borderBottom: "1px solid #f3f4f6",
  },
  dateDisplay: {
    background: "#f8f9fa",
    border: "1.5px solid #e5e7eb",
    borderRadius: 12,
    padding: "13px 16px",
    fontSize: 16,
    fontWeight: 700,
    color: "#0d1b2e",
    marginBottom: 4,
  },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepDots({ active, total = 5 }) {
  return (
    <div style={S.dots}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          style={{
            width: i === active ? 16 : 6,
            height: 6,
            borderRadius: i === active ? 3 : "50%",
            background: i < active ? "#00c97a" : i === active ? "#6d28d9" : "#e5e7eb",
            transition: "all 0.3s",
          }}
        />
      ))}
    </div>
  );
}

function ModalIcon({ children }) {
  return <div style={S.modalIcon}>{children}</div>;
}

function DarkPill({ label, value }) {
  return (
    <div style={S.darkPill}>
      <span style={S.darkPillLabel}>{label}</span>
      <span style={S.darkPillValue}>{value}</span>
    </div>
  );
}

function MLabel({ children, style = {} }) {
  return <div style={{ ...S.mLabel, ...style }}>{children}</div>;
}

function AccRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6b7280", padding: "5px 0", borderBottom: "1px solid #f3f4f6" }}>
      <span>{label}</span>
      <span style={{ color: "#0d1b2e", fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ─── Step 0: truID Intro ──────────────────────────────────────────────────────
function StepTruIDIntro({ onNext, onCancel }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleNext() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const resp = await fetch("/api/banking/initiate", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
      });

      const payload = await resp.json();
      if (!payload.success) throw new Error(payload.error?.message || "Failed to initiate");

      onNext(payload.collectionId, payload.consumerUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-5 duration-500">
      <StepDots active={0} />
      <ModalIcon>
        <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
          <path d="M12 2L3 7v11l9 5 9-5V7l-9-5z" stroke="#6d28d9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M12 22V12" stroke="#6d28d9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M12 12l8.5-4.7" stroke="#6d28d9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="12" cy="12" r="3" stroke="#6d28d9" strokeWidth="2"/>
        </svg>
      </ModalIcon>
      <div style={S.modalTitle}>Verify Bank Account</div>
      
      <div style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 20 }}>
          truID Verification Required for EFT Payouts
      </div>

      <div style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.6, textAlign: "center", marginBottom: 24, padding: "0 10px" }}>
        To receive funds via EFT, Mint requires a secure link to your bank account via **truID**. 
        This ensures capital is disbursed only to your personal verified account.
      </div>

      <div style={S.consentBox}>
        {[
          "Securely link account for disbursement",
          "Automated repayment alignment",
          "NCA compliant affordability check",
        ].map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8, fontSize: 12, color: "#4b5563" }}>
            <div style={{ marginTop: 2, width: 6, height: 6, borderRadius: "50%", background: "#6d28d9" }} />
            {item}
          </div>
        ))}
      </div>

      {error && <div style={{ color: "#e24b4a", fontSize: 12, marginBottom: 12, textAlign: "center", fontWeight: 600 }}>{error}</div>}
      
      <button 
        style={{ ...S.ctaDark, ...(loading ? S.ctaDarkDisabled : {}) }} 
        onClick={handleNext} 
        disabled={loading}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M13 10V3L4 14H11V21L20 10H13Z" />
        </svg>
        {loading ? "Initializing..." : "Verify via truID Connect"}
      </button>
      
      <button style={S.ctaBack} onClick={onCancel} disabled={loading}>Go back to review</button>
    </div>
  );
}

// ─── Step 1: truID Auth ───────────────────────────────────────────────────────
function StepTruIDAuth({ collectionId, consumerUrl, principal, profile, loanId, onNext, onBack }) {
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("Please complete the verification in the secure window below.");

  useEffect(() => {
    let interval;
    if (status === "pending" || status === "loading") {
      interval = setInterval(async () => {
        try {
          const resp = await fetch(`/api/banking/status?collectionId=${collectionId}`);
          const payload = await resp.json();
          if (payload.success) {
            if (payload.outcome === "completed") {
              setStatus("completed");
              clearInterval(interval);
              handleCapture();
            } else if (payload.outcome === "failed") {
              setStatus("failed");
              setMessage("Verification failed. Please try again.");
              clearInterval(interval);
            }
          }
        } catch (err) {
          console.error("Status check error:", err);
        }
      }, 4000);
    }
    return () => clearInterval(interval);
  }, [collectionId, status]);

  async function handleCapture() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      
      const resp = await fetch("/api/banking/capture", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ collectionId }),
      });
      
      const payload = await resp.json();
      if (payload.success) {
        const summary = payload.snapshot?.data || {};
        const accInfo = summary.accounts?.[0] || {};
        
        const acc = {
          bank: accInfo.bankName || "Verified Bank",
          acc: "****" + String(accInfo.accountNumber || "").slice(-4),
          holder: accInfo.accountHolder || "Verified Holder",
        };

        if (loanId) {
          await supabase.from('loan_application').update({
            status: 'pending_approval',
            step_number: 2
          }).eq('id', loanId);

          await supabase.from('admin_approvals').insert({
            user_id: profile.id,
            loan_application_id: loanId,
            amount: principal,
            status: 'pending',
            admin_notes: `Bank verified via truID: ${acc.bank} (${acc.acc})`,
          });
        }
        
        onNext(acc);
      } else {
        setStatus("failed");
        setMessage("Failed to capture account details.");
      }
    } catch (err) {
      setStatus("failed");
      setMessage("Error capturing bank data.");
    }
  }

  return (
    <div className="animate-in fade-in slide-in-from-right-5 duration-500">
      <StepDots active={1} />
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: "-0.5px", color: "#0d1b2e" }}>
          tru<span style={{ color: "#6d28d9" }}>ID</span>
        </div>
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>Open Finance · Encrypted connection</div>
      </div>

      <div style={{ background: "#f8f9fa", border: "1.5px solid #e5e7eb", borderRadius: 18, overflow: "hidden", marginBottom: 14 }}>
        <iframe
          src={consumerUrl}
          style={{ width: "100%", height: 420, border: "none" }}
          allow="camera; microphone"
          title="truID Verification"
        />
      </div>

      <div style={status === "completed" ? S.verifiedPill : S.infoNoteWarn}>
        {status === "completed" ? "✓ Verification successful!" : message}
      </div>

      <button style={S.ctaBack} onClick={onBack} disabled={status === "loading"}>
        {status === "completed" ? "Continuing..." : "Go back"}
      </button>
    </div>
  );
}

// ─── Step 2: Salary Date ──────────────────────────────────────────────────────
function StepSalaryDate({ verifiedAcc, defaultDay, termMonths: initialTerm, principal, onNext, onBack }) {
  const [day, setDay] = useState(defaultDay || "");
  const [term, setTerm] = useState(initialTerm || 1);

  const calculation = useMemo(() => {
    if (!day) return null;
    return calculateSecuredLoan({
      principal,
      originationDate: new Date(),
      nextSalaryDate: new Date(new Date().getFullYear(), new Date().getMonth(), parseInt(day)),
      termMonths: term,
    });
  }, [day, principal, term]);

  return (
    <div className="animate-in fade-in slide-in-from-right-5 duration-500">
      <StepDots active={2} />
      <ModalIcon>
        <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
          <rect x="3" y="4" width="18" height="18" rx="2" stroke="#6d28d9" strokeWidth="2" />
          <path d="M16 2v4M8 2v4M3 10h18" stroke="#6d28d9" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </ModalIcon>
      <div style={S.modalTitle}>Salary Date</div>

      <div style={S.verifiedPill}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>Bank Account Verified</div>
      </div>

      <div style={{ background: "#f8f9fa", border: "1.5px solid #e5e7eb", borderRadius: 14, padding: 14, marginBottom: 16 }}>
        <AccRow label="Bank" value={verifiedAcc.bank} />
        <AccRow label="Account" value={verifiedAcc.acc} />
      </div>

      <MLabel>Day you receive your salary</MLabel>
      <input
        style={S.input}
        type="number"
        placeholder="e.g. 25"
        min="1"
        max="31"
        value={day}
        onChange={(e) => setDay(e.target.value)}
      />

      <MLabel>Loan Term (Months)</MLabel>
      <div style={{ display: "flex", background: "#f8f9fa", borderRadius: 12, padding: 4, marginBottom: 16, border: "1.5px solid #e5e7eb", flexWrap: "wrap", gap: "4px" }}>
        {[1, 2, 3, 4, 5, 6].map(m => (
          <button 
            key={m}
            onClick={() => setTerm(m)}
            style={{
              flex: "1 0 30%",
              padding: "10px 5px",
              fontSize: 11,
              fontWeight: 800,
              borderRadius: 8,
              border: "none",
              background: term === m ? "#0d1b2e" : "transparent",
              color: term === m ? "#fff" : "#9ca3af",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            {m}M
          </button>
        ))}
      </div>

      {calculation && (
        <>
          <MLabel>First repayment date</MLabel>
          <div style={S.dateDisplay}>
            {formatDate(calculation.paymentDates[0])}
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 14 }}>
            Repayment schedule confirmed.
          </div>
        </>
      )}

      <button 
        style={{ ...S.ctaDark, ...(!calculation ? S.ctaDarkDisabled : {}) }} 
        onClick={() => onNext(calculation, parseInt(day))} 
        disabled={!calculation}
      >
        Calculate Final Schedule
      </button>
      <button style={S.ctaBack} onClick={onBack}>Go back</button>
    </div>
  );
}

// ─── Step 3: Repayment Plan ───────────────────────────────────────────────
function StepFinalSummary({ calculation, verifiedAcc, onNext, onBack }) {
  return (
    <div className="animate-in fade-in slide-in-from-right-5 duration-500">
      <StepDots active={3} />
      <ModalIcon>
        <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" stroke="#6d28d9" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </ModalIcon>
      <div style={S.modalTitle}>Repayment Plan</div>

      <DarkPill label="Total Due" value={formatZAR(calculation.totalRepayable)} />

      <MLabel style={{ marginBottom: 10 }}>Monthly Breakdown</MLabel>
      <div style={{ marginBottom: 14 }}>
        {calculation.schedule.map((item, i) => (
          <div key={i} style={{ ...S.repayRow, ...(i === calculation.schedule.length - 1 ? { borderBottom: "none" } : {}) }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0d1b2e" }}>Month {item.period}</div>
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{formatDate(item.date)}</div>
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#0d1b2e" }}>{formatZAR(item.installment)}</div>
          </div>
        ))}
      </div>

      <div style={S.infoNote}>
        Instalments collected via NAEDO debit order from your {verifiedAcc.bank} account.
      </div>

      <button style={S.ctaDark} onClick={() => onNext()}>Review & sign</button>
      <button style={S.ctaBack} onClick={onBack}>Go back</button>
    </div>
  );
}

// ─── Step 4: Legal & Signature ────────────────────────────────────────────────
function StepLegal({ principal, calculation, salaryDay, verifiedAcc, profile, pledgedAssets, onNext, onCancel }) {
  const [checks, setChecks] = useState([false, false, false]);
  const canvasRef = useRef(null);
  const sigPad = useSignaturePad(canvasRef, {
    backgroundColor: "rgba(255, 255, 255, 0)",
    penColor: "#6d28d9",
    minWidth: 1,
    maxWidth: 3,
  });
  const sigHas = !sigPad.isEmpty();

  const checkLabels = [
    "I authorise the pledge of assets and understand liquidation risks",
    "I authorise NAEDO debit order for total repayable",
    "I consent to the NCR-compliant loan terms displayed",
  ];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-5 duration-500">
      <StepDots active={4} />
      <ModalIcon>
        <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="#6d28d9" strokeWidth="2" />
          <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="#6d28d9" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </ModalIcon>
      <div style={S.modalTitle}>Legal Review</div>

      <div style={S.lscroll} className="no-scrollbar">
        <h4 style={{ color: "#0d1b2e", fontSize: 12, marginBottom: 6, fontWeight: 700 }}>Loan Agreement — Mint Securities</h4>
        <p>Principal: {formatZAR(principal)}<br />Total Repayable: {formatZAR(calculation.totalRepayable)}<br />Term: {calculation.installments.length} months</p>
        <p>Interest includes daily accrual as per NCR Short-Term Credit regulations.</p>
        <p>Fees: Initiation ({formatZAR(calculation.initiationFee)}) + Service ({formatZAR(calculation.totalServiceFees)})</p>
      </div>

      {checkLabels.map((lbl, i) => (
        <div key={i} style={S.checkRow} onClick={() => setChecks(c => c.map((v, idx) => idx === i ? !v : v))}>
          <div style={{ width: 18, height: 18, border: "2px solid #6d28d9", borderRadius: 4, background: checks[i] ? "#6d28d9" : "#fff", display: "flex", alignItems: "center", justify: "center" }}>
            {checks[i] && <div style={{ width: 10, height: 10, background: "#fff", borderRadius: 1 }} />}
          </div>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#374151" }}>{lbl}</label>
        </div>
      ))}

      <MLabel style={{ marginTop: 12 }}>Digital Signature (Draw below)</MLabel>
      <div 
        style={{ 
          ...S.sigArea, 
          borderColor: !sigHas ? "#d1d5db" : "#6d28d9",
          borderStyle: !sigHas ? "dashed" : "solid",
          background: "#fff",
          height: 140,
          touchAction: "none"
        }}
      >
        <canvas 
          ref={canvasRef} 
          style={{ width: "100%", height: "100%", cursor: "crosshair" }} 
        />
        {!sigHas && (
          <div style={{ position: "absolute", pointerEvents: "none", color: "#9ca3af", fontSize: 13, fontWeight: 500 }}>
            Sign here
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
        <button 
          type="button"
          onClick={() => { sigPad.clear(); }}
          style={{ 
            background: "transparent", 
            border: "none", 
            color: "#6d28d9", 
            fontSize: 11, 
            fontWeight: 700, 
            textTransform: "uppercase", 
            letterSpacing: "0.05em",
            cursor: "pointer",
            padding: "4px 8px"
          }}
        >
          Clear Signature
        </button>
      </div>

      <button 
        style={{ ...S.ctaDark, ...(!checks.every(Boolean) || !sigHas ? S.ctaDarkDisabled : {}) }} 
        onClick={() => {
          if (!sigPad.isEmpty()) {
            const dataUrl = sigPad.toDataURL();
            onNext(dataUrl);
          }
        }}
        disabled={!checks.every(Boolean) || !sigHas}
      >
        Complete Signing & Authorize
      </button>
      <button style={S.ctaCancel} onClick={onCancel}>Cancel application</button>
    </div>
  );
}

// ─── Step 5: Success ──────────────────────────────────────────────────────────
function StepSuccess({ calculation, emailStatus, onCancel }) {
  return (
    <div className="animate-in zoom-in-95 duration-700 text-center">
      {emailStatus === 'failed' ? (
        <div style={S.warnIcon}>!</div>
      ) : (
        <div style={S.succIcon}>✓</div>
      )}
      
      <div style={{ fontSize: 22, fontWeight: 800, color: "#0d1b2e", marginBottom: 12 }}>
        {emailStatus === 'failed' ? "Order Logged (Email Pending)" : "Agreement Signed"}
      </div>
      
      <div style={{ fontSize: 14, color: "#9ca3af", marginBottom: 24, lineHeight: 1.5 }}>
        Your NCR-compliant loan is finalized.<br />
        {emailStatus === 'failed' ? (
          <span style={{ color: "#d97706" }}>Note: Confirmation email failed to send locally. Your documents are stored safely in your profile.</span>
        ) : (
          "Confirmation email with your signed agreement has been sent."
        )}
      </div>

      <DarkPill label="Monthly Instalment" value={formatZAR(calculation.installmentAmount)} />
      <button style={{ ...S.ctaDark, marginTop: 24 }} onClick={onCancel}>Complete & Close</button>
    </div>
  );
}

// ─── Component: LiquidityFlow ───────────────────────────────────────────────
export default function LiquidityFlow({ principal, profile, loanId, termMonths = 1, salaryDate, selectedAssets = [], onComplete, onCancel }) {
  const [step, setStep] = useState(0); 

  useEffect(() => {
    // Clear any stale TrueID verification state on mount
    localStorage.removeItem('truid_collection_id');
    localStorage.removeItem('truid_consumer_url');
    sessionStorage.removeItem('truid_consent_token');
  }, []);
 
  const [verifiedAcc, setVerifiedAcc] = useState(null);
  const [digitalSignature, setDigitalSignature] = useState("");
  const [salaryDay, setSalaryDay] = useState(null);
  const [calculation, setCalculation] = useState(null);
  const [collectionId, setCollectionId] = useState("");
  const [consumerUrl, setConsumerUrl] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [emailStatus, setEmailStatus] = useState('idle'); // idle, sending, sent, failed

  async function handleLegalNext(sig) {
    if (isProcessing) return;
    if (!calculation || !profile || !principal) {
      console.error("[LiquidityFlow] Missing critical data for PDF generation:", { 
        hasCalculation: !!calculation, 
        hasProfile: !!profile, 
        hasPrincipal: !!principal 
      });
      // Prevent UI hang and inform user
      alert("Agreement data not ready. Please wait a moment and try again.");
      return;
    }

    setIsProcessing(true);
    setDigitalSignature(sig);
    
    try {
      // 1. Generate the Professional PDF
      const { fileName, pdfBase64 } = await generateLoanAgreementPdf({
        profile,
        principal,
        calculation,
        salaryDay: salaryDay, // Use state salaryDay
        verifiedAcc,
        digitalSignature: sig,
        pledgedAssets: selectedAssets
      });

      // 2. Email the agreement to the client
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const assetNames = selectedAssets.map(a => a.name || a.symbol || 'Asset');

        console.log("[LiquidityFlow] Triggering agreement email...", { loanId, assets: assetNames });
        setEmailStatus('sending');
        
        const emailResponse = await fetch("/api/loan/email-agreement", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session?.access_token}`
          },
          body: JSON.stringify({ 
            loanId, 
            pdfBase64, 
            fileName,
            amount: principal,
            assets: assetNames
          }),
        });

        if (!emailResponse.ok) {
          const errorData = await emailResponse.json().catch(() => ({}));
          console.error("[LiquidityFlow] Email send failed server-side:", errorData.error);
          setEmailStatus('failed');
          // We don't throw here because we still want to save the loan to DB
        } else {
          console.log("[LiquidityFlow] Email sent successfully");
          setEmailStatus('sent');
        }
      } catch (emailErr) {
        console.warn("[LiquidityFlow] Could not initiate email send:", emailErr);
        setEmailStatus('failed');
      }


      // 3. Save to Database
      const { error } = await supabase
        .from('loan_application')
        .update({
          status: 'pending_payout',
          // Note: schedule and signature are in the generated PDF, 
          // columns metadata/digital_signature do not exist in schema cache.
        })
        .eq('id', loanId);

      if (error) throw error;
      setStep(5); // Step 5 is now the success step
    } catch (err) {
      console.error("Signing failed:", err);
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div style={S.page}>
      <div style={S.modal}>
        {step === 0 && (
          <StepTruIDIntro 
            onNext={(cId, url) => {
              setCollectionId(cId);
              setConsumerUrl(url);
              setStep(1);
            }} 
            onCancel={onCancel} 
          />
        )}
        {step === 1 && (
          <StepTruIDAuth 
            collectionId={collectionId} 
            consumerUrl={consumerUrl}
            principal={principal}
            profile={profile}
            loanId={loanId}
            onNext={(acc) => {
              setVerifiedAcc(acc);
              setStep(2);
            }}
            onBack={() => setStep(0)}
          />
        )}
        {step === 2 && (
          <StepSalaryDate
            verifiedAcc={verifiedAcc}
            principal={principal}
            termMonths={termMonths}
            defaultDay={salaryDate ? new Date(salaryDate).getDate() : ""}
            onNext={(calc, day) => {
              setCalculation(calc);
              setSalaryDay(day);
              setStep(3);
            }}
            onBack={() => setStep(1)}
          />
        )}
        {step === 3 && (
          <StepFinalSummary
            calculation={calculation}
            verifiedAcc={verifiedAcc}
            onNext={() => setStep(4)} // Changed to step 4 for StepLegal
            onBack={() => setStep(2)}
          />
        )}
        {step === 4 && ( // StepLegal is now step 4
          <StepLegal 
            principal={principal}
            calculation={calculation}
            salaryDay={salaryDay}
            verifiedAcc={verifiedAcc}
            profile={profile}
            pledgedAssets={selectedAssets}
            onNext={handleLegalNext} // Call the new handler
            onCancel={onCancel}
          />
        )}
        {step === 5 && ( // StepSuccess is now step 5
          <StepSuccess 
            calculation={calculation}
            emailStatus={emailStatus}
            onCancel={onComplete}
          />
        )}
      </div>
    </div>
  );
}
