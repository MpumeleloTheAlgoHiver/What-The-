import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, ArrowUpRight, ArrowDownLeft, X,
  Wallet, BarChart3, ChevronRight,
  RefreshCw, Search, Star, AlertCircle, Check, ClipboardList,
  BookOpen, LayoutGrid, ArrowDownToLine, Target,
} from "lucide-react";
import SwipeableBalanceCard from "../components/SwipeableBalanceCard";
import { useProfile } from "../lib/useProfile";
import { supabase } from "../lib/supabase";
import MinorProofOfAddressDeclaration from "../components/MinorProofOfAddressDeclaration";
import ChildResponsibilityAgreement from "../components/ChildResponsibilityAgreement";

// â”€â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function getAge(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function fmt(cents) {
  const val = (cents || 0) / 100;
  return `R\u202F${val.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// â”€â”€â”€ Animation variants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};
const item = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 340, damping: 28 } },
};

function TransferModal({ child, parentBalance, balancesLoading, onTransfer, onClose }) {
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const numAmount = parseFloat(amount) || 0;
  const amountCents = Math.round(numAmount * 100);
  const insufficient = !balancesLoading && amountCents > (parentBalance || 0);

  async function handleSubmit() {
    if (numAmount <= 0) { setError("Enter a valid amount."); return; }
    if (insufficient) { setError("Insufficient wallet balance."); return; }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/child-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "transfer",
          family_member_id: child.id,
          amount: amountCents,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Transfer failed."); return; }
      setSuccess(true);
      onTransfer(json);
    } catch {
      setError("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-lg font-bold text-slate-800 text-center placeholder-slate-400 focus:border-violet-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-100 transition tabular-nums";

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        className="relative w-full max-w-md bg-white rounded-t-3xl shadow-2xl overflow-hidden pb-[env(safe-area-inset-bottom)]"
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
      >
        <div className="flex justify-center pt-3 pb-1"><div className="h-1 w-10 rounded-full bg-slate-200" /></div>

        <div className="px-6 pt-3 pb-8">
          {!success ? (
            <>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#6ee7b7,#34d399)" }}>
                    <ArrowDownLeft className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-slate-900">Transfer Funds</p>
                    <p className="text-xs text-slate-400">
                      To {child.first_name}'s account
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="h-8 w-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition active:scale-95"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Balance info */}
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 mb-4 border border-slate-100">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Your Wallet</p>
                  <p className="text-sm font-bold text-slate-900 tabular-nums mt-0.5">
                    {balancesLoading ? "Loadingâ€¦" : fmt(parentBalance)}
                  </p>
                </div>
                <ArrowUpRight className="h-4 w-4 text-slate-300" />
                <div className="text-right">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{child.first_name}'s Wallet</p>
                  <p className="text-sm font-bold text-slate-900 tabular-nums mt-0.5">
                    {balancesLoading ? "Loadingâ€¦" : fmt(child.available_balance || 0)}
                  </p>
                </div>
              </div>

              {/* Amount input */}
              <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 ml-0.5">
                Amount (ZAR)
              </label>
              <div className="relative mb-4">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">R</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className={inputCls + " pl-10"}
                  autoFocus
                />
              </div>

              {/* Quick amounts */}
              <div className="flex gap-2 mb-5">
                {[50, 100, 250, 500].map((v) => (
                  <button
                    key={v}
                    onClick={() => setAmount(String(v))}
                    disabled={balancesLoading}
                    className="flex-1 rounded-lg py-2 text-xs font-bold text-purple-600 bg-purple-50 border border-purple-100 hover:bg-purple-100 transition active:scale-95"
                  >
                    R{v}
                  </button>
                ))}
              </div>

              {insufficient && (
                <div className="flex items-start gap-2 rounded-xl bg-purple-50 px-4 py-3 border border-purple-100 mb-3">
                  <AlertCircle className="h-3.5 w-3.5 text-purple-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-purple-600">Amount exceeds your wallet balance.</p>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 border border-red-100 mb-3">
                  <X className="h-3.5 w-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-red-500">{error}</p>
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={balancesLoading || saving || numAmount <= 0 || insufficient}
                className="w-full rounded-xl py-3.5 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#1e1b4b,#312e81)" }}
              >
                {saving ? "Transferringâ€¦" : `Transfer R${numAmount.toFixed(2)}`}
              </button>
            </>
          ) : (
            <motion.div
              className="text-center py-4"
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
            >
              <div className="h-16 w-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "linear-gradient(135deg,#e9d5ff,#d8b4fe)" }}>
                <Check className="h-8 w-8 text-purple-600" />
              </div>
              <p className="text-lg font-bold text-slate-900">Transfer Complete!</p>
              <p className="text-sm text-slate-500 mt-2">
                R{numAmount.toFixed(2)} has been transferred to {child.first_name}'s wallet.
              </p>
              <button
                onClick={onClose}
                className="mt-6 w-full rounded-xl py-3.5 text-sm font-bold text-white active:scale-[0.98]"
                style={{ background: "linear-gradient(135deg,#1e1b4b,#312e81)" }}
              >
                Done
              </button>
            </motion.div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// â”€â”€â”€ Invest Modal (bottom-sheet) â€” browse strategies & invest â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function InvestModal({ child, onInvest, onClose }) {
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [units, setUnits] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const childBalance = child.available_balance || 0;
  const minInvCents = selected?.min_investment || 0;
  const amountCents = units * minInvCents;
  const numAmount = amountCents / 100;
  const insufficient = amountCents > childBalance;

  useEffect(() => {
    fetchStrategies();
  }, []);

  async function fetchStrategies() {
    setLoading(true);
    try {
      if (!supabase) return;
      const { data } = await supabase
        .from("strategies_c")
        .select("id, name, short_name, description, risk_level, sector, tags, min_investment, is_featured, holdings, strategy_metrics(*)")
        .eq("status", "active")
        .eq("is_kid_strategy", true)
        .order("is_featured", { ascending: false })
        .order("name");

      const rows = data || [];

      // Collect all holding symbols to fetch logos
      const allSymbols = [...new Set(
        rows.flatMap(s => (Array.isArray(s.holdings) ? s.holdings : []).map(h => h.symbol || h.ticker).filter(Boolean))
      )];
      let secMap = {};
      if (allSymbols.length > 0) {
        const { data: secs } = await supabase
          .from("securities_c")
          .select("symbol, name, logo_url")
          .in("symbol", allSymbols);
        (secs || []).forEach(s => { secMap[s.symbol] = s; });
      }

      const enriched = rows.map(s => {
        const metrics = Array.isArray(s.strategy_metrics)
          ? [...s.strategy_metrics].sort((a, b) => (b.as_of_date || "").localeCompare(a.as_of_date || ""))[0]
          : s.strategy_metrics;
        const r_ytd = metrics?.r_ytd ?? metrics?.r_ytd_pct ?? metrics?.r_1y ?? null;
        const ytd_as_of_date = metrics?.as_of_date ?? null;
        const holdingsList = (Array.isArray(s.holdings) ? s.holdings : [])
          .sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0))
          .map(h => ({ symbol: h.symbol || h.ticker, logo_url: secMap[h.symbol || h.ticker]?.logo_url || null }));
        return { ...s, r_ytd, ytd_as_of_date, holdingsList };
      });

      setStrategies(enriched);
    } catch (e) { console.error("[child-invest] strategies", e); }
    finally { setLoading(false); }
  }

  async function handleInvest() {
    if (!selected) return;
    if (amountCents <= 0) { setError("Select a valid investment amount."); return; }
    if (insufficient) { setError("Insufficient funds in child's wallet."); return; }

    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/child-invest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_member_id: child.id,
          strategy_id: selected.id,
          amount: amountCents,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Investment failed."); return; }
      setSuccess(true);
      onInvest(json);
    } catch {
      setError("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  const filtered = strategies.filter(s =>
    s.name?.toLowerCase().includes(search.toLowerCase())
  );

  const inputCls =
    "w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:border-violet-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-100 transition";

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        className="relative w-full max-w-md bg-white rounded-[32px] shadow-2xl overflow-hidden max-h-[85vh] overflow-y-auto"
        initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
      >

        <div className="px-6 pt-3 pb-8 overflow-y-auto" style={{ maxHeight: "calc(85vh - 24px)" }}>
          {!success ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  {selected && (
                    <button
                      onClick={() => { setSelected(null); setUnits(1); setError(""); }}
                      className="h-8 w-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition active:scale-95 mr-1"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#a78bfa,#7c3aed)" }}>
                    <BarChart3 className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-slate-900">
                      {selected ? "Invest Amount" : "Invest for " + child.first_name}
                    </p>
                    <p className="text-xs text-slate-400">
                      {selected ? selected.name : "Choose a strategy to invest in"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="h-8 w-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition active:scale-95"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Available balance pill */}
              <div className="flex items-center gap-2 rounded-xl bg-purple-50 border border-purple-100 px-4 py-2.5 mb-4">
                <Wallet className="h-3.5 w-3.5 text-purple-500" />
                <span className="text-xs font-semibold text-purple-600">{child.first_name}'s balance:</span>
                <span className="text-xs font-bold text-purple-800 ml-auto tabular-nums">{fmt(childBalance)}</span>
              </div>

              {/* Strategy list */}
              {!selected && (
                <>
                  {/* Search */}
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search strategies..."
                      className={inputCls + " pl-10"}
                    />
                  </div>

                  {loading ? (
                    <div className="space-y-3">
                      {[0, 1].map(i => (
                        <div key={i} className="rounded-2xl border border-slate-100 bg-white p-4 space-y-3 animate-pulse">
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-2 flex-1">
                              <div className="h-4 w-32 bg-slate-100 rounded" />
                              <div className="h-3 w-48 bg-slate-100 rounded" />
                              <div className="h-3 w-24 bg-slate-100 rounded" />
                            </div>
                            <div className="h-12 w-24 bg-slate-100 rounded-xl" />
                          </div>
                          <div className="flex gap-2">
                            <div className="h-6 w-16 bg-slate-100 rounded-full" />
                            <div className="h-6 w-20 bg-slate-100 rounded-full" />
                          </div>
                          <div className="h-9 bg-slate-50 rounded-xl" />
                        </div>
                      ))}
                    </div>
                  ) : filtered.length === 0 ? (
                    <p className="text-center text-sm text-slate-400 py-8">No strategies found.</p>
                  ) : (
                    <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-0.5">
                      {filtered.map((s) => {
                        const ytd = s.r_ytd;
                        const ytdPct = ytd != null ? ytd * 100 : null;
                        const isUp = (ytdPct ?? 0) >= 0;
                        return (
                          <button
                            key={s.id}
                            onClick={() => setSelected(s)}
                            className="w-full rounded-2xl border border-slate-100 bg-white shadow-sm p-4 text-left hover:shadow-md hover:border-violet-200 transition active:scale-[0.98]"
                          >
                            {/* Header row */}
                            <div className="flex items-start gap-3 mb-3">
                              <div className="flex-1 min-w-0 space-y-0.5">
                                <p className="text-sm font-semibold text-slate-900 truncate">{s.short_name || s.name}</p>
                                <p className="text-xs text-slate-500 line-clamp-1">
                                  {s.risk_level || "Balanced"}{s.description ? ` â€¢ ${s.description.substring(0, 60)}${s.description.length > 60 ? "â€¦" : ""}` : ""}
                                </p>
                                {s.min_investment > 0 && (
                                  <p className="text-[11px] text-slate-400">Min. {fmt(s.min_investment)}</p>
                                )}
                              </div>
                              {/* Sparkline */}
                              <div className="flex-shrink-0 rounded-xl bg-slate-50 px-2 py-1.5">
                                <svg width="64" height="32" viewBox="0 0 64 32">
                                  <defs>
                                    <linearGradient id={`sg-${s.id}`} x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="0%" stopColor={isUp ? "#7c3aed" : "#e11d48"} stopOpacity="0.15" />
                                      <stop offset="100%" stopColor={isUp ? "#7c3aed" : "#e11d48"} stopOpacity="0" />
                                    </linearGradient>
                                  </defs>
                                  <polyline
                                    points="0,28 10,22 20,24 30,14 40,10 50,16 64,6"
                                    fill="none"
                                    stroke={isUp ? "#7c3aed" : "#e11d48"}
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <circle cx="64" cy="6" r="2.5" fill={isUp ? "#7c3aed" : "#e11d48"} />
                                </svg>
                              </div>
                            </div>
                            {/* Badges */}
                            <div className="flex flex-wrap gap-1.5 mb-3">
                              {s.risk_level && (
                                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-600">{s.risk_level}</span>
                              )}
                              {s.sector && (
                                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-600">{s.sector}</span>
                              )}
                              {s.is_featured && (
                                <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-xs font-semibold text-violet-600">Featured</span>
                              )}
                            </div>
                            {/* YTD return */}
                            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 mb-3">
                              <span className="text-xs font-semibold text-slate-600">YTD return</span>
                              <div className="flex items-center gap-2">
                                {ytdPct != null ? (
                                  <span className={`text-xs font-semibold ${isUp ? "text-emerald-600" : "text-red-500"}`}>
                                    {isUp ? "+" : ""}{ytdPct.toFixed(2)}%
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-400">â€”</span>
                                )}
                                {s.ytd_as_of_date && (
                                  <span className="text-[10px] text-slate-400">
                                    {new Date(s.ytd_as_of_date).toLocaleDateString("en-ZA", { month: "short", day: "numeric" })}
                                  </span>
                                )}
                              </div>
                            </div>
                            {/* Holdings snapshot */}
                            {s.holdingsList?.length > 0 && (
                              <div className="flex items-center gap-2">
                                <div className="flex -space-x-2">
                                  {s.holdingsList.slice(0, 3).map((h) => (
                                    <div key={h.symbol} className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-white shadow-sm">
                                      {h.logo_url ? (
                                        <img src={h.logo_url} alt={h.symbol} className="h-full w-full object-cover" />
                                      ) : (
                                        <div className="flex h-full w-full items-center justify-center bg-slate-100 text-[8px] font-bold text-slate-600">
                                          {h.symbol?.substring(0, 2)}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                  {s.holdingsList.length > 3 && (
                                    <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-[10px] font-semibold text-slate-500">
                                      +{s.holdingsList.length - 3}
                                    </div>
                                  )}
                                </div>
                                <span className="text-xs font-semibold text-slate-500">Holdings snapshot</span>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* Amount entry (after selecting strategy) */}
              {selected && (
                <div className="mt-2">
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 ml-0.5">
                    Units to invest
                  </label>

                  {/* Unit stepper */}
                  <div className="flex items-center justify-center gap-6 py-4 mb-3">
                    <button
                      type="button"
                      onClick={() => setUnits(u => Math.max(1, u - 1))}
                      disabled={units <= 1}
                      className="h-12 w-12 rounded-full bg-slate-100 text-slate-700 text-2xl font-bold flex items-center justify-center transition active:scale-90 disabled:opacity-40"
                    >−</button>
                    <div className="text-center min-w-[60px]">
                      <p className="text-4xl font-bold text-slate-900 tabular-nums">{units}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">unit{units !== 1 ? "s" : ""}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setUnits(u => u + 1)}
                      className="h-12 w-12 rounded-full bg-violet-600 text-white text-2xl font-bold flex items-center justify-center transition active:scale-90"
                    >+</button>
                  </div>

                  {/* Price breakdown */}
                  <div className="flex items-center justify-center gap-1.5 text-sm mb-5 text-slate-500">
                    <span className="font-semibold text-slate-700">{fmt(minInvCents)}</span>
                    <span>×</span>
                    <span className="font-semibold text-slate-700">{units}</span>
                    <span>=</span>
                    <span className="font-bold text-violet-700 text-base">{fmt(amountCents)}</span>
                  </div>

                  {/* Strategy info */}
                  <div className="rounded-xl bg-slate-50 border border-slate-100 p-3.5 mb-4">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Investment Summary</p>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Strategy</span>
                      <span className="font-semibold text-slate-800">{selected.name}</span>
                    </div>
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-slate-500">Amount</span>
                      <span className="font-bold text-slate-900">R{numAmount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-slate-500">From</span>
                      <span className="font-semibold text-slate-800">{child.first_name}'s wallet</span>
                    </div>
                  </div>

                  {insufficient && (
                    <div className="flex items-start gap-2 rounded-xl bg-purple-50 px-4 py-3 border border-purple-100 mb-3">
                      <AlertCircle className="h-3.5 w-3.5 text-purple-500 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-purple-600">Insufficient balance. Transfer funds first.</p>
                    </div>
                  )}

                  {error && (
                    <div className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 border border-red-100 mb-3">
                      <X className="h-3.5 w-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-red-500">{error}</p>
                    </div>
                  )}

                  <button
                    onClick={handleInvest}
                    disabled={saving || numAmount <= 0 || insufficient}
                    className="w-full rounded-xl py-3.5 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-50"
                    style={{ background: "linear-gradient(135deg,#1e1b4b,#312e81)" }}
                  >
                    {saving ? "Investingâ€¦" : `Invest R${numAmount.toFixed(2)}`}
                  </button>
                </div>
              )}
            </>
          ) : (
            <motion.div
              className="text-center py-4"
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
            >
              <div className="h-16 w-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "linear-gradient(135deg,#e9d5ff,#d8b4fe)" }}>
                <Check className="h-8 w-8 text-purple-600" />
              </div>
              <p className="text-lg font-bold text-slate-900">Investment Placed!</p>
              <p className="text-sm text-slate-500 mt-2">
                R{numAmount.toFixed(2)} invested in {selected?.name} for {child.first_name}.
              </p>
              <button
                onClick={onClose}
                className="mt-6 w-full rounded-xl py-3.5 text-sm font-bold text-white active:scale-[0.98]"
                style={{ background: "linear-gradient(135deg,#1e1b4b,#312e81)" }}
              >
                Done
              </button>
            </motion.div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}




// â”€â”€â”€ TransactionRow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function TransactionRow({ tx }) {
  const isCredit = tx.direction === "credit";
  const date = tx.created_at ? new Date(tx.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) : "";
  return (
    <div className="flex items-center gap-3.5 py-3.5">
      <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-purple-100">
        {isCredit
          ? <ArrowDownLeft className="h-4.5 w-4.5 text-purple-600" />
          : <ArrowUpRight className="h-4.5 w-4.5 text-purple-600" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 truncate">{tx.description || tx.name || "Transaction"}</p>
        <p className="text-[11px] text-slate-600 mt-0.5">{date}</p>
      </div>
      <p className="text-sm font-bold tabular-nums text-purple-600">
        {isCredit ? "+" : "-"}{fmt(Math.round(Math.abs(tx.amount || 0) * 100))}
      </p>
    </div>
  );
}

// â”€â”€â”€ CompleteProfileModal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


function CompleteProfileModal({ child, parentProfile, onUpdate, onClose }) {
  const poaComplete = !!child.poa_declaration_url;
  const [step, setStep] = useState(() => {
    if (!child.id_number) return "id";
    if (!poaComplete) return "poa";
    return "agreement";
  });
  const [idInput, setIdInput] = useState("");
  const [idError, setIdError] = useState("");
  const [flowError, setFlowError] = useState("");
  const [saving, setSaving] = useState(false);

  const childName =
    [child.first_name, child.last_name].filter(Boolean).join(" ") || "your child";

  function verifyId(id) {
    const clean = String(id || "").replace(/\D/g, "");
    if (clean.length !== 13) return { ok: false, msg: "ID number must be exactly 13 digits." };
    if (child.date_of_birth) {
      const yy = clean.substring(0, 2);
      const mm = clean.substring(2, 4);
      const dd = clean.substring(4, 6);
      const y = parseInt(yy, 10);
      const fullYear = y <= new Date().getFullYear() % 100 ? `20${yy}` : `19${yy}`;
      const idDob = `${fullYear}-${mm}-${dd}`;
      if (idDob !== child.date_of_birth)
        return { ok: false, msg: "Date of birth in ID does not match the child's record." };
    }
    return { ok: true, clean };
  }

  async function handleIdSave() {
    const { ok, msg, clean } = verifyId(idInput);
    if (!ok) { setIdError(msg); return; }
    setSaving(true);
    setFlowError("");
    try {
      await fetch(`/api/family-members/${child.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_number: clean }),
      });
      onUpdate({ ...child, id_number: clean });
      if (!child.poa_declaration_url) { setStep("poa"); }
      else if (!child.signed_agreement_url) { setStep("agreement"); }
      else {
        // All steps already done â€” mark address_completed
        await fetch(`/api/family-members/${child.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address_completed: true }),
        });
        onUpdate({ ...child, id_number: clean, address_completed: true });
        onClose();
      }
    } catch { setIdError("Save failed. Please try again."); }
    finally { setSaving(false); }
  }

  async function handlePoaComplete({ livesWithParent, pdfBuffer, fileUpload, signedAt }) {
    setSaving(true);
    setFlowError("");
    try {
      let poaUrl = null;
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token && pdfBuffer) {
        throw new Error("Session expired. Please sign in again.");
      }

      if (pdfBuffer) {
        // Use chunked fromCharCode to avoid freezing the JS thread on mobile
        const uint8 = new Uint8Array(pdfBuffer);
        const CHUNK = 0x8000;
        let bin = "";
        for (let i = 0; i < uint8.length; i += CHUNK) {
          bin += String.fromCharCode.apply(null, uint8.subarray(i, i + CHUNK));
        }
        const pdfBase64 = btoa(bin);
        const res = await fetch("/api/onboarding/upload-agreement", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ pdfBase64, subjectId: child.id }),
        });
        const j = await res.json();
        if (!res.ok || !j.publicUrl) {
          throw new Error(j?.error || "Failed to upload proof of address.");
        }
        poaUrl = j.publicUrl;
      } else if (fileUpload && supabase) {
        const safeName = fileUpload.name.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "");
        const path = `poa/${child.id}/${Date.now()}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("birth-certificates").upload(path, fileUpload, { upsert: true });
        if (upErr) {
          throw new Error(upErr.message || "Failed to upload proof document.");
        }
        poaUrl = `storage://birth-certificates/${path}`;
      }
      if (poaUrl) {
        const patchRes = await fetch(`/api/family-members/${child.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            poa_declaration_url: poaUrl,
            address_completed: true,
          }),
        });
        if (!patchRes.ok) {
          const patchJson = await patchRes.json().catch(() => ({}));
          throw new Error(patchJson?.error || "Failed to save proof of address.");
        }
        onUpdate({ ...child, poa_declaration_url: poaUrl, address_completed: true });
      }
      onClose();
    } catch (e) {
      console.error("[complete-poa]", e);
      const message = e?.message || "Proof of address upload failed. Please try again.";
      setFlowError(message);
      throw new Error(message);
    } finally { setSaving(false); }
  }

  async function handleAgreementComplete({ pdfBuffer, signedAt }) {
    setSaving(true);
    setFlowError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Session expired. Please sign in again.");

      const uint8 = new Uint8Array(pdfBuffer);
      const CHUNK = 0x8000;
      let bin = "";
      for (let i = 0; i < uint8.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, uint8.subarray(i, i + CHUNK));
      }
      const pdfBase64 = btoa(bin);
      const uploadRes = await fetch("/api/onboarding/upload-agreement", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pdfBase64, subjectId: child.id }),
      });
      const uploadJson = await uploadRes.json();
      if (!uploadRes.ok || !uploadJson.publicUrl) {
        throw new Error(uploadJson?.error || "Failed to upload signed agreement.");
      }

      const patchRes = await fetch(`/api/family-members/${child.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signed_agreement_url: uploadJson.publicUrl, signed_at: signedAt, address_completed: true }),
      });
      if (!patchRes.ok) {
        const patchJson = await patchRes.json().catch(() => ({}));
        throw new Error(patchJson?.error || "Failed to save signed agreement.");
      }

      onUpdate({ ...child, signed_agreement_url: uploadJson.publicUrl, address_completed: true });
      onClose();
    } catch (e) {
      console.error("[complete-agreement]", e);
      const message = e?.message || "Signing failed. Please try again.";
      setFlowError(message);
      throw new Error(message);
    } finally { setSaving(false); }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => { if (!saving) onClose(); }} />
      <motion.div
        className="relative w-full max-w-md bg-white rounded-[32px] shadow-2xl max-h-[85vh] overflow-y-auto"
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
      >
        <div className="h-1 w-full" style={{ background: "linear-gradient(90deg,#8b5cf6,#6366f1)" }} />
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-slate-200" />
        </div>
        <div className="px-6 pt-2 pb-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#a78bfa,#7c3aed)" }}>
                <ClipboardList className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-base font-bold text-slate-900">Complete Profile</p>
                <p className="text-xs text-slate-400">
                  {step === "id" ? "Step 1 â€” ID number" :
                   step === "poa" ? "Proof of address" :
                   "Responsibility agreement"}
                </p>
              </div>
            </div>
            <button onClick={onClose} disabled={saving} className="h-8 w-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition disabled:opacity-50">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {flowError && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-xl px-4 py-2.5 mb-4">{flowError}</p>
          )}

          {/* Step: ID number */}
          {step === "id" && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600 leading-relaxed">
                Please provide <strong>{childName}'s</strong> SA ID number to complete their profile.
              </p>
              <input
                type="text"
                inputMode="numeric"
                maxLength={13}
                value={idInput}
                onChange={(e) => { setIdInput(e.target.value.replace(/\D/g, "")); setIdError(""); }}
                placeholder="13-digit ID number"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:border-violet-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-100 transition"
              />
              {idError && (
                <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-xl px-4 py-2.5">{idError}</p>
              )}
              <button
                onClick={handleIdSave}
                disabled={saving || idInput.length !== 13}
                className="w-full rounded-xl py-3.5 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#1e1b4b,#312e81)" }}
              >
                {saving ? "Savingâ€¦" : "Save & Continue"}
              </button>
            </div>
          )}

          {/* Step: POA */}
          {step === "poa" && (
            <MinorProofOfAddressDeclaration
              childData={child}
              parentProfile={parentProfile}
              saving={saving}
              onComplete={handlePoaComplete}
              onBack={() => {
                if (!child.id_number) setStep("id");
                else onClose();
              }}
            />
          )}

          {/* Step: Agreement */}
          {step === "agreement" && (
            <ChildResponsibilityAgreement
              parentProfile={parentProfile}
              childData={child}
              saving={saving}
              onBack={onClose}
              onComplete={handleAgreementComplete}
            />
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€â”€ Main Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

export default function ChildDashboardPage({ child: initialChild, onBack }) {
  const { profile } = useProfile();
  const isMounted = useRef(true);
  const [child, setChild] = useState(initialChild);
  const [holdings, setHoldings] = useState([]);
  const [strategyMap, setStrategyMap] = useState({});
  const [transactions, setTransactions] = useState([]);
  const [parentBalance, setParentBalance] = useState(null);
  const [parentBalanceLoading, setParentBalanceLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [showTransfer, setShowTransfer] = useState(false);
  const [openingTransfer, setOpeningTransfer] = useState(false);
  const [showInvest, setShowInvest] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);

  const childName = [child?.first_name, child?.last_name].filter(Boolean).join(" ") || "Child";
  const age = getAge(child?.date_of_birth);
  const parentName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || "Parent";
  const parentMintNumber = profile?.mintNumber || "";
  const childBalance = child?.available_balance || 0;
  const childKycStatus = String(child?.kyc_status || "pending").toLowerCase();
  const childKycLabel = childKycStatus === "completed"
    ? "KYC Completed"
    : childKycStatus === "rejected"
      ? "KYC Rejected"
      : "KYC Pending";

  const poaDone = !!child?.poa_declaration_url;
  const missingItems = [
    !child?.id_number && "ID number",
    !poaDone && "proof of address",
    !child?.signed_agreement_url && "responsibility agreement",
  ].filter(Boolean);
  const isProfileIncomplete = !child?.address_completed;

  useEffect(() => {
    isMounted.current = true;
    fetchAll();
    return () => { isMounted.current = false; };
  }, [child?.id]);

  async function fetchAll() {
    setLoading(true);
    try {
      await Promise.all([
        fetchHoldings(),
        fetchParentWallet(),
        fetchTransactions(),
        fetchChildBalance(),
      ]);
    } catch (e) {
      console.error("[child-dash] fetchAll error", e);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }

  async function fetchChildBalance() {
    try {
      const res = await fetch(`/api/child-wallet?family_member_id=${child.id}`);
      const json = await res.json();
      if (json.balance !== undefined && isMounted.current) {
        setChild(prev => ({ ...prev, available_balance: json.balance }));
      }
    } catch (e) { console.error("[child-dash] balance", e); }
  }

  async function fetchHoldings() {
    try {
      if (!supabase) return;
      const { data, error } = await supabase
        .from("stock_holdings_c")
        .select("id, security_id, quantity, avg_fill, market_value, unrealized_pnl, strategy_id")
        .eq("family_member_id", child.id)
        .eq("Status", "active")
        .order("market_value", { ascending: false });
      if (error) { console.error("[child-dash] holdings query error", error); return; }
      const baseRows = data || [];

      // Enrich with security info (symbol/name/logo_url live on securities_c)
      const securityIds = [...new Set(baseRows.map(h => h.security_id).filter(Boolean))];
      let secMap = {};
      if (securityIds.length > 0) {
        const { data: secs } = await supabase
          .from("securities_c")
          .select("id, symbol, name, logo_url")
          .in("id", securityIds);
        (secs || []).forEach(s => { secMap[s.id] = s; });
      }
      const rows = baseRows.map(h => {
        const sec = secMap[h.security_id] || {};
        return { ...h, symbol: sec.symbol || null, name: sec.name || null, logo_url: sec.logo_url || null };
      });
      if (isMounted.current) setHoldings(rows);

      // Fetch strategy names for any strategy holdings
      const stratIds = [...new Set(rows.map(h => h.strategy_id).filter(Boolean))];
      if (stratIds.length > 0) {
        const { data: strats } = await supabase
          .from("strategies_c")
          .select("id, name, short_name, risk_level, is_featured")
          .in("id", stratIds);
        const map = {};
        (strats || []).forEach(s => { map[s.id] = s; });
        if (isMounted.current) setStrategyMap(map);
      }
    } catch (e) { console.error("[child-dash] holdings", e); }
  }

  async function fetchParentWallet() {
    setParentBalanceLoading(true);
    try {
      if (!supabase) return;
      const userId = (await supabase.auth.getUser())?.data?.user?.id;
      if (!userId) return;
      const { data } = await supabase
        .from("wallets")
        .select("balance")
        .eq("user_id", userId)
        .maybeSingle();
      const balanceRands = Number(data?.balance || 0);
      const balanceCents = Math.round(balanceRands * 100);
      if (isMounted.current) setParentBalance(balanceCents);
    } catch (e) {
      console.error("[child-dash] parent wallet", e);
    } finally {
      if (isMounted.current) setParentBalanceLoading(false);
    }
  }

  async function openTransferModal() {
    setOpeningTransfer(true);
    await Promise.all([fetchParentWallet(), fetchChildBalance()]);
    if (isMounted.current) {
      setShowTransfer(true);
      setOpeningTransfer(false);
    }
  }

  async function fetchTransactions() {
    try {
      if (!supabase) return;
      const { data, error } = await supabase
        .from("transactions")
        .select("id, name, direction, amount, description, created_at")
        .eq("family_member_id", child.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) { console.error("[child-dash] txns query error", error); return; }
      if (isMounted.current) setTransactions(data || []);
    } catch (e) { console.error("[child-dash] txns", e); }
  }

  function handleTransferDone(result) {
    if (result.child_balance !== undefined) {
      setChild(prev => ({ ...prev, available_balance: result.child_balance }));
    }
    if (result.parent_balance !== undefined) {
      setParentBalance(result.parent_balance);
    }
    fetchTransactions();
    fetchHoldings();
  }

  function handleInvestDone(result) {
    if (result.child_balance !== undefined) {
      setChild(prev => ({ ...prev, available_balance: result.child_balance }));
    }
    fetchHoldings();
    fetchTransactions();
  }

  // market_value and avg_fill are stored in rands; convert to cents for fmt
  const totalPortfolioCents = holdings.reduce((s, h) => s + Math.round((h.market_value || 0) * 100), 0);


  // Group holdings by strategy
  const strategyGroups = holdings.reduce((acc, h) => {
    if (!h.strategy_id) return acc;
    if (!acc[h.strategy_id]) acc[h.strategy_id] = [];
    acc[h.strategy_id].push(h);
    return acc;
  }, {});

  const strategyCards = Object.entries(strategyGroups).map(([sid, hs]) => {
    const strat = strategyMap[sid] || {};
    const totalValueCents = hs.reduce((s, h) => s + Math.round((h.market_value || 0) * 100), 0);
    const totalCostCents = hs.reduce((s, h) => s + Math.round(Number(h.avg_fill || 0) * Number(h.quantity || 0) * 100), 0);
    const pnlCents = totalValueCents - totalCostCents;
    const pnlP = totalCostCents > 0 ? (pnlCents / totalCostCents) * 100 : 0;
    return { id: sid, name: strat.name || "Strategy", short_name: strat.short_name, risk_level: strat.risk_level, is_featured: strat.is_featured, totalValue: totalValueCents, pnl: pnlCents, pnlPct: pnlP, holdings: hs };
  });

  // Best performing individual assets (top 5 by unrealized_pnl %)
  const bestAssets = [...holdings]
    .filter(h => h.symbol && h.market_value > 0)
    .map(h => {
      const costRands = Number(h.avg_fill || 0) * Number(h.quantity || 0);
      const marketRands = h.market_value || 0;
      const pnlR = marketRands - costRands;
      const pnlP = costRands > 0 ? ((marketRands - costRands) / costRands) * 100 : 0;
      return { ...h, pnlR, pnlP };
    })
    .sort((a, b) => b.pnlP - a.pnlP)
    .slice(0, 5);



  return (
    <div
      className="min-h-screen pb-[env(safe-area-inset-bottom)]"
      style={{
        backgroundColor: "#f8f6fa",
        backgroundImage: "linear-gradient(180deg,#0d0d12 0%,#0e0a14 0.5%,#100b18 1%,#120c1c 1.5%,#150e22 2%,#181028 2.5%,#1c122f 3%,#201436 3.5%,#25173e 4%,#2a1a46 5%,#301d4f 6%,#362158 7%,#3d2561 8%,#44296b 9%,#4c2e75 10%,#54337f 11%,#5d3889 12%,#663e93 13%,#70449d 14%,#7a4aa7 15%,#8451b0 16%,#8e58b9 17%,#9860c1 18%,#a268c8 19%,#ac71ce 20%,#b57ad3 21%,#be84d8 22%,#c68edc 23%,#cd98e0 24%,#d4a2e3 25%,#daace6 26%,#dfb6e9 27%,#e4c0eb 28%,#e8c9ed 29%,#ecd2ef 30%,#efdaf1 31%,#f2e1f3 32%,#f4e7f5 33%,#f6ecf7 34%,#f8f0f9 35%,#f9f3fa 36%,#faf5fb 38%,#fbf7fc 40%,#fcf9fd 42%,#fdfafd 45%,#faf8fc 55%,#f8f6fa 100%)",
        backgroundRepeat: "no-repeat",
        backgroundSize: "100% 100vh",
        backgroundAttachment: "fixed",
      }}
    >
      {/* â”€â”€ Header â”€â”€ */}
      <div className="px-4 pt-12 pb-6">
        <div className="mx-auto w-full max-w-sm md:max-w-md">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/90 backdrop-blur-md text-slate-700 border border-slate-200 shadow-sm transition hover:bg-white active:scale-95"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex-1" />
          </div>

          <div className="mt-4">
            <SwipeableBalanceCard
              userId={null}
              mintNumber={parentMintNumber || null}
              overrideBalance={totalPortfolioCents / 100}
              overrideWalletBalance={childBalance / 100}
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto w-full max-w-sm px-4 pb-12 md:max-w-md">
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-4">

          {/* â”€â”€ Incomplete profile banner â”€â”€ */}
          {isProfileIncomplete && (
            <motion.div variants={item}>
              <button
                onClick={() => setShowCompleteModal(true)}
                className="w-full flex items-center gap-3 rounded-2xl px-4 py-4 text-left transition active:scale-[0.98]"
                style={{ background: "linear-gradient(135deg,#fef3c7,#fef9c3)", border: "1px solid #fde68a" }}
              >
                <div className="h-9 w-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="h-4.5 w-4.5 text-amber-600" style={{ height: "1.125rem", width: "1.125rem" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-amber-800">Complete {child?.first_name}'s profile</p>
                  <p className="text-xs text-amber-700 mt-0.5 truncate">
                    Missing: {missingItems.join(", ")}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-amber-600 flex-shrink-0" />
              </button>
            </motion.div>
          )}

          {/* Quick Actions */}
          <motion.div variants={item}>
            <div className="grid grid-cols-4 gap-2 text-[11px] font-medium">
              {[
                { label: "Learn", icon: BookOpen, onClick: null, comingSoon: true },
                { label: "Invest", icon: LayoutGrid, onClick: () => setShowInvest(true) },
                { label: "Deposit", icon: ArrowDownToLine, onClick: openTransferModal, disabled: openingTransfer },
                { label: "Goals", icon: Target, onClick: null, comingSoon: true },
              ].map((btn, i) => {
                const Icon = btn.icon;
                return (
                  <button
                    key={i}
                    disabled={btn.comingSoon || btn.disabled}
                    onClick={btn.onClick}
                    className={`relative flex flex-col items-center gap-2 rounded-2xl px-1 py-3 transition-all ${
                      btn.comingSoon
                        ? "bg-slate-100/70 cursor-not-allowed border border-slate-200/60"
                        : "bg-white shadow-md active:scale-95 active:shadow-sm"
                    } disabled:opacity-60`}
                    type="button"
                  >
                    <span className={`flex h-8 w-8 items-center justify-center rounded-full ${
                      btn.comingSoon ? "bg-slate-200 text-slate-400" : "bg-violet-50 text-violet-700"
                    }`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className={`text-center leading-tight font-medium ${
                      btn.comingSoon ? "text-slate-400" : "text-slate-700"
                    }`}>
                      {btn.disabled && !btn.comingSoon ? "Loading…" : btn.label}
                    </span>
                    {btn.comingSoon && (
                      <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 inline-flex items-center px-1.5 py-px rounded-full text-[7px] font-bold uppercase tracking-wider text-white" style={{ background: "linear-gradient(90deg,#7c3aed,#a855f7)" }}>Soon</span>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>

          {/* â”€â”€ Strategy Holdings â”€â”€ */}
          <motion.div variants={item}>
            <div className="flex items-center gap-2 mb-3 px-1">
              <div className="h-2 w-2 rounded-full bg-slate-300" />
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Strategies</p>
            </div>

            {strategyCards.length > 0 ? (
              <div className="space-y-3">
                {strategyCards.map((sc) => {
                  const isUp = sc.pnl >= 0;
                  return (
                    <div key={sc.id} className="rounded-2xl border border-slate-200 bg-white shadow-md p-4">
                      {/* Header */}
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0"
                            style={{ background: "linear-gradient(135deg,#ede9fe,#ddd6fe)" }}>
                            <BarChart3 className="h-5 w-5 text-purple-600" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-900 truncate">{sc.short_name || sc.name}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {sc.risk_level && (
                                <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-violet-50 text-violet-600 border border-violet-100">{sc.risk_level}</span>
                              )}
                              {sc.is_featured && (
                                <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-violet-100 text-violet-700">Featured</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-bold text-slate-900 tabular-nums">{fmt(sc.totalValue)}</p>
                          <p className={`text-xs font-semibold tabular-nums ${isUp ? "text-emerald-600" : "text-red-500"}`}>
                            {isUp ? "+" : ""}{fmt(sc.pnl)} ({isUp ? "+" : ""}{sc.pnlPct.toFixed(2)}%)
                          </p>
                        </div>
                      </div>
                      {/* Holdings avatar row */}
                      {sc.holdings.length > 0 && (
                        <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                          <div className="flex -space-x-2">
                            {sc.holdings.slice(0, 4).map(h => (
                              <div key={h.id} className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-white shadow-sm">
                                {h.logo_url ? (
                                  <img src={h.logo_url} alt={h.symbol} className="h-full w-full object-cover" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center bg-slate-100 text-[8px] font-bold text-slate-600">
                                    {h.symbol?.substring(0, 2)}
                                  </div>
                                )}
                              </div>
                            ))}
                            {sc.holdings.length > 4 && (
                              <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-[10px] font-semibold text-slate-500">
                                +{sc.holdings.length - 4}
                              </div>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400">{sc.holdings.length} holding{sc.holdings.length !== 1 ? "s" : ""}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 p-8 text-center shadow-lg bg-white">
                <div className="h-16 w-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "linear-gradient(135deg,#e9d5ff,#d8b4fe)" }}>
                  <BarChart3 className="h-7 w-7 text-purple-600" />
                </div>
                <p className="text-sm font-bold text-slate-900">No investments yet</p>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  Start investing on {child?.first_name}'s behalf to build their future portfolio.
                </p>
                <button
                  onClick={() => setShowInvest(true)}
                  className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-purple-600 hover:text-purple-700 transition"
                >
                  <BarChart3 className="h-4 w-4" /> Browse Strategies
                </button>
              </div>
            )}
          </motion.div>

          {/* â”€â”€ Best Performing Assets â”€â”€ */}
          {bestAssets.length > 0 && (
            <motion.div variants={item}>
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className="h-2 w-2 rounded-full bg-emerald-400" />
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Best Performing Assets</p>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 snap-x [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {bestAssets.map(a => {
                  const isUp = a.pnlR >= 0;
                  return (
                    <div key={a.id} className="flex min-w-[220px] flex-shrink-0 snap-start items-center gap-3 rounded-2xl bg-white border border-slate-100 shadow-md p-3.5">
                      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-100">
                        {a.logo_url ? (
                          <img src={a.logo_url} alt={a.name} className="h-9 w-9 object-contain" />
                        ) : (
                          <span className="text-[10px] font-bold text-slate-600">{a.symbol?.substring(0, 3)}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">{a.symbol}</p>
                        <p className="text-[10px] text-slate-500 truncate">{a.name}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={`text-sm font-bold tabular-nums ${isUp ? "text-emerald-500" : "text-red-500"}`}>
                          {isUp ? "+" : ""}{fmt(Math.round(a.pnlR * 100))}
                        </p>
                        <p className={`text-[10px] font-semibold tabular-nums ${isUp ? "text-emerald-500" : "text-red-500"}`}>
                          ({isUp ? "+" : ""}{a.pnlP.toFixed(2)}%)
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* â”€â”€ Recent Activity â”€â”€ */}
          <motion.div variants={item}>
            <div className="flex items-center gap-2 mb-3 px-1">
              <div className="h-2 w-2 rounded-full bg-slate-300" />
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Recent Activity</p>
            </div>

            {transactions.length > 0 ? (
              <div className="rounded-2xl overflow-hidden shadow-lg border border-slate-200 bg-white">
                <div className="divide-y divide-slate-100 px-5">
                  {transactions.map((tx) => (
                    <TransactionRow key={tx.id} tx={tx} />
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 p-6 text-center shadow-lg bg-white">
                <p className="text-xs text-slate-600">No activity yet. Transfer or invest to get started.</p>
              </div>
            )}
          </motion.div>

          {/* â”€â”€ Account Info â”€â”€ */}
          <motion.div variants={item}>
            <div className="flex items-center gap-2 mb-3 px-1">
              <div className="h-2 w-2 rounded-full bg-slate-300" />
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Account Details</p>
            </div>
            <div className="rounded-2xl shadow-lg border border-slate-200 p-5 bg-white">
              <div className="space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Account Type</span>
                  <span className="font-semibold text-slate-900">Child (Minor)</span>
                </div>
                {child?.mint_number && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Mint Number</span>
                    <span className="font-mono text-xs font-semibold text-slate-900">{child.mint_number}</span>
                  </div>
                )}
                {age !== null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Age</span>
                    <span className="font-semibold text-slate-900">{age} year{age !== 1 ? "s" : ""}</span>
                  </div>
                )}
                {child?.date_of_birth && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Date of Birth</span>
                    <span className="font-semibold text-slate-900">
                      {new Date(child.date_of_birth).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm border-t border-slate-100 pt-4">
                  <span className="text-slate-600">Managed By</span>
                  <span className="font-semibold text-slate-900">{parentName}</span>
                </div>
                {parentMintNumber && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Parent Mint #</span>
                    <span className="font-mono text-xs font-semibold text-slate-900">{parentMintNumber}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">KYC Status</span>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide border ${
                      childKycStatus === "completed"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : childKycStatus === "rejected"
                          ? "bg-red-50 text-red-700 border-red-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${childKycStatus === "pending" ? "animate-pulse" : ""}`} style={{ backgroundColor: "currentColor" }} />
                    {childKycLabel}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>

        </motion.div>
      </div>

      {/* â”€â”€ Modals â”€â”€ */}
      <AnimatePresence>
        {showTransfer && (
          <TransferModal
            child={child}
            parentBalance={parentBalance}
            balancesLoading={parentBalanceLoading}
            onTransfer={handleTransferDone}
            onClose={() => setShowTransfer(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showInvest && (
          <InvestModal
            child={child}
            onInvest={handleInvestDone}
            onClose={() => setShowInvest(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showCompleteModal && (
          <CompleteProfileModal
            child={child}
            parentProfile={profile}
            onUpdate={(updated) => setChild(updated)}
            onClose={() => setShowCompleteModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
