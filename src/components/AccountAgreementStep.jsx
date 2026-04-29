/**
 * AccountAgreementStep.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Step 9 of 9 — Client Securities Administration & Nominee Appointment Agreement
 *
 * Flow:  review  →  sign  →  processing  →  success
 *
 * What it does:
 *  1. REVIEW   — shows all real client data pulled from useProfile() + onboarding state
 *  2. SIGN     — renders the full agreement text with client details auto-populated,
 *                then a signature pad for the client to draw their signature
 *  3. PROCESSING — builds a 2-page PDF via jsPDF:
 *                   Page 1: Account Details table (same layout as PDF generator)
 *                   Page 2: Full agreement text with client details + drawn signature
 *  4. SUCCESS  — shows date signed / date downloaded, download button, go to dashboard
 *
 * Date rules:
 *  - signedAt    = exact moment client clicks "Sign" — NEVER changes
 *  - downloadedAt = re-stamped fresh on every download click
 *  - Both appear in: PDF page 1 table rows, PDF page 2 signature block,
 *                    PDF footer on every page, audit trail box, success screen
 *
 * Usage in OnboardingProcessPage (step === 9):
 *   <AccountAgreementStep
 *     profile={profile}
 *     onboardingData={{ bankName, bankAccountNumber, bankBranchCode,
 *                       taxNumber, identityNumber, sourceOfFunds,
 *                       sourceOfFundsOther, expectedMonthlyInvestment }}
 *     existingOnboardingId={existingOnboardingId}
 *     onComplete={handleFinalComplete}
 *   />
 *
 * Dependencies:  npm install jspdf signature_pad
 * Supabase:      bucket "signed-agreements" (public)
 *                columns: signed_agreement_url, signed_at, downloaded_at, signature_data_url
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import SignaturePad from "signature_pad";
import jsPDF from "jspdf";
import { supabase } from "../lib/supabase";

// ─── Image cache (module-level) ────────────────────────────────────────────
const imageCache = new Map();

// ─── constants ────────────────────────────────────────────────────────────────

const MINT_LOGO_URL =
  "https://mfxnghmuccevsxwcetej.supabase.co/storage/v1/object/public/Mint%20Assets/tMOmeIOo4KE20Yh1bIuk8PFMlFHZ421rVESa2dcn.jpg";

const CEO_SIGNATURE_URL = "/assets/ceo-signature.png";

const MINT_PURPLE = [91, 33, 182];
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 15;
const COL1 = 62;
const COL2 = PAGE_W - MARGIN * 2 - COL1;

// ─── date helpers ─────────────────────────────────────────────────────────────

function formatDateLong(iso) {
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "numeric", month: "long", year: "numeric",
  });
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString("en-ZA", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZoneName: "short",
  });
}

function todayParts() {
  const d = new Date();
  return {
    day: d.getDate(),
    month: d.toLocaleString("en-ZA", { month: "long" }),
    year: String(d.getFullYear()).slice(-2),
  };
}

// ─── PDF helpers ──────────────────────────────────────────────────────────────

async function fetchImageBase64(url) {
  if (!url) return null;

  // Check cache first
  if (imageCache.has(url)) {
    return imageCache.get(url);
  }

  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const data = await new Promise((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result);
      r.readAsDataURL(blob);
    });
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const result = { data, width: img.width, height: img.height };
        imageCache.set(url, result); // Cache the result
        resolve(result);
      };
      img.onerror = () => {
        const result = { data, width: 0, height: 0 };
        imageCache.set(url, result); // Cache even on error to avoid retries
        resolve(result);
      };
      img.src = data;
    });
  } catch {
    const result = null;
    imageCache.set(url, result); // Cache null result
    return result;
  }
}

function drawRow(doc, y, label, value, labelW, valueW, margin) {
  const px = 3, py = 2.5, lh = 5.5;
  const valLines = doc.splitTextToSize(String(value || "—"), valueW - px * 2);
  const rowH = Math.max(valLines.length * lh + py * 2, 10);

  doc.setDrawColor(30, 30, 30);
  doc.setLineWidth(0.4);
  doc.rect(margin, y, labelW, rowH);
  doc.rect(margin + labelW, y, valueW, rowH);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(50, 50, 50);
  doc.splitTextToSize(label.toUpperCase(), labelW - px * 2)
    .forEach((l, i) => doc.text(l, margin + px, y + py + 3.5 + i * lh));

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);
  valLines.forEach((l, i) => doc.text(l, margin + labelW + px, y + py + 3.5 + i * lh));

  return y + rowH;
}

function needsNewPage(doc, y, needed = 20) {
  if (y + needed > 278) { doc.addPage(); return MARGIN; }
  return y;
}

function drawFooters(doc, signedAt, downloadedAt) {
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(160, 160, 160);
    const fy = PAGE_H - 8;
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, fy - 3, PAGE_W - MARGIN, fy - 3);
    doc.text(`Signed: ${formatDateTime(signedAt)}`, MARGIN, fy);
    const pg = `Page ${p} of ${total}`;
    doc.text(pg, (PAGE_W - doc.getTextWidth(pg)) / 2, fy);
    const dl = `Downloaded: ${formatDateTime(downloadedAt)}`;
    doc.text(dl, PAGE_W - MARGIN - doc.getTextWidth(dl), fy);
  }
}

// ─── PDF builder ──────────────────────────────────────────────────────────────

async function buildPDF({ profile, onboardingData, packDetail, signatureDataUrl, signedAt, downloadedAt }) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const logoB64 = await fetchImageBase64(MINT_LOGO_URL);
  const ceoSigB64 = await fetchImageBase64(CEO_SIGNATURE_URL);

  const {
    bankName = "", bankAccountNumber = "", bankBranchCode = "",
    taxNumber = "", identityNumber = "",
    sourceOfFunds = "", sourceOfFundsOther = "",
    bankAccountType = "",
  } = onboardingData;

  // ── Extract fields from pack_detail (SumSub KYC data) with profile fallback ──
  const pd = packDetail?.info || {};
  const pdFirstName = pd.firstNameEn || pd.firstName || "";
  const pdLastName = pd.lastNameEn || pd.lastName || "";
  const pdFullName = pdFirstName && pdLastName ? `${pdFirstName} ${pdLastName}` : "";
  const pdIdDoc = Array.isArray(pd.idDocs) ? pd.idDocs.find(d => d.number) : null;
  const pdIdNumber = pdIdDoc?.number || "";
  const pdAddress = (() => {
    if (Array.isArray(pd.addresses) && pd.addresses.length > 0) {
      const a = pd.addresses[0];
      return [a.street, a.town, a.state, a.postCode, a.country].filter(Boolean).join(", ");
    }
    return "";
  })();
  const pdEmail = packDetail?.email || "";
  const pdPhone = packDetail?.phone || "";

  const fullName = pdFullName || [profile?.first_name || profile?.firstName, profile?.last_name || profile?.lastName].filter(Boolean).join(" ") || profile?.full_name || "—";
  const address = pdAddress || profile?.address || profile?.physical_address || "—";
  const email = pdEmail || profile?.email || "—";
  const cell = pdPhone || profile?.cell_number || profile?.phone || "—";
  const resolvedId = pdIdNumber || identityNumber || "—";
  const taxNo = taxNumber || profile?.tax_number || "—";

  // ── PAGE 1: Account Details ───────────────────────────────────────────────
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");

  if (logoB64?.data) {
    const logoAspect = logoB64.width / logoB64.height;
    const logoH = 14;
    const logoW = logoH * logoAspect;
    doc.addImage(logoB64.data, "JPEG", PAGE_W - MARGIN - logoW, MARGIN, logoW, logoH, undefined, "FAST");
  }

  let y = MARGIN + 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...MINT_PURPLE);
  const t = "ACCOUNT DETAILS";
  const tw = doc.getTextWidth(t);
  doc.text(t, (PAGE_W - tw) / 2, y);
  doc.setDrawColor(...MINT_PURPLE);
  doc.setLineWidth(0.5);
  doc.line((PAGE_W - tw) / 2, y + 1, (PAGE_W + tw) / 2, y + 1);
  y += 12;

  const rows = [
    ["Asset / Fund Manager", "MINT PLATFORMS (PTY) LTD"],
    ["Account Name", fullName.toUpperCase()],
    ["Contact Name", fullName.toUpperCase()],
    ["Identity / Registration Number", resolvedId],
    ["Income Tax Number", taxNo],
    ["Physical Address", address],
    ["Postal Address", address],
    ["Cell No", cell],
    ["E-Mail", email],
    ["Bank Account Number", bankAccountNumber || "—"],
    ["Branch Number", bankBranchCode || "—"],
    ["Bank Name", String(bankName || "—").replace(/_/g, " ").toUpperCase()],
    ["Account Type", (bankAccountType || "SAVINGS").toUpperCase()],
    ["Date Signed", formatDateLong(signedAt)],
    ["Date Downloaded", formatDateLong(downloadedAt)],
  ];

  for (const [l, v] of rows) {
    y = needsNewPage(doc, y, 12);
    y = drawRow(doc, y, l, v, COL1, COL2, MARGIN);
  }

  // ── PAGE 2: Agreement (exact docx content, client data injected) ──────────
  doc.addPage();
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");

  if (logoB64?.data) {
    const logoAspect = logoB64.width / logoB64.height;
    const logoH = 13;
    const logoW = logoH * logoAspect;
    doc.addImage(logoB64.data, "JPEG", PAGE_W - MARGIN - logoW, MARGIN, logoW, logoH, undefined, "FAST");
  }

  y = MARGIN + 20;

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...MINT_PURPLE);
  for (const line of doc.splitTextToSize(
    "CLIENT SECURITIES ADMINISTRATION AND NOMINEE APPOINTMENT AGREEMENT",
    PAGE_W - MARGIN * 2,
  )) {
    doc.text(line, (PAGE_W - doc.getTextWidth(line)) / 2, y);
    y += 6;
  }
  y += 4;

  // Parties block
  doc.setFontSize(9);
  doc.setTextColor(40, 40, 40);
  const parties = [
    ["Between", true],
    ["", false],
    ["Mint Platforms (Pty) Ltd, trading as Mint", true],
    ['Registration Number: 2024/644796/07 ("Mint")', false],
    ["", false],
    ["and", true],
    ["", false],
    [fullName, true],
    [`ID / Registration Number: ${resolvedId}`, false],
    [address, false],
    ['("Client")', false],
  ];
  for (const [line, bold] of parties) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    const lw = line ? doc.getTextWidth(line) : 0;
    doc.text(line, (PAGE_W - lw) / 2, y);
    y += line === "" ? 3 : 5;
  }
  y += 6;

  const bold = (...args) => { doc.setFont("helvetica", "bold"); doc.setFontSize(args[0] || 9.5); };
  const norm = (...args) => { doc.setFont("helvetica", "normal"); doc.setFontSize(args[0] || 8.5); };
  const color = (r, g, b) => doc.setTextColor(r, g, b);

  const writePara = (text, indent = 0) => {
    norm(8.5); color(40, 40, 40);
    for (const line of doc.splitTextToSize(text, PAGE_W - MARGIN * 2 - indent)) {
      y = needsNewPage(doc, y, 5.5);
      doc.text(line, MARGIN + indent, y);
      y += 4.5;
    }
    y += 1;
  };

  const writeHeading = (text) => {
    y = needsNewPage(doc, y, 12);
    bold(9.5); color(...MINT_PURPLE);
    doc.text(text, MARGIN, y);
    y += 6;
  };

  const writeBullet = (text) => {
    norm(8.5); color(40, 40, 40);
    const indent = 8;
    const lines = doc.splitTextToSize(`• ${text}`, PAGE_W - MARGIN * 2 - indent);
    for (const line of lines) {
      y = needsNewPage(doc, y, 5.5);
      doc.text(line, MARGIN + indent, y);
      y += 4.5;
    }
  };

  writeHeading("1. APPOINTMENT");
  writePara(`The Client hereby appoints Mint Platforms (Pty) Ltd, trading as Mint ("Mint"), to act as its authorised securities administrator for purposes of facilitating the custody, administration and record-keeping of securities held by the Client.`);
  writePara(`The Client further authorises Mint to facilitate the opening and maintenance of an account in the Client's name with an appointed nominee custodian, or its affiliated companies, acting as nominee and custodian, for the purpose of holding and administering securities on behalf of the Client.`);
  writePara("Mint is authorised to:");
  writePara("1.1  Facilitate the opening and administration of the Client's securities account with the appointed nominee custodian, including the submission of all required documentation and client information.", 4);
  writePara("1.2  Administer, record, and facilitate the holding of securities beneficially owned by the Client through the nominee and custody structure.", 4);
  writePara("1.3  Interface and communicate with relevant transfer secretaries, custodians, central securities depositories, settlement agents, and registry service providers in order to give effect to the Client's investment holdings.", 4);
  writePara("1.4  Provide relevant client and investment information, instructions, and documentation to Strate, the appointed nominee custodian, and any related service providers for the purposes of securities settlement, custody administration, and registry maintenance.", 4);

  writeHeading("2. NOMINEE AND UNDERLYING ACCOUNT ARRANGEMENTS");
  writePara("2.1  The Client acknowledges that securities acquired through Mint may be held through:", 4);
  writeBullet("a nominee structure, or");
  writeBullet("underlying accounts opened in the Client's name with a custodian or registry service provider.");
  y += 2;
  writePara("2.2  Where required by the relevant service provider, Mint is authorised to facilitate the opening of such underlying accounts in the Client's name for purposes of recording ownership of securities.", 4);
  writePara("2.3  The Client consents to Mint providing the Client's information to relevant service providers for the purpose of establishing such accounts.", 4);

  writeHeading("3. RECORD OF OWNERSHIP");
  writePara("3.1  The Client remains the beneficial owner of any securities purchased or held through Mint.", 4);
  writePara("3.2  Mint will maintain internal records reflecting the Client's beneficial ownership of securities.", 4);
  writePara("3.3  Official registry records may be maintained by a transfer secretary or registry provider as required under applicable market infrastructure rules.", 4);

  writeHeading("4. CLIENT INSTRUCTIONS");
  writePara("4.1  Mint will act on instructions provided by the Client regarding:", 4);
  writeBullet("subscriptions");
  writeBullet("transfers");
  writeBullet("disposals");
  writeBullet("corporate actions");
  writeBullet("other administrative matters relating to the Client's securities.");
  y += 2;
  writePara("4.2  Instructions may be provided through electronic platforms, written instruction, or other communication channels approved by Mint.", 4);

  writeHeading("5. INFORMATION SHARING");
  writePara("5.1  The Client authorises Mint to provide relevant client information and investment details to third-party service providers including but not limited to:", 4);
  writeBullet("custodians");
  writeBullet("transfer secretaries");
  writeBullet("registry service providers");
  writeBullet("settlement agents");
  y += 1;
  writePara("for the purpose of administering the Client's securities holdings.");
  writePara("5.2  Such information will be shared solely for the purposes of facilitating the Client's investments.", 4);

  writeHeading("6. TERM");
  writePara("This Agreement shall commence on the date of signature and remain in effect until terminated by either party upon written notice.");

  writeHeading("7. GOVERNING LAW");
  writePara("This Agreement shall be governed by and interpreted in accordance with the laws of the Republic of South Africa.");

  y = needsNewPage(doc, y, 70);
  writeHeading("8. SIGNATURES");

  const { day, month, year } = todayParts();
  norm(8.5); color(40, 40, 40);
  doc.text(`Signed at MINT PLATFORMS on this ${day} day of ${month} 20${year}.`, MARGIN, y);
  y += 10;

  const colW = (PAGE_W - MARGIN * 2 - 10) / 2;
  const cx = MARGIN + colW + 10;

  bold(8.5); color(40, 40, 40);
  doc.text("For and on behalf of Mint Platforms (Pty) Ltd", MARGIN, y);
  norm(8.5);
  doc.text("Name: Lonwabo Damane", MARGIN, y + 5);
  doc.text("Title: Chief Executive Officer", MARGIN, y + 10);
  if (ceoSigB64?.data && ceoSigB64.width > 0) {
    const aspect = ceoSigB64.width / ceoSigB64.height;
    const maxH = 22;
    const maxW = colW;
    let h = 18;
    let w = h * aspect;
    if (w > maxW) { w = maxW; h = w / aspect; }
    if (h > maxH) { h = maxH; w = h * aspect; }
    doc.addImage(ceoSigB64.data, "PNG", MARGIN, y + 12, w, h, undefined, "FAST");
  }
  doc.setDrawColor(100, 100, 100); doc.setLineWidth(0.3);
  doc.line(MARGIN, y + 32, MARGIN + colW, y + 32);
  doc.setFontSize(7.5); color(120, 120, 120);
  doc.text("Authorised Signatory", MARGIN, y + 36);

  bold(8.5); color(40, 40, 40);
  doc.text("For and on behalf of the Client", cx, y);
  norm(8.5);
  doc.text(`Name: ${fullName}`, cx, y + 5);
  doc.text(`ID: ${resolvedId}`, cx, y + 10);

  if (signatureDataUrl) {
    const userSig = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.onerror = () => resolve(null);
      img.src = signatureDataUrl;
    });

    if (userSig && userSig.width > 0) {
      const aspect = userSig.width / userSig.height;
      const maxH = 22;
      const maxW = colW;
      let h = 18;
      let w = h * aspect;
      if (w > maxW) { w = maxW; h = w / aspect; }
      if (h > maxH) { h = maxH; w = h * aspect; }
      doc.addImage(signatureDataUrl, "PNG", cx, y + 12, w, h, undefined, "FAST");
    } else {
      doc.addImage(signatureDataUrl, "PNG", cx, y + 12, colW, 18, undefined, "FAST");
    }
  }

  doc.setDrawColor(100, 100, 100); doc.setLineWidth(0.3);
  doc.line(cx, y + 32, cx + colW, y + 32);

  bold(7.5); color(60, 60, 60);
  doc.text(`Date Signed: ${formatDateLong(signedAt)}`, cx, y + 37);
  norm(7.5); color(100, 100, 100);
  doc.text(`Date Downloaded: ${formatDateLong(downloadedAt)}`, cx, y + 42);

  y += 54;

  y = needsNewPage(doc, y, 30);
  doc.setFillColor(248, 246, 252);
  doc.setDrawColor(200, 190, 220);
  doc.setLineWidth(0.3);
  doc.roundedRect(MARGIN, y, PAGE_W - MARGIN * 2, 26, 2, 2, "FD");
  bold(7.5); color(...MINT_PURPLE);
  doc.text("ELECTRONIC SIGNATURE AUDIT TRAIL", MARGIN + 4, y + 5);
  norm(7); color(80, 80, 80);
  doc.text(`Signed by:         ${fullName} (ID: ${resolvedId})`, MARGIN + 4, y + 10);
  doc.text(`Signed at (UTC):   ${new Date(signedAt).toISOString()}`, MARGIN + 4, y + 15);
  doc.text(`Downloaded (UTC):  ${new Date(downloadedAt).toISOString()}`, MARGIN + 4, y + 20);

  drawFooters(doc, signedAt, downloadedAt);

  return doc.output("arraybuffer");
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AccountAgreementStep({
  profile,
  onboardingData = {},
  existingOnboardingId,
  onBack,
  onComplete,
}) {
  const {
    bankName = "", bankAccountNumber = "", bankBranchCode = "",
    taxNumber = "", identityNumber = "",
    sourceOfFunds = "", sourceOfFundsOther = "",
    expectedMonthlyInvestment = "",
    bankAccountType = "SAVINGS",
  } = onboardingData;

  const [phase, setPhase] = useState("review");
  const [error, setError] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [signedAt, setSignedAt] = useState(null);
  const [downloadedAt, setDownloadedAt] = useState(null);
  const [packDetail, setPackDetail] = useState(null);
  const [fetchedOnboarding, setFetchedOnboarding] = useState({});

  const canvasRef = useRef(null);
  const sigPadRef = useRef(null);
  const signatureDataUrlRef = useRef(null);
  const [sigEmpty, setSigEmpty] = useState(true);

  // ── fetch latest onboarding & pack details ────────────────────────────────
  useEffect(() => {
    async function getAllData() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user?.id) return;
        const uid = session.user.id;

        const { data: pdData } = await supabase
          .from("user_onboarding_pack_details")
          .select("pack_details")
          .eq("user_id", uid)
          .maybeSingle();
        if (pdData?.pack_details) setPackDetail(pdData.pack_details);

        const { data: obData } = await supabase
          .from("user_onboarding")
          .select("bank_name, bank_account_number, bank_branch_code, sumsub_raw")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (obData) {
          let raw = {};
          try { raw = typeof obData.sumsub_raw === "string" ? JSON.parse(obData.sumsub_raw) : (obData.sumsub_raw || {}); } catch { }
          setFetchedOnboarding({
            bankName: obData.bank_name,
            bankAccountNumber: obData.bank_account_number,
            bankBranchCode: obData.bank_branch_code,
            bankAccountName: raw.bank_details?.bank_account_name,
            bankAccountType: raw.bank_details?.bank_account_type,
            taxNumber: raw.tax_details?.tax_number,
            identityNumber: raw.identity_details?.identity_number,
            ...raw.source_of_funds_details,
          });
        }
      } catch (e) { console.warn("Failed to fetch onboarding data:", e); }
    }
    getAllData();
  }, []);

  // ── derive client info ────────────────────────────────────────────────────
  const pd = packDetail?.info || {};
  const pdFullName = (pd.firstNameEn && pd.lastNameEn) ? `${pd.firstNameEn} ${pd.lastNameEn}` : (pd.firstName && pd.lastName ? `${pd.firstName} ${pd.lastName}` : "");
  const pdIdDoc = Array.isArray(pd.idDocs) ? pd.idDocs.find(d => d.number && (d.idDocType === "ID_CARD" || d.idDocType === "PASSPORT" || d.idDocType === "DRIVERS")) : null;
  const pdTaxDoc = Array.isArray(pd.idDocs) ? pd.idDocs.find(d => {
    if (!d.number) return false;
    const type = d.idDocType || "";
    return type === "TIN" || type === "TAX_ID" || (typeof type === "string" && type.includes("TAX"));
  }) : null;

  const pdIdNumber = pdIdDoc?.number || "";
  const pdTaxNumber = pdTaxDoc?.number || "";

  const pdAddress = (() => {
    if (Array.isArray(pd.addresses) && pd.addresses.length > 0) {
      const a = pd.addresses[0];
      return [a.street, a.town, a.state, a.postCode, a.country].filter(Boolean).join(", ");
    }
    return "";
  })();

  const fullName = pdFullName || [profile?.first_name || profile?.firstName, profile?.last_name || profile?.lastName]
    .filter(Boolean).join(" ") || profile?.full_name || "—";
  const address = pdAddress || profile?.address || profile?.physical_address || "—";
  const email = packDetail?.email || profile?.email || "—";
  const cell = packDetail?.phone || profile?.cell_number || profile?.phone || "—";
  const resolvedId = pdIdNumber || fetchedOnboarding.identityNumber || onboardingData?.identityNumber || "—";

  const effectiveBankName = bankName || fetchedOnboarding.bankName || "";
  const effectiveBankAcc = bankAccountNumber || fetchedOnboarding.bankAccountNumber || "";
  const effectiveBankBranch = bankBranchCode || fetchedOnboarding.bankBranchCode || "";
  const effectiveBankType = bankAccountType || fetchedOnboarding.bankAccountType || "SAVINGS";

  const taxNo = pdTaxNumber || taxNumber || fetchedOnboarding.taxNumber || profile?.tax_number || "—";

  const sourceLabel = (sourceOfFunds || fetchedOnboarding.source_of_funds) === "other"
    ? `Other: ${sourceOfFundsOther || fetchedOnboarding.source_of_funds_other || "—"}`
    : String(sourceOfFunds || fetchedOnboarding.source_of_funds || "—").replace(/_/g, " ");

  const resolvedMonthly = expectedMonthlyInvestment || fetchedOnboarding.expected_monthly_investment || "";

  // ── signature pad ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "sign" || !canvasRef.current) return;
    const canvas = canvasRef.current;

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
      penColor: "rgb(20,20,20)",
      minWidth: 1.5, maxWidth: 3,
    });
    sigPadRef.current.addEventListener("endStroke", () => setSigEmpty(sigPadRef.current.isEmpty()));

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [phase]);

  const clearSignature = useCallback(() => { sigPadRef.current?.clear(); setSigEmpty(true); }, []);

  // ── sign & save ───────────────────────────────────────────────────────────
  const handleSign = async () => {
    if (!sigPadRef.current || sigPadRef.current.isEmpty()) {
      setError("Please draw your signature before continuing.");
      return;
    }
    setError("");
    setPhase("processing");

    try {
      const sigDataUrl = sigPadRef.current.toDataURL("image/png");
      signatureDataUrlRef.current = sigDataUrl;

      const now = new Date().toISOString();
      setSignedAt(now);
      setDownloadedAt(now);

      const pdfBuffer = await buildPDF({
        profile,
        onboardingData: {
          ...onboardingData,
          bankName: effectiveBankName,
          bankAccountNumber: effectiveBankAcc,
          bankBranchCode: effectiveBankBranch,
          bankAccountType: effectiveBankType,
          taxNumber: taxNo,
          identityNumber: resolvedId,
        },
        packDetail,
        signatureDataUrl: sigDataUrl,
        signedAt: now, downloadedAt: now,
      });

      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error("Not authenticated.");

      let publicUrl = "";
      try {
        const token = session?.access_token;
        if (token) {
          // Efficient base64 encoding (handles large PDFs safely with chunking)
          const uint8 = new Uint8Array(pdfBuffer);
          const chunkSize = 8192;
          let binaryString = "";
          for (let i = 0; i < uint8.length; i += chunkSize) {
            binaryString += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
          }
          const pdfBase64 = btoa(binaryString);
          const uploadRes = await fetch("/api/onboarding/upload-agreement", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ pdfBase64 }),
          });
          if (uploadRes.ok) {
            const uploadJson = await uploadRes.json();
            publicUrl = uploadJson.publicUrl || "";
          }
        }
      } catch (storageErr) {
        console.warn("PDF storage skipped:", storageErr?.message);
      }

      if (!publicUrl) {
        throw new Error("Failed to upload agreement. Please check your connection and try again.");
      }

      setPdfUrl(publicUrl);

      // ── FIX: save ALL completion flags + URL atomically ──────────────────
      try {
        // Use the specific onboarding ID if available, fallback to latest for this user
        const recordId = existingOnboardingId;

        // Try to use existing record if we have the ID to avoid SELECT query
        let existing = null;
        if (recordId) {
          existing = { id: recordId };
        } else {
          // Only query if we don't have the ID
          const { data: records } = await supabase
            .from("user_onboarding")
            .select("id, sumsub_raw")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(1);
          existing = records?.[0];
        }

        const targetId = existing?.id || recordId;

        let raw = {};
        if (existing?.sumsub_raw) {
          raw = typeof existing.sumsub_raw === "string" ? JSON.parse(existing.sumsub_raw) : existing.sumsub_raw;
        }
        // Stamp all prior step flags (reaching signing = all prior steps done)
        raw.tax_details_saved = raw.tax_details_saved || true;
        raw.bank_details_saved = raw.bank_details_saved || true;
        raw.mandate_accepted = raw.mandate_accepted || true;
        raw.risk_disclosure_accepted = raw.risk_disclosure_accepted || true;
        raw.source_of_funds_accepted = raw.source_of_funds_accepted || true;
        raw.terms_accepted = raw.terms_accepted || true;
        // ── FIX: explicitly stamp account_agreement_signed ───────────────
        raw.account_agreement_signed = true;
        raw.signed_at = now;
        raw.downloaded_at = now;
        raw.signed_agreement_url = publicUrl;

        const updatePayload = {
          kyc_status: "onboarding_complete",
          sumsub_raw: JSON.stringify(raw),
        };

        if (targetId) {
          await supabase
            .from("user_onboarding")
            .update(updatePayload)
            .eq("id", targetId);
        } else {
          // Fallback if no record found
          await supabase
            .from("user_onboarding")
            .insert({ ...updatePayload, user_id: userId, employment_status: "not_provided" });
        }
      } catch (dbErr) {
        console.warn("Onboarding DB update failed (non-critical):", dbErr?.message);
        // Last-resort minimal update — ensure signed_at is included
        try {
          await supabase.from("user_onboarding").update({
            kyc_status: "onboarding_complete",
          }).eq("user_id", userId);
        } catch (e) {
          console.error("[AccountAgreementStep] Fallback DB update also failed:", e?.message);
        }
      }

      setPhase("success");

      if (onComplete) {
        try {
          await onComplete({
            signed_agreement_url: publicUrl,
            signed_at: now,
            downloaded_at: now,
          });
        } catch (completeErr) {
          console.error("onComplete error:", completeErr);
        }
      }
    } catch (err) {
      console.error("Sign error:", err);
      setError(err?.message || "Something went wrong. Please try again.");
      setPhase("sign");
    }
  };

  // ── download — re-stamps downloadedAt each click ──────────────────────────
  const handleDownload = async () => {
    if (!signatureDataUrlRef.current || !signedAt) return;
    const dlNow = new Date().toISOString();
    setDownloadedAt(dlNow);

    const pdfBuffer = await buildPDF({
      profile,
      onboardingData: {
        ...onboardingData,
        bankName: effectiveBankName,
        bankAccountNumber: effectiveBankAcc,
        bankBranchCode: effectiveBankBranch,
        bankAccountType: effectiveBankType,
        taxNumber: taxNo,
        identityNumber: resolvedId,
      },
      packDetail,
      signatureDataUrl: signatureDataUrlRef.current,
      signedAt, downloadedAt: dlNow,
    });

    const blob = new Blob([pdfBuffer], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mint-agreement-${new Date(dlNow).toISOString().slice(0, 10)}.pdf`;
    a.click();
    URL.revokeObjectURL(url);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (userId) {
        await supabase.from("user_onboarding").update({
          downloaded_at: dlNow,
        }).eq("user_id", userId);
      }
    } catch (e) { console.warn("Could not persist downloaded_at:", e); }
  };

  // ── theme ─────────────────────────────────────────────────────────────────
  const purple = "hsl(270 30% 25%)";
  const purpleMid = "hsl(270 20% 50%)";
  const purpleLight = "hsl(270 15% 60%)";
  const purplePale = "hsl(270 20% 96%)";
  const purpleBorder = "hsl(270 20% 88%)";
  const mintAccent = "hsl(270 50% 55%)";

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE: REVIEW
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === "review") {
    const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "—");
    const reviewRows = [
      { label: "Full Name", value: fullName },
      { label: "ID / Reg Number", value: resolvedId },
      { label: "Income Tax Number", value: taxNo },
      { label: "Email Address", value: email },
      { label: "Cell Number", value: cell },
      { label: "Physical Address", value: address },
      { label: "Bank Name", value: String(effectiveBankName || "—").replace(/_/g, " ").toUpperCase() },
      { label: "Account Number", value: effectiveBankAcc || "—" },
      { label: "Branch Code", value: effectiveBankBranch || "—" },
      { label: "Account Type", value: capitalize(effectiveBankType) },
      { label: "Source of Funds", value: sourceLabel },
      { label: "Monthly Investment", value: String(resolvedMonthly || "—").replace(/_/g, " ") },
    ];

    return (
      <div className="w-full max-w-2xl mx-auto">
        <div className="text-center mb-8 animate-fade-in delay-1">
          <p className="text-xs uppercase tracking-[0.2em] mb-2" style={{ color: purpleMid }}>
            Step 9 of 9
          </p>
          <div style={{
            width: 56, height: 56, borderRadius: "50%", margin: "0 auto 16px",
            background: "linear-gradient(135deg, hsl(270 50% 55%) 0%, hsl(270 40% 40%) 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" width={28} height={28}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <h2 className="text-3xl font-light tracking-tight mb-2" style={{ color: purple }}>
            Review Your Details
          </h2>
          <p className="text-sm" style={{ color: purpleMid }}>
            Confirm your information is correct before signing the agreement
          </p>
        </div>

        <div className="progress-bar animate-fade-in delay-1">
          {[...Array(9)].map((_, i) => (
            <div key={i} className="progress-step active" />
          ))}
        </div>

        <div className="animate-fade-in delay-2" style={{
          background: "white", border: `1px solid ${purpleBorder}`,
          borderRadius: 16, overflow: "hidden",
          boxShadow: "0 4px 24px rgba(83,47,126,0.08)", marginBottom: 20,
        }}>
          <div style={{
            padding: "14px 20px", borderBottom: `1px solid ${purpleBorder}`,
            display: "flex", alignItems: "center", gap: 8, background: purplePale,
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke={mintAccent} strokeWidth="1.5" width={16} height={16}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 600, color: purple, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Your Account Information
            </span>
          </div>

          {reviewRows.map((row, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "160px 1fr",
              borderBottom: i < reviewRows.length - 1 ? `1px solid ${purpleBorder}` : "none",
              minHeight: 44,
            }}>
              <div style={{
                padding: "12px 16px", fontSize: 11, fontWeight: 600, color: purpleMid,
                textTransform: "uppercase", letterSpacing: "0.05em",
                borderRight: `1px solid ${purpleBorder}`, display: "flex", alignItems: "center",
                background: i % 2 === 0 ? purplePale : "white",
              }}>
                {row.label}
              </div>
              <div style={{
                padding: "12px 16px", fontSize: 13.5, fontWeight: 500,
                color: row.value === "—" ? "#bbb" : purple,
                display: "flex", alignItems: "center",
                background: i % 2 === 0 ? "hsl(270 10% 99%)" : "white",
                whiteSpace: "pre-line", wordBreak: "break-word",
              }}>
                {row.value}
              </div>
            </div>
          ))}
        </div>

        <div className="animate-fade-in delay-3" style={{
          background: "hsl(270 50% 97%)", border: `1px solid hsl(270 40% 88%)`,
          borderRadius: 12, padding: "14px 18px", display: "flex", gap: 12, marginBottom: 28,
        }}>
          <svg viewBox="0 0 24 24" fill="none" stroke={mintAccent} strokeWidth="1.5" width={20} height={20} style={{ flexShrink: 0, marginTop: 1 }}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
          </svg>
          <div>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: purple, marginBottom: 4 }}>
              Client Securities Administration &amp; Nominee Appointment Agreement
            </p>
            <p style={{ margin: 0, fontSize: 11.5, color: purpleMid, lineHeight: 1.6 }}>
              On the next screen you will read the full agreement with your details already filled in,
              then draw your signature. The signed PDF will record your <strong>date signed</strong> and{" "}
              <strong>date downloaded</strong> on every page.
            </p>
          </div>
        </div>

        <div className="text-center animate-fade-in delay-4">
          <button type="button" className="continue-button agreement-continue enabled" onClick={() => setPhase("sign")}>
            Proceed to Sign Agreement
          </button>
        </div>
        <p className="text-xs text-center mt-4 animate-fade-in delay-4" style={{ color: purpleLight }}>
          Step 9 of 9 — Final step
        </p>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE: SIGN
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === "sign") {
    const { day, month, year } = todayParts();

    return (
      <div className="w-full max-w-3xl mx-auto">
        <div className="text-center mb-6 animate-fade-in delay-1">
          <p className="text-xs uppercase tracking-[0.2em] mb-2" style={{ color: purpleMid }}>
            Step 9 of 9
          </p>
          <h2 className="text-3xl font-light tracking-tight mb-1" style={{ color: purple }}>
            Sign Your Agreement
          </h2>
          <p className="text-sm" style={{ color: purpleMid }}>
            Read the agreement below, then draw your signature to complete onboarding
          </p>
        </div>

        <div className="animate-fade-in delay-2" style={{
          background: "white", border: `1px solid ${purpleBorder}`,
          borderRadius: 16, overflow: "hidden",
          boxShadow: "0 4px 24px rgba(83,47,126,0.08)", marginBottom: 24,
        }}>
          <div style={{
            padding: "16px 24px", borderBottom: `1px solid ${purpleBorder}`,
            background: purplePale, display: "flex", alignItems: "center", gap: 10,
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke={mintAccent} strokeWidth="1.5" width={18} height={18}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
            <span style={{ fontSize: 11, fontWeight: 700, color: purple, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Client Securities Administration and Nominee Appointment Agreement
            </span>
          </div>

          <div style={{ padding: "24px 28px", maxHeight: 480, overflowY: "auto", fontSize: 13, lineHeight: 1.7, color: "#222" }}>
            <p style={{ textAlign: "center", marginBottom: 16 }}><strong>Between</strong></p>
            <p style={{ textAlign: "center", marginBottom: 4 }}>
              <strong>Mint Platforms (Pty) Ltd</strong>, trading as <strong>Mint</strong><br />
              Registration Number: 2024/644796/07<br />
              (&quot;Mint&quot;)
            </p>
            <p style={{ textAlign: "center", margin: "12px 0" }}>and</p>
            <div style={{
              textAlign: "center", marginBottom: 24,
              padding: "12px 20px", borderRadius: 10,
              background: "hsl(270 50% 97%)", border: `1px solid hsl(270 40% 88%)`,
            }}>
              <strong style={{ fontSize: 14, color: purple }}>{fullName}</strong><br />
              <span style={{ fontSize: 12, color: purpleMid }}>
                ID / Registration Number: {identityNumber || "—"}<br />
                {address}<br />
              </span>
              <span style={{ fontSize: 12 }}>(&quot;Client&quot;)</span>
            </div>

            <hr style={{ border: "none", borderTop: `1px solid ${purpleBorder}`, margin: "20px 0" }} />

            <p><strong style={{ color: purple }}>1. APPOINTMENT</strong></p>
            <p>The Client hereby appoints <strong>Mint Platforms (Pty) Ltd, trading as Mint (&quot;Mint&quot;)</strong>, to act as its authorised securities administrator for purposes of facilitating the custody, administration and record-keeping of securities held by the Client.</p>
            <p>The Client further authorises Mint to facilitate the opening and maintenance of an account in the Client&apos;s name with <strong>an appointed nominee custodian</strong>, or its affiliated companies, acting as nominee and custodian, for the purpose of holding and administering securities on behalf of the Client.</p>
            <p>Mint is authorised to:</p>
            <p style={{ paddingLeft: 16 }}><strong>1.1</strong> Facilitate the opening and administration of the Client&apos;s securities account with <strong>the appointed nominee custodian</strong>, including the submission of all required documentation and client information.</p>
            <p style={{ paddingLeft: 16 }}><strong>1.2</strong> Administer, record, and facilitate the holding of securities beneficially owned by the Client through the nominee and custody structure.</p>
            <p style={{ paddingLeft: 16 }}><strong>1.3</strong> Interface and communicate with relevant transfer secretaries, custodians, central securities depositories, settlement agents, and registry service providers in order to give effect to the Client&apos;s investment holdings.</p>
            <p style={{ paddingLeft: 16 }}><strong>1.4</strong> Provide relevant client and investment information, instructions, and documentation to <strong>Strate</strong>, <strong>the appointed nominee custodian</strong>, and any related service providers for the purposes of securities settlement, custody administration, and registry maintenance.</p>

            <p><strong style={{ color: purple }}>2. NOMINEE AND UNDERLYING ACCOUNT ARRANGEMENTS</strong></p>
            <p style={{ paddingLeft: 16 }}><strong>2.1</strong> The Client acknowledges that securities acquired through Mint may be held through:</p>
            <ul style={{ paddingLeft: 32 }}>
              <li>a <strong>nominee structure</strong>, or</li>
              <li><strong>underlying accounts opened in the Client&apos;s name</strong> with a custodian or registry service provider.</li>
            </ul>
            <p style={{ paddingLeft: 16 }}><strong>2.2</strong> Where required by the relevant service provider, Mint is authorised to facilitate the opening of such underlying accounts in the Client&apos;s name for purposes of recording ownership of securities.</p>
            <p style={{ paddingLeft: 16 }}><strong>2.3</strong> The Client consents to Mint providing the Client&apos;s information to relevant service providers for the purpose of establishing such accounts.</p>

            <p><strong style={{ color: purple }}>3. RECORD OF OWNERSHIP</strong></p>
            <p style={{ paddingLeft: 16 }}><strong>3.1</strong> The Client remains the <strong>beneficial owner</strong> of any securities purchased or held through Mint.</p>
            <p style={{ paddingLeft: 16 }}><strong>3.2</strong> Mint will maintain internal records reflecting the Client&apos;s beneficial ownership of securities.</p>
            <p style={{ paddingLeft: 16 }}><strong>3.3</strong> Official registry records may be maintained by a transfer secretary or registry provider as required under applicable market infrastructure rules.</p>

            <p><strong style={{ color: purple }}>4. CLIENT INSTRUCTIONS</strong></p>
            <p style={{ paddingLeft: 16 }}><strong>4.1</strong> Mint will act on instructions provided by the Client regarding:</p>
            <ul style={{ paddingLeft: 32 }}>
              <li>subscriptions</li><li>transfers</li><li>disposals</li>
              <li>corporate actions</li>
              <li>other administrative matters relating to the Client&apos;s securities.</li>
            </ul>
            <p style={{ paddingLeft: 16 }}><strong>4.2</strong> Instructions may be provided through electronic platforms, written instruction, or other communication channels approved by Mint.</p>

            <p><strong style={{ color: purple }}>5. INFORMATION SHARING</strong></p>
            <p style={{ paddingLeft: 16 }}><strong>5.1</strong> The Client authorises Mint to provide relevant client information and investment details to third-party service providers including but not limited to:</p>
            <ul style={{ paddingLeft: 32 }}>
              <li>custodians</li><li>transfer secretaries</li>
              <li>registry service providers</li><li>settlement agents</li>
            </ul>
            <p>for the purpose of administering the Client&apos;s securities holdings.</p>
            <p style={{ paddingLeft: 16 }}><strong>5.2</strong> Such information will be shared solely for the purposes of facilitating the Client&apos;s investments.</p>

            <p><strong style={{ color: purple }}>6. TERM</strong></p>
            <p>This Agreement shall commence on the date of signature and remain in effect until terminated by either party upon written notice.</p>

            <p><strong style={{ color: purple }}>7. GOVERNING LAW</strong></p>
            <p>This Agreement shall be governed by and interpreted in accordance with the laws of the <strong>Republic of South Africa</strong>.</p>

            <p><strong style={{ color: purple }}>8. SIGNATURES</strong></p>
            <p>Signed at <strong>MINT PLATFORMS</strong> on this <strong>{day}</strong> day of <strong>{month}</strong> 20<strong>{year}</strong>.</p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 16 }}>
              <div style={{ borderTop: `2px solid ${purpleBorder}`, paddingTop: 10 }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>For and on behalf of Mint Platforms (Pty) Ltd</p>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: purpleMid }}>Name: Lonwabo Damane</p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: purpleMid }}>Title: Chief Executive Officer</p>
              </div>
              <div style={{ borderTop: `2px solid ${purpleBorder}`, paddingTop: 10 }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>For and on behalf of the Client</p>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: purpleMid }}>Name: <strong style={{ color: purple }}>{fullName}</strong></p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: purpleMid }}>ID: {identityNumber || "—"}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Signature pad */}
        <div className="animate-fade-in delay-3" style={{
          background: "white", border: `2px dashed ${purpleBorder}`,
          borderRadius: 16, overflow: "hidden", marginBottom: 16, position: "relative",
        }}>
          <div style={{
            padding: "10px 16px", borderBottom: `1px solid ${purpleBorder}`,
            display: "flex", justifyContent: "space-between", alignItems: "center",
            background: purplePale,
          }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: purpleMid, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Signature of {fullName}
            </span>
            <button type="button" onClick={clearSignature} style={{
              fontSize: 11, color: purpleMid, background: "none", border: "none",
              cursor: "pointer", padding: "2px 8px", borderRadius: 6, fontFamily: "inherit",
            }}>Clear</button>
          </div>

          {sigEmpty && (
            <div style={{
              position: "absolute", top: "55%", left: "50%",
              transform: "translate(-50%,-50%)", pointerEvents: "none", textAlign: "center",
            }}>
              <svg viewBox="0 0 24 24" fill="none" stroke={purpleBorder} strokeWidth="1" width={32} height={32} style={{ margin: "0 auto 6px" }}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
              </svg>
              <p style={{ fontSize: 12, color: purpleBorder, margin: 0 }}>Draw your signature here</p>
            </div>
          )}

          <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: 160, cursor: "crosshair", touchAction: "none" }} />
        </div>

        <div className="animate-fade-in delay-3" style={{
          display: "flex", gap: 8, marginBottom: 20,
          padding: "10px 14px", borderRadius: 8,
          background: "hsl(270 50% 98%)", border: `1px solid ${purpleBorder}`,
        }}>
          <svg viewBox="0 0 24 24" fill="none" stroke={mintAccent} strokeWidth="1.5" width={14} height={14} style={{ flexShrink: 0, marginTop: 1 }}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
          </svg>
          <p style={{ margin: 0, fontSize: 11, color: purpleMid, lineHeight: 1.5 }}>
            By drawing your signature you confirm that you have read and agree to the Client Securities Administration
            and Nominee Appointment Agreement. This constitutes a legally binding electronic signature. The date signed
            and date downloaded will be recorded on every page of the PDF.
          </p>
        </div>

        {error && <p className="form-error" role="alert" style={{ textAlign: "center", marginBottom: 12 }}>{error}</p>}

        <div className="text-center animate-fade-in delay-4">
          <button
            type="button"
            className={`continue-button agreement-continue ${!sigEmpty ? "enabled" : ""}`}
            disabled={sigEmpty}
            onClick={handleSign}
          >
            Sign &amp; Complete Onboarding
          </button>
        </div>

        <div className="text-center mt-3">
          <button type="button" onClick={() => setPhase("review")} style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 12, color: purpleLight, fontFamily: "inherit", textDecoration: "underline",
          }}>
            ← Back to review
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE: PROCESSING
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === "processing") {
    return (
      <div className="w-full max-w-md mx-auto text-center" style={{ paddingTop: 60 }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{
          width: 64, height: 64, borderRadius: "50%", margin: "0 auto 24px",
          border: `3px solid ${purpleBorder}`, borderTopColor: mintAccent,
          animation: "spin 0.8s linear infinite",
        }} />
        <h2 className="text-2xl font-light mb-2" style={{ color: purple }}>Generating your agreement…</h2>
        <p className="text-sm" style={{ color: purpleMid }}>Building signed PDF and saving securely</p>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE: SUCCESS
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === "success") {
    return (
      <div className="w-full max-w-md mx-auto text-center animate-fade-in" style={{ paddingTop: 40 }}>
        <div style={{
          width: 80, height: 80, borderRadius: "50%", margin: "0 auto 24px",
          background: "linear-gradient(135deg, hsl(152 70% 45%) 0%, hsl(152 60% 35%) 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 8px 32px rgba(16,185,129,0.3)",
        }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" width={40} height={40}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </div>

        <h2 className="text-3xl font-light tracking-tight mb-3" style={{ color: purple }}>Onboarding Complete</h2>
        <p className="text-sm mb-6" style={{ color: purpleMid, lineHeight: 1.6 }}>
          Your agreement has been signed and saved. Welcome to <span className="mint-brand">MINT</span>.
        </p>

        <div style={{
          background: purplePale, border: `1px solid ${purpleBorder}`,
          borderRadius: 12, padding: "14px 20px", marginBottom: 24, textAlign: "left",
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: purpleMid, textTransform: "uppercase", letterSpacing: "0.06em" }}>Date Signed</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: purple }}>{signedAt ? formatDateLong(signedAt) : "—"}</span>
            </div>
            <div style={{ borderTop: `1px solid ${purpleBorder}` }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: purpleMid, textTransform: "uppercase", letterSpacing: "0.06em" }}>Date Downloaded</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: purple }}>{downloadedAt ? formatDateLong(downloadedAt) : "—"}</span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28, alignItems: "center" }}>
          {["Identity verified", "Bank details saved", "Agreement signed", pdfUrl ? "PDF saved to your account" : "PDF ready to download"].map((item) => (
            <div key={item} style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "6px 16px", borderRadius: 999,
              background: "hsl(152 80% 95%)", color: "hsl(152 60% 28%)",
              fontSize: 13, fontWeight: 500,
            }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width={14} height={14}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              {item}
            </div>
          ))}
        </div>

        <div style={{ marginBottom: 28 }}>
          <button type="button" onClick={handleDownload} style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "11px 22px", borderRadius: 10,
            background: purplePale, border: `1px solid ${purpleBorder}`,
            color: purple, fontSize: 13, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit",
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width={16} height={16}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download Signed Agreement
          </button>
          <p style={{ margin: "6px 0 0", fontSize: 11, color: purpleLight }}>
            Each download records a fresh date downloaded on the PDF
          </p>
        </div>

        <button
          type="button"
          className="continue-button agreement-continue enabled"
          onClick={async (e) => {
            e.preventDefault();
            if (onComplete) {
              try {
                await onComplete({
                  signed_agreement_url: pdfUrl,
                  signed_at: signedAt,
                  downloaded_at: downloadedAt,
                });
              } catch (err) {
                console.error("Completion error:", err);
              }
            }
          }}
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  return null;
}
