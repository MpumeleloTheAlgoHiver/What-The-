import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";

async function getAuthToken() {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

async function fetchServerHoldings(token) {
  try {
    const res = await fetch("/api/user/holdings", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      console.error("Failed to fetch holdings from server:", res.status);
      return { holdings: [], closedHoldings: [] };
    }
    const json = await res.json();
    return { holdings: json.holdings || [], closedHoldings: json.closedHoldings || [] };
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      console.warn("[useFinancialData] Holdings fetch timed out, returning empty");
    } else {
      console.error("Failed to fetch holdings:", err);
    }
    return { holdings: [], closedHoldings: [] };
  }
}

async function fetchServerTransactions(token, limit = 50) {
  try {
    const res = await fetch(`/api/user/transactions?limit=${limit}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      console.error("Failed to fetch transactions from server:", res.status);
      return [];
    }
    const json = await res.json();
    return json.transactions || [];
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      console.warn("[useFinancialData] Transactions fetch timed out, returning empty");
    } else {
      console.error("Failed to fetch transactions:", err);
    }
    return [];
  }
}

let financialDataCache = null;

export const clearFinancialDataCache = () => {
  financialDataCache = null;
};

export const useFinancialData = () => {
  const [data, setData] = useState({
    balance: 0,
    investments: 0,
    availableCredit: 0,
    transactions: [],
    holdings: [],
    creditInfo: null,
    bestAssets: [],
    loading: true,
    error: null,
  });

  const fetchData = useCallback(async () => {
    if (!supabase) {
      setData((prev) => ({ ...prev, loading: false, error: "Database not connected" }));
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setData((prev) => ({ ...prev, loading: false }));
        return;
      }

      const userId = session.user.id;
      const token = session.access_token;

      const [
        holdings,
        allServerTransactions,
        creditResult,
        walletResult,
      ] = await Promise.all([
        fetchServerHoldings(token),
        fetchServerTransactions(token, 100),
        supabase.from("credit_accounts").select("*").eq("user_id", userId).maybeSingle(),
        supabase.from("wallets").select("balance").eq("user_id", userId).maybeSingle(),
      ]);

      const safeHoldings = Array.isArray(holdings) ? holdings : [];
      const safeTxns = Array.isArray(allServerTransactions) ? allServerTransactions : [];
      const transactions = safeTxns.slice(0, 20);
      const allTransactions = safeTxns;
      const creditInfo = creditResult.data;

      const sortedHoldings = [...safeHoldings].filter(h => !h.strategy_id).sort((a, b) => {
        const aGain = (a.unrealized_pnl || 0) / 100;
        const bGain = (b.unrealized_pnl || 0) / 100;
        return bGain - aGain;
      });

      const liveVal = (h) => h.last_price != null && h.quantity != null ? (h.last_price * h.quantity) / 100 : (h.market_value || 0) / 100;
      const bestAssets = sortedHoldings.slice(0, 5).map((h) => {
        const currentValue = liveVal(h);
        const costBasis = ((h.avg_fill || 0) * (h.quantity || 0)) / 100;
        const changePercent = costBasis > 0 ? ((currentValue - costBasis) / costBasis) * 100 : 0;
        return {
          symbol: h.symbol,
          name: h.name,
          value: currentValue,
          change: changePercent,
          logo: h.logo_url,
        };
      });

      const totalInvestments = safeHoldings.reduce((sum, h) => sum + liveVal(h), 0);
      
      const incomeTypes = ["credit"];
      const expenseTypes = ["debit"];
      const totalIncome = allTransactions
        .filter((t) => incomeTypes.includes(t.direction))
        .reduce((sum, t) => sum + Math.abs((t.amount || 0) / 100), 0);
      const totalExpenses = allTransactions
        .filter((t) => expenseTypes.includes(t.direction))
        .reduce((sum, t) => sum + Math.abs((t.amount || 0) / 100), 0);
      const availableCredit = Math.max(0, (totalIncome - totalExpenses) * 0.2);
      const walletBalance = walletResult.data?.balance ?? 0;

      const newData = {
        balance: walletBalance,
        investments: totalInvestments,
        availableCredit,
        transactions,
        holdings,
        creditInfo,
        bestAssets,
        loading: false,
        error: null,
      };

      financialDataCache = newData;
      setData(newData);

      console.log("[useFinancialData] Updated balance from DB:", walletBalance);
    } catch (err) {
      console.error("Error fetching financial data:", err);
      setData((prev) => ({
        ...prev,
        loading: false,
        error: err.message,
      }));
    }
  }, []);

  useEffect(() => {
    const safetyTimer = setTimeout(() => {
      setData((prev) => {
        if (!prev.loading) return prev;
        console.warn("[useFinancialData] Safety timeout reached, unblocking UI");
        return { ...prev, loading: false };
      });
    }, 15000);
    fetchData().finally(() => clearTimeout(safetyTimer));
    return () => clearTimeout(safetyTimer);
  }, [fetchData]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") fetchData();
    };
    const handleUpdate = () => {
      fetchData();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("financial-data-updated", handleUpdate);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("financial-data-updated", handleUpdate);
    };
  }, [fetchData]);

  return { ...data, refetch: fetchData };
};

export const useMintBalance = () => {
  const [data, setData] = useState({
    totalBalance: 0,
    investments: 0,
    availableCredit: 0,
    dailyChange: 0,
    recentChanges: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    const fetchBalance = async () => {
      if (!supabase) {
        setData((prev) => ({ ...prev, loading: false }));
        return;
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          setData((prev) => ({ ...prev, loading: false }));
          return;
        }

        const userId = session.user.id;
        const token = session.access_token;

        const [holdingsRaw, allServerTransactionsRaw] = await Promise.all([
          fetchServerHoldings(token),
          fetchServerTransactions(token, 100),
        ]);

        const holdings = Array.isArray(holdingsRaw) ? holdingsRaw : [];
        const allServerTransactions = Array.isArray(allServerTransactionsRaw) ? allServerTransactionsRaw : [];
        const recentTransactions = allServerTransactions.slice(0, 10);
        const allTransactions = allServerTransactions;
        
        const liveV = (h) => h.last_price != null && h.quantity != null ? (h.last_price * h.quantity) / 100 : (h.market_value || 0) / 100;
        const totalInvestments = holdings.reduce((sum, h) => sum + liveV(h), 0);
        const costBasisTotal = holdings.reduce((sum, h) => sum + ((h.avg_fill || 0) * (h.quantity || 0)) / 100, 0);
        const dailyChange = totalInvestments - costBasisTotal;
        
        const incomeTypes = ["credit"];
        const expenseTypes = ["debit"];
        const totalIncome = allTransactions
          .filter((t) => incomeTypes.includes(t.direction))
          .reduce((sum, t) => sum + Math.abs((t.amount || 0) / 100), 0);
        const totalExpenses = allTransactions
          .filter((t) => expenseTypes.includes(t.direction))
          .reduce((sum, t) => sum + Math.abs((t.amount || 0) / 100), 0);
        const availableCredit = Math.max(0, (totalIncome - totalExpenses) * 0.2);
        const totalBalance = totalInvestments + availableCredit;

        const recentChanges = recentTransactions.map((t) => ({
          title: t.name || t.description || "Transaction",
          date: formatTransactionDate(t.transaction_date || t.created_at),
          amount: formatTransactionAmount((t.amount || 0) / 100, t.direction),
        }));

        setData({
          totalBalance,
          investments: totalInvestments,
          availableCredit,
          dailyChange,
          recentChanges,
          loading: false,
          error: null,
        });
      } catch (err) {
        console.error("Error fetching mint balance:", err);
        setData((prev) => ({ ...prev, loading: false, error: err.message }));
      }
    };

    fetchBalance();

    const handleVisibility = () => {
      if (document.visibilityState === "visible") fetchBalance();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  return data;
};

export const useTransactions = (limit = 20) => {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTransactions = async () => {
      if (!supabase) {
        setLoading(false);
        return;
      }

      try {
        const token = await getAuthToken();
        if (!token) {
          setLoading(false);
          return;
        }

        const data = await fetchServerTransactions(token, limit);
        setTransactions(data);
      } catch (err) {
        console.error("Error fetching transactions:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchTransactions();
  }, [limit]);

  return { transactions, loading };
};

export const useCreditInfo = () => {
  const [data, setData] = useState({
    availableCredit: 0,
    score: 0,
    loanBalance: 0,
    nextPaymentDate: null,
    minDue: 0,
    utilisationPercent: 0,
    scoreChangesToday: [],
    scoreChangesAllTime: [],
    loading: true,
    hasCredit: false,
  });

  useEffect(() => {
    const fetchCredit = async () => {
      if (!supabase) {
        setData((prev) => ({ ...prev, loading: false }));
        return;
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          setData((prev) => ({ ...prev, loading: false }));
          return;
        }

        const userId = session.user.id;

        const [creditResult, scoreHistoryResult] = await Promise.all([
          supabase.from("credit_accounts").select("*").eq("user_id", userId).maybeSingle(),
          supabase.from("credit_score_history").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
        ]);

        const credit = creditResult.data;
        const allScoreChanges = (scoreHistoryResult.data || []).map((s) => ({
          label: s.reason || "Score update",
          date: formatTransactionDate(s.created_at),
          value: s.change > 0 ? `+${s.change}` : `${s.change}`,
          rawDate: new Date(s.created_at),
        }));

        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const scoreChangesToday = allScoreChanges.filter((s) => s.rawDate >= sevenDaysAgo);
        const scoreChangesAllTime = allScoreChanges;

        if (credit) {
          setData({
            availableCredit: credit.available_credit || 0,
            score: credit.credit_score || 0,
            loanBalance: credit.loan_balance || 0,
            nextPaymentDate: credit.next_payment_date ? formatDate(credit.next_payment_date) : null,
            minDue: credit.minimum_due || 0,
            utilisationPercent: credit.utilisation_percent || 0,
            scoreChangesToday,
            scoreChangesAllTime,
            loading: false,
            hasCredit: true,
          });
        } else {
          setData((prev) => ({ ...prev, loading: false, hasCredit: false }));
        }
      } catch (err) {
        console.error("Error fetching credit info:", err);
        setData((prev) => ({ ...prev, loading: false }));
      }
    };

    fetchCredit();
  }, []);

  return data;
};

export const useInvestments = () => {
  const [data, setData] = useState({
    totalInvestments: 0,
    monthlyChange: 0,
    monthlyChangePercent: 0,
    portfolioMix: [],
    goals: [],
    holdings: [],
    closedHoldings: [],
    loading: true,
    hasInvestments: false,
  });

  const fetchInvestments = useCallback(async () => {
    if (!supabase) {
      setData((prev) => ({ ...prev, loading: false }));
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setData((prev) => ({ ...prev, loading: false }));
        return;
      }

      const userId = session.user.id;
      const token = session.access_token;

      const [holdingsResult, goalsResult] = await Promise.all([
        fetchServerHoldings(token),
        supabase.from("investment_goals").select("*").eq("user_id", userId),
      ]);

      const holdings = holdingsResult.holdings;
      const closedHoldings = holdingsResult.closedHoldings;
      const goals = goalsResult.data || [];

      const liveHV = (h) => h.last_price != null && h.quantity != null ? (h.last_price * h.quantity) / 100 : (h.market_value || 0) / 100;
      const totalInvestments = holdings.reduce((sum, h) => sum + liveHV(h), 0);
      const costBasisAll = holdings.reduce((sum, h) => sum + ((h.avg_fill || 0) * (h.quantity || 0)) / 100, 0);
      const monthlyChange = totalInvestments - costBasisAll;
      const monthlyChangePercent = costBasisAll > 0 ? (monthlyChange / costBasisAll) * 100 : 0;

      const assetClasses = {};
      holdings.forEach((h) => {
        const assetClass = h.asset_class || "Other";
        const holdingValue = liveHV(h);
        assetClasses[assetClass] = (assetClasses[assetClass] || 0) + holdingValue;
      });

      const portfolioMix = Object.entries(assetClasses).map(([label, value]) => ({
        label,
        value: totalInvestments > 0 ? Math.round((value / totalInvestments) * 100) + "%" : "0%",
      }));

      const formattedGoals = goals.map((g) => {
        const invested = g.current_amount || 0;
        let currentValue = invested;

        if (g.linked_security_id || g.linked_strategy_id) {
          const linkedHolding = holdings.find(
            (h) => h.security_id === g.linked_security_id || h.strategy_id === g.linked_strategy_id
          );
          if (linkedHolding) {
            const marketVal = linkedHolding.last_price != null && linkedHolding.quantity != null ? (linkedHolding.last_price * linkedHolding.quantity) / 100 : (linkedHolding.market_value || 0) / 100;
            const costBasis = ((linkedHolding.avg_fill || 0) * (linkedHolding.quantity || 0)) / 100;
            const gainLoss = marketVal - costBasis;
            currentValue = invested + (costBasis > 0 ? (gainLoss / costBasis) * invested : 0);
          }
        }

        const target = g.target_amount || 0;
        const pct = target > 0 ? Math.min(100, Math.round((currentValue / target) * 100)) : 0;

        return {
          id: g.id,
          label: g.name || "Goal",
          value: `R${target.toLocaleString()}`,
          progress: pct + "%",
          currentAmount: currentValue,
          investedAmount: invested,
          targetAmount: target,
          targetDate: g.target_date || null,
          linkedAssetName: g.linked_asset_name || null,
          linkedStrategyId: g.linked_strategy_id || null,
          linkedSecurityId: g.linked_security_id || null,
        };
      });

      setData({
        totalInvestments,
        monthlyChange,
        monthlyChangePercent,
        portfolioMix: portfolioMix.length > 0 ? portfolioMix : [],
        goals: formattedGoals,
        holdings,
        closedHoldings,
        loading: false,
        hasInvestments: holdings.length > 0,
      });
    } catch (err) {
      console.error("Error fetching investments:", err);
      setData((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    fetchInvestments();
  }, [fetchInvestments]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") fetchInvestments();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchInvestments]);

  return { ...data, refetch: fetchInvestments };
};

function formatTransactionDate(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

function formatTransactionAmount(amount, direction) {
  if (amount === undefined || amount === null) return "R0";
  const isPositive = direction === "credit";
  const sign = isPositive ? "+" : "-";
  return `${sign}R${Math.abs(amount).toLocaleString()}`;
}

function formatDate(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  return date.toLocaleDateString("en-ZA", { month: "long", day: "numeric", year: "numeric" });
}
