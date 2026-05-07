import React, { useState, useEffect, useCallback } from "react";
import { ArrowLeft, RefreshCw, Calendar, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { formatCurrency } from "../lib/formatCurrency";

const ManageSubscriptionsPage = ({ onBack }) => {
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [togglingId, setTogglingId] = useState(null);

  const fetchSubscriptions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/user/strategy-subscriptions", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!data.success) {
        // Table may not exist yet — treat as empty rather than crashing
        setSubscriptions([]);
      } else {
        setSubscriptions(data.subscriptions || []);
      }
    } catch (err) {
      setSubscriptions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSubscriptions();
  }, [fetchSubscriptions]);

  const toggleStatus = async (sub) => {
    setTogglingId(sub.id);
    const newStatus = sub.status === "active" ? "cancelled" : "active";
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/user/strategy-subscriptions/${sub.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Update failed");
      setSubscriptions((prev) =>
        prev.map((s) => (s.id === sub.id ? { ...s, status: newStatus } : s))
      );
    } catch (err) {
      alert(err.message || "Could not update subscription");
    } finally {
      setTogglingId(null);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-ZA", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-10">
      <div className="mx-auto w-full max-w-sm px-4 pt-12 md:max-w-md md:px-6">

        {/* Header */}
        <header className="flex items-center gap-3 mb-8 relative">
          <button
            type="button"
            onClick={onBack}
            className="absolute left-0 flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="w-full text-center text-lg font-semibold text-slate-900">
            Manage Subscriptions
          </h1>
        </header>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="h-8 w-8 text-violet-500 animate-spin" />
            <p className="text-sm text-slate-500">Loading subscriptions…</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        )}

        {/* Empty */}
        {!loading && !error && subscriptions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-violet-50">
              <RefreshCw className="h-6 w-6 text-violet-400" />
            </div>
            <p className="text-sm font-semibold text-slate-700">No subscriptions yet</p>
            <p className="text-xs text-slate-500 max-w-[220px]">
              Strategy subscriptions appear here when you invest in more than one strategy.
            </p>
          </div>
        )}

        {/* Subscription cards */}
        {!loading && !error && subscriptions.length > 0 && (
          <div className="space-y-4">
            <p className="text-xs text-slate-500 mb-1">
              Monthly strategy fees are deducted from your wallet on the billing date.
            </p>
            {subscriptions.map((sub) => {
              const isActive = sub.status === "active";
              const isToggling = togglingId === sub.id;
              const amountRands = Number(sub.amount || 29);

              return (
                <div
                  key={sub.id}
                  className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden"
                >
                  {/* Top strip: status colour */}
                  <div
                    className={`h-1 w-full ${isActive ? "bg-gradient-to-r from-violet-500 to-purple-500" : "bg-slate-200"}`}
                  />

                  <div className="p-4">
                    {/* Name + status badge */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {sub.plan || "Strategy Subscription"}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {formatCurrency(amountRands, "R")}/month
                        </p>
                      </div>
                      <span
                        className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold flex-shrink-0 ${
                          isActive
                            ? "bg-green-50 text-green-700 border border-green-100"
                            : "bg-slate-100 text-slate-500 border border-slate-200"
                        }`}
                      >
                        {isActive ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5" />
                        )}
                        {isActive ? "Active" : "Cancelled"}
                      </span>
                    </div>

                    {/* Next billing */}
                    <div className="flex items-center gap-1.5 mb-4">
                      <Calendar className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                      <p className="text-xs text-slate-500">
                        {isActive
                          ? `Next charge on ${formatDate(sub.current_period_end)}`
                          : `Cancelled — no further charges`}
                      </p>
                    </div>

                    {/* Toggle button */}
                    <button
                      type="button"
                      disabled={isToggling}
                      onClick={() => toggleStatus(sub)}
                      className={`w-full rounded-xl py-2.5 text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${
                        isActive
                          ? "bg-rose-50 text-rose-600 border border-rose-100 hover:bg-rose-100"
                          : "bg-violet-50 text-violet-700 border border-violet-100 hover:bg-violet-100"
                      }`}
                    >
                      {isToggling ? (
                        <span className="flex items-center justify-center gap-1.5">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Updating…
                        </span>
                      ) : isActive ? (
                        "Cancel Subscription"
                      ) : (
                        "Reactivate Subscription"
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ManageSubscriptionsPage;
