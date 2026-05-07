import React, { useEffect, useState } from "react";
import { CreditCard } from "lucide-react";
import CreditMetricCard from "../components/credit/CreditMetricCard.jsx";
import CreditActionGrid from "../components/credit/CreditActionGrid.jsx";
import CreditScorePage from "./CreditScorePage.jsx";
import { useProfile } from "../lib/useProfile";
import { useCreditInfo } from "../lib/useFinancialData";
import CreditSkeleton from "../components/CreditSkeleton";
import NotificationBell from "../components/NotificationBell";

const CreditPage = ({ onOpenNotifications, onOpenCreditApply, initialView = "overview" }) => {
  const [view, setView] = useState(initialView);
  const { profile, loading } = useProfile();
  const {
    availableCredit,
    score,
    loanBalance,
    nextPaymentDate,
    minDue,
    utilisationPercent,
    scoreChangesToday,
    scoreChangesAllTime,
    loading: creditLoading,
    hasCredit,
  } = useCreditInfo();

  const displayName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  useEffect(() => {
    const handlePopState = () => {
      setView("overview");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  const navigate = (viewName) => {
    setView(viewName);
  };

  if (view === "score") {
    return <CreditScorePage onBack={() => navigate("overview")} scoreChangesToday={scoreChangesToday} scoreChangesAllTime={scoreChangesAllTime} currentScore={score} />;
  }

  if (loading || creditLoading) {
    return <CreditSkeleton />;
  }

  const utilisationWidth = `${utilisationPercent}%`;

  return (
    <div className="min-h-screen bg-slate-50 pb-[env(safe-area-inset-bottom)] text-slate-900">
      <div className="rounded-b-[36px] bg-gradient-to-b from-[#111111] via-[#3b1b7a] to-[#5b21b6] px-4 pb-12 pt-12 text-white md:px-8">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-6 md:max-w-md">
          <header className="flex items-center justify-between text-white">
            <div className="flex items-center gap-3">
              {profile.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt={displayName || "Profile"}
                  className="h-10 w-10 rounded-full border border-white/40 object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 border border-white/30 text-xs font-semibold text-white">
                  {initials || "—"}
                </div>
              )}
            </div>
            <NotificationBell onClick={onOpenNotifications} />
          </header>

          <section className="rounded-3xl bg-white/10 p-5 shadow-sm backdrop-blur">
            <p className="text-xs uppercase tracking-[0.2em] text-white/70">Available Credit</p>
            <p className="mt-3 text-3xl font-semibold">
              {hasCredit ? `R${availableCredit.toLocaleString()}` : '—'}
            </p>
            {!hasCredit && (
              <p className="mt-1.5 text-xs text-white/50">Complete a credit assessment to see your limit</p>
            )}
            {hasCredit && (
              <div className="mt-4 inline-flex items-center rounded-full bg-emerald-400/20 px-3 py-1 text-xs font-semibold text-emerald-100">
                Good standing
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="mx-auto -mt-10 flex w-full max-w-sm flex-col gap-5 px-4 pb-10 md:max-w-md md:px-8">
        {!hasCredit ? (
          <CreditMetricCard>
            <div className="text-center py-4">
              <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-violet-50 text-violet-600 mb-4">
                <CreditCard className="h-8 w-8" />
              </div>
              <p className="text-lg font-semibold text-slate-900 mb-2">No Credit Account Yet</p>
              <p className="text-sm text-slate-500 mb-5 max-w-xs mx-auto">
                Apply for credit to unlock additional purchasing power and build your credit score.
              </p>
              <button
                type="button"
                onClick={onOpenCreditApply}
                className="inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-white shadow-lg shadow-slate-900/20 transition hover:-translate-y-0.5"
              >
                Apply for credit
              </button>
            </div>
          </CreditMetricCard>
        ) : (
          <>
            <CreditMetricCard>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-700">Credit Score</p>
                  <p className="mt-2 text-3xl font-semibold text-slate-900">{score || 0}</p>
                  <p className="mt-1 text-xs text-slate-400">Updated today</p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate("score")}
                  className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white"
                >
                  View score
                </button>
              </div>
            </CreditMetricCard>

            <CreditMetricCard>
              <p className="text-sm font-semibold text-slate-700">Active loan / Utilisation</p>
              <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-slate-400">Loan balance</p>
                  <p className="mt-1 font-semibold text-slate-800">R{loanBalance.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Next payment date</p>
                  <p className="mt-1 font-semibold text-slate-800">{nextPaymentDate || "N/A"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Minimum due</p>
                  <p className="mt-1 font-semibold text-slate-800">R{minDue.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Utilisation</p>
                  <p className="mt-1 font-semibold text-slate-800">
                    {utilisationPercent}%
                  </p>
                </div>
              </div>
              <div className="mt-5">
                <div className="h-2 w-full rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-purple-500 to-emerald-300"
                    style={{ width: utilisationWidth }}
                  />
                </div>
              </div>
            </CreditMetricCard>
          </>
        )}

      </div>
    </div>
  );
};

export default CreditPage;
