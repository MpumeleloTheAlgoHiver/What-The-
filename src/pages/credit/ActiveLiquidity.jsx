import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft, ChevronRight, CreditCard, TrendingDown, ArrowRight, CheckCircle2,
  AlertTriangle, AlertCircle, ChevronDown, ChevronUp, Landmark, X,
  Search, SlidersHorizontal, UploadCloud
} from "lucide-react";
import { formatZar } from "../../lib/formatCurrency";
import { supabase } from "../../lib/supabase";

const ActiveLiquidity = ({ onBack, profile, fonts }) => {
  // --- CORE DATA STATE ---
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);

  // --- SEARCH, FILTER & PAGINATION STATE ---
  const [searchQuery, setSearchQuery] = useState("");
  const [filterZone, setFilterZone] = useState("All");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 6;

  // --- INTERACTIVE UI STATE ---
  const [expandedLoanId, setExpandedLoanId] = useState(null);
  const [paymentLoan, setPaymentLoan] = useState(null);
  const [portalTarget, setPortalTarget] = useState(null);

  // --- PAYMENT UPLOAD STATE ---
  const [paymentAmount, setPaymentAmount] = useState("");
  const [popFile, setPopFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  // --- SUPABASE DATA FETCHING ---
  const fetchActiveLoans = async () => {
    if (!profile?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);

    // Safety timeout — stop spinner after 15s even if Supabase hangs
    const timeoutId = setTimeout(() => {
      setLoading(false);
    }, 15000);

    try {
      const { data, error } = await supabase
        .from('loan_application')
        .select(`
          *,
          pbc_collateral_pledges (
            symbol,
            loan_value,
            pledged_value,
            pledged_quantity,
            security_id,
            securities_c (
              name,
              last_price,
              ltv_pct,
              margin_call_pct,
              auto_liq_pct,
              liquidity_grading,
              logo_url
            )
          )
        `)
        .eq('user_id', profile.id)
        .eq('Secured_Unsecured', 'secured')
        .neq('status', 'repaid')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setLoans(data || []);
    } catch (err) {
      console.error("Error fetching active loans:", err.message);
      setLoans([]);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActiveLoans();
  }, [profile?.id]);

  // --- LOGIC CALCULATIONS ---
  const getRiskZone = (currentLtv, marginCall) => {
    if (currentLtv >= marginCall) return 'critical';
    if (currentLtv >= marginCall - 10) return 'warning';
    return 'safe';
  };

  // 1. Process Live Values for all fetched loans
  const processedLoans = useMemo(() => {
    return loans.map(loan => {
      const liveCollateralValue = loan.pbc_collateral_pledges?.reduce((acc, p) => {
        const livePrice = p.securities_c?.last_price || 0;
        const liveBalance = (p.pledged_quantity * livePrice);
        return acc + (liveBalance > 0 ? liveBalance : (p.pledged_value || 0));
      }, 0) || 1;

      const outstanding = loan.principal_amount || 0;
      const currentLtv = (outstanding / liveCollateralValue) * 100;
      const marginCall = (loan.pbc_collateral_pledges?.[0]?.securities_c?.margin_call_pct || 0.65) * 100;
      const zone = getRiskZone(currentLtv, marginCall);

      return { ...loan, liveCollateralValue, currentLtv, marginCall, zone };
    });
  }, [loans]);

  // 2. Apply Search & Filter
  const filteredLoans = useMemo(() => {
    return processedLoans.filter(loan => {
      const matchesSearch =
        loan.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        loan.pbc_collateral_pledges?.some(p => p.symbol.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesFilter = filterZone === "All" || loan.zone.toLowerCase() === filterZone.toLowerCase();

      return matchesSearch && matchesFilter;
    });
  }, [processedLoans, searchQuery, filterZone]);

  // 3. Apply Pagination (Max 6 Items)
  const paginatedLoans = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredLoans.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredLoans, currentPage]);

  const totalPages = Math.ceil(filteredLoans.length / itemsPerPage);

  // --- PAYMENT HANDLER (UPLOAD + DB INSERT) ---
  const handleProcessPayment = async () => {
    const amount = parseFloat(paymentAmount);
    if (!amount || isNaN(amount) || amount <= 0) {
      alert("Please enter a valid payment amount.");
      return;
    }
    if (!popFile) {
      alert("Please upload your Proof of Payment document.");
      return;
    }

    setIsProcessing(true);
    try {
      // 1. Upload Document to Storage (Assuming a 'documents' bucket)
      const fileExt = popFile.name.split('.').pop();
      const fileName = `pop-${paymentLoan.id}-${Date.now()}.${fileExt}`;
      const filePath = `${profile.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, popFile);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: publicUrlData } = supabase.storage
        .from('documents')
        .getPublicUrl(filePath);

      // 2. Insert Record into loan_documents table
      const { error: docError } = await supabase.from('loan_documents').insert({
        user_id: profile.id,
        loan_application_id: paymentLoan.id,
        document_name: popFile.name,
        document_url: publicUrlData.publicUrl,
        document_type: 'proof_of_payment'
      });

      if (docError) throw docError;

      // 3. Optimistically update loan balance
      const newPrincipal = Math.max(0, paymentLoan.principal_amount - amount);
      const newStatus = newPrincipal === 0 ? 'repaid' : paymentLoan.status;

      const { error: loanError } = await supabase
        .from('loan_application')
        .update({ principal_amount: newPrincipal, status: newStatus })
        .eq('id', paymentLoan.id);

      if (loanError) throw loanError;

      // 4. INSERT INTO LEDGER (CRITICAL FOR HISTORY PAGE)
      const { error: historyError } = await supabase
        .from('credit_transactions_history')
        .insert({
          user_id: profile.id,
          loan_application_id: paymentLoan.id,
          loan_type: 'secured',
          transaction_type: 'repayment',
          direction: 'debit',
          amount: amount,
          description: 'Facility Settlement (EFT)',
          occurred_at: new Date().toISOString()
        });

      if (historyError) throw historyError;

      // Success Cleanup
      setPaymentLoan(null);
      setPaymentAmount("");
      setPopFile(null);
      fetchActiveLoans();

    } catch (err) {
      console.error("Payment processing failed", err);
      alert("Payment failed. Please ensure storage buckets are correctly configured.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-32 relative text-slate-900 overflow-x-hidden">
      {/* Sticky Header */}
      <div className="px-5 pt-14 pb-6 sticky top-0 bg-slate-50/80 backdrop-blur-xl z-30 border-b border-slate-100/50">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center shadow-sm active:scale-95 transition-all">
            <ChevronLeft size={20} className="text-slate-600" />
          </button>
          <div>
            <h1 className="text-xl font-bold tracking-tight" style={{ fontFamily: fonts?.display }}>Active Liquidity</h1>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              {loading ? "Syncing ledgers..." : `${loans.length} Active Session(s)`}
            </p>
          </div>
        </div>
      </div>

      <div className="px-5 pt-6">
        {/* --- SEARCH & FILTER SECTION --- */}
        {!loading && loans.length > 0 && (
          <div className="mb-6">
            <div className="relative mb-3">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="Search by Facility ID or Ticker..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                className="w-full bg-white border border-slate-100 rounded-2xl py-3 pl-11 pr-4 text-xs focus:outline-none shadow-sm"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar px-1">
              {['All', 'Safe', 'Warning', 'Critical'].map(zone => (
                <button
                  key={zone}
                  onClick={() => { setFilterZone(zone); setCurrentPage(1); }}
                  className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider whitespace-nowrap transition-all ${filterZone === zone
                    ? 'bg-slate-900 text-white shadow-md'
                    : 'bg-white text-slate-500 border border-slate-100'
                    }`}
                >
                  {zone}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* --- LOANS LIST --- */}
        <div className="space-y-5">
          {loading ? (
            <div className="space-y-5">
              {[1, 2].map((i) => (
                <div key={i} className="bg-white rounded-[32px] p-6 shadow-xl shadow-slate-200/40 border border-slate-100 animate-pulse">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-slate-100"></div>
                      <div>
                        <div className="h-3 w-16 bg-slate-100 rounded mb-1"></div>
                        <div className="h-4 w-20 bg-slate-100 rounded"></div>
                      </div>
                    </div>
                    <div className="h-6 w-16 bg-slate-100 rounded-full"></div>
                  </div>
                  <div className="mb-4">
                    <div className="h-3 w-24 bg-slate-100 rounded mb-2"></div>
                    <div className="h-8 w-32 bg-slate-100 rounded mb-4"></div>
                    <div className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <div>
                        <div className="h-3 w-20 bg-slate-100 rounded mb-1"></div>
                        <div className="h-4 w-24 bg-slate-100 rounded"></div>
                      </div>
                      <div className="text-right flex flex-col items-end">
                        <div className="h-3 w-16 bg-slate-100 rounded mb-1"></div>
                        <div className="h-4 w-16 bg-slate-100 rounded"></div>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-6">
                    <div className="bg-slate-50 rounded-2xl p-3 h-14 border border-slate-100"></div>
                    <div className="bg-slate-50 rounded-2xl p-3 h-14 border border-slate-100"></div>
                    <div className="bg-slate-50 rounded-2xl p-3 h-14 border border-slate-100"></div>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1 py-6 rounded-2xl bg-slate-100"></div>
                    <div className="flex-1 py-6 rounded-2xl bg-slate-100"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : filteredLoans.length === 0 && loans.length > 0 ? (
            <div className="text-center py-10 text-slate-400 text-xs italic">No matching facilities found</div>
          ) : paginatedLoans.map((loan) => {

            const outstanding = loan.principal_amount || 0;
            const monthly = (loan.amount_repayable / loan.number_of_months) || 0;

            // Back-calculate original principal using prime rate to detect actual payments.
            // amount_repayable = origPrincipal + interest(prime) + initiation + service_fees
            // Estimating: progress only shows when principal has genuinely dropped via payments.
            const PRIME_MONTHLY = 0.105 / 12;
            const months = loan.number_of_months || 1;
            const totalRepayable = Number(loan.amount_repayable || 0);
            const estServiceFees = 69 * months;
            const estInitiation = 1050;
            const estOriginalPrincipal = Math.max(0,
              (totalRepayable - estInitiation - estServiceFees) / (1 + PRIME_MONTHLY * months)
            );
            const amountPaid = Math.max(0, estOriginalPrincipal - outstanding);
            const progress = totalRepayable > 0
              ? Math.min(100, (amountPaid / totalRepayable) * 100)
              : 0;

            // Safely parse and format the first repayment date
            const nextDate = loan.first_repayment_date
              ? new Date(loan.first_repayment_date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
              : 'TBD';

            const isExpanded = expandedLoanId === loan.id;

            return (
              <div key={loan.id} className="bg-white rounded-[32px] p-6 shadow-xl shadow-slate-200/40 border border-slate-100 animate-in slide-in-from-bottom-4 duration-500">
                {/* Card Header */}
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-violet-50 flex items-center justify-center border border-violet-100">
                      <CreditCard size={18} className="text-violet-600" />
                    </div>
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-0.5">Facility ID</span>
                      <span className="font-mono text-sm font-bold text-slate-900">#{loan.id.slice(0, 8)}</span>
                    </div>
                  </div>

                  <span className={`px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 ${loan.zone === 'safe' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                    loan.zone === 'warning' ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                      'bg-rose-50 text-rose-600 border border-rose-100'
                    }`}>
                    {loan.zone === 'safe' && <CheckCircle2 size={12} />}
                    {loan.zone === 'warning' && <AlertTriangle size={12} />}
                    {loan.zone === 'critical' && <AlertCircle size={12} />}
                    {loan.zone}
                  </span>
                </div>

                {/* Balances & Upcoming Repayment */}
                <div className="mb-4">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Outstanding</span>
                  <p className="font-light tracking-tight text-3xl text-slate-900 mt-1 mb-4" style={{ fontFamily: fonts?.display }}>
                    {formatZar(outstanding)}
                  </p>

                  <div className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div>
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Next Repayment</span>
                      <span className="text-sm font-bold text-slate-900">{nextDate}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Amount Due</span>
                      <span className="text-sm font-bold text-violet-600">{formatZar(monthly)}</span>
                    </div>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mb-6">
                  <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">
                    <span>Repayment Progress</span>
                    <span className="text-violet-600">{progress.toFixed(0)}%</span>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                    <div className="h-full bg-violet-600 rounded-full transition-all duration-1000" style={{ width: `${progress}%` }} />
                  </div>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-3 gap-2 mb-6">
                  <div className="bg-slate-50 rounded-2xl p-3 text-center border border-slate-100">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">LTV</span>
                    <span className={`font-bold text-sm ${loan.zone === 'safe' ? 'text-slate-900' : loan.zone === 'warning' ? 'text-amber-600' : 'text-rose-600'}`}>
                      {loan.currentLtv.toFixed(0)}%
                    </span>
                  </div>
                  <div className="bg-slate-50 rounded-2xl p-3 text-center border border-slate-100">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Collateral</span>
                    <span className="font-bold text-sm text-slate-900">
                      {loan.liveCollateralValue >= 1000000 ? `R${(loan.liveCollateralValue / 1000000).toFixed(1)}m` : `R${(loan.liveCollateralValue / 1000).toFixed(0)}k`}
                    </span>
                  </div>
                  <div className="bg-slate-50 rounded-2xl p-3 text-center border border-slate-100">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Assets</span>
                    <span className="font-bold text-sm text-slate-900">{loan.pbc_collateral_pledges?.length || 0}</span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setPaymentLoan(loan);
                      setPaymentAmount(monthly.toFixed(2));
                      setPopFile(null);
                    }}
                    className="flex-1 py-4 rounded-2xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest shadow-xl shadow-slate-900/20 active:scale-95 transition-all"
                  >
                    Make Payment
                  </button>
                  <button
                    onClick={() => setExpandedLoanId(isExpanded ? null : loan.id)}
                    className="flex-1 py-4 flex justify-center items-center gap-2 rounded-2xl bg-white border border-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all"
                  >
                    Details {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>

                {/* Expanded Live Asset Details */}
                {isExpanded && (
                  <div className="mt-6 pt-6 border-t border-slate-100 animate-in slide-in-from-top-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4">Pledged Assets Breakdown</p>
                    <div className="space-y-3">
                      {loan.pbc_collateral_pledges?.map((pledge, idx) => {
                        const sec = pledge.securities_c;
                        const liveValue = (pledge.pledged_quantity * (sec?.last_price || 0)) / 100;

                        return (
                          <div key={idx} className="flex justify-between items-center bg-slate-50 p-3 rounded-2xl border border-slate-100">
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-lg bg-white flex items-center justify-center border border-slate-200 overflow-hidden">
                                {sec?.logo_url ? (
                                  <img src={sec.logo_url} className="h-full w-full object-contain p-1" alt={pledge.symbol} />
                                ) : (
                                  <span className="text-[8px] font-bold text-slate-400">{pledge.symbol}</span>
                                )}
                              </div>
                              <div>
                                <p className="text-xs font-bold text-slate-900">{pledge.symbol}</p>
                                <p className="text-[9px] text-slate-500 uppercase font-medium">{pledge.pledged_quantity} shares</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-xs font-bold text-slate-900">{formatZar(liveValue || pledge.pledged_value)}</p>
                              <p className="text-[8px] text-emerald-600 uppercase font-black tracking-widest">Live Value</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Pagination Controls */}
          {!loading && totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 px-2">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => p - 1)}
                className="h-10 w-10 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-600 shadow-sm disabled:opacity-40 active:scale-95"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Page {currentPage} of {totalPages}
              </span>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(p => p + 1)}
                className="h-10 w-10 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-600 shadow-sm disabled:opacity-40 active:scale-95"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}

          {/* Empty State */}
          {!loading && loans.length === 0 && (
            <div className="bg-white rounded-[36px] p-10 text-center border border-slate-100 mt-8 shadow-sm">
              <div className="h-20 w-20 rounded-full bg-slate-50 flex items-center justify-center mx-auto mb-6 text-slate-300">
                <TrendingDown size={32} />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">No Active Facilities</h3>
              <p className="text-xs text-slate-500 font-medium mb-8 leading-relaxed">
                You currently have no active collateralized loans. Utilize your portfolio to generate instant capital.
              </p>
              <button
                onClick={onBack}
                className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg flex justify-center items-center gap-2 active:scale-95 transition-all"
              >
                Start Application <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* --- MINT EFT PAYMENT MODAL (Centered with Upload logic) --- */}
      {paymentLoan && portalTarget && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4">
          <button className="absolute inset-0" onClick={() => !isProcessing && setPaymentLoan(null)} />

          <div className="relative w-full max-w-sm bg-white rounded-[36px] p-8 shadow-2xl animate-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto no-scrollbar">
            <button
              disabled={isProcessing}
              onClick={() => setPaymentLoan(null)}
              className="absolute top-6 right-6 h-8 w-8 bg-slate-50 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X size={16} />
            </button>

            <div className="h-14 w-14 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center mb-6 border border-violet-100">
              <Landmark size={24} />
            </div>

            <h3 className="text-xl font-bold text-slate-900 mb-1" style={{ fontFamily: fonts?.display }}>EFT Repayment</h3>
            <p className="text-xs text-slate-500 mb-6 leading-relaxed">
              Transfer funds to the MINT account and upload your POP to settle.
            </p>

            {/* Bank Details derived from Account Confirmation_5883.pdf */}
            <div className="bg-slate-50 rounded-[24px] p-5 mb-6 border border-slate-100 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Bank</span>
                <span className="text-xs font-bold text-slate-900">Capitec Business</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Account Name</span>
                <span className="text-xs font-bold text-slate-900">ALGOHIVE PTY LTD</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Account No.</span>
                <span className="text-xs font-bold text-slate-900 font-mono">1053045883</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Branch Code</span>
                <span className="text-xs font-bold text-slate-900 font-mono">450105</span>
              </div>
              <div className="pt-4 border-t border-slate-200/60 flex justify-between items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-violet-600">Reference</span>
                <span className="text-xs font-black text-slate-900 font-mono bg-violet-100 px-2.5 py-1 rounded-lg">
                  MINT-{paymentLoan.id.slice(0, 6).toUpperCase()}
                </span>
              </div>
            </div>

            {/* Custom Payment Amount */}
            <div className="mb-4">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-2 pl-2">Payment Amount</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">R</span>
                <input
                  type="number"
                  placeholder="0.00"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 pl-10 pr-4 font-bold text-slate-900 outline-none focus:border-violet-500 transition-colors shadow-sm"
                />
              </div>
            </div>

            {/* Proof of Payment Upload */}
            <div className="mb-8">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-2 pl-2">Proof of Payment</label>
              <div className="relative overflow-hidden w-full bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-center p-4 shadow-sm hover:bg-slate-100 transition-colors cursor-pointer group">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setPopFile(e.target.files[0])}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="flex items-center gap-3 text-slate-500 group-hover:text-violet-600 transition-colors">
                  <UploadCloud size={20} />
                  <span className="text-xs font-bold truncate max-w-[200px]">
                    {popFile ? popFile.name : "Tap to Upload File"}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={handleProcessPayment}
              disabled={isProcessing || !paymentAmount || !popFile}
              className="w-full py-4 rounded-2xl bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest shadow-xl shadow-slate-900/20 active:scale-95 transition-all disabled:opacity-40"
            >
              {isProcessing ? "Uploading & Processing..." : "Submit Payment"}
            </button>
          </div>
        </div>
        , portalTarget)}
    </div>
  );
};

export default ActiveLiquidity;