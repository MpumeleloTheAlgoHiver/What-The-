import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown, Plus, FileText, Layers, ChevronRight,
  Check, AlertTriangle, Circle, Bell, Lock,
  X, Landmark, UploadCloud
} from "lucide-react";
import { formatZar } from "../../lib/formatCurrency";
import NavigationPill from "../../components/NavigationPill";
import NotificationBell from "../../components/NotificationBell";
import { supabase } from "../../lib/supabase";
import FamilyDropdown from "../../components/FamilyDropdown";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ─── Sparkline SVG ──────────────────────────────────────────────────────────
const Spark = ({ points = "0,20 10,18 20,22 30,12 40,14 50,8 60,10 70,6", color = "#7c3aed" }) => (
  <svg viewBox="0 0 70 28" className="w-14 h-7">
    <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ─── Payment row ─────────────────────────────────────────────────────────────
const TxnRow = ({
  icon: Icon,
  iconBg,
  iconColor,
  title,
  date,
  amount,
  amountColor,
  isLast,
  expanded,
  onToggle,
  statusLabel,
  statusTone,
  statusDotTone,
  details = [],
}) => (
  <div className={`${!isLast ? "border-b border-slate-100" : ""}`}>
    <button type="button" onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
      <div className={`h-9 w-9 rounded-[14px] flex items-center justify-center shrink-0 ${iconBg}`}>
        <Icon size={15} className={iconColor} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-slate-900 leading-tight">{title}</p>
        <p className="text-[11px] text-slate-400 mt-0.5">{date}</p>
      </div>
      <span className={`text-[13px] font-medium ${amountColor}`}>{amount}</span>
      <ChevronRight size={14} className={`text-slate-300 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
    </button>

    {expanded ? (
      <div className="px-4 pb-3.5">
        <div className="ml-12 rounded-xl border border-slate-100 bg-slate-50 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Transaction details</p>
            <span className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-full ${statusTone}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${statusDotTone}`} />
              {statusLabel}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-y-1.5 gap-x-3">
            {details.map((d) => (
              <React.Fragment key={d.label}>
                <p className="text-[11px] text-slate-500">{d.label}</p>
                <p className="text-[11px] text-slate-900 text-right">{d.value}</p>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    ) : null}
  </div>
);

// ─── Offer row ────────────────────────────────────────────────────────────────
const OfferRow = ({ icon: Icon, title, desc, onClick, disabled = false }) => (
  <button
    onClick={!disabled ? onClick : undefined}
    disabled={disabled}
    className={`flex items-center gap-3 w-full bg-white border border-slate-100 rounded-[20px] px-4 py-3.5 mb-2.5 transition-all text-left ${disabled ? "opacity-50 cursor-not-allowed" : "active:scale-[0.98]"}`}
  >
    <div className="h-10 w-10 rounded-2xl bg-violet-50 flex items-center justify-center shrink-0">
      <Icon size={16} className="text-violet-600" />
    </div>
    <div className="flex-1">
      <p className="text-[13px] font-medium text-slate-900">{title}</p>
      <p className="text-[11px] text-slate-400 mt-0.5">{desc}</p>
    </div>
    {disabled ? (
      <Lock size={14} className="text-slate-400 shrink-0" />
    ) : (
      <ChevronRight size={14} className="text-slate-300 shrink-0" />
    )}
  </button>
);

// ─── Main component ───────────────────────────────────────────────────────────
const UnsecuredCreditDashboard = ({ profile, onTabChange, onOpenNotifications }) => {
  const [loan, setLoan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showLoanBreakdown, setShowLoanBreakdown] = useState(false);
  const [expandedTxnId, setExpandedTxnId] = useState(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const [showEftModal, setShowEftModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [popFile, setPopFile] = useState(null);
  const [portalTarget, setPortalTarget] = useState(null);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  const displayName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ");
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase() || "—";

  // ── fetch most-recent active unsecured loan ────────────────────────────────
  useEffect(() => {
    async function fetchLoan() {
      if (!profile?.id || !supabase) {
        setLoading(false);
        setHistoryLoading(false);
        return;
      }

      const { data } = await supabase
        .from("loan_application")
        .select(
          "id, principal_amount, amount_repayable, interest_rate, " +
          "number_of_months, monthly_repayable, first_repayment_date, " +
          "salary_date, status, repayment_schedule, created_at, updated_at, application_id, Secured_Unsecured"
        )
        .eq("user_id", profile.id)
        .eq("Secured_Unsecured", "unsecured")
        .in("status", ["active", "in_progress"])
        .gt("principal_amount", 0)
        .gt("amount_repayable", 0)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: historyData, error: historyErr } = await supabase
        .from("credit_transactions_history")
        .select("id, transaction_type, direction, amount, occurred_at, description")
        .eq("user_id", profile.id)
        .eq("loan_type", "unsecured")
        .order("occurred_at", { ascending: false })
        .limit(20);

      if (historyErr) {
        console.warn("Failed to fetch unsecured credit history:", historyErr.message || historyErr);
        setHistoryRows([]);
      } else {
        setHistoryRows(historyData || []);
      }

      setLoan(data || null);
      setLoading(false);
      setHistoryLoading(false);
    }
    fetchLoan();
  }, [profile?.id]);

  // ── derived values ────────────────────────────────────────────────────────
  const principal     = loan?.principal_amount  ?? 0;
  const totalRepay    = loan?.amount_repayable  ?? 0;
  const months        = loan?.number_of_months  ?? 0;
  // Prefer DB-generated monthly_repayable; fallback to schedule or arithmetic
  const monthlyPay    = parseFloat(loan?.monthly_repayable ?? 0) ||
                        parseFloat(loan?.repayment_schedule?.monthly_payment ?? 0) ||
                        (months > 0 ? totalRepay / months : 0);
  // Count paid installments from repayment_schedule.schedule
  const schedule      = loan?.repayment_schedule?.schedule ?? [];
  const paidCount     = schedule.filter(s => s.status === "paid").length;
  const totalPaid     = paidCount * monthlyPay;
  const loanBalance   = Math.max(0, totalRepay - totalPaid);
  const facilityLimit = totalRepay;
  const available     = Math.max(0, facilityLimit - loanBalance);
  const usedPct       = facilityLimit > 0 ? (loanBalance / facilityLimit) * 100 : 0;

  const nextDueDate = (() => {
    if (!loan?.first_repayment_date) return null;
    const d = new Date(loan.first_repayment_date);
    const now = new Date();
    while (d < now) d.setMonth(d.getMonth() + 1);
    return d;
  })();
  const daysUntilDue = nextDueDate
    ? Math.ceil((nextDueDate - new Date()) / (1000 * 60 * 60 * 24))
    : null;
  const dueLabelColor =
    daysUntilDue === null ? "" :
    daysUntilDue <= 3  ? "bg-red-50 text-red-700" :
    daysUntilDue <= 14 ? "bg-amber-50 text-amber-700" :
                         "bg-emerald-50 text-emerald-700";
  const dueLabel =
    daysUntilDue === null ? "—" :
    daysUntilDue <= 0  ? "Due today" :
    daysUntilDue === 1 ? "Tomorrow" :
    `In ${daysUntilDue} days`;

  const normalizedLoanStatus = String(loan?.status || "").toLowerCase();
  const isPendingStatus = ["pending", "in_progress", "pending_approval", "pending_payout"].includes(normalizedLoanStatus);
  const isAcceptedStatus = ["active", "approved", "completed", "repaid"].includes(normalizedLoanStatus);
  const statusTone = isAcceptedStatus
    ? "text-emerald-700 bg-emerald-50"
    : isPendingStatus
      ? "text-amber-700 bg-amber-50"
      : "text-slate-700 bg-slate-100";
  const statusDotTone = isAcceptedStatus
    ? "bg-emerald-500"
    : isPendingStatus
      ? "bg-amber-500"
      : "bg-slate-400";
  const statusLabel = isAcceptedStatus
    ? "Accepted"
    : isPendingStatus
      ? "Pending"
      : (loan?.status ? String(loan.status).replace(/_/g, " ") : "Unknown");

  // ─── Display rate strings ────────────────────────────────────────────────
  const monthlyRatePct = 4.5;
  const maxEffectiveRatePct = 27;
  const effectiveRatePct = Math.min(maxEffectiveRatePct, Math.max(0, months * monthlyRatePct));
  const annualRate = `${Number.isInteger(effectiveRatePct) ? effectiveRatePct.toFixed(0) : effectiveRatePct.toFixed(1)}%`;
  const monthlyRate = `${monthlyRatePct}%`;
  const canStartNewLoan = !loan || loanBalance <= 0;

  // ─── helpers ─────────────────────────────────────────────────────────────
  const fmtDate = (d) => d
    ? new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", year: "numeric" }).format(d)
    : "—";

  // ─── PDF statement generator ──────────────────────────────────────────────
  const generateStatement = useCallback(async () => {
    if (!loan || generatingPdf) return;
    setGeneratingPdf(true);
    try {
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const W = doc.internal.pageSize.getWidth();
      const purple = [74, 46, 117];
      const darkPurple = [42, 26, 70];
      const lightGray = [245, 245, 248];
      const textGray = [100, 100, 110];
      const generated = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "long", year: "numeric" }).format(new Date());
      const borrowerName = displayName || "Borrower";

      // ── Fee calculations (only interest + admin fee) ─────────────────────
      const totalAdminFees = 69 * months;
      const totalInterest = Math.max(0, totalRepay - principal - totalAdminFees);

      // ══════════════════════════════════════════════════
      // PAGE 1 — HEADER + COMPLIANCE
      // ══════════════════════════════════════════════════
      // Full-width header bar
      doc.setFillColor(...purple);
      doc.rect(0, 0, W, 28, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text("mint", 14, 12);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text("financial services", 14, 17);
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text("LOAN STATEMENT", W - 14, 12, { align: "right" });
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text(`Generated: ${generated}`, W - 14, 17, { align: "right" });
      if (loan.application_id) {
        doc.text(`Ref: ${loan.application_id}`, W - 14, 21, { align: "right" });
      }

      let y = 36;

      // ── Compliance block ─────────────────────────────────────────────────
      doc.setFillColor(...lightGray);
      doc.roundedRect(10, y, W - 20, 72, 3, 3, "F");
      y += 5;
      doc.setTextColor(255, 140, 0);
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "bold");
      doc.text("REGULATORY & COMPLIANCE DISCLOSURE", 15, y);
      y += 5;
      doc.setTextColor(...textGray);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      const complianceLines = [
        "This credit agreement is governed by the National Credit Act 34 of 2005 (NCA) and all regulations",
        "promulgated thereunder. The credit provider is registered with the National Credit Regulator (NCR).",
        "",
        "NCR REGISTRATION: Mint Financial Services is a registered credit provider as required under s40 of the NCA.",
        "Cost of credit is disclosed in full below as required by s92 of the NCA. The consumer has a right to receive",
        "a pre-agreement statement and quotation before concluding any credit agreement (NCA s92 & s93).",
        "",
        "CONSUMER RIGHTS: You have the right to request a credit report at no charge once per year. You have",
        "the right to dispute incorrect information with any credit bureau. You may settle this agreement early",
        "at any time (NCA s125). In the event of debt review, contact an NCR-registered debt counsellor.",
        "",
        `INTEREST RATE DISCLOSURE: The interest rate applied is ${monthlyRate} per month with an effective rate of ${annualRate}`,
        `for this ${months || 0}-month unsecured short-term credit agreement.`,
      ];
      complianceLines.forEach((line) => {
        doc.text(line, 15, y);
        y += 3.8;
      });
      y += 4;

      // ── Borrower info row ────────────────────────────────────────────────
      autoTable(doc, {
        startY: y,
        margin: { left: 10, right: 10 },
        theme: "plain",
        styles: { fontSize: 7.5, cellPadding: 2 },
        headStyles: { fillColor: darkPurple, textColor: 255, fontStyle: "bold", fontSize: 7 },
        head: [["BORROWER INFORMATION", "", "AGREEMENT INFORMATION", ""]],
        body: [
          ["Full name", borrowerName, "Application ID", loan.application_id || "—"],
          ["Status", statusLabel, "Opened", loan.created_at ? fmtDate(new Date(loan.created_at)) : "—"],
          ["Contact", profile?.email || "—", "Credit type", "Unsecured · Short-term"],
        ],
        columnStyles: {
          0: { textColor: textGray, cellWidth: 28 },
          1: { fontStyle: "bold", cellWidth: 45 },
          2: { textColor: textGray, cellWidth: 28 },
          3: { fontStyle: "bold" },
        },
      });
      y = doc.lastAutoTable.finalY + 8;

      // ══════════════════════════════════════════════════
      // DETAILED COST OF CREDIT BREAKDOWN
      // ══════════════════════════════════════════════════
      doc.setTextColor(...darkPurple);
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text("DETAILED COST OF CREDIT BREAKDOWN", 10, y);
      y += 4;
      doc.setDrawColor(...purple);
      doc.setLineWidth(0.5);
      doc.line(10, y, W - 10, y);
      y += 4;

      autoTable(doc, {
        startY: y,
        margin: { left: 10, right: 10 },
        theme: "striped",
        styles: { fontSize: 8, cellPadding: 2.5 },
        headStyles: { fillColor: purple, textColor: 255, fontStyle: "bold", fontSize: 7.5 },
        columnStyles: { 0: { cellWidth: 90 }, 1: { halign: "right" }, 2: { halign: "right" } },
        head: [["Item", "Rate / Detail", "Amount (ZAR)"]],
        body: [
          ["Principal amount disbursed", "—", formatZar(principal)],
          ["Interest (4.5% p.m. on reducing balance)", `${annualRate} over ${months || 0} months (max 27%)`, formatZar(totalInterest)],
          ["Monthly admin fee × " + months, "R69.00 per month (fixed)", formatZar(totalAdminFees)],
          ["", "", ""],
          [{ content: "TOTAL COST OF CREDIT (TCC)", styles: { fontStyle: "bold" } }, { content: "Interest + admin fees", styles: {} }, { content: formatZar(totalRepay - principal), styles: { fontStyle: "bold" } }],
          [{ content: "TOTAL AMOUNT REPAYABLE", styles: { fontStyle: "bold", fillColor: darkPurple, textColor: 255 } }, { content: "", styles: { fillColor: darkPurple } }, { content: formatZar(totalRepay), styles: { fontStyle: "bold", fillColor: darkPurple, textColor: 255 } }],
        ],
      });
      y = doc.lastAutoTable.finalY + 8;

      // ── Monthly repayment summary rows ───────────────────────────────────
      autoTable(doc, {
        startY: y,
        margin: { left: 10, right: 10 },
        theme: "plain",
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: lightGray, textColor: 60, fontStyle: "bold", fontSize: 7.5 },
        columnStyles: { 0: { cellWidth: 90 }, 1: { halign: "right" } },
        head: [["Monthly repayment breakdown", "Amount"]],
        body: [
          ["Monthly instalment (principal + interest)", formatZar(monthlyPay)],
          ["Loan term", months > 0 ? `${months} month${months > 1 ? "s" : ""}` : "—"],
          ["First repayment date", loan.first_repayment_date ? fmtDate(new Date(loan.first_repayment_date)) : "—"],
          ["Interest rate", `${monthlyRate} per month (${annualRate} over ${months || 0} months, max 27%)`],
          ["Amount already repaid", formatZar(totalPaid)],
          ["Outstanding balance", formatZar(loanBalance)],
        ],
      });
      y = doc.lastAutoTable.finalY + 10;

      // ══════════════════════════════════════════════════
      // REPAYMENT SCHEDULE
      // ══════════════════════════════════════════════════
      if (schedule.length > 0) {
        if (y > 220) { doc.addPage(); y = 20; }
        doc.setTextColor(...darkPurple);
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.text("REPAYMENT SCHEDULE", 10, y);
        y += 4;
        doc.setDrawColor(...purple);
        doc.line(10, y, W - 10, y);
        y += 4;
        autoTable(doc, {
          startY: y,
          margin: { left: 10, right: 10 },
          theme: "striped",
          styles: { fontSize: 7.5, cellPadding: 2 },
          headStyles: { fillColor: purple, textColor: 255, fontStyle: "bold", fontSize: 7.5 },
          columnStyles: { 0: { cellWidth: 18 }, 3: { halign: "right" }, 4: { halign: "right", cellWidth: 28 } },
          head: [["Month", "Due Date", "Status", "Amount", "Running Balance"]],
          body: schedule.map((s, idx) => {
            const runningBalance = Math.max(0, totalRepay - (idx + 1) * (s.amount || monthlyPay));
            return [
              s.month || (idx + 1),
              s.due_date ? fmtDate(new Date(s.due_date)) : "—",
              s.status ? String(s.status).charAt(0).toUpperCase() + String(s.status).slice(1) : "Pending",
              formatZar(s.amount || monthlyPay),
              formatZar(runningBalance),
            ];
          }),
        });
        y = doc.lastAutoTable.finalY + 10;
      }

      // ══════════════════════════════════════════════════
      // PAYMENT HISTORY
      // ══════════════════════════════════════════════════
      if (y > 220) { doc.addPage(); y = 20; }
      doc.setTextColor(...darkPurple);
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text("TRANSACTION & PAYMENT HISTORY", 10, y);
      y += 4;
      doc.setDrawColor(...purple);
      doc.line(10, y, W - 10, y);
      y += 4;

      const historyForPdf = historyRows.length > 0
        ? historyRows.map((h) => [
            h.occurred_at ? fmtDate(new Date(h.occurred_at)) : "—",
            (h.description || h.transaction_type || "transaction").replace(/_/g, " "),
            String(h.direction || "").toLowerCase() === "credit" ? "Credit" : "Debit",
            formatZar(Number(h.amount || 0)),
            String(h.direction || "").toLowerCase() === "credit" ? "Accepted" : "Pending",
          ])
        : [[fmtDate(new Date(loan.created_at)), "Loan disbursed", "Credit", formatZar(principal), "Accepted"]];

      autoTable(doc, {
        startY: y,
        margin: { left: 10, right: 10 },
        theme: "striped",
        styles: { fontSize: 7.5, cellPadding: 2.5 },
        headStyles: { fillColor: purple, textColor: 255, fontStyle: "bold", fontSize: 7.5 },
        columnStyles: { 2: { cellWidth: 20 }, 3: { halign: "right", cellWidth: 28 }, 4: { cellWidth: 22 } },
        head: [["Date", "Description", "Direction", "Amount", "Status"]],
        body: historyForPdf,
        didParseCell: (data) => {
          if (data.column.index === 4 && data.section === "body") {
            const val = String(data.cell.raw || "");
            if (val === "Accepted") {
              data.cell.styles.textColor = [5, 150, 105];
              data.cell.styles.fontStyle = "bold";
            } else if (val === "Pending") {
              data.cell.styles.textColor = [180, 120, 0];
              data.cell.styles.fontStyle = "bold";
            }
          }
        },
      });

      // ── Footer on each page ───────────────────────────────────────────────
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(6.5);
        doc.setTextColor(180, 180, 185);
        doc.setFont("helvetica", "normal");
        doc.text(
          "This document is computer-generated and does not require a signature. Mint Financial Services · NCR Registered · NCA Compliant",
          W / 2, doc.internal.pageSize.getHeight() - 8, { align: "center" }
        );
        doc.text(`Page ${i} of ${pageCount}`, W - 10, doc.internal.pageSize.getHeight() - 8, { align: "right" });
      }

      const filename = `Mint_Loan_Statement_${loan.application_id || "loan"}_${new Date().toISOString().slice(0, 10)}.pdf`;
      doc.save(filename);
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setGeneratingPdf(false);
    }
  }, [loan, profile, displayName, principal, totalRepay, monthlyPay, months, totalPaid,
      loanBalance, schedule, historyRows, statusLabel, nextDueDate, fmtDate, generatingPdf]);

  const handleProcessPayment = async () => {
    const amount = parseFloat(paymentAmount);
    if (!amount || isNaN(amount) || amount <= 0) {
      alert("Please enter a valid payment amount.");
      return;
    }
    if (!popFile) {
      alert("Please upload your Proof of Payment document.");
      return;
    }

    setIsProcessing(true);
    try {
      const fileExt = popFile.name.split('.').pop();
      const fileName = `pop-${loan?.id || 'unsecured'}-${Date.now()}.${fileExt}`;
      const filePath = `${profile.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, popFile);

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('documents')
        .getPublicUrl(filePath);

      const { error: docError } = await supabase.from('loan_documents').insert({
        user_id: profile.id,
        loan_application_id: loan.id,
        document_name: popFile.name,
        document_url: publicUrlData.publicUrl,
        document_type: 'proof_of_payment'
      });

      if (docError) throw docError;

      const newPrincipal = Math.max(0, loan.principal_amount - amount);
      const newStatus = newPrincipal === 0 ? 'repaid' : loan.status;

      const { error: loanError } = await supabase
        .from('loan_application')
        .update({ principal_amount: newPrincipal, status: newStatus })
        .eq('id', loan.id);

      if (loanError) throw loanError;

      setShowEftModal(false);
      setPopFile(null);
      setPaymentAmount("");
      setIsSuccess(true);
      
      const { data: updatedLoan } = await supabase.from('loan_application').select('*').eq('id', loan.id).single();
      if(updatedLoan) setLoan({ ...loan, ...updatedLoan });
    } catch (err) {
      console.error("Payment processing failed", err);
      alert("Payment failed. Please ensure storage buckets are correctly configured.");
    } finally {
      setIsProcessing(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-8 text-center animate-in slide-in-from-bottom-4 duration-500">
        <div className="h-24 w-24 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center mb-8 shadow-inner border border-emerald-100">
          <Check size={48} strokeWidth={3} />
        </div>
        <h2 className="text-3xl font-bold mb-3 text-slate-900 tracking-tight">
          Payment Submitted
        </h2>
        <p className="text-xs text-slate-500 mb-10 leading-relaxed max-w-[260px] font-medium">
          Your settlement is being processed. Our team will verify your Proof of Payment and update your ledger.
        </p>
        <button
          onClick={() => setIsSuccess(false)}
          className="w-full max-w-xs py-4 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl active:scale-95 transition-all"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">

      {/* ── HERO ── */}
      <div
        className="rounded-b-[32px] pb-10 pt-0"
        style={{ background: "linear-gradient(170deg, #0d0d12 0%, #25173e 20%, #7a4aa7 60%, #c68edc 85%, #f4e7f5 100%)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-12 mb-6 relative z-50">
          <FamilyDropdown
            profile={profile}
            userId={profile?.id}
            initials={initials}
            avatarUrl={profile?.avatarUrl}
            onOpenFamily={() =>
              window.dispatchEvent(new CustomEvent("navigate-within-app", { detail: { page: "family" } }))
            }
            onSelectMember={(member) =>
              window.dispatchEvent(new CustomEvent("navigate-within-app", { detail: { page: "memberPortfolio", member } }))
            }
          />
          <NotificationBell onClick={onOpenNotifications} />
        </div>

        {/* Balance card — 3D flip */}
        <div
          className="mx-5"
          style={{ perspective: "1200px", borderRadius: "28px" }}
        >
          {/* Spinning wrapper */}
          <div
            style={{
              position: "relative",
              transformStyle: "preserve-3d",
              transition: "transform 0.6s cubic-bezier(0.4, 0.2, 0.2, 1), min-height 0.4s ease",
              transform: showLoanBreakdown ? "rotateY(180deg)" : "rotateY(0deg)",
              minHeight: showLoanBreakdown ? "280px" : "196px",
            }}
          >
            {/* ── FRONT FACE ── */}
            <div
              className="w-full"
              style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
            >
              <button
                type="button"
                onClick={() => loan && setShowLoanBreakdown(true)}
                className="w-full text-left rounded-[28px] px-5 pt-5 pb-6"
                style={{ background: "linear-gradient(135deg, #2a1a46 0%, #4c2e75 55%, #7a4aa7 100%)" }}
              >
                {loading ? (
                  <div className="h-[164px] animate-pulse rounded-xl bg-white/10" />
                ) : (
                  <>
                    {/* Top row — app name + status pill */}
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-[11px] font-semibold tracking-tight text-white/75 font-mono">
                        {loan?.application_id ? loan.application_id.toUpperCase().slice(0, 14) : "MINT CREDIT"}
                      </span>
                      <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${isPendingStatus ? "bg-amber-400/20" : isAcceptedStatus ? "bg-emerald-400/20" : "bg-white/10"}`}>
                        <div className={`h-1.5 w-1.5 rounded-full ${statusDotTone}`} />
                        <span className={`text-[9px] ${isPendingStatus ? "text-amber-300" : isAcceptedStatus ? "text-emerald-300" : "text-white/70"}`}>
                          {loan ? statusLabel : "No active loan"}
                        </span>
                      </div>
                    </div>

                    {/* Balance */}
                    <p className="text-[8px] font-semibold text-white/40 uppercase tracking-[0.2em] mb-0.5">Outstanding balance</p>
                    <p className="text-[28px] font-light text-white leading-none">{formatZar(loanBalance)}</p>

                    {/* Progress bar */}
                    <div className="mt-3 h-[3px] bg-white/15 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-white/60 rounded-full"
                        style={{ width: `${Math.min(facilityLimit > 0 ? (loanBalance / facilityLimit) * 100 : 0, 100)}%` }}
                      />
                    </div>

                    {/* Repaid / Remaining */}
                    <div className="flex justify-between mt-1.5">
                      <div>
                        <p className="text-[8px] text-white/35 uppercase tracking-[0.1em]">Repaid</p>
                        <p className="text-[11px] text-white/70">{formatZar(totalPaid)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[8px] text-white/35 uppercase tracking-[0.1em]">Remaining</p>
                        <p className="text-[11px] text-white/70">{formatZar(loanBalance)}</p>
                      </div>
                    </div>
                  </>
                )}
              </button>
            </div>

            {/* ── BACK FACE ── */}
            <div
              className="w-full absolute inset-0"
              style={{
                backfaceVisibility: "hidden",
                WebkitBackfaceVisibility: "hidden",
                transform: "rotateY(180deg)",
              }}
            >
              <button
                type="button"
                onClick={() => setShowLoanBreakdown(false)}
                className="w-full text-left rounded-[28px] px-5 pt-5 pb-6 h-full"
                style={{ background: "linear-gradient(135deg, #2a1a46 0%, #4c2e75 55%, #7a4aa7 100%)" }}
              >
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/70">Loan breakdown</p>
                  <span className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-full ${statusTone}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${statusDotTone}`} />
                    {statusLabel}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-y-2.5 gap-x-3">
                  <p className="text-[11px] text-white/65">Principal</p>
                  <p className="text-[11px] text-white text-right">{formatZar(principal)}</p>

                  <p className="text-[11px] text-white/65">Total repayable</p>
                  <p className="text-[11px] text-white text-right">{formatZar(totalRepay)}</p>

                  <p className="text-[11px] text-white/65">Monthly</p>
                  <p className="text-[11px] text-white text-right">{formatZar(monthlyPay)}</p>

                  <p className="text-[11px] text-white/65">Term</p>
                  <p className="text-[11px] text-white text-right">{months > 0 ? `${months} months` : "—"}</p>

                  <p className="text-[11px] text-white/65">Amount repaid</p>
                  <p className="text-[11px] text-white text-right">{formatZar(totalPaid)}</p>

                  <p className="text-[11px] text-white/65">Opened</p>
                  <p className="text-[11px] text-white text-right">{loan?.created_at ? fmtDate(new Date(loan.created_at)) : "—"}</p>
                </div>
                <p className="text-[10px] text-white/40 mt-3">← Tap to flip back</p>
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-center">
          <NavigationPill
            activeTab="credit"
            onTabChange={onTabChange}
            className="!static !left-auto !top-auto !translate-x-0 !translate-y-0 scale-90 sm:scale-100"
          />
        </div>
      </div>

      {/* ── BODY ── */}
      <div className="px-5 -mt-1 pb-36">

        {/* Metrics 2×2 */}
        <div className="grid grid-cols-2 gap-2.5 mt-5 mb-2.5">
          {/* Next repayment */}
          <div className="bg-white border border-slate-100 rounded-[20px] p-4 shadow-sm">
            <p className="text-[10px] text-slate-400 mb-1">Next repayment</p>
            <p className="text-[18px] font-medium text-slate-900">{formatZar(monthlyPay)}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {nextDueDate ? `Due ${fmtDate(nextDueDate)}` : "—"}
            </p>
            {daysUntilDue !== null && (
              <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full mt-1.5 ${dueLabelColor}`}>
                {dueLabel}
              </span>
            )}
          </div>

          {/* Interest rate */}
          <div className="bg-white border border-slate-100 rounded-[20px] p-4 shadow-sm">
            <p className="text-[10px] text-slate-400 mb-1">Interest rate</p>
            <p className="text-[18px] font-medium text-slate-900">{monthlyRate} p.m.</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{annualRate} over {months > 0 ? `${months} months` : "term"}</p>
            <span className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full mt-1.5 bg-emerald-50 text-emerald-700">
              Unsecured
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 mb-5">
          {/* Loan term */}
          <div className="bg-white border border-slate-100 rounded-[20px] p-4 shadow-sm">
            <p className="text-[10px] text-slate-400 mb-1">Loan term</p>
            <p className="text-[18px] font-medium text-slate-900">{months > 0 ? `${months} month${months > 1 ? "s" : ""}` : "—"}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Short-term credit</p>
            <span className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full mt-1.5 bg-violet-50 text-violet-700">
              NCA regulated
            </span>
          </div>

          {/* Total paid */}
          <div className="bg-white border border-slate-100 rounded-[20px] p-4 shadow-sm">
            <p className="text-[10px] text-slate-400 mb-1">Total paid</p>
            <p className="text-[18px] font-medium text-slate-900">{formatZar(totalPaid)}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">since inception</p>
          </div>
        </div>

        {/* Quick actions */}
        <p className="text-[14px] font-medium text-slate-900 mb-3">Quick actions</p>
        <div className="grid grid-cols-3 gap-2.5 mb-7">
          {[
            { label: "Repay", icon: ArrowDown,   onClick: () => {
              if (!loan || loanBalance <= 0) {
                alert("No active facility to settle.");
                return;
              }
              setPaymentAmount(monthlyPay.toFixed(2));
              setPopFile(null);
              setShowEftModal(true);
            }},
            {
              label: "New loan",
              icon: Plus,
              onClick: () => onTabChange?.("creditApply"),
              disabled: !canStartNewLoan,
            },
            { label: generatingPdf ? "Generating…" : "Statement", icon: FileText, onClick: generateStatement },
          ].map(({ label, icon: Icon, onClick, disabled }) => (
            <button
              key={label}
              onClick={!disabled ? onClick : undefined}
              disabled={disabled}
              className={`flex flex-col items-center gap-1.5 bg-white border border-slate-100 rounded-[18px] py-3 px-1.5 text-slate-700 shadow-sm transition-all ${disabled ? "opacity-50 cursor-not-allowed" : "active:scale-95"}`}
            >
              <div className="h-8 w-8 rounded-full bg-violet-50 flex items-center justify-center">
                <Icon size={15} className="text-violet-600" />
              </div>
              <span className="text-[11px] font-medium text-center leading-tight flex items-center gap-1">
                {label}
                {disabled ? <Lock size={11} className="text-slate-400" /> : null}
              </span>
            </button>
          ))}
        </div>

        {/* Payment history */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-[14px] font-medium text-slate-900">Payment history</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Recent repayments</p>
          </div>
          <button className="text-[12px] font-medium text-violet-600 mt-0.5">View all</button>
        </div>

        <div className="bg-white border border-slate-100 rounded-[20px] overflow-hidden shadow-sm mb-7">
          {historyLoading ? (
            <div className="py-8 text-center text-[12px] text-slate-400">Loading history…</div>
          ) : historyRows.length > 0 ? (
            historyRows.slice(0, 4).map((entry, i) => {
              const direction = String(entry?.direction || "").toLowerCase();
              const isCredit = direction === "credit";
              const rawType = String(entry?.transaction_type || "transaction");
              const title = entry?.description || rawType.replace(/_/g, " ");
              const txDate = entry?.occurred_at ? fmtDate(new Date(entry.occurred_at)) : "—";
              const txnId = entry.id || `history-${i}`;
              const expanded = expandedTxnId === txnId;
              return (
                <TxnRow
                  key={txnId}
                  icon={isCredit ? Check : Circle}
                  iconBg={isCredit ? "bg-emerald-50" : "bg-slate-100"}
                  iconColor={isCredit ? "text-emerald-600" : "text-slate-400"}
                  title={title}
                  date={txDate}
                  amount={`${isCredit ? "+" : "−"}${formatZar(Number(entry?.amount || 0))}`}
                  amountColor={isCredit ? "text-emerald-600" : "text-slate-900"}
                  expanded={expanded}
                  onToggle={() => setExpandedTxnId(expanded ? null : txnId)}
                  statusLabel={isCredit ? "Accepted" : "Pending"}
                  statusTone={isCredit ? "text-emerald-700 bg-emerald-50" : "text-amber-700 bg-amber-50"}
                  statusDotTone={isCredit ? "bg-emerald-500" : "bg-amber-500"}
                  details={[
                    { label: "Type", value: rawType.replace(/_/g, " ") },
                    { label: "Direction", value: direction || "—" },
                    { label: "Amount", value: formatZar(Number(entry?.amount || 0)) },
                    { label: "Date", value: txDate },
                  ]}
                  isLast={i === Math.min(historyRows.length, 4) - 1}
                />
              );
            })
          ) : loan ? (
            <>
              <TxnRow
                icon={Check}
                iconBg="bg-emerald-50"
                iconColor="text-emerald-600"
                title={`Loan disbursed${loan.application_id ? ` · ${loan.application_id}` : ""}`}
                date={loan.created_at ? fmtDate(new Date(loan.created_at)) + " · Activated" : "—"}
                amount={`+${formatZar(principal)}`}
                amountColor="text-emerald-600"
                expanded={expandedTxnId === "fallback-disbursed"}
                onToggle={() => setExpandedTxnId(expandedTxnId === "fallback-disbursed" ? null : "fallback-disbursed")}
                statusLabel="Accepted"
                statusTone="text-emerald-700 bg-emerald-50"
                statusDotTone="bg-emerald-500"
                details={[
                  { label: "Type", value: "application created" },
                  { label: "Direction", value: "credit" },
                  { label: "Amount", value: formatZar(principal) },
                  { label: "Date", value: loan.created_at ? fmtDate(new Date(loan.created_at)) : "—" },
                ]}
              />
              {/* Render up to 3 schedule entries */}
              {schedule.slice(0, 3).map((entry, i) => (
                <TxnRow
                  key={i}
                  icon={entry.status === "paid" ? Check : Circle}
                  iconBg={entry.status === "paid" ? "bg-emerald-50" : "bg-slate-100"}
                  iconColor={entry.status === "paid" ? "text-emerald-600" : "text-slate-400"}
                  title={`Repayment ${entry.month}`}
                  date={entry.due_date ? fmtDate(new Date(entry.due_date)) : "—"}
                  amount={`−${formatZar(entry.amount)}`}
                  amountColor={entry.status === "paid" ? "text-slate-900" : "text-slate-400"}
                  expanded={expandedTxnId === `fallback-repay-${i}`}
                  onToggle={() => setExpandedTxnId(expandedTxnId === `fallback-repay-${i}` ? null : `fallback-repay-${i}`)}
                  statusLabel={entry.status === "paid" ? "Accepted" : "Pending"}
                  statusTone={entry.status === "paid" ? "text-emerald-700 bg-emerald-50" : "text-amber-700 bg-amber-50"}
                  statusDotTone={entry.status === "paid" ? "bg-emerald-500" : "bg-amber-500"}
                  details={[
                    { label: "Type", value: "repayment" },
                    { label: "Direction", value: "debit" },
                    { label: "Amount", value: formatZar(Number(entry.amount || 0)) },
                    { label: "Due date", value: entry.due_date ? fmtDate(new Date(entry.due_date)) : "—" },
                  ]}
                  isLast={i === Math.min(schedule.length, 3) - 1}
                />
              ))}
              {schedule.length === 0 && (
                <TxnRow
                  icon={Circle}
                  iconBg="bg-slate-100"
                  iconColor="text-slate-400"
                  title="First repayment due"
                  date={nextDueDate ? fmtDate(nextDueDate) : "—"}
                  amount={`−${formatZar(monthlyPay)}`}
                  amountColor="text-slate-400"
                  expanded={expandedTxnId === "fallback-first-repay"}
                  onToggle={() => setExpandedTxnId(expandedTxnId === "fallback-first-repay" ? null : "fallback-first-repay")}
                  statusLabel="Pending"
                  statusTone="text-amber-700 bg-amber-50"
                  statusDotTone="bg-amber-500"
                  details={[
                    { label: "Type", value: "repayment" },
                    { label: "Direction", value: "debit" },
                    { label: "Amount", value: formatZar(Number(monthlyPay || 0)) },
                    { label: "Due date", value: nextDueDate ? fmtDate(nextDueDate) : "—" },
                  ]}
                  isLast
                />
              )}
            </>
          ) : (
            <div className="py-8 text-center text-[12px] text-slate-400">
              No credit history found.
            </div>
          )}
        </div>

        {/* More credit options */}
        <p className="text-[14px] font-medium text-slate-900 mb-3">More credit options</p>
        <OfferRow
          icon={Plus}
          title="New loan"
          desc={canStartNewLoan ? "Start a fresh unsecured loan application" : "Available once your current loan is fully paid"}
          onClick={() => onTabChange?.("creditApply")}
          disabled={!canStartNewLoan}
        />
        <OfferRow
          icon={Layers}
          title="Portfolio-backed credit"
          desc="Use your investments as collateral for lower rates"
          onClick={() => onTabChange?.("instantLiquidity")}
        />
      </div>

      {/* --- MINT EFT PAYMENT MODAL --- */}
      {showEftModal && loan && portalTarget && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4">
          <button className="absolute inset-0" onClick={() => !isProcessing && setShowEftModal(false)} />

          <div className="relative w-full max-w-sm bg-white rounded-[36px] p-8 shadow-2xl animate-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto no-scrollbar">
            <button
              disabled={isProcessing}
              onClick={() => setShowEftModal(false)}
              className="absolute top-6 right-6 h-8 w-8 bg-slate-50 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X size={16} />
            </button>

            <div className="h-14 w-14 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center mb-6 border border-violet-100">
              <Landmark size={24} />
            </div>

            <h3 className="text-xl font-bold text-slate-900 mb-1">EFT Repayment</h3>
            <p className="text-xs text-slate-500 mb-6 leading-relaxed">
              Transfer funds to the MINT account and upload your POP to settle.
            </p>

            {/* Bank Details from Account Confirmation PDF */}
            <div className="bg-slate-50 rounded-[24px] p-5 mb-6 border border-slate-100 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Bank</span>
                <span className="text-xs font-bold text-slate-900">Capitec Business</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Account Name</span>
                <span className="text-xs font-bold text-slate-900">ALGOHIVE PTY LTD</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Account No.</span>
                <span className="text-xs font-bold text-slate-900 font-mono">1053045883</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Branch Code</span>
                <span className="text-xs font-bold text-slate-900 font-mono">450105</span>
              </div>
              <div className="pt-4 border-t border-slate-200/60 flex justify-between items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-violet-600">Reference</span>
                <span className="text-xs font-black text-slate-900 font-mono bg-violet-100 px-2.5 py-1 rounded-lg">
                  MINT-{loan.id.slice(0, 6).toUpperCase()}
                </span>
              </div>
            </div>

            {/* Custom Payment Amount */}
            <div className="mb-4">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-2 pl-2">Payment Amount</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">R</span>
                <input
                  type="number"
                  placeholder="0.00"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 pl-10 pr-4 font-bold text-slate-900 outline-none focus:border-violet-500 transition-colors shadow-sm"
                />
              </div>
            </div>

            {/* Proof of Payment Upload */}
            <div className="mb-8">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-2 pl-2">Proof of Payment</label>
              <div className="relative overflow-hidden w-full bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-center p-4 shadow-sm hover:bg-slate-100 transition-colors cursor-pointer group">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setPopFile(e.target.files[0])}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="flex items-center gap-3 text-slate-500 group-hover:text-violet-600 transition-colors">
                  <UploadCloud size={20} />
                  <span className="text-xs font-bold truncate max-w-[200px]">
                    {popFile ? popFile.name : "Tap to Upload File"}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={handleProcessPayment}
              disabled={isProcessing || !paymentAmount || !popFile}
              className="w-full py-4 rounded-2xl bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest shadow-xl shadow-slate-900/20 active:scale-95 transition-all disabled:opacity-40"
            >
              {isProcessing ? "Uploading & Processing..." : "Submit Payment"}
            </button>
          </div>
        </div>
        , portalTarget)}
    </div>
  );
};

export default UnsecuredCreditDashboard;
