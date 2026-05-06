import React, { useEffect, useRef, useState } from "react";
import SignaturePad from "signature_pad";
import jsPDF from "jspdf";
import { X, Check, Loader2 } from "lucide-react";
import { downloadPdfBuffer } from "../lib/pdfDownload";

// ─── constants ────────────────────────────────────────────────────────────────

const CEO_SIGNATURE_URL = "/assets/ceo-signature.png";
const MINT_PURPLE = [91, 33, 182];
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 15;
const COL1 = 70;
const COL2 = PAGE_W - MARGIN * 2 - COL1;

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDateLong(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "numeric", month: "long", year: "numeric",
  });
}

function formatAge(dob) {
  if (!dob) return "—";
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return `${age} years old`;
}

async function fetchImageBase64(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const data = await new Promise((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result);
      r.readAsDataURL(blob);
    });
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ data, width: img.width, height: img.height });
      img.onerror = () => resolve({ data, width: 0, height: 0 });
      img.src = data;
    });
  } catch { return null; }
}

function drawRow(doc, y, label, value, labelW, valueW, margin) {
  const px = 3, py = 2.5, lh = 5.5;
  const valLines = doc.splitTextToSize(String(value || "—"), valueW - px * 2);
  const rowH = Math.max(valLines.length * lh + py * 2, 10);
  doc.setDrawColor(220, 220, 230);
  doc.setLineWidth(0.25);
  doc.setFillColor(248, 246, 255);
  doc.rect(margin, y, labelW, rowH, "FD");
  doc.setFillColor(255, 255, 255);
  doc.rect(margin + labelW, y, valueW, rowH, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(120, 100, 160);
  doc.text(label.toUpperCase(), margin + px, y + py + 3.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(30, 27, 75);
  valLines.forEach((l, i) => doc.text(l, margin + labelW + px, y + py + 3.5 + i * lh));
  return y + rowH;
}

function addPageHeader(doc, pageNum, totalPages) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(160, 160, 160);
  doc.text(`Page ${pageNum} of ${totalPages}`, PAGE_W - MARGIN, PAGE_H - MARGIN, { align: "right" });
  doc.text("CONFIDENTIAL — Mint Platforms (Pty) Ltd", MARGIN, PAGE_H - MARGIN);
}

// ─── PDF builder ──────────────────────────────────────────────────────────────

async function buildChildAgreementPdf({ parentProfile, childData, signatureDataUrl, signedAt }) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const ceoSigB64 = await fetchImageBase64(CEO_SIGNATURE_URL);

  const parentName = [parentProfile?.firstName, parentProfile?.lastName].filter(Boolean).join(" ") || "—";
  const parentId = parentProfile?.idNumber || "—";
  const parentEmail = parentProfile?.email || "—";
  const childName = `${childData.first_name || ""} ${childData.last_name || ""}`.trim() || "—";
  const childDob = formatDateLong(childData.date_of_birth);
  const childAge = formatAge(childData.date_of_birth);
  const childMint = childData.mint_number || "PENDING";
  const childIdNumber = childData.id_number || "—";
  const signedDateLong = formatDateLong(signedAt);
  const signedDateTime = new Date(signedAt).toLocaleString("en-ZA", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });

  let pageNum = 1;

  // ── PAGE 1: Cover & Party Details ────────────────────────────────────────────
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");

  addPageHeader(doc, pageNum, 2);

  // Purple header bar
  doc.setFillColor(...MINT_PURPLE);
  doc.rect(MARGIN, MARGIN + 12, PAGE_W - MARGIN * 2, 1.5, "F");

  let y = MARGIN + 20;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...MINT_PURPLE);
  doc.text("CLIENT SECURITIES ADMINISTRATION AND", MARGIN, y);
  y += 6;
  doc.text("NOMINEE APPOINTMENT AGREEMENT", MARGIN, y);
  y += 5;
  doc.setFontSize(9.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 27, 75);
  doc.text("MINOR ACCOUNT — GUARDIAN RESPONSIBILITY UNDERTAKING", MARGIN, y);
  y += 5;
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(130, 100, 170);
  doc.text("Pursuant to the Mint Platforms (Pty) Ltd Service Framework and the Financial Markets Act 19 of 2012", MARGIN, y);
  y += 10;

  // Section 1 — Parties
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 27, 75);
  doc.text("1. PARTIES TO THE AGREEMENT", MARGIN, y);
  y += 5;

  y = drawRow(doc, y, "Service Provider", "Mint Platforms (Pty) Ltd (FSP Licence Pending)", COL1, COL2, MARGIN);
  y = drawRow(doc, y, "Custodian / Nominee", "Appointed nominee custodian", COL1, COL2, MARGIN);
  y = drawRow(doc, y, "The Minor (Client)", childName, COL1, COL2, MARGIN);
  y = drawRow(doc, y, "Minor Mint Account ID", childMint, COL1, COL2, MARGIN);
  y = drawRow(doc, y, "Minor Date of Birth", `${childDob} (${childAge})`, COL1, COL2, MARGIN);
  y = drawRow(doc, y, "Minor Identity Number", childIdNumber, COL1, COL2, MARGIN);
  y = drawRow(doc, y, "Legal Guardian / Parent", parentName, COL1, COL2, MARGIN);
  y = drawRow(doc, y, "Guardian Identity Number", parentId, COL1, COL2, MARGIN);
  y = drawRow(doc, y, "Guardian Email Address", parentEmail, COL1, COL2, MARGIN);
  y = drawRow(doc, y, "Relationship to Minor", "Parent / Legal Guardian", COL1, COL2, MARGIN);
  y = drawRow(doc, y, "Date of Agreement", signedDateLong, COL1, COL2, MARGIN);
  y = drawRow(doc, y, "Agreement Reference", `MINT-MINOR-${childMint}-${new Date(signedAt).getFullYear()}`, COL1, COL2, MARGIN);
  y += 10;

  // Section 2 — Recitals
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 27, 75);
  doc.text("2. RECITALS", MARGIN, y);
  y += 5;

  const writePara = (text, indent = 0, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(9);
    doc.setTextColor(50, 40, 80);
    const lines = doc.splitTextToSize(text, PAGE_W - MARGIN * 2 - indent);
    lines.forEach((line) => {
      if (y > PAGE_H - MARGIN - 12) {
        doc.addPage();
        pageNum++;
        addPageHeader(doc, pageNum, 2);
        y = MARGIN + 14;
      }
      doc.text(line, MARGIN + indent, y);
      y += 4.8;
    });
    y += 2;
  };

  writePara("A. Mint Platforms (Pty) Ltd ('the Platform') facilitates the investment of client funds in JSE-listed securities through its platform. The Platform acts as an authorised Financial Services Provider (FSP) pursuant to the Financial Advisory and Intermediary Services Act 37 of 2002 ('FAIS Act').");
  writePara("B. Securities purchased by or on behalf of clients are held through an appointed third-party nominee custodian acting as nominee and custodian. Client assets are fully segregated from the Platform's own assets at all times.");
  writePara("C. The Guardian wishes to open and operate an investment account on behalf of the Minor, and the Platform is willing to provide such services subject to the terms and conditions set out herein.");

  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 27, 75);
  doc.text("3. GUARDIAN'S REPRESENTATION AND WARRANTY", MARGIN, y);
  y += 5;

  writePara("3.1  The Guardian warrants and represents that they are the natural parent or court-appointed legal guardian of the Minor and have the full legal capacity and authority to enter into this Agreement on the Minor's behalf in terms of the Children's Act 38 of 2005.");
  writePara("3.2  The Guardian warrants that all information provided regarding the Minor, including name, date of birth, and identity number, is true, accurate, complete, and supported by a valid unabridged birth certificate issued by the Department of Home Affairs of the Republic of South Africa.");
  writePara("3.3  The Guardian warrants that all funds invested in the Minor's account originate from lawful sources and are for the exclusive benefit of the Minor, in compliance with the Financial Intelligence Centre Act 38 of 2001 ('FICA').");

  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 27, 75);
  doc.text("4. APPOINTMENT OF PLATFORM AND CUSTODIAN", MARGIN, y);
  y += 5;

  writePara("4.1  The Guardian, acting for and on behalf of the Minor, hereby appoints the Platform as its nominee administrator to manage the Minor's securities and investment account ('the Account').");
  writePara("4.2  The Guardian further authorises the Platform to facilitate the opening and maintenance of the Account in the Minor's name with an appointed nominee custodian, or its affiliated companies, acting as nominee and custodian, for the purpose of holding and administering securities on behalf of the Minor.");
  writePara("4.3  The Platform is specifically authorised to:\n  4.3.1  Facilitate the opening and administration of the Minor's securities account with the appointed nominee custodian, including the submission of all required documentation and client information.\n  4.3.2  Execute buy and sell orders in JSE-listed securities as instructed by the Guardian on behalf of the Minor.\n  4.3.3  Hold cash balances in a trust account pending investment or withdrawal.\n  4.3.4  Provide relevant client and investment information, instructions, and documentation to Strate, the appointed nominee custodian, and any related service providers for securities settlement, custody administration, and registry maintenance.");

  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 27, 75);
  doc.text("5. GUARDIAN'S RESPONSIBILITY AND INDEMNITY", MARGIN, y);
  y += 5;

  writePara("5.1  The Guardian accepts full and exclusive legal, financial, and fiduciary responsibility for all activity in the Account, including all buy, sell, and transfer instructions provided to the Platform on the Minor's behalf.");
  writePara("5.2  The Guardian hereby indemnifies the Platform, the appointed nominee custodian, and their respective directors, officers, and employees from and against any and all claims, losses, damages, costs, or expenses (including legal costs) arising from or in connection with:\n  (a) the operation of the Account;\n  (b) any instruction given by the Guardian;\n  (c) any claim made by the Minor upon reaching the age of majority;\n  (d) any breach by the Guardian of any warranty or representation in this Agreement.");
  writePara("5.3  The Guardian acknowledges responsibility for all platform fees, brokerage charges, securities transfer tax, dividends withholding tax, and any other charges or tax liabilities arising from or associated with the Account.");
  writePara("5.4  The Guardian agrees to promptly notify the Platform of any change in their legal guardianship status over the Minor.");

  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 27, 75);
  doc.text("6. TRANSITION OF AUTHORITY UPON MAJORITY", MARGIN, y);
  y += 5;

  writePara("6.1  Upon the Minor attaining the age of majority (18 years), all rights and authority over the Account shall vest in the Minor exclusively. The Guardian's authority to instruct the Platform on behalf of the Minor shall automatically terminate.");
  writePara("6.2  The Platform shall require the Minor, upon reaching majority, to complete a new client onboarding process, including identity verification (KYC/FICA), before granting full account control.");
  writePara("6.3  Until such transition is completed, the Guardian remains liable for all obligations under this Agreement.");

  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 27, 75);
  doc.text("7. RISK DISCLOSURE", MARGIN, y);
  y += 5;

  writePara("7.1  The Guardian acknowledges that securities investments are subject to market risk and that the value of the Minor's portfolio may increase or decrease. Past performance does not guarantee future results. The Platform does not guarantee any specific investment returns.");

  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 27, 75);
  doc.text("8. GOVERNING LAW", MARGIN, y);
  y += 5;

  writePara("8.1  This Agreement shall be governed by and construed in accordance with the laws of the Republic of South Africa. Any dispute shall be subject to the jurisdiction of the South Gauteng High Court, Johannesburg.");

  // Signatures section
  if (y > PAGE_H - 110) {
    doc.addPage();
    pageNum++;
    addPageHeader(doc, pageNum, 2);
    y = MARGIN + 14;
  }

  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 27, 75);
  doc.text("9. SIGNATURES", MARGIN, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(60, 50, 90);
  doc.text(`Signed by the Guardian on behalf of the Minor (${childName}):`, MARGIN, y);
  y += 4;

  if (signatureDataUrl) {
    doc.addImage(signatureDataUrl, "JPEG", MARGIN, y, 50, 20, undefined, "FAST");
  }

  y += 24;
  doc.setDrawColor(180, 170, 210);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, MARGIN + 75, y);
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(30, 27, 75);
  doc.text(parentName, MARGIN, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(120, 110, 150);
  doc.text("Legal Guardian / Parent", MARGIN, y);
  y += 4;
  doc.text(`Signed: ${signedDateTime}`, MARGIN, y);

  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(60, 50, 90);
  doc.text("For and on behalf of Mint Platforms (Pty) Ltd:", MARGIN, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(60, 50, 90);
  doc.text("Name: Lonwabo Damane", MARGIN, y);
  y += 4;
  doc.text("Title: Chief Executive Officer", MARGIN, y);
  y += 2;

  if (ceoSigB64?.data && ceoSigB64.width > 0) {
    const aspect = ceoSigB64.width / ceoSigB64.height;
    let h = 18, w = h * aspect;
    const maxW = 70;
    if (w > maxW) { w = maxW; h = w / aspect; }
    doc.addImage(ceoSigB64.data, "PNG", MARGIN, y, w, h, undefined, "FAST");
    y += h + 2;
  } else {
    y += 14;
  }

  doc.setDrawColor(180, 170, 210);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, MARGIN + 75, y);
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(30, 27, 75);
  doc.text("Lonwabo Damane", MARGIN, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(120, 110, 150);
  doc.text("Chief Executive Officer — Mint Platforms (Pty) Ltd", MARGIN, y);

  // Footer disclaimer box
  y += 14;
  if (y < PAGE_H - 32) {
    doc.setDrawColor(200, 190, 230);
    doc.setFillColor(248, 246, 255);
    doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN, y, PAGE_W - MARGIN * 2, 22, 2, 2, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 90, 140);
    const disclaimer = "Securities are held on behalf of clients by an appointed nominee custodian. Client assets are segregated from Platform assets. This Agreement is binding upon signature and forms part of the Platform's standard terms of service. Mint Platforms (Pty) Ltd — FSP Licence Pending — FAIS Compliant.";
    const dLines = doc.splitTextToSize(disclaimer, PAGE_W - MARGIN * 2 - 8);
    dLines.forEach((line, i) => doc.text(line, MARGIN + 4, y + 5 + i * 4));
  }

  return doc.output("arraybuffer");
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChildResponsibilityAgreement({
  parentProfile,
  childData,
  onBack,
  onComplete,
  saving = false
}) {
  const [error, setError] = useState("");
  const [sigEmpty, setSigEmpty] = useState(true);
  const canvasRef = useRef(null);
  const sigPadRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      canvas.getContext("2d").scale(ratio, ratio);
      sigPadRef.current?.clear();
    };
    sigPadRef.current = new SignaturePad(canvas, {
      backgroundColor: "rgb(255,255,255)",
      penColor: "rgb(30,27,75)",
      minWidth: 1.5,
      maxWidth: 3,
    });
    sigPadRef.current.addEventListener("endStroke", () => setSigEmpty(sigPadRef.current.isEmpty()));
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const handleSignAndFinish = async () => {
    if (sigEmpty) {
      setError("Please sign the agreement to continue.");
      return;
    }
    setError("");
    // Use JPEG for the signature — avoids jsPDF's PNG re-encode which fails on
    // memory-constrained mobile WebViews (throws "load error" consistently)
    const sigUrl = sigPadRef.current.toDataURL("image/jpeg", 0.92);
    const now = new Date().toISOString();
    try {
      const pdfBuffer = await buildChildAgreementPdf({
        parentProfile,
        childData,
        signatureDataUrl: sigUrl,
        signedAt: now,
      });

      const saved = await onComplete({ pdfBuffer, signedAt: now, signatureDataUrl: sigUrl });
      if (saved === false) return;

      const childName = `${childData?.first_name || ""}_${childData?.last_name || ""}`.trim().replace(/\s+/g, "_") || "child";
      downloadPdfBuffer(pdfBuffer, `Mint_Agreement_${childName}.pdf`);
    } catch (e) {
      setError(e?.message || "Failed to generate agreement PDF. Please try again.");
    }
  };

  const childName = `${childData?.first_name || ""} ${childData?.last_name || ""}`.trim() || "your child";
  const parentName = [parentProfile?.firstName, parentProfile?.lastName].filter(Boolean).join(" ") || "Guardian";

  return (
    <div className="flex flex-col gap-5 pt-2">
      <p className="text-sm text-slate-600 leading-relaxed">
        As the legal guardian of <strong>{childName}</strong>, please review the key terms below and sign to confirm your responsibility for this investment account.
      </p>

      {/* Agreement summary scroll box */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 max-h-[230px] overflow-y-auto">
        <div className="p-4 flex flex-col gap-3 text-[11.5px] text-slate-600">
          <p className="font-bold text-slate-900 border-b pb-2 text-xs uppercase tracking-wider">
            Client Securities Administration & Nominee Appointment Agreement — Minor Account
          </p>

          <div className="space-y-1.5">
            <div className="flex justify-between items-start py-1 border-b border-slate-100">
              <span className="text-slate-500 shrink-0 pr-3">Service Provider</span>
              <span className="text-slate-800 font-semibold text-right">Mint Platforms (Pty) Ltd</span>
            </div>
            <div className="flex justify-between items-start py-1 border-b border-slate-100">
              <span className="text-slate-500 shrink-0 pr-3">Custodian / Nominee</span>
              <span className="text-slate-800 font-semibold text-right">Appointed nominee custodian</span>
            </div>
            <div className="flex justify-between items-start py-1 border-b border-slate-100">
              <span className="text-slate-500 shrink-0 pr-3">Legal Guardian</span>
              <span className="text-slate-800 font-semibold text-right">{parentName}</span>
            </div>
            <div className="flex justify-between items-start py-1 border-b border-slate-100">
              <span className="text-slate-500 shrink-0 pr-3">Minor (Client)</span>
              <span className="text-slate-800 font-semibold text-right">{childName}</span>
            </div>
            {childData?.mint_number && (
              <div className="flex justify-between items-start py-1 border-b border-slate-100">
                <span className="text-slate-500 shrink-0 pr-3">Mint Account ID</span>
                <span className="text-slate-800 font-semibold text-right">{childData.mint_number}</span>
              </div>
            )}
          </div>

          <div className="rounded-xl bg-purple-50 border border-purple-100 p-3 space-y-2">
            <p className="font-bold text-slate-800 text-[11px]">Key Terms You Are Agreeing To:</p>
            <p className="leading-relaxed">
              <strong>Custodial Authority:</strong> Securities are held by an appointed nominee custodian, fully segregated from Mint's assets.
            </p>
            <p className="leading-relaxed">
              <strong>Guardian Responsibility:</strong> You accept full legal and financial responsibility for all account activity, including all buy, sell, and transfer instructions.
            </p>
            <p className="leading-relaxed">
              <strong>Indemnity:</strong> You indemnify Mint and the appointed nominee custodian against any claim arising from the account, including any future claim by the Minor.
            </p>
            <p className="leading-relaxed">
              <strong>Transition at 18:</strong> Upon the Minor reaching majority (18 years), all authority automatically vests in the Minor, who must complete their own onboarding.
            </p>
            <p className="leading-relaxed">
              <strong>Governing Law:</strong> South African law. South Gauteng High Court jurisdiction.
            </p>
          </div>
        </div>
      </div>

      {/* Signature pad */}
      <div className="flex flex-col gap-2">
        <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider ml-1">
          Guardian Signature
        </label>
        <div
          className="relative rounded-2xl border-2 border-slate-200 bg-white overflow-hidden"
          style={{ height: "130px" }}
        >
          <canvas
            ref={canvasRef}
            className="h-full w-full cursor-crosshair"
            style={{ touchAction: "none" }}
          />
          <button
            onClick={() => { sigPadRef.current?.clear(); setSigEmpty(true); }}
            className="absolute top-2 right-2 rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-200 transition"
          >
            Clear
          </button>
          {sigEmpty && (
            <p className="absolute inset-0 flex items-center justify-center text-xs text-slate-300 pointer-events-none">
              Draw your signature here
            </p>
          )}
        </div>
        <p className="text-[10px] text-slate-400 ml-1">
          By signing, you confirm you are the legal guardian of {childName} and agree to the terms above.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 border border-red-100">
          <X className="h-3.5 w-3.5 text-red-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-red-500">{error}</p>
        </div>
      )}

      <div className="flex flex-col gap-3 mt-1">
        <button
          onClick={handleSignAndFinish}
          disabled={saving || sigEmpty}
          className="w-full rounded-xl py-3.5 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
          style={{ background: "linear-gradient(135deg,#1e1b4b,#312e81)" }}
        >
          {saving ? (
            <><Loader2 className="h-4 w-4 animate-spin" />Finalising Account…</>
          ) : (
            <><Check className="h-4 w-4" />Sign & Finalise</>
          )}
        </button>
        <button
          onClick={onBack}
          disabled={saving}
          className="w-full py-2 text-xs font-semibold text-slate-400 hover:text-slate-600 transition"
        >
          Go Back
        </button>
      </div>
    </div>
  );
}
