import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";

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
        .select("strategy_id, basket_value, inception_pnl, inception_pct, as_of_date, holdings_snapshot")
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

      // Build latest returns map per strategy_id (first row per strategy = most recent)
      const returnsMap = {};
      for (const row of (returnsData || [])) {
        if (!returnsMap[row.strategy_id]) {
          returnsMap[row.strategy_id] = {
            basketValueCents: Number(row.basket_value || 0),
            inceptionPnlCents: row.inception_pnl == null ? null : Number(row.inception_pnl),
            inceptionPct: row.inception_pct == null ? null : Number(row.inception_pct),
            asOfDate: row.as_of_date,
            holdingsSnapshot: Array.isArray(row.holdings_snapshot) ? row.holdings_snapshot : [],
          };
        }
      }

      // Get active strategies for metadata (name, logos, static weights)
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

          // Build a lookup from static holdings for logo/name enrichment
          const staticBySymbol = Object.fromEntries(
            (strategy.holdings || []).map(h => [h.symbol, { logo_url: h.logo_url, name: h.name }])
          );

          // Convert holdings_snapshot (cents) to display-ready shape with weights
          const snapshot = returns.holdingsSnapshot;
          const totalMarketValueCents = snapshot.reduce(
            (sum, h) => sum + Number(h.current_price || 0) * Number(h.qty || 0), 0
          );
          const snapshotHoldings = snapshot.map(h => {
            const marketValueCents = Number(h.current_price || 0) * Number(h.qty || 0);
            const weight = totalMarketValueCents > 0 ? (marketValueCents / totalMarketValueCents) * 100 : 0;
            const info = staticBySymbol[h.symbol] || {};
            return {
              symbol: h.symbol,
              name: info.name || h.symbol,
              logo_url: info.logo_url || null,
              weight,
              qty: Number(h.qty || 0),
              avg_fill: Number(h.avg_fill || 0),       // cents — divide by 100 to display
              current_price: Number(h.current_price || 0), // cents — divide by 100 to display
              avg_exit: h.avg_exit ?? null,
              is_fill_day: h.is_fill_day || false,
              is_exit_day: h.is_exit_day || false,
            };
          }).sort((a, b) => b.weight - a.weight);

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
            // snapshotHoldings: live per-user holdings from client_strategy_returns_c
            // holdings: static strategy definition from strategies_c (fallback)
            snapshotHoldings: snapshotHoldings.length > 0 ? snapshotHoldings : (strategy.holdings || []),
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

export const useStrategyChartData = (strategyId, timeFilter = "m") => {
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchChartData = async () => {
      if (!strategyId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          setChartData([]);
          setLoading(false);
          return;
        }

        const now = new Date();
        const startDateMap = {
          "D":         new Date(now.getTime() - 7 * 86400000),
          "5d":        new Date(now.getTime() - 10 * 86400000),
          "m":         new Date(now.getTime() - 45 * 86400000),
          "ytd":       new Date(now.getFullYear(), 0, 1),
          "6m":        new Date(now.getTime() - 200 * 86400000),
          "1y":        new Date(now.getTime() - 400 * 86400000),
          "inception": null,
        };
        const startDate = Object.prototype.hasOwnProperty.call(startDateMap, timeFilter)
          ? startDateMap[timeFilter]
          : startDateMap["m"];

        let query = supabase
          .from("client_strategy_returns_c")
          .select("as_of_date, basket_value, inception_pnl")
          .eq("user_id", session.user.id)
          .eq("strategy_id", strategyId)
          .order("as_of_date", { ascending: true });

        if (startDate) {
          query = query.gte("as_of_date", startDate.toISOString().split("T")[0]);
        }

        const { data, error } = await query;
        if (error || !data?.length) {
          setChartData([]);
          setLoading(false);
          return;
        }

        // Use inception_pnl (cents → ZAR) as the Y-axis so the chart shows
        // cumulative PnL in rands — matches the existing PnL axis format.
        const priceHistory = data.map(row => ({
          ts: row.as_of_date + "T00:00:00Z",
          nav: (Number(row.inception_pnl) || 0) / 100,
        }));

        setChartData(formatChartData(priceHistory, timeFilter));
      } catch (err) {
        console.error("[useStrategyChartData] Error:", err);
        setChartData([]);
      } finally {
        setLoading(false);
      }
    };

    fetchChartData();
  }, [strategyId, timeFilter]);

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
      if (!userId || !strategyId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const columnMap = {
          "D":         { pnl: "1d_pnl",        pct: "1d_pct" },
          "5d":        { pnl: "5d_pnl",        pct: "5d_pct" },
          "m":         { pnl: "1m_pnl",        pct: "1m_pct" },
          "ytd":       { pnl: "ytd_pnl",       pct: "ytd_pct" },
          "6m":        { pnl: "6m_pnl",        pct: "6m_pct" },
          "1y":        { pnl: "1y_pnl",        pct: "1y_pct" },
          "inception": { pnl: "inception_pnl", pct: "inception_pct" },
        };

        const columns = columnMap[activeTab];
        if (!columns) {
          setReturnData({ pnl: null, pct: null, basketValue: 0 });
          setLoading(false);
          return;
        }

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
    case "all":
    case "6m":
    case "1y":
    case "inception": {
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
