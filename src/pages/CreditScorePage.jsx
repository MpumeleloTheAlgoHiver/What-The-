import React, { useEffect, useMemo, useState } from "react";
import CreditMetricCard from "../components/credit/CreditMetricCard.jsx";
import { supabase } from "../lib/supabase.js";

/* ── human-readable labels for engine_result keys ── */
const LABEL_MAP = {
  creditScore: "Credit Score",
  creditUtilization: "Credit Utilisation",
  adverseListings: "Adverse Listings",
  incomeStability: "Income Stability",
  dti: "Debt-to-Income",
  bankStatementCashflows: "Bank Statement Cashflows",
  employmentTenure: "Employment Tenure",
  employmentCategory: "Employment Category",
  contractType: "Contract Type",
  algoHiveBehavioural: "AlgoHive Behavioural Score",
};
const adjustLabel = (key) =>
  LABEL_MAP[key] || key.replace(/([A-Z])/g, " $1").trim();

/* ── colour helpers for breakdown bars ── */
const barColor = (pct) => {
  if (pct >= 60) return "bg-emerald-400";
  if (pct >= 30) return "bg-amber-400";
  return "bg-rose-400";
};
const badgeColor = (pct) => {
  if (pct >= 60) return "text-emerald-600";
  if (pct >= 30) return "text-amber-600";
  return "text-rose-500";
};

