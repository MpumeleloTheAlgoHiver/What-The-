import React, { useState, useEffect } from "react";
import { ChevronLeft, ArrowUpRight, ArrowDownRight, History, Search, Receipt, ArrowRight } from "lucide-react";
import { formatZar } from "../../lib/formatCurrency";
import { supabase } from "../../lib/supabase";

const LiquidityHistory = ({ onBack, profile, fonts }) => {
  const [transactions, setTransactions] = useState([]);
  const [lifetimeBorrowed, setLifetimeBorrowed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    async function fetchHistory() {
      if (!profile?.id) {
        setLoading(false);
        return;
      }
      setLoading(true);

      try {
        const { data, error } = await supabase
          .from('credit_transactions_history')
          .select('*')
          .eq('user_id', profile.id)
          .eq('loan_type', 'secured')
          .order('occurred_at', { ascending: false });

        if (error) throw error;

        const historyRows = data || [];
        let totalBorrowed = 0;

        const txs = historyRows.map(row => {
          if (row.transaction_type === 'application_created' && row.direction === 'credit') {
            totalBorrowed += Number(row.amount);
          }

          const isCredit = row.direction === 'credit';
          const isRepayment = row.transaction_type === 'repayment';
          const isFee = row.transaction_type === 'fee';

          return {
            id: row.id,
            type: row.transaction_type,
            direction: row.direction,
            description: row.description || (isCredit ? 'Facility Disbursement' : 'Facility Settlement'),
            amount: isCredit ? Number(row.amount) : -Number(row.amount),
            date: row.occurred_at,
            status: 'completed',
            originalId: row.loan_application_id,
            isFee
          };
        });

        setTransactions(txs);
        setLifetimeBorrowed(totalBorrowed);
      } catch (err) {
        console.error("Error fetching history:", err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchHistory();
  }, [profile?.id]);

  const filteredTransactions = transactions.filter(tx =>
    tx.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    tx.originalId.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-50 pb-32 relative text-slate-900 overflow-x-hidden">
      {/* Sticky Header */}
      <div className="px-5 pt-14 pb-6 sticky top-0 bg-slate-50/80 backdrop-blur-xl z-30 border-b border-slate-100/50">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center shadow-sm active:scale-95 transition-all"
          >
            <ChevronLeft size={20} className="text-slate-600" />
          </button>
          <div>
            <h1 className="text-xl font-bold tracking-tight" style={{ fontFamily: fonts?.display }}>Transaction History</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Secured Liquidity Ledger
            </p>
          </div>
        </div>
      </div>

      <div className="px-5 pt-6 space-y-6">
        {/* Summary Card */}
        <div className="bg-white rounded-[32px] p-6 shadow-xl shadow-slate-200/40 border border-slate-100 flex justify-between items-center animate-in slide-in-from-bottom-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-violet-500 mb-1">Lifetime Borrowed</p>
            {loading ? <div className="h-9 w-32 bg-slate-100 animate-pulse rounded mt-1" /> : <h2 className="text-3xl font-light tracking-tight text-slate-900" style={{ fontFamily: fonts?.display }}>
              {formatZar(lifetimeBorrowed)}
            </h2>}
          </div>
          <div className="h-14 w-14 rounded-2xl bg-violet-50 flex items-center justify-center border border-violet-100">
            <History className="text-violet-600" size={24} />
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            placeholder="Search ledger events..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-slate-100 rounded-2xl py-3.5 pl-11 pr-4 text-xs font-medium focus:outline-none focus:border-violet-300 shadow-sm transition-all"
          />
        </div>

        {/* Transactions List */}
        <div className="space-y-3">
          {loading ? (
            <>
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-white rounded-[24px] p-4 flex items-center gap-4 shadow-sm border border-slate-100 animate-pulse">
                  <div className="w-12 h-12 shrink-0 rounded-2xl bg-slate-100"></div>
                  <div className="flex-1">
                    <div className="h-4 w-32 bg-slate-100 rounded mb-2"></div>
                    <div className="h-3 w-24 bg-slate-100 rounded"></div>
                  </div>
                  <div className="text-right flex flex-col items-end">
                    <div className="h-4 w-16 bg-slate-100 rounded mb-2"></div>
                    <div className="h-2 w-12 bg-slate-100 rounded"></div>
                  </div>
                </div>
              ))}
            </>
          ) : filteredTransactions.length === 0 ? (
            <div className="bg-white rounded-[36px] p-10 text-center border border-slate-100 mt-8 shadow-sm animate-in fade-in duration-700">
              <div className="h-20 w-20 rounded-full bg-slate-50 flex items-center justify-center mx-auto mb-6 text-slate-300">
                <History size={32} />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">No Transactions</h3>
              <p className="text-xs text-slate-500 font-medium mb-8 leading-relaxed">
                You haven't made any liquidity transactions yet. Start by applying for portfolio-backed credit.
              </p>
              <button
                onClick={onBack}
                className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg flex justify-center items-center gap-2 active:scale-95 transition-all"
              >
                Start Application <ArrowRight size={14} />
              </button>
            </div>
          ) : filteredTransactions.map((tx) => (
            <div
              key={tx.id}
              className="bg-white rounded-[24px] p-4 flex items-center gap-4 shadow-sm border border-slate-100 hover:border-violet-100 transition-all animate-in slide-in-from-bottom-2"
            >
              {/* Transaction Icon */}
              <div className={`w-12 h-12 shrink-0 rounded-2xl flex items-center justify-center border ${tx.direction === 'credit' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                tx.isFee ? 'bg-slate-50 text-slate-500 border-slate-200' :
                  'bg-violet-50 text-violet-600 border-violet-100'
                }`}>
                {tx.direction === 'credit' ? (
                  <ArrowDownRight size={20} strokeWidth={2.5} />
                ) : tx.isFee ? (
                  <Receipt size={20} strokeWidth={2.5} />
                ) : (
                  <ArrowUpRight size={20} strokeWidth={2.5} />
                )}
              </div>

              {/* Transaction Details */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-900 truncate mb-0.5">{tx.description}</p>
                <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400">
                  <span>{new Date(tx.date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  <span>•</span>
                  <span className="text-emerald-500">
                    {tx.status}
                  </span>
                </div>
              </div>

              {/* Transaction Amount */}
              <div className="text-right shrink-0">
                <span className={`block font-bold text-sm tracking-tight ${tx.direction === 'credit' ? 'text-emerald-600' : 'text-slate-900'
                  }`}>
                  {tx.amount > 0 ? '+' : '-'}{formatZar(Math.abs(tx.amount))}
                </span>
                <span className="text-[8px] font-mono text-slate-300 uppercase">
                  {tx.type.replace('_', ' ')}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default LiquidityHistory;