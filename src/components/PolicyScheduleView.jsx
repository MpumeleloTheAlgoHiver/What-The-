/**
 * PolicyScheduleView
 * React conversion of the Flutter PolicyScheduleScreen widget.
 * All client details come through props — nothing hardcoded.
 *
 * Props:
 *   firstName       {string}
 *   lastName        {string}
 *   policyNo        {string}
 *   dateStr         {string}  e.g. "14 April 2026"
 *   planLabel       {string}  e.g. "Individual Funeral Plan"
 *   coverAmount     {number}
 *   basePremium     {number}
 *   totalMonthly    {number}
 *   deductionDate   {string|number}
 *   addonDetails    {Array<{ label, sub, premium }>}
 *   dependents      {Array<{ firstName, lastName, type, dob }>}
 *   onClose         {Function}  optional — renders a close button in the header
 */

import { X, Shield, Users, Calendar } from "lucide-react";

// ─── Brand tokens ─────────────────────────────────────────────────────────────
const PURPLE      = "#5B2D8E";
const PURPLE_DARK = "#3D1A6B";
const PURPLE_PALE = "#F5F2FC";
const BORDER      = "#DDD8F0";
const GRAY_BG     = "#F5F5F5";
const TEXT        = "#1A1A2E";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtR(n) {
  return `R\u00a0${Number(n).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
function fmtCover(n) {
  return `R\u00a0${Number(n).toLocaleString("en-ZA")}`;
}
function depAge(dob) {
  if (!dob) return null;
  const parts = dob.split("-").map(Number);
  if (parts.length !== 3) return null;
  const [fy, fm, fd] = parts;
  const now = new Date();
  let a = now.getFullYear() - fy;
  if (now.getMonth() + 1 < fm || (now.getMonth() + 1 === fm && now.getDate() < fd)) a--;
  return a;
}
function relationLabel(type) {
  if (type === "spouse")  return "Spouse";
  if (type === "member")  return "Society Member";
  return "Child";
}

// ─── Sub-components (mirrors Flutter helper methods) ─────────────────────────

/** Flutter: _buildSectionHeader */
function SectionHeader({ title }) {
  return (
    <div
      style={{ background: PURPLE }}
      className="w-full px-3 py-2 rounded-t-md"
    >
      <span className="text-white font-bold text-sm tracking-wide uppercase">
        {title}
      </span>
    </div>
  );
}

/** Flutter: _buildDataTable */
function DataTable({ rows }) {
  return (
    <div
      style={{ border: `1px solid ${BORDER}` }}
      className="rounded-b-md overflow-hidden w-full"
    >
      {rows.map(([label, value], i) => (
        <div
          key={label}
          className="flex items-center justify-between px-3 py-2.5"
          style={{
            background: i % 2 === 0 ? "#fff" : PURPLE_PALE,
            borderBottom: i < rows.length - 1 ? `1px solid ${BORDER}` : "none",
          }}
        >
          <span className="text-sm" style={{ color: "#666" }}>{label}</span>
          <span className="text-sm font-semibold" style={{ color: TEXT }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

/** Flutter: _buildBenefitRow */
function BenefitRow({ label, value, alt }) {
  return (
    <div
      className="flex items-center justify-between px-3 py-2.5"
      style={{
        background: alt ? PURPLE_PALE : "#fff",
        borderBottom: `1px solid ${BORDER}`,
      }}
    >
      <span className="text-sm font-medium" style={{ color: "#444" }}>{label}</span>
      <span className="text-sm font-bold" style={{ color: PURPLE }}>{value}</span>
    </div>
  );
}

/** Flutter: _buildDependentRow (Card + ListTile) */
function DependentCard({ name, relation, cover }) {
  return (
    <div
      className="flex items-center justify-between rounded-xl px-4 py-3 mb-2"
      style={{ background: GRAY_BG, border: `1px solid ${BORDER}` }}
    >
      <div>
        <p className="text-sm font-bold" style={{ color: TEXT }}>{name}</p>
        <p className="text-xs mt-0.5" style={{ color: "#777" }}>{relation}</p>
      </div>
      <span className="text-sm font-bold" style={{ color: TEXT }}>{cover}</span>
    </div>
  );
}

/** Flutter: _buildFooter (bottomNavigationBar) */
function Footer({ policyNo, fullName }) {
  return (
    <div
      className="w-full px-4 py-3 text-center"
      style={{ background: GRAY_BG, borderTop: `1px solid ${BORDER}` }}
    >
      <p className="text-[10px]" style={{ color: "#999" }}>
        Policy Schedule — {fullName} &nbsp;|&nbsp; {policyNo} &nbsp;|&nbsp; support@mymint.co.za
      </p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function PolicyScheduleView({
  firstName = "",
  lastName  = "",
  policyNo  = "",
  dateStr   = "",
  planLabel = "",
  coverAmount,
  basePremium,
  totalMonthly,
  deductionDate,
  addonDetails  = [],
  dependents    = [],
  onClose,
}) {
  const fullName   = `${firstName} ${lastName}`.trim();
  const BASE       = typeof window !== "undefined" ? window.location.origin : "";
  const heroImg    = `${BASE}/assets/images/hands-hero.jpeg`;
  const mintLogo   = `${BASE}/assets/LOGO%202%20WHITE%20MINT.svg`;

  const planRows = [
    ["Product Name",    planLabel             || "—"],
    ["Plan Value",      fmtCover(coverAmount)  || "—"],
    ["Base Premium",    fmtR(basePremium)       || "—"],
    ["Monthly Total",   fmtR(totalMonthly)      || "—"],
    ["Deduction Date",  deductionDate ? `${deductionDate} of each month` : "—"],
  ];

  return (
    /* Flutter: Scaffold */
    <div className="flex flex-col min-h-screen bg-white" style={{ color: TEXT }}>

      {/* Flutter: AppBar */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ background: PURPLE_DARK }}
      >
        <div className="flex items-center gap-3">
          <img src={mintLogo} alt="Mint" className="h-6 w-auto" />
          <div>
            <p className="text-[10px] text-white/60 uppercase tracking-widest leading-none">
              Wills &amp; Funeral Specialists
            </p>
            <p className="text-white font-bold text-sm leading-tight">Policy Schedule</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1 text-white/70 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Flutter: SingleChildScrollView */}
      <div className="flex-1 overflow-y-auto">

        {/* Flutter: Image.network — hero header */}
        <div className="w-full h-48 overflow-hidden">
          <img
            src={heroImg}
            alt="Mint Funeral Cover"
            className="w-full h-full object-cover object-center"
          />
        </div>

        {/* Flutter: Padding > Column */}
        <div className="px-5 py-6 space-y-6">

          {/* Flutter: Text('MINT') + Text('WILLS & FUNERAL SPECIALISTS') + Divider */}
          <div>
            <p className="text-2xl font-extrabold uppercase" style={{ color: PURPLE }}>
              Mint
            </p>
            <p className="text-[11px] font-semibold tracking-widest uppercase" style={{ color: "#888" }}>
              Wills &amp; Funeral Specialists
            </p>
            <div className="mt-2 mb-3">
              <p className="text-base font-semibold uppercase" style={{ color: TEXT }}>
                Policy Schedule
              </p>
              <p className="text-sm" style={{ color: "#888" }}>{dateStr}</p>
            </div>
            <div style={{ height: 2, background: PURPLE, borderRadius: 1 }} />
          </div>

          {/* Flutter: Text('Dear ...') + welcome text */}
          <div className="space-y-2">
            <p className="text-base font-bold" style={{ color: TEXT }}>
              Dear {fullName},
            </p>
            <p className="text-sm leading-relaxed" style={{ color: "#555" }}>
              Thank you for choosing the Mint Funeral Plan. We are honoured to be your
              trusted financial partner and committed to ensuring your loved ones are cared
              for at their most vulnerable time.
            </p>

            {/* Policy reference pill */}
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{ background: PURPLE_PALE, border: `1px solid ${BORDER}` }}
            >
              <Shield className="h-3.5 w-3.5" style={{ color: PURPLE }} />
              <span className="text-xs font-bold tracking-wider" style={{ color: PURPLE }}>
                {policyNo}
              </span>
            </div>
          </div>

          {/* Flutter: _buildSectionHeader('PLAN SUMMARY') + _buildDataTable */}
          <div>
            <SectionHeader title="Plan Summary" />
            <DataTable rows={planRows} />
          </div>

          {/* Flutter: _buildSectionHeader('BENEFIT DETAILS') + _buildBenefitRow × N */}
          <div>
            <SectionHeader title="Benefit Details" />
            <div style={{ border: `1px solid ${BORDER}` }} className="rounded-b-md overflow-hidden">
              <BenefitRow
                label="Funeral Cover — Main Member"
                value={fmtCover(coverAmount)}
                alt={false}
              />
              {addonDetails.map((a, i) => (
                <BenefitRow
                  key={a.label}
                  label={`${a.label}${a.sub ? ` — ${a.sub}` : ""}`}
                  value={`+${fmtR(a.premium)}/mo`}
                  alt={(i + 1) % 2 === 0}
                />
              ))}
              {/* Total row */}
              <div
                className="flex items-center justify-between px-3 py-3"
                style={{ background: PURPLE }}
              >
                <span className="text-sm font-bold text-white">Monthly Total</span>
                <span className="text-base font-extrabold text-white">{fmtR(totalMonthly)}</span>
              </div>
            </div>
          </div>

          {/* Flutter: _buildSectionHeader('DEPENDENTS') + _buildDependentRow × N */}
          {dependents.length > 0 && (
            <div>
              <SectionHeader title="Dependents" />
              <div
                className="rounded-b-md p-3"
                style={{ background: "#fff", border: `1px solid ${BORDER}` }}
              >
                <div className="flex items-center gap-1.5 mb-3">
                  <Users className="h-4 w-4" style={{ color: PURPLE }} />
                  <span className="text-xs font-semibold" style={{ color: PURPLE }}>
                    {dependents.length} covered member{dependents.length > 1 ? "s" : ""}
                  </span>
                </div>
                {dependents.map((dep, i) => {
                  const name     = [dep.firstName, dep.lastName].filter(Boolean).join(" ") || "—";
                  const ageYrs   = depAge(dep.dob);
                  const relation = `${relationLabel(dep.type)}${ageYrs !== null ? ` (${ageYrs} yrs)` : ""}`;
                  return (
                    <DependentCard
                      key={i}
                      name={name}
                      relation={relation}
                      cover={fmtCover(coverAmount)}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Deduction info */}
          {deductionDate && (
            <div
              className="flex items-start gap-2.5 rounded-xl px-4 py-3"
              style={{ background: PURPLE_PALE, border: `1px solid ${BORDER}` }}
            >
              <Calendar className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: PURPLE }} />
              <p className="text-sm" style={{ color: PURPLE_DARK }}>
                Your premium of <strong>{fmtR(totalMonthly)}</strong> will be deducted on the{" "}
                <strong>{deductionDate}</strong> of each month.
                <br />
                <span className="text-xs" style={{ color: "#999" }}>
                  Bank reference: MINT-INS {policyNo}
                </span>
              </p>
            </div>
          )}

          {/* Legal notice */}
          <p className="text-[10px] leading-relaxed pb-2" style={{ color: "#aaa" }}>
            A 6-month waiting period applies from the policy start date. Underwritten by
            GuardRisk Life Ltd — FSP 76. Mint Financial Services (Pty) Ltd — FSP No. 55118.
          </p>
        </div>
      </div>

      {/* Flutter: bottomNavigationBar → _buildFooter */}
      <Footer policyNo={policyNo} fullName={fullName} />
    </div>
  );
}
