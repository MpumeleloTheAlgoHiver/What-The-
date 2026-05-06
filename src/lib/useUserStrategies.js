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

      const userId = session.user.id;

      // MINT Frontend Playbook: source from client_strategy_returns_c (single source of truth)
      const { data: returnsData, error: returnsError } = await supabase
        .from("client_strategy_returns_c")
        .select("strategy_id, basket_value, inception_pnl, inception_pct, as_of_date")
        .eq("user_id", userId)
        .order("as_of_date", { ascending: false });

      if (returnsError) {
        console.error("[useUserStrategies] Error fetching client_strategy_returns_c:", returnsError);
        // Fallback to API if playbook table unavailable
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
        return;
      }

      // Build latest returns map per strategy_id
      const returnsMap = {};
      for (const row of (returnsData || [])) {
        if (!returnsMap[row.strategy_id]) {
          returnsMap[row.strategy_id] = {
            basketValueCents: Number(row.basket_value || 0),
            inceptionPnlCents: row.inception_pnl == null ? null : Number(row.inception_pnl),
            inceptionPct: row.inception_pct == null ? null : Number(row.inception_pct),
            asOfDate: row.as_of_date,
          };
        }
      }

      // Get active strategies for metadata
      const { data: allStrategies, error: stratErr } = await supabase
        .from("strategies_c")
        .select("id, name, short_name, description, risk_level, sector, icon_url, image_url, holdings, status")
        .eq("status", "active");

      if (stratErr) {
        console.error("[useUserStrategies] Error fetching strategies:", stratErr);
        setData((prev) => ({ ...prev, loading: false, error: stratErr.message }));
        return;
      }

      // Filter to strategies that have returns data
      const matchedStrategies = (allStrategies || [])
        .filter(s => returnsMap[s.id])
        .map(strategy => {
          const returns = returnsMap[strategy.id];
          const basketValueRands = returns.basketValueCents / 100;
          const inceptionPnlRands = returns.inceptionPnlCents != null ? returns.inceptionPnlCents / 100 : null;
          // Derive invested amount from basket_value - inception_pnl
          const investedAmount = inceptionPnlRands != null
            ? basketValueRands - inceptionPnlRands
            : basketValueRands;

          return {
            id: strategy.id,
            strategyId: strategy.id,
            name: strategy.name || "Unknown Strategy",
            shortName: strategy.short_name || strategy.name || "Strategy",
            description: strategy.description || "",
            riskLevel: strategy.risk_level || "Moderate",
            sector: strategy.sector || "",
            iconUrl: strategy.icon_url,
            imageUrl: strategy.image_url,
            holdings: strategy.holdings || [],
            investedAmount: investedAmount,
            currentValue: basketValueRands,
            unitsHeld: 0,
            entryDate: null,
            lastUpdated: returns.asOfDate,
            previousMonthChange: returns.inceptionPct != null ? parseFloat(returns.inceptionPct.toFixed(1)) : 0,
            metrics: { as_of_date: returns.asOfDate },
            firstInvestedDate: null,
          };
        });

      console.log("[useUserStrategies] Strategies from client_strategy_returns_c:", matchedStrategies.length);

      setData({
        strategies: matchedStrategies,
        selectedStrategy: matchedStrategies[0] || null,
        loading: false,
        error: null,
      });
    } catch (err) {
      console.error("[useUserStrategies] Unexpected error:", err);
      setData((prev) => ({ ...prev, loading: false, error: err.message }));
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
// Per playbook: *_pnl columns are in cents (divide by 100), *_pct columns are
// already percentages (do NOT divide). NULL period values mean the client
// hasn't been invested long enough — preserve null so the UI can show "N/A"
// instead of a misleading 0%.
export const useStrategyPeriodReturns = (userId, strategyId, activeTab = "m") => {
  const [returnData, setReturnData] = useState({ pnl: null, pct: null, basketValue: 0 });
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
          const rawPnl = data[columns.pnl];
          const rawPct = data[columns.pct];
          const basketValue = (Number(data.basket_value || 0)) / 100;
          setReturnData({
            pnl: rawPnl == null ? null : Number(rawPnl) / 100,
            pct: rawPct == null ? null : Number(rawPct),
            basketValue: basketValue
          });
        } else {
          setReturnData({ pnl: null, pct: null, basketValue: 0 });
        }
      } catch (err) {
        console.warn("[useStrategyPeriodReturns] Error fetching period returns:", err);
        setReturnData({ pnl: null, pct: null, basketValue: 0 });
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
