import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";
import { getStrategyPriceHistory } from "./strategyData";

export const useUserStrategies = () => {
  const [data, setData] = useState({
    strategies: [],
    selectedStrategy: null,
    loading: true,
    error: null,
  });

  const fetchUserStrategies = useCallback(async () => {
    if (!supabase) {
      setData((prev) => ({ ...prev, loading: false, error: "Database not connected" }));
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setData({ strategies: [], selectedStrategy: null, loading: false, error: null });
        return;
      }

      const token = session.access_token;
      const res = await fetch("/api/user/strategies", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        console.error("[useUserStrategies] API error:", res.status, errJson);
        setData((prev) => ({ ...prev, loading: false, error: errJson.error || "Failed to fetch strategies" }));
        return;
      }

      const json = await res.json();
      const serverStrategies = json.strategies || [];

      if (serverStrategies.length === 0) {
        console.log("[useUserStrategies] No strategies found from API");
        setData({ strategies: [], selectedStrategy: null, loading: false, error: null });
        return;
      }

      const formattedStrategies = serverStrategies.map((strategy) => {
        const latestMetric = strategy.metrics;
        const invested = strategy.investedAmount || 0;
        const currentVal = strategy.currentMarketValue != null
          ? Number(strategy.currentMarketValue.toFixed(2))
          : invested;
        const changePct = invested > 0 ? ((currentVal - invested) / invested) * 100 : 0;

        return {
          id: strategy.id,
          strategyId: strategy.id,
          name: strategy.name || "Unknown Strategy",
          shortName: strategy.shortName || strategy.name || "Strategy",
          description: strategy.description || "",
          riskLevel: strategy.riskLevel || "Moderate",
          sector: strategy.sector || "",
          iconUrl: strategy.iconUrl,
          imageUrl: strategy.imageUrl,
          holdings: strategy.holdings || [],
          investedAmount: invested,
          currentValue: currentVal,
          unitsHeld: 0,
          entryDate: null,
          lastUpdated: latestMetric?.as_of_date,
          previousMonthChange: parseFloat(changePct.toFixed(1)),
          metrics: latestMetric,
          firstInvestedDate: strategy.firstInvestedDate || null,
        };
      });

      setData({
        strategies: formattedStrategies,
        selectedStrategy: formattedStrategies[0] || null,
        loading: false,
        error: null,
      });

    } catch (err) {
      console.error("Error fetching strategies:", err);
      setData((prev) => ({
        ...prev,
        loading: false,
        error: err.message,
      }));
    }
  }, []);

  const selectStrategy = useCallback((strategy) => {
    setData((prev) => ({ ...prev, selectedStrategy: strategy }));
  }, []);

  useEffect(() => {
    fetchUserStrategies();
  }, [fetchUserStrategies]);

  return { ...data, selectStrategy, refetch: fetchUserStrategies };
};

export const useStrategyChartData = (strategyId, timeFilter = "W", purchaseDate = null) => {
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchChartData = async () => {
      if (!strategyId) {
        setLoading(false);
        return;
      }

      setLoading(true);

      const timeframeMap = {
        "D": "1D",
        "W": "1W",
        "M": "1M",
        "ALL": "1Y",
        "5d": "1W",
        "m": "1M",
        "ytd": "1Y",
        "all": "1Y",
      };

      const timeframe = timeframeMap[timeFilter] || timeframeMap["D"] || "1D";

      try {
        const priceHistory = await getStrategyPriceHistory(strategyId, timeframe);

        if (!priceHistory || priceHistory.length === 0) {
          setChartData([]);
          setLoading(false);
          return;
        }

        let filteredHistory = priceHistory;
        if (purchaseDate) {
          const purchaseDateStr = purchaseDate.slice(0, 10);
          const afterPurchase = priceHistory.filter(p => p.ts.split("T")[0] >= purchaseDateStr);
          if (afterPurchase.length >= 1) {
            filteredHistory = afterPurchase;
          } else {
            const beforePurchase = priceHistory.filter(p => p.ts.split("T")[0] < purchaseDateStr);
            if (beforePurchase.length > 0) {
              const lastKnown = beforePurchase[beforePurchase.length - 1];
              filteredHistory = [lastKnown, { ...lastKnown, ts: purchaseDateStr + "T00:00:00Z" }];
            } else {
              filteredHistory = priceHistory.slice(-1);
            }
          }
        }

        const formattedData = formatChartData(filteredHistory, timeFilter);
        setChartData(formattedData);

      } catch (err) {
        console.error("Error fetching chart data:", err);
        setChartData([]);
      } finally {
        setLoading(false);
      }
    };

    fetchChartData();
  }, [strategyId, timeFilter, purchaseDate]);

  return { chartData, loading };
};

