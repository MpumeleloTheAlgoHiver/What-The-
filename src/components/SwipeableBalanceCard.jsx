import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Eye,
  EyeOff,
  TrendingUp,
  TrendingDown,
  LayoutGrid,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { supabase } from "../lib/supabase";
import { getStrategyPriceHistory, getClientStrategyReturns } from "../lib/strategyData";
import { useRealtimePrices } from "../lib/useRealtimePrices";
import Skeleton from "./Skeleton";
import SettlementBadge from "./PendingBadge";
import {
  useSettlementConfig,
  getSettlementStatusForHolding,
} from "../lib/useSettlementStatus";

const VISIBILITY_STORAGE_KEY = "mintBalanceVisible";

const truncateDecimal = (num, decimals) => {
  const factor = Math.pow(10, decimals);
  return Math.floor(num * factor) / factor;
};

const formatFull = (value) => {
  const num = Number(value);
  const truncated = truncateDecimal(num, 2);
  return `R${truncated.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatKMB = (value) => {
  const num = Number(value);
  const sign = num < 0 ? "-" : "";
  const absNum = Math.abs(num);
  let formatted = absNum;
  if (absNum >= 1e9) formatted = (truncateDecimal(absNum / 1e9, 1)).toString() + "b";
  else if (absNum >= 1e6) formatted = (truncateDecimal(absNum / 1e6, 1)).toString() + "m";
  else if (absNum >= 1e3) formatted = (truncateDecimal(absNum / 1e3, 1)).toString() + "k";
  else formatted = truncateDecimal(absNum, 2).toString();
  return `${sign}R${formatted}`;
};

const formatPrecise = (value) => {
  const num = Number(value);
  const truncated = truncateDecimal(num, 2);
  return `R${truncated.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const TIMEFRAME_DAYS = { d: 7, "5d": 5, m: 30, ytd: 365, all: 1825 };

const SwipeableBalanceCard = ({
  userId,
  isBackFacing = true,
  forceVisible,
  mintNumber: mintNumberProp,
}) => {
  const [activeTab, setActiveTab] = useState("m");
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const { lastUpdated, isConnected } = useRealtimePrices();
  const settlementCfg = useSettlementConfig();
  const holdingSettlementStatus = getSettlementStatusForHolding(settlementCfg);
  const [showUpdatedText, setShowUpdatedText] = useState(false);
  const updatedTimerRef = useRef(null);

  // ── FIX 1: Wallet balance state ──────────────────────────────────────────
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletLoading, setWalletLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    const fetchWallet = async () => {
      setWalletLoading(true);
      try {
        const { data, error } = await supabase
          .from("wallets")
          .select("balance")
          .eq("user_id", userId)
          .maybeSingle();
        if (!error && data?.balance !== undefined) {
          // Balance is stored in Rands (not cents)
          const bal = Number(data.balance);
          setWalletBalance(bal);
        } else if (error) {
          console.error("❌ [SwipeableBalanceCard] Wallet fetch error:", error);
        }
      } catch (err) {
        console.error("❌ [SwipeableBalanceCard] Wallet fetch crash:", err);
      } finally {
        setWalletLoading(false);
      }
    };
    fetchWallet();

    window.addEventListener("profile-updated", fetchWallet);
    window.addEventListener("wallet-updated", fetchWallet);
    return () => {
      window.removeEventListener("profile-updated", fetchWallet);
      window.removeEventListener("wallet-updated", fetchWallet);
    };
  }, [userId]);

  // ── FIX 2: Mint number — fetch from DB if prop not provided ──────────────
  const [mintNumber, setMintNumber] = useState(mintNumberProp || null);

  useEffect(() => {
    if (mintNumberProp) {
      setMintNumber(mintNumberProp);
      return;
    }
    if (!userId) return;
    const fetchMintNumber = async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("mint_number")
          .eq("id", userId)
          .maybeSingle();
        if (!error && data?.mint_number) {
          setMintNumber(data.mint_number);
        }
      } catch (e) {}
    };
    fetchMintNumber();
  }, [userId, mintNumberProp]);

  useEffect(() => {
    if (lastUpdated) {
      setShowUpdatedText(true);
      if (updatedTimerRef.current) clearTimeout(updatedTimerRef.current);
      updatedTimerRef.current = setTimeout(
        () => setShowUpdatedText(false),
        3000,
      );
    }
    return () => {
      if (updatedTimerRef.current) clearTimeout(updatedTimerRef.current);
    };
  }, [lastUpdated]);


  useEffect(() => {
    if (!isBackFacing) setIsOpen(false);
  }, [isBackFacing]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isOpen]);

  const [selectedAsset, setSelectedAsset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chartData, setChartData] = useState([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [returnData5d, setReturnData5d] = useState({ pnl: 0, pct: 0 });
  const [latestBasketValue, setLatestBasketValue] = useState(0);
  const holdingsScrollRef = useRef(null);

  const scrollToHoldingIndex = (index) => {
    const container = holdingsScrollRef.current;
    if (!container) return;
    const item = container.querySelector(`[data-holding-index="${index}"]`);
    if (item) {
      const containerRect = container.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      const scrollLeft =
        container.scrollLeft +
        (itemRect.left - containerRect.left) -
        containerRect.width / 2 +
        itemRect.width / 2;
      container.scrollTo({ left: scrollLeft, behavior: "smooth" });
    }
  };

  const [dbData, setDbData] = useState({
    holdings: [],
    totalMarketValue: 0,
    totalInvested: 0,
    totalInvestedAmount: 0,
    holdingsCount: 0,
  });

  const [isVisible, setIsVisible] = useState(() => {
    try { return localStorage.getItem(VISIBILITY_STORAGE_KEY) !== "false"; } catch { return true; }
  });

  const toggleVisibility = () => {
    setIsVisible(v => {
      try { localStorage.setItem(VISIBILITY_STORAGE_KEY, String(!v)); } catch {}
      return !v;
    });
  };

  const loadDataRef = React.useRef(null);

  useEffect(() => {
    const loadData = async () => {
      if (!userId) return;
      setLoading(true);

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token;

        const [holdingsRes, strategiesRes] = token
          ? await Promise.all([
            fetch("/api/user/holdings", {
              headers: { Authorization: `Bearer ${token}` },
            }).then((r) => (r.ok ? r.json() : { holdings: [] })),
            fetch("/api/user/strategies", {
              headers: { Authorization: `Bearer ${token}` },
            }).then((r) => (r.ok ? r.json() : { strategies: [] })),
          ])
          : [{ holdings: [] }, { strategies: [] }];

        const stockHoldings = (holdingsRes.holdings || []).filter(h => !h.strategy_id);
        const strategyItems = await Promise.all((strategiesRes.strategies || []).map(async (s) => {
          const holdingsArr = s.holdings || [];
          const topLogos = holdingsArr
            .sort((a, b) => (b.weight || 0) - (a.weight || 0))
            .slice(0, 3)
            .map((h) => h.logo_url || null)
            .filter(Boolean);
          const investedRands = s.investedAmount || 0;
          const liveRands = s.currentMarketValue != null ? s.currentMarketValue : investedRands;
          const purchaseDate = s.firstInvestedDate;
          let changePct = investedRands > 0 ? ((liveRands - investedRands) / investedRands) * 100 : 0;

          const investedCents = Math.round(investedRands * 100);
          const currentCents = Math.round(liveRands * 100);
          return {
            symbol: s.shortName || s.name || "Strategy",
            name: s.name || "Strategy",
            market_value: currentCents,
            invested_amount: investedCents,
            avg_fill: investedCents,
            quantity: 1,
            logo_url: null,
            security_id: null,
            isStrategy: true,
            strategyId: s.id,
            topLogos: topLogos,
            changePct: changePct,
            holdings: holdingsArr,
            firstInvestedDate: purchaseDate,
          };
        }));
        const enrichedHoldings = [...stockHoldings, ...strategyItems];

        const mValue = enrichedHoldings.reduce(
          (acc, h) => acc + Number(h.market_value || 0) / 100,
          0,
        );
        const invested = enrichedHoldings.reduce(
          (acc, h) =>
            acc + (Number(h.avg_fill || 0) * Number(h.quantity || 0)) / 100,
          0,
        );
        const investedAmount = enrichedHoldings.reduce(
          (acc, h) => {
            if (h.invested_amount !== undefined) return acc + Number(h.invested_amount) / 100;
            // For stocks, use avg_fill * quantity as the initial invested amount
            return acc + (Number(h.avg_fill || 0) * Number(h.quantity || 0)) / 100;
          },
          0,
        );

        console.log("[SwipeableBalanceCard] Loaded holdings:", {
          count: enrichedHoldings.length,
          totalMarketValue: mValue,
          holdings: enrichedHoldings.map(h => ({
            symbol: h.symbol,
            market_value: h.market_value,
            security_id: h.security_id,
            strategy_id: h.strategy_id,
            quantity: h.quantity,
            avg_fill: h.avg_fill
          }))
        });

        setDbData({
          holdings: enrichedHoldings,
          totalMarketValue: mValue,
          totalInvested: invested,
          totalInvestedAmount: investedAmount,
          holdingsCount: enrichedHoldings.length,
        });
      } catch (err) {
        console.error("❌ [SwipeableBalanceCard] Load data error:", err);
      } finally {
        setLoading(false);
      }
    };

    loadDataRef.current = loadData;
    loadData();

    const handleVisibility = () => {
      if (document.visibilityState === "visible") loadDataRef.current?.();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [userId, lastUpdated]);

  useEffect(() => {
    const fetchChartPrices = async () => {
      if (!userId) return;

      // Ensure we don't leave chart stuck in loading if no holdings
      if (dbData.holdings.length === 0) {
        if (!loading) {
           setChartData([]);
           setChartLoading(false);
        }
        return;
      }

      setChartLoading(true);
      try {
        const holdingsToChart = selectedAsset ? [selectedAsset] : dbData.holdings;
        const days = TIMEFRAME_DAYS[activeTab] || 30;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const startDateStr = cutoff.toISOString().split("T")[0];
        console.log(`[SwipeableBalanceCard] Fetching history for tab: ${activeTab}, days: ${days}, startDate: ${startDateStr}`);

        // Process strategies using client_strategy_returns_c table (basket_value for the period)
        const strategyBasketByDate = {};
        const endDateStr = new Date().toISOString().split("T")[0];
        const limitValue = activeTab === "5d" ? 5 : undefined;

        const strategyHoldings = holdingsToChart.filter(h => h.isStrategy && h.strategyId);
        for (const sh of strategyHoldings) {
          try {
            // Build query for basket_value from client_strategy_returns_c
            let query = supabase
              .from("client_strategy_returns_c")
              .select("as_of_date, basket_value")
              .eq("user_id", userId)
              .eq("strategy_id", sh.strategyId)
              .gte("as_of_date", startDateStr)
              .order("as_of_date", { ascending: true });

            // For 5d, limit to 5 rows; otherwise get all rows in the range
            if (limitValue) {
              query = query.limit(limitValue);
            }

            const { data, error } = await query;

            if (!error && data && data.length > 0) {
              // Process rows and convert basket_value from cents to rands
              data.forEach((row) => {
                const dateKey = row.as_of_date;
                const basketValueRands = (Number(row.basket_value || 0)) / 100;
                strategyBasketByDate[dateKey] = (strategyBasketByDate[dateKey] || 0) + basketValueRands;
              });
            }
          } catch (e) {
            console.warn(`[Chart] Failed to fetch strategy basket values for ${sh.strategyId}:`, e);
          }
        }

        // Process stocks
        const stockHoldings = holdingsToChart.filter(h => h.security_id && !h.isStrategy);
        const pricePromises = stockHoldings.map(async (h) => {
          try {
            let { data, error } = await supabase
              .from("stock_returns_c")
              .select("as_of_date, current_price")
              .eq("security_id", h.security_id)
              .gte("as_of_date", startDateStr)
              .order("as_of_date", { ascending: true });

            if (error || !data || data.length < 2) {
              const fallback = await supabase
                .from("stock_returns_c")
                .select("as_of_date, current_price")
                .eq("security_id", h.security_id)
                .order("as_of_date", { ascending: false })
                .limit(30);
              if (!fallback.error && fallback.data && fallback.data.length >= 2) {
                data = fallback.data.reverse();
              } else if (!data || data.length === 0) return null;
            }

            const pDateStr = (h.created_at || h.as_of_date || "").split("T")[0];
            const avgFillPrice = Number(h.avg_fill || 0) / 100;
            const livePrice = Number(h.last_price || 0) / 100;
            
            const allMapped = data.map((p) => ({
              ts: p.as_of_date.split("T")[0],
              close: Number(p.current_price) / 100,
            }));
            
            let filteredPrices = allMapped.filter((p) => p.ts >= pDateStr);
            if (filteredPrices.length === 0) {
              filteredPrices = [{ ts: pDateStr, close: avgFillPrice }];
            }
            
            const today = new Date().toISOString().split("T")[0];
            const lastDate = filteredPrices[filteredPrices.length - 1]?.ts;
            if (livePrice > 0 && lastDate && lastDate < today) {
              filteredPrices.push({ ts: today, close: livePrice });
            }
            
            return {
              securityId: h.security_id,
              quantity: Number(h.quantity || 1),
              avgFill: avgFillPrice,
              prices: filteredPrices,
            };
          } catch (e) {
            console.warn(`[Chart] Failed to fetch stock ${h.security_id}:`, e);
            return null;
          }
        });

        const allPriceData = (await Promise.all(pricePromises)).filter(Boolean);
        const hasStrategyData = Object.keys(strategyBasketByDate).length > 0;

        if (allPriceData.length === 0 && !hasStrategyData) {
          // No price history in DB — synthesize a 2-point chart from cost basis → current market value
          const activeHoldings = holdingsToChart.filter(h => !h.isStrategy && Number(h.avg_fill || 0) > 0);
          if (activeHoldings.length > 0) {
            const totalCostCents = activeHoldings.reduce((s, h) => s + Number(h.avg_fill || 0) * Number(h.quantity || 0), 0);
            const totalMarketCents = activeHoldings.reduce((s, h) => s + Number(h.market_value || 0), 0);
            const totalPnl = (totalMarketCents - totalCostCents) / 100;
            const earliest = activeHoldings
              .map(h => (h.created_at || h.as_of_date || "").slice(0, 10))
              .filter(Boolean).sort()[0] || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
            const today = new Date().toISOString().slice(0, 10);
            setChartData([
              { d: earliest, v: 0 },
              { d: today, v: Number(totalPnl.toFixed(2)) },
            ]);
          } else {
            setChartData([]);
          }
          return;
        }

        // Merge dates and calculate PnL per point
        const dateSet = new Set();
        allPriceData.forEach(({ prices }) => prices.forEach((p) => dateSet.add(p.ts)));
        Object.keys(strategyBasketByDate).forEach((d) => dateSet.add(d));
        const sortedDates = Array.from(dateSet).sort();

        const rawPriceByDate = {};
        allPriceData.forEach(({ securityId, prices }) => {
          rawPriceByDate[securityId] = {};
          prices.forEach((p) => { rawPriceByDate[securityId][p.ts] = p.close; });
        });

        const filledPriceByDate = {};
        allPriceData.forEach(({ securityId }) => {
          filledPriceByDate[securityId] = {};
          let lastK = 0;
          for (const dateKey of sortedDates) {
            if (rawPriceByDate[securityId]?.[dateKey] !== undefined) {
              lastK = rawPriceByDate[securityId][dateKey];
            }
            if (lastK > 0) filledPriceByDate[securityId][dateKey] = lastK;
          }
        });

        const points = [];
        // Don't add anchor point - start with first actual value at bottom left
        for (const dateKey of sortedDates) {
          let totalPnl = 0;
          let hasVal = false;
          for (const { securityId, quantity, avgFill } of allPriceData) {
            const pr = filledPriceByDate[securityId]?.[dateKey];
            if (pr && avgFill > 0) {
              totalPnl += quantity * (pr - avgFill);
              hasVal = true;
            }
          }
          // Add strategy basket value from last 5 rows (in rands)
          if (strategyBasketByDate[dateKey] !== undefined) {
            totalPnl += strategyBasketByDate[dateKey];
            hasVal = true;
          }
          if (hasVal) points.push({ d: dateKey, v: Number(totalPnl.toFixed(2)) });
        }

        // Normalize chart to start value: subtract first value from all points
        if (points.length > 0) {
          const firstValue = points[0].v;
          points.forEach(point => {
            point.v = Number((point.v - firstValue).toFixed(2));
          });
          // Add the first value back as the baseline
          points[0].v = firstValue;
        }

        console.log(`[SwipeableBalanceCard] Final chart points: ${points.length}`);
        setChartData(points);
      } catch (err) {
        console.error("❌ [SwipeableBalanceCard] Chart fetch error:", err);
      } finally {
        setChartLoading(false);
      }
    };

    fetchChartPrices();
  }, [userId, dbData.holdings, activeTab, selectedAsset, lastUpdated, loading]);

  useEffect(() => {
    const fetchPeriodReturnData = async () => {
      if (!["5d", "m", "ytd", "all"].includes(activeTab) || !userId) return;

      try {
        // If an asset is selected, show its returns
        // Otherwise, calculate portfolio-wide returns
        const asset = selectedAsset;

        // Map activeTab to column names
        const columnMap = {
          "5d": { pnl: "5d_pnl", pct: "5d_pct" },
          "m": { pnl: "1m_pnl", pct: "1m_pct" },
          "ytd": { pnl: "ytd_pnl", pct: "ytd_pct" },
          "all": { pnl: "inception_pnl", pct: "inception_pct" }
        };

        const columns = columnMap[activeTab];

        if (asset) {
          // For selected asset, fetch from appropriate table
          if (asset.isStrategy && asset.strategyId) {
            const { data, error } = await supabase
              .from("client_strategy_returns_c")
              .select("*")
              .eq("user_id", userId)
              .eq("strategy_id", asset.strategyId)
              .order("as_of_date", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (!error && data) {
              const pnlValue = data[columns.pnl] || 0;
              const pctValue = data[columns.pct] || 0;
              const basketValue = (Number(data.basket_value || 0)) / 100;
              setReturnData5d({
                pnl: (Number(pnlValue)) / 100,
                pct: Number(pctValue)
              });
              setLatestBasketValue(basketValue);
            } else {
              setLatestBasketValue(0);
              setReturnData5d({ pnl: 0, pct: 0 });
            }
          } else if (asset.security_id) {
            const { data, error } = await supabase
              .from("stock_returns_c")
              .select("*")
              .eq("security_id", asset.security_id)
              .order("as_of_date", { ascending: false })
              .limit(1)
              .single();

            if (!error && data) {
              const pnlValue = data[columns.pnl] || 0;
              const pctValue = data[columns.pct] || 0;
              const basketValue = (Number(data.basket_value || 0)) / 100;
              setReturnData5d({
                pnl: (Number(pnlValue)) / 100,
                pct: Number(pctValue)
              });
              setLatestBasketValue(basketValue);
            } else {
              setLatestBasketValue(0);
              setReturnData5d({ pnl: 0, pct: 0 });
            }
          }
        } else if (dbData.holdings.length > 0) {
          // For portfolio-wide returns, sum returns from all holdings
          let totalPnl = 0;
          let weightedPct = 0;
          let totalValue = dbData.totalMarketValue;
          let totalInvested = dbData.totalInvestedAmount;

          const strategyIds = dbData.holdings
            .filter(h => h.isStrategy && h.strategyId)
            .map(h => h.strategyId);

          const securityIds = dbData.holdings
            .filter(h => h.security_id && !h.isStrategy)
            .map(h => h.security_id);

          // Fetch latest return data for each strategy
          if (strategyIds.length > 0) {
            for (const strategyId of strategyIds) {
              const { data: row, error: err } = await supabase
                .from("client_strategy_returns_c")
                .select("*")
                .eq("user_id", userId)
                .eq("strategy_id", strategyId)
                .order("as_of_date", { ascending: false })
                .limit(1)
                .maybeSingle();

              if (!err && row) {
                const pnlValue = row[columns.pnl] || 0;
                const pctValue = row[columns.pct] || 0;
                const basketValue = (Number(row.basket_value || 0)) / 100;
                const weight = dbData.totalMarketValue > 0 ? basketValue / dbData.totalMarketValue : 0;
                totalPnl += (Number(pnlValue)) / 100;
                weightedPct += Number(pctValue) * weight;
              }
            }
          }

          // Fetch latest return data for each stock
          if (securityIds.length > 0) {
            for (const securityId of securityIds) {
              const { data: row, error: err } = await supabase
                .from("stock_returns_c")
                .select("*")
                .eq("security_id", securityId)
                .order("as_of_date", { ascending: false })
                .limit(1)
                .single();

              if (!err && row) {
                const pnlValue = row[columns.pnl] || 0;
                const pctValue = row[columns.pct] || 0;
                const basketValue = (Number(row.basket_value || 0)) / 100;
                const weight = dbData.totalMarketValue > 0 ? basketValue / dbData.totalMarketValue : 0;
                totalPnl += (Number(pnlValue)) / 100;
                weightedPct += Number(pctValue) * weight;
              }
            }
          }

          // Calculate portfolio return percentage
          const portfolioPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

          setReturnData5d({
            pnl: totalPnl,
            pct: portfolioPct
          });
        }
      } catch (e) {
        console.warn("[SwipeableBalanceCard] Error fetching period return data:", e);
      }
    };

    fetchPeriodReturnData();
  }, [activeTab, userId, selectedAsset, dbData.holdings]);

  const displayMarketValue = selectedAsset
    ? Number(selectedAsset.market_value || 0) / 100
    : dbData.totalMarketValue;
  const displayInvested = selectedAsset
    ? (Number(selectedAsset.avg_fill || 0) *
      Number(selectedAsset.quantity || 0)) /
    100
    : dbData.totalInvested;
  const displayInvestedAmount = selectedAsset
    ? (selectedAsset.invested_amount !== undefined
        ? Number(selectedAsset.invested_amount) / 100
        : (Number(selectedAsset.avg_fill || 0) * Number(selectedAsset.quantity || 0)) / 100)
    : dbData.totalInvestedAmount;
  const displayReturn = ["5d", "m", "ytd", "all"].includes(activeTab)
    ? returnData5d.pnl
    : (displayMarketValue - displayInvested);
  // Show latest basket_value for period views, otherwise use market value
  const displayBalance = ["5d", "m", "ytd", "all"].includes(activeTab) && latestBasketValue > 0
    ? latestBasketValue
    : displayMarketValue;

  const isLoss = displayReturn < 0;
  const returnPct = ["5d", "m", "ytd", "all"].includes(activeTab)
    ? truncateDecimal(returnData5d.pct, 2).toFixed(2)
    : (displayInvested > 0
      ? truncateDecimal((displayReturn / displayInvested) * 100, 2).toFixed(2)
      : "0.00");
  const chartColor = isLoss ? "hsl(0,84%,60%)" : "hsl(160,70%,45%)";

  const masked = "••••";

  const TrendIcon = isLoss ? TrendingDown : TrendingUp;

  if (loading && userId)
    return (
      <div className="rounded-3xl gradient-hero-card shadow-hero p-5 relative overflow-hidden border border-white/5 animate-pulse">
        <div className="flex items-center justify-between mb-3">
          <Skeleton className="h-2.5 w-28 bg-white/10 rounded" />
          <Skeleton className="h-3 w-10 bg-white/10 rounded" />
        </div>
        <div className="flex items-end justify-between mb-4">
          <div>
            <Skeleton className="h-8 w-36 bg-white/10 rounded mb-2" />
            <Skeleton className="h-5 w-24 bg-white/10 rounded" />
          </div>
          <Skeleton className="h-12 w-28 bg-white/10 rounded" />
        </div>
        <Skeleton className="h-9 w-full bg-white/10 rounded-full mb-4" />
        <div className="flex gap-4 pt-4 border-t border-white/10">
          <Skeleton className="h-8 w-24 bg-white/10 rounded" />
          <Skeleton className="h-8 w-24 bg-white/10 rounded" />
        </div>
      </div>
    );

  return (
    <div className="rounded-3xl gradient-hero-card shadow-hero p-5 relative overflow-hidden border border-white/5">
      {/* Ambient glows */}
      <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-accent/30 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-8 w-32 h-32 rounded-full bg-primary/15 blur-3xl pointer-events-none" />

      {/* Top row: label + visibility + LIVE */}
      <div className="flex items-center justify-between relative">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold tracking-[0.18em] text-white/60">
            {selectedAsset ? selectedAsset.symbol.toUpperCase() : "PORTFOLIO VALUE"}
          </span>
          <button
            onClick={toggleVisibility}
            className="text-white/50 hover:text-white/90 transition-colors"
            aria-label="Toggle visibility"
          >
            {isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          {isConnected && (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-success" style={{ animation: "pulse-dot 2s ease-in-out infinite" }} />
              <span className="text-[9px] tracking-wider text-white/50 font-semibold">LIVE</span>
            </>
          )}
        </div>
      </div>

      {/* Value + inline sparkline */}
      <div className="flex items-end justify-between mt-2 relative">
        <div className="flex-1 min-w-0 pr-3">
          <h2 className="text-3xl font-bold tracking-tight text-white leading-none">
            {isVisible ? formatFull(displayBalance) : masked}
          </h2>
          <div className="flex items-center gap-2 mt-2">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${isLoss ? "bg-destructive/20 text-destructive" : "bg-success/20 text-success"}`}>
              <TrendIcon size={11} strokeWidth={2.5} />
              {isVisible ? (
                <>
                  {["5d", "m", "ytd", "all"].includes(activeTab) && (
                    <span className="text-[10px] opacity-75">
                      {activeTab === "5d" && "5D:"}{activeTab === "m" && "1M:"}{activeTab === "ytd" && "YTD:"}{activeTab === "all" && "Inc:"}
                    </span>
                  )}
                  {formatKMB(Math.abs(displayReturn))}
                </>
              ) : (
                masked
              )}
            </span>
            <span className={`text-[11px] font-medium ${isLoss ? "text-destructive" : "text-success"}`}>
              {isVisible ? `${isLoss ? "-" : "+"}${returnPct}%` : masked}
            </span>
          </div>
        </div>

        {/* Inline sparkline */}
        <div className="opacity-90 shrink-0">
          {chartData.length > 1 ? (
            <ResponsiveContainer width={110} height={48}>
              <ComposedChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg px-2 py-1 shadow-md">
                        <p className="text-[9px] text-slate-500">{payload[0]?.payload?.d}</p>
                        <p className="text-[10px] font-semibold text-slate-800">{formatPrecise(payload[0]?.value)}</p>
                      </div>
                    );
                  }}
                />
                <ReferenceLine y={0} stroke="rgba(148,163,184,0.3)" strokeDasharray="3 3" strokeWidth={1} />
                <Area type="monotone" dataKey="v" stroke="none" fill={chartColor} fillOpacity={0.15} />
                <Line type="monotone" dataKey="v" stroke={chartColor} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : chartLoading ? (
            <div className="flex items-end gap-0.5 w-[110px] h-12">
              {[40, 55, 35, 65, 50, 70, 45, 60].map((h, i) => (
                <Skeleton key={i} className="flex-1 rounded-sm bg-white/10" style={{ height: `${h}%` }} />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Asset selector */}
      <div ref={dropdownRef} className="relative mt-3">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/15"
        >
          <LayoutGrid size={12} className="text-violet-400" />
          <span className="text-[11px] font-medium text-slate-200 whitespace-nowrap">
            {selectedAsset ? selectedAsset.symbol : (dbData.holdings.length > 0 ? dbData.holdings[0].symbol : "Investments")}
          </span>
          {isOpen ? <ChevronUp size={12} className="text-slate-300" /> : <ChevronDown size={12} className="text-slate-300" />}
        </button>
        {isOpen && (
          <div className="absolute top-full mt-1 left-0 w-48 bg-white rounded-xl z-[120] overflow-hidden border border-slate-200 shadow-lg">
            <div className="py-1 overflow-y-auto max-h-[140px]">
              {dbData.holdings.map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => { setSelectedAsset(item); setIsOpen(false); scrollToHoldingIndex(idx); }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${selectedAsset?.symbol === item.symbol ? "bg-slate-100" : "hover:bg-slate-50"}`}
                >
                  <div className="w-4 h-4 rounded-full overflow-hidden bg-slate-100 shrink-0">
                    {item.isStrategy && item.topLogos?.length > 0 ? (
                      <div className="flex -space-x-1 h-full items-center justify-center">
                        {item.topLogos.slice(0, 2).map((logo, li) => (
                          <img key={li} src={logo} className="w-3 h-3 rounded-full object-cover border border-white/25" />
                        ))}
                      </div>
                    ) : item.logo_url ? (
                      <img src={item.logo_url} className="w-full h-full object-cover" />
                    ) : (
                      <span className="flex items-center justify-center w-full h-full text-[6px] text-slate-500">
                        {item.symbol?.substring(0, 2)}
                      </span>
                    )}
                  </div>
                  <span className="text-[9px] font-medium text-slate-700 truncate">{item.symbol}</span>
                  {(() => {
                    if (item.isStrategy && Number(item.avg_fill || 0) === 0) return <SettlementBadge status="pending" size="xs" />;
                    if (item.settlement_status && item.settlement_status !== "confirmed") return <SettlementBadge status={item.settlement_status} size="xs" />;
                    const isSettlementActive = settlementCfg.brokerEnabled || settlementCfg.fullyIntegrated;
                    if (!isSettlementActive) return null;
                    const s = holdingSettlementStatus;
                    return s && s !== "confirmed" ? <SettlementBadge status={s} size="xs" /> : null;
                  })()}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Period selector */}
      <div className="mt-4 flex bg-black/20 backdrop-blur-sm rounded-full p-0.5 relative">
        {[["5d","5D"],["m","M"],["ytd","YTD"],["all","All"]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-1 py-1.5 rounded-full text-[11px] font-semibold transition-all ${
              activeTab === key ? "bg-white text-slate-900 shadow-sm" : "text-white/60 hover:text-white/90"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="mt-4 pt-4 border-t border-white/10 flex relative">
        <div className="flex-1">
          <div className="text-[9px] tracking-[0.15em] text-white/50 font-semibold">CASH</div>
          <div className="text-sm font-bold text-white mt-0.5">
            {isVisible ? (walletLoading ? "..." : formatFull(walletBalance)) : masked}
          </div>
        </div>
        <div className="w-px bg-white/10" />
        <div className="flex-1 pl-4">
          <div className="text-[9px] tracking-[0.15em] text-white/50 font-semibold">MINT NUMBER</div>
          <div className="text-sm font-bold text-white mt-0.5 font-mono">
            {mintNumber ?? "GENERATING..."}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(52,211,153,0.4); }
          50% { opacity: 0.7; box-shadow: 0 0 0 3px rgba(52,211,153,0); }
        }
      `}</style>
    </div>
  );
};

export default SwipeableBalanceCard;