const CreditScorePage = ({ onBack }) => {
  const [view, setView] = useState("today");
  const [showScoreHistory, setShowScoreHistory] = useState(false);
  const [showReasons, setShowReasons] = useState(false);
  const [scoreSnapshot, setScoreSnapshot] = useState({
    score: null,
    experianScore: null,
    delta: null,
    updatedAt: null,
    breakdown: null,
    scoreReasons: [],
  });

  /* ── load latest + previous score rows ── */
  useEffect(() => {
    const loadScore = async () => {
      if (!supabase) return;
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (!userId) return;

      const { data: scoreRows } = await supabase
        .from("loan_engine_score")
        .select(
          "engine_score,experian_score,engine_result,score_reasons,created_at"
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(2);

      if (!Array.isArray(scoreRows) || scoreRows.length === 0) return;

      const [latest, previous] = scoreRows;
      const latestScore = Number(latest?.engine_score);
      const prevScore = Number(previous?.engine_score);
      const experianScore = Number(latest?.experian_score);
      setScoreSnapshot({
        score: Number.isFinite(latestScore) ? latestScore : null,
        experianScore: Number.isFinite(experianScore) ? experianScore : null,
        delta:
          Number.isFinite(latestScore) && Number.isFinite(prevScore)
            ? latestScore - prevScore
            : null,
        updatedAt: latest?.created_at || null,
        breakdown: latest?.engine_result || null,
        scoreReasons: Array.isArray(latest?.score_reasons)
          ? latest.score_reasons
          : [],
      });
    };

    loadScore();
  }, []);

  /* ── derived state ── */
  const hasScore =
    Number.isFinite(scoreSnapshot.score) && scoreSnapshot.score > 0;
  const hasExperian =
    Number.isFinite(scoreSnapshot.experianScore) &&
    scoreSnapshot.experianScore > 0;

  const scoreDelta =
    hasScore && scoreSnapshot.delta !== null
      ? `${scoreSnapshot.delta > 0 ? "+" : ""}${Math.round(scoreSnapshot.delta)} pts`
      : "—";

  const updatedLabel =
    hasScore && scoreSnapshot.updatedAt
      ? `Updated ${new Date(scoreSnapshot.updatedAt).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })}`
      : "No score data yet";

  const markerPosition = useMemo(() => {
    if (!hasExperian) {
      if (!hasScore) return 0;
      return Math.min(Math.max(scoreSnapshot.score, 0), 100);
    }
    const min = 300;
    const max = 850;
    const pct =
      ((scoreSnapshot.experianScore - min) / (max - min)) * 100;
    return Math.min(Math.max(pct, 0), 100);
  }, [hasScore, hasExperian, scoreSnapshot.score, scoreSnapshot.experianScore]);

  const displayScore = hasExperian
    ? scoreSnapshot.experianScore
    : hasScore
      ? Math.round(scoreSnapshot.score)
      : null;

  /* ── breakdown items from engine_result ── */
  const breakdownItems = useMemo(() => {
    if (!scoreSnapshot.breakdown) return [];
    return Object.entries(scoreSnapshot.breakdown)
      .filter(([, value]) => {
        if (!value || typeof value !== "object") return false;
        return Number.isFinite(value?.contributionPercent);
      })
      .map(([key, value]) => {
      const contribution = Number.isFinite(value?.contributionPercent)
        ? value.contributionPercent
        : 0;
      const weight = Number.isFinite(value?.weightPercent)
        ? value.weightPercent
        : 0;
      const valuePct = Number.isFinite(value?.valuePercent)
        ? value.valuePercent
        : 0;
      return {
        key,
        label: adjustLabel(key),
        contribution,
        weight,
        valuePercent: valuePct,
      };
    });
  }, [scoreSnapshot.breakdown]);

  /* ── score history (static demo data for now) ── */
  const scoreChanges = hasScore
    ? view === "today"
      ? [
          { label: "Credit utilisation", date: "Apr 14", value: "+4" },
          { label: "Cash purchases", date: "Apr 12", value: "-6" },
          { label: "Credit utilisation", date: "Apr 10", value: "+4" },
        ]
      : [
          { label: "Credit utilisation", date: "Mar 22", value: "+8" },
          { label: "New credit line", date: "Feb 12", value: "+12" },
          { label: "Cash purchases", date: "Jan 03", value: "-4" },
        ]
    : [];

  return (
    <div className="min-h-screen bg-slate-50 px-4 pb-[env(safe-area-inset-bottom)] pt-10 text-slate-900 md:px-8">
      <div className="mx-auto flex w-full max-w-sm flex-col gap-6 md:max-w-md">
        {/* ── header ── */}
        <header className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm"
            aria-label="Back to credit overview"
          >
            ←
          </button>
          <h1 className="text-lg font-semibold">Credit Score</h1>
          <div className="w-10" />
        </header>

        {/* ── today / all-time toggle ── */}
        <div className="flex items-center justify-center rounded-full bg-slate-100 p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setView("today")}
            className={`flex-1 rounded-full px-4 py-2 transition ${
              view === "today"
                ? "bg-white text-slate-900 shadow"
                : "text-slate-500"
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setView("all")}
            className={`flex-1 rounded-full px-4 py-2 transition ${
              view === "all"
                ? "bg-white text-slate-900 shadow"
                : "text-slate-500"
            }`}
          >
            All time
          </button>
        </div>

        {/* ── main score card ── */}
        <CreditMetricCard className="flex flex-col items-center gap-4 text-center">
          <div className="flex items-center gap-3">
            <div className="text-[88px] font-light leading-none tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-purple-500 to-indigo-400">
              {displayScore ?? "—"}
            </div>
            <span className="rounded-full border border-slate-100 bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm">
              {scoreDelta}
            </span>
          </div>

          <div className="w-full">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>{hasExperian ? "Experian" : "Mint Engine"}</span>
              <span>{updatedLabel}</span>
            </div>
            <div className="relative mt-3 h-3 w-full rounded-full bg-gradient-to-r from-purple-500 via-indigo-400 to-emerald-300">
              <div
                className="absolute -top-1 h-5 w-1.5 rounded-full bg-white shadow"
                style={{ left: `calc(${markerPosition}% - 3px)` }}
              />
            </div>
            {hasExperian ? (
              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                <span>300</span>
                <span>500</span>
                <span>700</span>
                <span>850</span>
              </div>
            ) : (
              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                <span>0</span>
                <span>50</span>
                <span>75</span>
                <span>100</span>
              </div>
            )}
          </div>

          {hasExperian && hasScore && (
            <div className="w-full mt-2 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2">
              <span className="text-[10px] uppercase font-bold text-slate-400">
                Mint Engine Score
              </span>
              <span className="text-sm font-black text-slate-800">
                {Math.round(scoreSnapshot.score)}%
              </span>
            </div>
          )}
        </CreditMetricCard>

        {/* ── score breakdown from engine_result ── */}
        {breakdownItems.length > 0 && (
          <CreditMetricCard>
            <p className="text-xs font-semibold uppercase text-slate-400 mb-3">
              Score Breakdown
            </p>
            <div className="space-y-3">
              {breakdownItems.map((item) => {
                const pct = Math.min(item.valuePercent, 100);
                return (
                  <div key={item.key}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-slate-600">{item.label}</span>
                      <span
                        className={`text-xs font-semibold ${badgeColor(pct)}`}
                      >
                        {Number.isFinite(item.contribution)
                          ? item.contribution.toFixed(1)
                          : "—"}
                        <span className="text-slate-400 font-normal">
                          {" "}/ {item.weight}
                        </span>
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${barColor(pct)}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CreditMetricCard>
        )}

        {/* ── Experian / engine reasons ── */}
        {scoreSnapshot.scoreReasons.length > 0 && (
          <CreditMetricCard>
            <button
              type="button"
              onClick={() => setShowReasons((p) => !p)}
              className="w-full flex items-center justify-between"
            >
              <p className="text-xs font-semibold uppercase text-slate-400">
                Experian Reasons
              </p>
              <span className="text-xs text-slate-400">
                {showReasons ? "▲" : "▼"}
              </span>
            </button>
            {showReasons && (
              <ul className="mt-3 space-y-1.5">
                {scoreSnapshot.scoreReasons.map((reason, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-xs text-slate-600"
                  >
                    <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-rose-400" />
                    {reason}
                  </li>
                ))}
              </ul>
            )}
          </CreditMetricCard>
        )}

        {/* ── score history ── */}
        <CreditMetricCard>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-slate-400">
              Changes
            </p>
            <button
              type="button"
              onClick={() => setShowScoreHistory((prev) => !prev)}
              disabled={!hasScore}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                hasScore
                  ? "bg-slate-100 text-slate-600"
                  : "bg-slate-200 text-slate-400 cursor-not-allowed"
              }`}
            >
              {showScoreHistory
                ? "Hide history"
                : hasScore
                  ? "Score history"
                  : "Check Mint score standing"}
            </button>
          </div>
          {showScoreHistory && (
            <div className="mt-4 flex flex-col gap-3">
              {scoreChanges.length > 0 ? (
                scoreChanges.map((item, index) => (
                  <div
                    key={`${item.label}-${item.date}-${index}`}
                    className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-700">
                        {item.label}
                      </p>
                      <p className="text-[11px] text-slate-400">{item.date}</p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${
                        item.value.startsWith("+")
                          ? "bg-emerald-100 text-emerald-600"
                          : "bg-rose-100 text-rose-500"
                      }`}
                    >
                      {item.value}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">
                  No score activity to show yet. Run your Mint score check to
                  unlock insights.
                </p>
              )}
            </div>
          )}
        </CreditMetricCard>
      </div>
    </div>
  );
};

export default CreditScorePage;
