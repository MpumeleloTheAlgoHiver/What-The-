import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, ArrowUpRight, ArrowDownLeft, X, TrendingUp, TrendingDown,
  ShieldCheck, Baby, Wallet, BarChart3, ChevronRight,
  RefreshCw, Search, Star, AlertCircle, Check, ClipboardList,
} from "lucide-react";
import { useProfile } from "../lib/useProfile";
import { supabase } from "../lib/supabase";
import MinorProofOfAddressDeclaration from "../components/MinorProofOfAddressDeclaration";
import ChildResponsibilityAgreement from "../components/ChildResponsibilityAgreement";

// ─── helpers ────────────────────────────────────────────────────────────────

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


// ─── Animation variants ─────────────────────────────────────────────────────

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};
const item = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 340, damping: 28 } },
};

// ─── Avatar ──────────────────────────────────────────────────────────────────

function Avatar({ name, gradient, size = "h-14 w-14", text = "text-xl" }) {
  const initial = (name || "?")[0].toUpperCase();
  return (
    <div
      className={`${size} rounded-2xl flex items-center justify-center font-bold text-white flex-shrink-0`}
      style={{ background: gradient, aspectRatio: "1" }}
    >
      <span className={text}>{initial}</span>
    </div>
  );
}

// ─── Transfer Modal (bottom-sheet) ───────────────────────────────────────────

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
                    {balancesLoading ? "Loading…" : fmt(parentBalance)}
                  </p>
                </div>
                <ArrowUpRight className="h-4 w-4 text-slate-300" />
                <div className="text-right">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{child.first_name}'s Wallet</p>
                  <p className="text-sm font-bold text-slate-900 tabular-nums mt-0.5">
                    {balancesLoading ? "Loading…" : fmt(child.available_balance || 0)}
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
                {saving ? "Transferring…" : `Transfer R${numAmount.toFixed(2)}`}
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

// ─── Invest Modal (bottom-sheet) — browse strategies & invest ────────────────