// Fetch period-specific return data from client_strategy_returns_c
export const useStrategyPeriodReturns = (userId, strategyId, activeTab = "m") => {
  const [returnData, setReturnData] = useState({ pnl: 0, pct: 0, basketValue: 0 });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchPeriodReturns = async () => {
      if (!userId || !strategyId || !["D", "5d", "m", "ytd"].includes(activeTab)) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const columnMap = {
          "D": { pnl: "1d_pnl", pct: "1d_pct" },
          "5d": { pnl: "5d_pnl", pct: "5d_pct" },
          "m": { pnl: "1m_pnl", pct: "1m_pct" },
          "ytd": { pnl: "ytd_pnl", pct: "ytd_pct" }
        };

        const columns = columnMap[activeTab];

        const { data, error } = await supabase
          .from("client_strategy_returns_c")
          .select("*")
          .eq("user_id", userId)
          .eq("strategy_id", strategyId)
          .order("as_of_date", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && data) {
          const pnlValue = data[columns.pnl] || 0;
          const pctValue = data[columns.pct] || 0;
          const basketValue = (Number(data.basket_value || 0)) / 100;
          setReturnData({
            pnl: (Number(pnlValue)) / 100,
            pct: Number(pctValue),
            basketValue: basketValue
          });
        } else {
          setReturnData({ pnl: 0, pct: 0, basketValue: 0 });
        }
      } catch (err) {
        console.warn("[useStrategyPeriodReturns] Error fetching period returns:", err);
        setReturnData({ pnl: 0, pct: 0, basketValue: 0 });
      } finally {
        setLoading(false);
      }
    };

    fetchPeriodReturns();
  }, [userId, strategyId, activeTab]);

  return { returnData, loading };
};

function parseDateParts(ts) {
  const dateStr = ts.split("T")[0];
  const [y, m, d] = dateStr.split("-").map(Number);
  const dayOfWeek = new Date(y, m - 1, d).getDay();
  return { year: y, month: m, day: d, dayOfWeek };
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatChartData(priceHistory, timeFilter) {
  if (!priceHistory || priceHistory.length === 0) return [];

  switch (timeFilter) {
    case "D":
    case "W":
    case "5d": {
      return priceHistory.map((p) => {
        const { day, month, dayOfWeek, year } = parseDateParts(p.ts);
        return {
          day: `${day} ${MONTH_NAMES_SHORT[month - 1]} '${String(year).slice(-2)}`,
          value: p.nav,
          fullDate: `${DAY_NAMES[dayOfWeek]}, ${day} ${MONTH_NAMES_SHORT[month - 1]} ${year}`,
        };
      });
    }
    case "M":
    case "m": {
      return priceHistory.map((p) => {
        const { year, day, month } = parseDateParts(p.ts);
        return {
          day: `${day} ${MONTH_NAMES_SHORT[month - 1]} '${String(year).slice(-2)}`,
          value: p.nav,
          fullDate: `${day} ${MONTH_NAMES_SHORT[month - 1]} ${year}`,
        };
      });
    }
    case "ALL":
    case "ytd":
    case "all": {
      const monthKeys = new Set();
      priceHistory.forEach((p) => {
        const { year, month } = parseDateParts(p.ts);
        monthKeys.add(`${year}-${month}`);
      });
      // If less than 3 months of data, show daily points so the chart has a meaningful curve
      if (monthKeys.size < 3) {
        return priceHistory.map((p) => {
          const { year, month, day, dayOfWeek } = parseDateParts(p.ts);
          return {
            day: `${day} ${MONTH_NAMES_SHORT[month - 1]}`,
            value: p.nav,
            fullDate: `${DAY_NAMES[dayOfWeek]}, ${day} ${MONTH_NAMES_SHORT[month - 1]} ${year}`,
          };
        });
      }
      // For longer history, group by month
      const grouped = {};
      priceHistory.forEach((p) => {
        const { year, month } = parseDateParts(p.ts);
        const key = `${MONTH_NAMES_SHORT[month - 1]} '${String(year).slice(-2)}`;
        grouped[key] = p.nav;
      });
      const entries = Object.entries(grouped);
      return entries.map(([day, value]) => ({
        day,
        value,
        fullDate: day,
      }));
    }
    default:
      return priceHistory.map((p) => {
        const { year, month, day, dayOfWeek } = parseDateParts(p.ts);
        return {
          day: `${day} ${MONTH_NAMES_SHORT[month - 1]}`,
          value: p.nav,
          fullDate: `${DAY_NAMES[dayOfWeek]}, ${day} ${MONTH_NAMES_SHORT[month - 1]} ${year}`,
        };
      });
  }
}
