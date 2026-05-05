import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft, Crown, Heart, Baby, Sparkles, TrendingUp, Wallet,
  ShieldCheck, BarChart2, Clock
} from "lucide-react";
import { supabase } from "../lib/supabase";

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

function Avatar({ name, size = 72, gradient }) {
  const initial = (name || "?")[0].toUpperCase();
  return (
    <div
      className="rounded-3xl flex items-center justify-center font-bold text-white flex-shrink-0"
      style={{ width: size, height: size, background: gradient, fontSize: size * 0.38 }}
    >
      {initial}
    </div>
  );
}

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.04 } },
};
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 340, damping: 28 } },
};

const GRADIENTS = {
  spouse: "linear-gradient(135deg,#fb7185,#e11d48)",
  child: "linear-gradient(135deg,#818cf8,#6366f1)",
};

const ROLE_COLORS = {
  spouse: { bg: "#fff1f2", text: "#e11d48" },
  child:  { bg: "#eff6ff", text: "#2563eb" },
};

export default function MemberPortfolioPage({ member, onBack }) {
  const [holdings, setHoldings] = useState([]);
  const [loadingHoldings, setLoadingHoldings] = useState(true);
  const [portfolioValue, setPortfolioValue] = useState(0);

  const isSpouse = member?.relationship === "spouse";
  const age = getAge(member?.date_of_birth);
  const fullName = [member?.first_name, member?.last_name].filter(Boolean).join(" ");
  const gradient = GRADIENTS[member?.relationship] || GRADIENTS.child;
  const roleColor = ROLE_COLORS[member?.relationship] || ROLE_COLORS.child;

  useEffect(() => {
    if (member?.id) fetchHoldings();
  }, [member?.id]);

  async function fetchHoldings() {
    setLoadingHoldings(true);
    try {
      if (!supabase) return;
      const { data } = await supabase
        .from("stock_holdings_c")
        .select("id, symbol, name, quantity, average_cost, market_value, unrealized_pnl, logo_url")
        .eq("user_id", member.id)
        .is("family_member_id", null);
      const h = data || [];
      setHoldings(h);
      setPortfolioValue(h.reduce((s, x) => s + (x.market_value || 0), 0));
    } catch (e) {
      console.error("[member-portfolio]", e);
    } finally {
      setLoadingHoldings(false);
    }
  }

  if (!member) return null;

  return (
    <div
      className="min-h-screen pb-[env(safe-area-inset-bottom)]"
      style={{
        backgroundColor: "#f8f6fa",
        backgroundImage:
          "linear-gradient(180deg,#0d0d12 0%,#0e0a14 0.5%,#100b18 1%,#120c1c 1.5%,#150e22 2%,#181028 2.5%,#1c122f 3%,#201436 3.5%,#25173e 4%,#2a1a46 5%,#301d4f 6%,#362158 7%,#3d2561 8%,#44296b 9%,#4c2e75 10%,#54337f 11%,#5d3889 12%,#663e93 13%,#70449d 14%,#7a4aa7 15%,#8451b0 16%,#8e58b9 17%,#9860c1 18%,#a268c8 19%,#ac71ce 20%,#b57ad3 21%,#be84d8 22%,#c68edc 23%,#cd98e0 24%,#d4a2e3 25%,#daace6 26%,#dfb6e9 27%,#e4c0eb 28%,#e8c9ed 29%,#ecd2ef 30%,#efdaf1 31%,#f2e1f3 32%,#f4e7f5 33%,#f6ecf7 34%,#f8f0f9 35%,#f9f3fa 36%,#faf5fb 38%,#fbf7fc 40%,#fcf9fd 42%,#fdfafd 45%,#faf8fc 55%,#f8f6fa 100%)",
        backgroundRepeat: "no-repeat",
        backgroundSize: "100% 100vh",
      }}
    >
      {/* ── Header ── */}
      <div className="px-4 pt-12 pb-6">
        <div className="mx-auto w-full max-w-sm md:max-w-md">
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={onBack}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition hover:bg-white/25 active:scale-95"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="text-center">
              <p className="text-xs text-white/50 font-semibold uppercase tracking-widest">
                {isSpouse ? "Spouse Account" : "Child Account"}
              </p>
            </div>
            <div className="w-10" />
          </div>

          {/* Member profile block */}
          <div className="flex flex-col items-center gap-3">
            <Avatar name={fullName} size={80} gradient={gradient} />
            <div className="text-center">
              <h1 className="text-2xl font-bold text-white tracking-tight">{fullName}</h1>
              <div className="flex items-center justify-center gap-2 mt-1.5 flex-wrap">
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                  style={{ background: "rgba(255,255,255,0.15)", color: "#fff" }}
                >
                  {isSpouse
                    ? <Heart className="h-3 w-3" />
                    : <Baby className="h-3 w-3" />}
                  {isSpouse ? "Spouse" : age !== null ? `Age ${age}` : "Child"}
                </span>
                {member.mint_number && (
                  <span className="text-[11px] font-mono text-white/40">{member.mint_number}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="mx-auto w-full max-w-sm px-4 pb-12 md:max-w-md">
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-4">

          {/* ── Portfolio value card ── */}
          <motion.div
            variants={item}
            className="rounded-3xl p-5 relative overflow-hidden"
            style={{ background: "linear-gradient(135deg,#1e1b4b 0%,#312e81 50%,#3730a3 100%)" }}
          >
            <div className="absolute -top-8 -right-8 h-36 w-36 rounded-full opacity-10" style={{ background: "radial-gradient(circle,#fff,transparent)" }} />
            <div className="absolute -bottom-10 -left-6 h-28 w-28 rounded-full opacity-10" style={{ background: "radial-gradient(circle,#818cf8,transparent)" }} />
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-7 w-7 rounded-lg bg-white/15 flex items-center justify-center">
                  <Sparkles className="h-3.5 w-3.5 text-white/80" />
                </div>
                <p className="text-[11px] font-bold tracking-widest text-white/50 uppercase">Portfolio Value</p>
              </div>
              <p className="text-4xl font-bold text-white tracking-tight">{fmt(portfolioValue)}</p>
              <div className="flex items-center gap-2 mt-3">
                <span
                  className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold"
                  style={{ background: "rgba(52,211,153,0.2)", color: "#6ee7b7" }}
                >
                  <TrendingUp className="h-3 w-3" />
                  +R 0.00
                </span>
                <span className="text-xs text-white/40">0.0% all time</span>
              </div>
            </div>
          </motion.div>

          {/* ── Holdings ── */}
          <motion.div variants={item}>
            <div className="flex items-center gap-2 mb-3 px-1">
              <div className="h-1.5 w-1.5 rounded-full bg-slate-300" />
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Holdings</p>
            </div>

            {loadingHoldings ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="rounded-2xl bg-white shadow-sm border border-slate-100 p-4 animate-pulse">
                    <div className="flex items-center gap-3">
                      <div className="h-11 w-11 rounded-xl bg-slate-100 flex-shrink-0" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 bg-slate-100 rounded-full w-24" />
                        <div className="h-2.5 bg-slate-100 rounded-full w-16" />
                      </div>
                      <div className="h-3 bg-slate-100 rounded-full w-16" />
                    </div>
                  </div>
                ))}
              </div>
            ) : holdings.length > 0 ? (
              <div className="space-y-3">
                {holdings.map((h) => {
                  const pnlPositive = (h.unrealized_pnl || 0) >= 0;
                  return (
                    <motion.div
                      key={h.id}
                      variants={item}
                      className="rounded-2xl bg-white shadow-sm border border-slate-100 p-4"
                    >
                      <div className="flex items-center gap-3.5">
                        <div className="h-11 w-11 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                          {h.logo_url ? (
                            <img src={h.logo_url} alt={h.symbol} className="h-full w-full object-contain" />
                          ) : (
                            <BarChart2 className="h-5 w-5 text-slate-400" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[15px] font-bold text-slate-900 truncate">{h.symbol}</p>
                          <p className="text-[11px] text-slate-400 truncate">{h.name}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-[15px] font-bold text-slate-900 tabular-nums">{fmt(h.market_value)}</p>
                          <p
                            className="text-[11px] font-semibold tabular-nums"
                            style={{ color: pnlPositive ? "#059669" : "#dc2626" }}
                          >
                            {pnlPositive ? "+" : ""}{fmt(h.unrealized_pnl)}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              /* ── Empty holdings ── */
              <motion.div
                variants={item}
                className="rounded-3xl bg-white shadow-sm border border-slate-100 p-8 text-center"
              >
                <div
                  className="h-16 w-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg,#e0e7ff,#c7d2fe)" }}
                >
                  <Wallet className="h-7 w-7 text-indigo-400" />
                </div>
                <p className="text-sm font-bold text-slate-800">No holdings yet</p>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  {fullName.split(" ")[0]}'s portfolio will appear here once investments are made.
                </p>
              </motion.div>
            )}
          </motion.div>

          {/* ── Account info ── */}
          <motion.div variants={item} className="rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden">
            <div className="h-1" style={{ background: gradient }} />
            <div className="divide-y divide-slate-50">
              {[
                { label: "Account Type", value: isSpouse ? "Spouse" : "Child", icon: isSpouse ? <Heart className="h-4 w-4" style={{ color: "#e11d48" }} /> : <Baby className="h-4 w-4 text-indigo-400" /> },
                { label: "Mint Number", value: member.mint_number || "—", icon: <ShieldCheck className="h-4 w-4 text-emerald-400" /> },
                ...(age !== null ? [{ label: "Age", value: `${age} years old`, icon: <Clock className="h-4 w-4 text-slate-400" /> }] : []),
              ].map(({ label, value, icon }) => (
                <div key={label} className="flex items-center gap-3 px-4 py-3.5">
                  <div className="h-8 w-8 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0">
                    {icon}
                  </div>
                  <div className="flex-1">
                    <p className="text-[11px] text-slate-400 font-medium">{label}</p>
                    <p className="text-sm font-semibold text-slate-800">{value}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

        </motion.div>
      </div>
    </div>
  );
}