function InvestModal({ child, onInvest, onClose }) {
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const childBalance = child.available_balance || 0;
  const numAmount = parseFloat(amount) || 0;
  const amountCents = Math.round(numAmount * 100);
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
        .select("id, name, description, risk_level, min_investment, is_featured, strategy_metrics(*)")
        .eq("is_active", true)
        .order("is_featured", { ascending: false })
        .order("name")
        .order("as_of_date", { foreignTable: "strategy_metrics", ascending: false })
        .limit(1, { foreignTable: "strategy_metrics" });
      setStrategies(data || []);
    } catch (e) { console.error("[child-invest] strategies", e); }
    finally { setLoading(false); }
  }

  async function handleInvest() {
    if (!selected) return;
    if (numAmount <= 0) { setError("Enter a valid amount."); return; }
    if (insufficient) { setError("Insufficient funds in child's wallet."); return; }

    const minInv = (selected.min_investment || 0);
    if (amountCents < minInv) {
      setError(`Minimum investment is ${fmt(minInv)}.`);
      return;
    }

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

  const riskColors = {
    low: { bg: "#faf5ff", text: "#7c3aed" },
    medium: { bg: "#f3e8ff", text: "#8b5cf6" },
    high: { bg: "#ede9fe", text: "#6d28d9" },
    aggressive: { bg: "#ede9fe", text: "#6d28d9" },
  };

  const inputCls =
    "w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:border-violet-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-100 transition";

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        className="relative w-full max-w-md bg-white rounded-t-3xl shadow-2xl overflow-hidden pb-[env(safe-area-inset-bottom)]"
        style={{ maxHeight: "85vh" }}
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
      >
        <div className="flex justify-center pt-3 pb-1"><div className="h-1 w-10 rounded-full bg-slate-200" /></div>

        <div className="px-6 pt-3 pb-8 overflow-y-auto" style={{ maxHeight: "calc(85vh - 24px)" }}>
          {!success ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  {selected && (
                    <button
                      onClick={() => { setSelected(null); setAmount(""); setError(""); }}
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
                      placeholder="Search strategies…"
                      className={inputCls + " pl-10"}
                    />
                  </div>

                  {loading ? (
                    <div className="flex items-center justify-center py-10">
                      <RefreshCw className="h-5 w-5 text-slate-300 animate-spin" />
                    </div>
                  ) : filtered.length === 0 ? (
                    <p className="text-center text-sm text-slate-400 py-8">No strategies found.</p>
                  ) : (
                    <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
                      {filtered.map((s) => {
                        const metric = s.strategy_metrics?.[0] || {};
                        const changePct = metric.change_pct || metric.r_1y || 0;
                        const isUp = changePct >= 0;
                        const risk = (s.risk_level || "medium").toLowerCase();
                        const rc = riskColors[risk] || riskColors.medium;
                        return (
                          <button
                            key={s.id}
                            onClick={() => setSelected(s)}
                            className="w-full flex items-center gap-3 rounded-xl bg-slate-50 border border-slate-100 p-3.5 text-left hover:bg-purple-50/50 hover:border-purple-200 transition active:scale-[0.98]"
                          >
                            <div
                              className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0"
                              style={{ background: isUp ? "linear-gradient(135deg,#ede9fe,#ddd6fe)" : "linear-gradient(135deg,#e9d5ff,#d8b4fe)" }}
                            >
                              {isUp
                                ? <TrendingUp className="h-4 w-4 text-purple-600" />
                                : <TrendingDown className="h-4 w-4 text-purple-500" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-slate-900 truncate">{s.name}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span
                                  className="text-[10px] font-bold rounded-full px-2 py-0.5"
                                  style={{ background: rc.bg, color: rc.text }}
                                >
                                  {s.risk_level || "Medium"}
                                </span>
                                {s.is_featured && <Star className="h-3 w-3 text-purple-400" />}
                                {s.min_investment > 0 && (
                                  <span className="text-[10px] text-slate-400">Min {fmt(s.min_investment)}</span>
                                )}
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-sm font-bold tabular-nums text-purple-600">
                                {isUp ? "+" : ""}{changePct.toFixed(1)}%
                              </p>
                              <ChevronRight className="h-3.5 w-3.5 text-slate-300 ml-auto mt-0.5" />
                            </div>
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
                    Investment Amount (ZAR)
                  </label>
                  <div className="relative mb-4">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">R</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-lg font-bold text-slate-800 text-center placeholder-slate-400 focus:border-violet-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-100 transition tabular-nums pl-10"
                      autoFocus
                    />
                  </div>

                  {/* Quick amounts */}
                  <div className="flex gap-2 mb-5">
                    {[100, 250, 500, 1000].map((v) => (
                      <button
                        key={v}
                        onClick={() => setAmount(String(v))}
                        className="flex-1 rounded-lg py-2 text-xs font-bold text-purple-600 bg-purple-50 border border-purple-100 hover:bg-purple-100 transition active:scale-95"
                      >
                        R{v}
                      </button>
                    ))}
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
                    {saving ? "Investing…" : `Invest R${numAmount.toFixed(2)}`}
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

// ─── HoldingRow ──────────────────────────────────────────────────────────────

function HoldingRow({ holding }) {
  const isUp = (holding.unrealized_pnl || 0) >= 0;
  const securitySymbol = holding.securities?.symbol || `SEC-${String(holding.security_id || "").slice(0, 6)}`;
  const securityName = holding.securities?.name || "Security";
  return (
    <div className="flex items-center gap-3.5 rounded-xl shadow-lg border border-slate-200 p-4 bg-white">
      <div
        className="h-11 w-11 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: isUp ? "linear-gradient(135deg,#ede9fe,#ddd6fe)" : "linear-gradient(135deg,#e9d5ff,#d8b4fe)" }}
      >
        {isUp
          ? <TrendingUp className="h-5 w-5 text-purple-600" />
          : <TrendingDown className="h-5 w-5 text-purple-500" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-slate-900 truncate">{securitySymbol}</p>
        <p className="text-[11px] text-slate-600 truncate font-medium">{securityName}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-bold text-slate-900 tabular-nums">{fmt(holding.market_value || 0)}</p>
        <p className="text-[11px] font-semibold tabular-nums text-purple-600">
          {isUp ? "+" : ""}{fmt(holding.unrealized_pnl || 0)}
        </p>
      </div>
    </div>
  );
}

// ─── TransactionRow ──────────────────────────────────────────────────────────

function TransactionRow({ tx }) {
  const isCredit = tx.direction === "credit" || tx.type === "transfer_in";
  const date = tx.created_at ? new Date(tx.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) : "";
  return (
    <div className="flex items-center gap-3.5 py-3.5">
      <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-purple-100">
        {isCredit
          ? <ArrowDownLeft className="h-4.5 w-4.5 text-purple-600" />
          : <ArrowUpRight className="h-4.5 w-4.5 text-purple-600" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 truncate">{tx.description || tx.type || "Transaction"}</p>
        <p className="text-[11px] text-slate-600 mt-0.5">{date}</p>
      </div>
      <p className="text-sm font-bold tabular-nums text-purple-600">
        {isCredit ? "+" : "-"}{fmt(Math.abs(tx.amount || 0))}
      </p>
    </div>
  );
}

// ─── CompleteProfileModal ────────────────────────────────────────────────────

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
        // All steps already done — mark address_completed
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
      if (!token && livesWithParent && pdfBuffer) {
        throw new Error("Session expired. Please sign in again.");
      }

      if (livesWithParent && pdfBuffer) {
        const uint8 = new Uint8Array(pdfBuffer);
        let bin = "";
        for (let i = 0; i < uint8.length; i++) bin += String.fromCharCode(uint8[i]);
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
      } else if (!livesWithParent && fileUpload && supabase) {
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
      className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => { if (!saving) onClose(); }} />
      <motion.div
        className="relative w-full max-w-md bg-white rounded-t-3xl shadow-2xl pb-[env(safe-area-inset-bottom)]"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
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
                  {step === "id" ? "Step 1 — ID number" :
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
                {saving ? "Saving…" : "Save & Continue"}
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

// ═════════════════════════════════════════════════════════════════════════════
// ─── Main Page ──────────────────════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════════════════

export default function ChildDashboardPage({ child: initialChild, onBack }) {
  const { profile } = useProfile();
  const isMounted = useRef(true);
  const [child, setChild] = useState(initialChild);
  const [holdings, setHoldings] = useState([]);
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
    await Promise.all([
      fetchHoldings(),
      fetchParentWallet(),
      fetchTransactions(),
      fetchChildBalance(),
    ]);
    if (isMounted.current) setLoading(false);
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
      const { data } = await supabase
        .from("stock_holdings_c")
        .select("id, security_id, quantity, avg_fill, market_value, unrealized_pnl, strategy_id, securities(symbol, name)")
        .eq("family_member_id", child.id)
        .order("market_value", { ascending: false });
      if (isMounted.current) setHoldings(data || []);
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
      const { data } = await supabase
        .from("transactions")
        .select("id, type, direction, amount, description, created_at")
        .eq("family_member_id", child.id)
        .order("created_at", { ascending: false })
        .limit(10);
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

  const totalPortfolio = holdings.reduce((s, h) => s + (h.market_value || 0), 0);
  const totalPnl = holdings.reduce((s, h) => s + (h.unrealized_pnl || 0), 0);
  const pnlPct = totalPortfolio > 0 ? ((totalPnl / Math.max(totalPortfolio - totalPnl, 1)) * 100) : 0;
  const isPortUp = totalPnl >= 0;

  // Avatar gradient based on first letter hash
  const gradients = [
    "linear-gradient(135deg,#7c3aed,#5b21b6)",
    "linear-gradient(135deg,#a855f7,#7c3aed)",
    "linear-gradient(135deg,#8b5cf6,#6366f1)",
    "linear-gradient(135deg,#a78bfa,#7c3aed)",
    "linear-gradient(135deg,#9333ea,#7c3aed)",
  ];
  const avatarGradient = gradients[(childName.charCodeAt(0) || 0) % gradients.length];

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
      {/* ── Header ── */}
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

          {/* Child profile card */}
          <div className="flex flex-col items-center mt-6">
            <Avatar name={childName} gradient={avatarGradient} size="h-24 w-24" text="text-4xl" />
            <h1 className="text-2xl font-bold text-slate-800 mt-4 tracking-tight">{childName}</h1>
            <div className="flex items-center gap-2 mt-2">
              <span className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[11px] font-bold tracking-wide bg-white/90 backdrop-blur-md text-slate-700 border border-slate-200 shadow-sm">
                <Baby className="h-3.5 w-3.5" />
                {age !== null ? `${age} yr${age !== 1 ? "s" : ""} old` : "Child"}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold tracking-wide border ${
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
            <div className="flex items-center gap-1.5 mt-2">
              <ShieldCheck className="h-3.5 w-3.5 text-slate-500" />
              <span className="text-[11px] text-slate-600">
                Managed by {parentName}
                {parentMintNumber ? ` · #${parentMintNumber}` : ""}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="mx-auto w-full max-w-sm px-4 pb-12 md:max-w-md">
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-4">

          {/* ── Incomplete profile banner ── */}
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

          {/* ── Unified Wallet + Portfolio Card ── */}
          <motion.div
            variants={item}
            className="rounded-3xl relative overflow-hidden"
            style={{
              background: "linear-gradient(160deg, #1e1b4b 0%, #312e81 45%, #4c1d95 100%)",
              boxShadow: "0 24px 48px -12px rgba(79,70,229,0.45)",
            }}
          >
            {/* Subtle glare orbs */}
            <div className="pointer-events-none absolute -top-16 -right-16 h-64 w-64 rounded-full" style={{ background: "radial-gradient(circle, rgba(255,255,255,0.07), transparent 70%)" }} />
            <div className="pointer-events-none absolute -bottom-12 -left-12 h-48 w-48 rounded-full" style={{ background: "radial-gradient(circle, rgba(168,85,247,0.18), transparent 70%)" }} />

            <div className="relative px-6 pt-7 pb-6">

              {/* Label row */}
              <div className="flex items-center justify-between mb-1">
                <p className="text-[11px] font-semibold tracking-[0.18em] text-white/50 uppercase">Available Balance</p>
                <span className="text-[10px] font-semibold tracking-wider text-white/35 uppercase">{child?.first_name}'s Wallet</span>
              </div>

              {/* Wallet balance */}
              <p className="text-[2.85rem] font-bold text-white tracking-tight leading-none mb-6">{fmt(childBalance)}</p>

              {/* Hairline divider */}
              <div className="h-px w-full mb-5" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)" }} />

              {/* Portfolio row */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <p className="text-[10px] font-semibold tracking-[0.16em] text-white/45 uppercase mb-1">Portfolio Value</p>
                  <p className="text-2xl font-bold text-white tracking-tight">{fmt(totalPortfolio)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-semibold tracking-[0.16em] text-white/45 uppercase mb-1">All-time return</p>
                  <span
                    className="inline-flex items-center gap-1 text-sm font-bold"
                    style={{ color: isPortUp ? "#86efac" : "#fca5a5" }}
                  >
                    {isPortUp ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                    {isPortUp ? "+" : ""}{fmt(totalPnl)}&nbsp;
                    <span className="font-semibold opacity-80">({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)</span>
                  </span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-3">
                <button
                  onClick={openTransferModal}
                  disabled={openingTransfer}
                  className="flex-1 flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white transition active:scale-[0.97]"
                  style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.14)", backdropFilter: "blur(12px)" }}
                >
                  <ArrowDownLeft className="h-4 w-4" />
                  {openingTransfer ? "Loading…" : "Transfer"}
                </button>
                <button
                  onClick={() => setShowInvest(true)}
                  className="flex-1 flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white transition active:scale-[0.97]"
                  style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.14)", backdropFilter: "blur(12px)" }}
                >
                  <BarChart3 className="h-4 w-4" />
                  Invest
                </button>
              </div>
            </div>
          </motion.div>

          {/* ── Holdings ── */}
          <motion.div variants={item}>
            <div className="flex items-center gap-2 mb-3 px-1">
              <div className="h-2 w-2 rounded-full bg-slate-300" />
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Holdings</p>
              <span className="text-[10px] text-slate-400 ml-auto">{holdings.length} investment{holdings.length !== 1 ? "s" : ""}</span>
            </div>

            {holdings.length > 0 ? (
              <div className="space-y-2">
                {holdings.map((h) => (
                  <HoldingRow key={h.id} holding={h} />
                ))}
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

          {/* ── Recent Activity ── */}
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

          {/* ── Account Info ── */}
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

      {/* ── Modals ── */}
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
