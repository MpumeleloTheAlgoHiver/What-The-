import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, Eye, EyeOff, ChevronDown, ChevronRight, ChevronLeft, ArrowLeft, TrendingUp, TrendingDown, Plus } from "lucide-react";
import { Area, ComposedChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell, ReferenceLine } from 'recharts';
import { useInvestments } from "../lib/useFinancialData";
import { useRealtimePrices } from "../lib/useRealtimePrices";
import { useProfile } from "../lib/useProfile";
import { useUserStrategies, useStrategyChartData } from "../lib/useUserStrategies";
import { getMonthlyReturns, getStockMonthlyReturns, getOverallPortfolioMonthlyReturns } from "../lib/strategyData";
import { useStockQuotes, useStockChart } from "../lib/useStockData";
import { clearMarketDataCache } from "../lib/marketData";
import SwipeBackWrapper from "../components/SwipeBackWrapper.jsx";
import PortfolioSkeleton from "../components/PortfolioSkeleton";
import SettlementBadge from "../components/PendingBadge";
import FamilyDropdown from "../components/FamilyDropdown";



const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const formatPnlAxis = (value) => {
  const num = Number(value);
  if (Math.abs(num) < 0.5) return "R0";
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  if (abs >= 1e6) return `${sign}R${(abs / 1e6).toFixed(1)}m`;
  if (abs >= 1e3) return `${sign}R${(abs / 1e3).toFixed(0)}k`;
  return `${sign}R${abs.toFixed(0)}`;
};

const computePnlAxisConfig = (data, dataKey = "value") => {
  if (!data || data.length === 0) return { domain: [-10, 10], ticks: [-10, 0, 10] };
  const values = data.map((p) => p[dataKey]);
  let dataMin = Math.min(...values);
  let dataMax = Math.max(...values);
  if (Math.abs(dataMax - dataMin) < 1) {
    dataMin = Math.min(dataMin, -5);
    dataMax = Math.max(dataMax, 5);
  }
  let axisMin, axisMax;
  if (dataMin >= 0) {
    axisMin = 0;
    axisMax = dataMax * 1.15 || 10;
  } else if (dataMax <= 0) {
    axisMin = dataMin * 1.15 || -10;
    axisMax = 0;
  } else {
    const absMax = Math.max(Math.abs(dataMin), Math.abs(dataMax));
    axisMin = -(absMax * 1.15);
    axisMax = absMax * 1.15;
  }
  const totalRange = axisMax - axisMin;
  const step = Math.round(totalRange / 3) || 1;
  const ticks = [];
  let t = Math.round(axisMin);
  while (t <= axisMax + 0.5) { ticks.push(t); t += step; }
  if (!ticks.includes(0)) { ticks.push(0); ticks.sort((a, b) => a - b); }
  const unique = [...new Set(ticks)].sort((a, b) => a - b);
  return { domain: [axisMin, axisMax], ticks: unique.length >= 2 ? unique : [0, 5, 10] };
};

const getReturnColor = (value) => {
  if (value == null) return "bg-slate-50 text-slate-600";
  if (value > 0) return "bg-emerald-50 text-emerald-600";
  if (value < 0) return "bg-rose-50 text-rose-600";
  return "bg-slate-50 text-slate-600";
};


const NewPortfolioPage = ({ onOpenNotifications, onOpenInvest, onOpenStrategies, onBack, deepLink, onDeepLinkConsumed, onOpenStockDetail }) => {
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [activeTab, setActiveTab] = useState("holdings");
  const [timeFilter, setTimeFilter] = useState("W");
  const [failedLogos, setFailedLogos] = useState({});
  const [currentView, setCurrentView] = useState("portfolio");
  const [showStrategyDropdown, setShowStrategyDropdown] = useState(false);
  const [activePieIndex, setActivePieIndex] = useState(-1);
  const [selectedStock, setSelectedStock] = useState(null);
  const [showStockDropdown, setShowStockDropdown] = useState(false);
  const [stockTimeFilter, setStockTimeFilter] = useState("W");
  const [myStocksPage, setMyStocksPage] = useState(0);
  const [otherStocksPage, setOtherStocksPage] = useState(0);
  const [holdingsPage, setHoldingsPage] = useState(0);
  const [expandedStrategyId, setExpandedStrategyId] = useState(null);
  const [modalHolding, setModalHolding] = useState(null);
  const [modalTimeFilter, setModalTimeFilter] = useState("W");
  const expandedRowRef = useRef(null);
  const [tabRipple, setTabRipple] = useState(null);
  const [tabDirection, setTabDirection] = useState(0);
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [calendarData, setCalendarData] = useState({});
  const [showYearDropdown, setShowYearDropdown] = useState(false);
  const [calendarFilter, setCalendarFilter] = useState("overall");
  const [showCalendarFilterDropdown, setShowCalendarFilterDropdown] = useState(false);
  const tabOrder = ["strategy", "holdings"];

  useEffect(() => {
    if (currentView === "allocations") {
      window.history.pushState({ view: 'allocations' }, '');

      const handlePopState = (e) => {
        setCurrentView("portfolio");
      };

      window.addEventListener('popstate', handlePopState);
      return () => {
        window.removeEventListener('popstate', handlePopState);
      };
    }
  }, [currentView]);

  useEffect(() => {
    if (!deepLink) return;
    if (deepLink.tab) {
      const oldIdx = tabOrder.indexOf(activeTab);
      const newIdx = tabOrder.indexOf(deepLink.tab);
      setTabDirection(newIdx > oldIdx ? 1 : -1);
      setActiveTab(deepLink.tab);
    }
    if (deepLink.strategyId) {
      setExpandedStrategyId(deepLink.strategyId);
    }
    if (onDeepLinkConsumed) onDeepLinkConsumed();
  }, [deepLink]);

  useEffect(() => {
    if (!expandedStrategyId) return;
    let attempts = 0;
    const tryScroll = () => {
      if (expandedRowRef.current) {
        expandedRowRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (attempts < 10) {
        attempts++;
        setTimeout(tryScroll, 150);
      }
    };
    const timer = setTimeout(tryScroll, 400);
    return () => clearTimeout(timer);
  }, [expandedStrategyId]);

  const { lastUpdated: pricesLastUpdated } = useRealtimePrices();
  const { securities: allSecurities, quotes: liveQuotes, loading: quotesLoading, refetch: refetchStocks } = useStockQuotes(true);
  const stocksList = useMemo(() => {
    if (!allSecurities || allSecurities.length === 0) return [];
    return allSecurities
      .filter(s => s.currentPrice != null)
      .map(s => ({
        id: s.id,
        name: s.name,
        ticker: s.symbol,
        shares: 0,
        price: s.currentPrice || 0,
        dailyChange: s.changePct || 0,
        logo: s.logo_url || null,
      }));
  }, [allSecurities]);
  const selectedSecurityId = useMemo(() => {
    if (!selectedStock?.ticker) return null;
    const match = liveQuotes[selectedStock.ticker];
    return match?.id || null;
  }, [selectedStock?.ticker, liveQuotes]);
  const dropdownRef = useRef(null);
  const stockDropdownRef = useRef(null);
  const { profile } = useProfile();
  const { strategies, selectedStrategy: userSelectedStrategy, loading: strategiesLoading, selectStrategy, refetch: refetchStrategies } = useUserStrategies();
  const { chartData: realChartData, loading: chartLoading } = useStrategyChartData(userSelectedStrategy?.strategyId, timeFilter, userSelectedStrategy?.firstInvestedDate || null);

  const fullName = [profile?.firstName || profile?.first_name, profile?.lastName || profile?.last_name]
    .filter(Boolean).join(" ") || "User";
  const initials = fullName.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "U";

  const isStrategyReady = !strategiesLoading && userSelectedStrategy;
  const currentStrategy = userSelectedStrategy || {
    name: strategiesLoading ? "Loading..." : "No Strategy",
    currentValue: 0,
    previousMonthChange: 0,
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowStrategyDropdown(false);
      }
    };
    if (showStrategyDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showStrategyDropdown]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (stockDropdownRef.current && !stockDropdownRef.current.contains(event.target)) {
        setShowStockDropdown(false);
      }
    };
    if (showStockDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showStockDropdown]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (yearDropdownRef.current && !yearDropdownRef.current.contains(event.target)) {
        setShowYearDropdown(false);
      }
    };
    if (showYearDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showYearDropdown]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (calendarFilterRef.current && !calendarFilterRef.current.contains(event.target)) {
        setShowCalendarFilterDropdown(false);
      }
    };
    if (showCalendarFilterDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showCalendarFilterDropdown]);

  const handleStrategySelect = (strategy) => {
    selectStrategy(strategy);
    setShowStrategyDropdown(false);
  };

  const availableCalendarYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const dataYears = Object.keys(calendarData).map(Number);
    const earliestDataYear = dataYears.length > 0 ? Math.min(...dataYears) : currentYear;
    const entryYear = currentStrategy?.entryDate
      ? new Date(currentStrategy.entryDate).getFullYear()
      : earliestDataYear;
    const startYear = Math.min(entryYear, earliestDataYear);
    const years = [];
    for (let y = currentYear; y >= startYear; y--) {
      years.push(String(y));
    }
    return years;
  }, [calendarData, currentStrategy]);
  const yearDropdownRef = useRef(null);
  const calendarFilterRef = useRef(null);

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
  };

  const { holdings: rawHoldings, closedHoldings, loading: holdingsLoading, goals: investmentGoals, refetch: refetchInvestments } = useInvestments();

  const selectedStockPurchaseDate = useMemo(() => {
    if (!selectedSecurityId || !rawHoldings) return null;
    const holding = rawHoldings.find(h => String(h.security_id) === String(selectedSecurityId));
    return holding?.created_at || holding?.as_of_date || null;
  }, [selectedSecurityId, rawHoldings]);
  const { chartData: liveStockChartData, loading: stockChartLoading } = useStockChart(selectedSecurityId, stockTimeFilter, selectedStockPurchaseDate);
  const modalSecurityId = useMemo(() => {
    if (!modalHolding) return null;
    return liveQuotes[modalHolding.ticker]?.id || modalHolding.securityId || null;
  }, [modalHolding, liveQuotes]);
  const modalPurchaseDate = useMemo(() => {
    if (!modalHolding || !rawHoldings) return null;
    const h = (rawHoldings || []).find(h =>
      String(h.security_id) === String(modalSecurityId) ||
      String(h.security_id) === String(modalHolding.securityId)
    );
    return h?.created_at || h?.as_of_date || null;
  }, [modalHolding, modalSecurityId, rawHoldings]);
  const { chartData: modalRawChartData, loading: modalChartLoading } = useStockChart(modalSecurityId, modalTimeFilter, null);

  useEffect(() => {
    if (pricesLastUpdated) {
      clearMarketDataCache();
      refetchStocks();
      refetchInvestments();
      refetchStrategies();
    }
  }, [pricesLastUpdated, refetchInvestments, refetchStrategies]);

  const calendarFilterOptions = useMemo(() => {
    const options = [{ id: "overall", label: "Overall Portfolio" }];
    strategies.forEach(s => {
      options.push({ id: s.strategyId, label: s.shortName || s.name, type: "strategy" });
    });
    if (rawHoldings && rawHoldings.length > 0) {
      rawHoldings.filter(h => h.security_id && !h.strategy_id).forEach(h => {
        options.push({ id: h.security_id, label: h.symbol || h.name, type: "stock" });
      });
    }
    return options;
  }, [strategies, rawHoldings]);

  useEffect(() => {
    const validIds = calendarFilterOptions.map(o => o.id);
    if (!validIds.includes(calendarFilter)) {
      setCalendarFilter("overall");
    }
  }, [calendarFilterOptions]);

  const individualHoldingSecurityIds = useMemo(() => {
    return (rawHoldings || []).filter(h => h.security_id && !h.strategy_id).map(h => h.security_id);
  }, [rawHoldings]);

  useEffect(() => {
    let cancelled = false;
    const fetchCalendarData = async () => {
      let data = {};
      if (calendarFilter === "overall") {
        data = await getOverallPortfolioMonthlyReturns(
          strategies.map(s => s.strategyId).filter(Boolean),
          individualHoldingSecurityIds,
          strategies,
          (rawHoldings || []).filter(h => !h.strategy_id)
        );
      } else {
        const matchedStrategy = strategies.find(s => s.strategyId === calendarFilter);
        if (matchedStrategy) {
          const invested = matchedStrategy.investedAmount || 0;
          const current = matchedStrategy.currentValue || 0;
          const actualPnlPct = invested > 0 ? (current - invested) / invested : null;
          data = await getMonthlyReturns(calendarFilter, matchedStrategy.firstInvestedDate || null, actualPnlPct);
        } else {
          const matchedHolding = (rawHoldings || []).find(h => h.security_id === calendarFilter && !h.strategy_id);
          const investedVal = matchedHolding ? (matchedHolding.avg_fill * matchedHolding.quantity) / 100 : 0;
          const currentVal = matchedHolding ? (matchedHolding.market_value || 0) / 100 : 0;
          const actualPnlPct = investedVal > 0 ? (currentVal - investedVal) / investedVal : null;
          const livePriceCents = matchedHolding?.last_price ? Number(matchedHolding.last_price) : null;
          const livePriceRands = livePriceCents ? livePriceCents / 100 : null;
          data = await getStockMonthlyReturns(calendarFilter, matchedHolding?.created_at || null, actualPnlPct, livePriceRands);
        }
      }
      if (!cancelled) {
        setCalendarData(data);
        const years = Object.keys(data).sort().reverse();
        if (years.length > 0 && !years.includes(String(calendarYear))) {
          setCalendarYear(Number(years[0]));
        }
      }
    };
    fetchCalendarData();
    return () => { cancelled = true; };
  }, [calendarFilter, strategies, rawHoldings, individualHoldingSecurityIds]);

  const liveHoldingValue = (h) => {
    if (h.last_price != null && h.quantity != null) return (h.last_price * h.quantity) / 100;
    return (h.market_value || 0) / 100;
  };

  const displayAccountValue = useMemo(() => {
    const holdingsValue = (rawHoldings || []).filter(h => !h.strategy_id).reduce((sum, h) => sum + liveHoldingValue(h), 0);
    const strategiesValue = strategies.reduce((sum, s) => sum + (s.currentValue || s.investedAmount || 0), 0);
    return holdingsValue + strategiesValue;
  }, [rawHoldings, strategies]);

  const displayTotalCostBasis = useMemo(() => {
    const holdingsBasis = (rawHoldings || []).filter(h => !h.strategy_id).reduce((sum, h) => sum + ((h.avg_fill || 0) * (h.quantity || 0)) / 100, 0);
    const strategiesBasis = strategies.reduce((sum, s) => sum + (s.investedAmount || 0), 0);
    return holdingsBasis + strategiesBasis;
  }, [rawHoldings, strategies]);

  const displayInvestedAmount = useMemo(() => {
    const holdingsInvested = (rawHoldings || []).filter(h => !h.strategy_id).reduce((sum, h) => {
      if (h.invested_amount !== undefined) return sum + Number(h.invested_amount) / 100;
      return sum + ((h.avg_fill || 0) * (h.quantity || 0)) / 100;
    }, 0);
    const strategiesInvested = strategies.reduce((sum, s) => sum + (s.investedAmount || 0), 0);
    return holdingsInvested + strategiesInvested;
  }, [rawHoldings, strategies]);


  const allStrategyHoldings = useMemo(() => {
    const holdingsMap = new Map();
    const standaloneHoldings = (rawHoldings || []).filter(h => !h.strategy_id);
    if (standaloneHoldings.length > 0) {
      const totalValue = standaloneHoldings.reduce((sum, h) => sum + liveHoldingValue(h), 0);
      standaloneHoldings.forEach(h => {
        const sym = h.symbol || "N/A";
        const currentValue = liveHoldingValue(h);
        const costBasis = ((h.avg_fill || 0) * (h.quantity || 0)) / 100;
        const changePct = costBasis > 0 ? ((currentValue - costBasis) / costBasis) * 100 : 0;
        const weight = totalValue > 0 ? (currentValue / totalValue) * 100 : 0;
        const isPending = !h.avg_fill || Number(h.avg_fill) === 0;
        holdingsMap.set(sym, {
          symbol: sym,
          name: h.name || "Unknown",
          weight,
          logo: h.logo_url || null,
          securityId: h.security_id || null,
          currentValue,
          costBasis,
          change: changePct,
          isPending,
          settlement_status: h.settlement_status || null,
        });
      });
    }
    strategies.forEach(s => {
      const sym = s.shortName || s.name || "Strategy";
      if (!holdingsMap.has(sym)) {
        const holdingsArr = s.holdings || [];
        const topLogos = holdingsArr
          .sort((a, b) => (b.weight || 0) - (a.weight || 0))
          .slice(0, 3)
          .map(h => h.logo_url || null)
          .filter(Boolean);
        const sCv = s.currentValue || s.investedAmount || 0;
        const sIa = s.investedAmount || 0;
        const sPnlPct = sIa > 0 ? ((sCv - sIa) / sIa) * 100 : 0;
        const stratRawHoldings = (rawHoldings || []).filter(h => h.strategy_id === (s.strategyId || s.id));
        const isStrategyPending = stratRawHoldings.length > 0 && stratRawHoldings.every(h => !h.avg_fill);
        holdingsMap.set(sym, {
          symbol: sym,
          name: s.name || "Strategy",
          strategyId: s.strategyId || s.id,
          weight: 0,
          logo: null,
          isStrategy: true,
          isPending: isStrategyPending,
          topLogos,
          strategyHoldings: holdingsArr,
          currentValue: sCv,
          investedAmount: sIa,
          change: sPnlPct,
          ytd_return: s.metrics?.r_ytd,
        });
      }
    });
    const totalValue = Array.from(holdingsMap.values()).reduce((sum, h) => sum + h.currentValue, 0);
    if (totalValue > 0) {
      holdingsMap.forEach(h => { h.weight = (h.currentValue / totalValue) * 100; });
    }
    return Array.from(holdingsMap.values()).sort((a, b) => b.weight - a.weight);
  }, [rawHoldings, strategies, stocksList, liveQuotes]);

  const holdings = allStrategyHoldings;

  const getChartData = () => {
    if (realChartData && realChartData.length > 0) {
      const currentValue = currentStrategy.currentValue || 0;
      const costBasis = currentStrategy.investedAmount || 0;
      if (currentValue > 0 && realChartData.length > 0) {
        const latestNav = realChartData[realChartData.length - 1].value;
        if (!latestNav || latestNav <= 0) return [];
        const scaleFactor = currentValue / latestNav;
        const points = [];
        points.push({ ...realChartData[0], day: null, value: 0 });
        realChartData.forEach(d => {
          const marketValueAtDate = d.value * scaleFactor;
          const pnl = marketValueAtDate - costBasis;
          points.push({ ...d, value: Number(pnl.toFixed(2)) });
        });
        return points;
      }
    }
    return [];
  };

  const currentChartData = getChartData();
  const isLoadingData = strategiesLoading || chartLoading;

  const strategyAxisConfig = computePnlAxisConfig(currentChartData);

  const formatCurrency = (value) => {
    return `R${value.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const myStocks = useMemo(() => {
    if (!stocksList || stocksList.length === 0) return [];
    const holdingSymbols = new Set();
    (rawHoldings || []).filter(h => !h.strategy_id).forEach(h => { if (h.symbol) holdingSymbols.add(h.symbol); });
    allStrategyHoldings.forEach(h => { if (h.symbol && !h.isStrategy) holdingSymbols.add(h.symbol); });
    if (holdingSymbols.size === 0) return [];
    return stocksList.filter(stock => holdingSymbols.has(stock.ticker));
  }, [rawHoldings, allStrategyHoldings, stocksList]);

  const myStockIds = useMemo(() => new Set(myStocks.map(s => s.id)), [myStocks]);

  const prevMyStocksRef = useRef(0);
  useEffect(() => {
    if (myStocks.length > 0) {
      const currentIsMyStock = selectedStock && myStocks.some(s => s.id === selectedStock.id);
      if (!selectedStock || !currentIsMyStock || prevMyStocksRef.current === 0) {
        setSelectedStock(myStocks[0]);
      }
      prevMyStocksRef.current = myStocks.length;
    } else if (!selectedStock && stocksList.length > 0) {
      setSelectedStock(stocksList[0]);
    }
  }, [myStocks, stocksList]);

  if (strategiesLoading || holdingsLoading) {
    return <PortfolioSkeleton />;
  }

  // All Allocations View
  if (currentView === "allocations") {
    return (
      <SwipeBackWrapper onBack={() => setCurrentView("portfolio")} enabled={true}>
        <div className="min-h-screen pb-[env(safe-area-inset-bottom)] text-white relative overflow-x-hidden">
          {/* Gradient background - same as portfolio page */}
          <div className="absolute inset-x-0 top-0 -z-10 h-full">
            <div
              className="absolute inset-x-0 top-0"
              style={{
                height: '100vh',
                background: 'linear-gradient(180deg, #0d0d12 0%, #0e0a14 0.5%, #100b18 1%, #120c1c 1.5%, #150e22 2%, #181028 2.5%, #1c122f 3%, #201436 3.5%, #25173e 4%, #2a1a46 5%, #301d4f 6%, #362158 7%, #3d2561 8%, #44296b 9%, #4c2e75 10%, #54337f 11%, #5d3889 12%, #663e93 13%, #70449d 14%, #7a4aa7 15%, #8451b0 16%, #8e58b9 17%, #9860c1 18%, #a268c8 19%, #ac71ce 20%, #b57ad3 21%, #be84d8 22%, #c68edc 23%, #cd98e0 24%, #d4a2e3 25%, #daace6 26%, #dfb6e9 27%, #e4c0eb 28%, #e8c9ed 29%, #ecd2ef 30%, #efdaf1 31%, #f2e1f3 32%, #f4e7f5 33%, #f6ecf7 34%, #f8f0f9 35%, #f9f3fa 36%, #faf5fb 38%, #fbf7fc 40%, #fcf9fd 42%, #fdfafd 45%, #faf8fc 55%, #f8f6fa 100%)'
              }}
            />
            <div
              className="absolute inset-x-0 top-[100vh] bottom-0"
              style={{ background: '#f8f6fa' }}
            />
          </div>

          {/* Header */}
          <div className="mx-auto flex w-full max-w-sm flex-col px-4 pt-12 md:max-w-md md:px-6">
            <header className="flex items-center gap-3 mb-6">
              <button
                onClick={() => setCurrentView("portfolio")}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-sm border border-white/20 shadow-lg transition hover:bg-white/20"
              >
                <ArrowLeft className="h-5 w-5 text-white" />
              </button>
              <h1 className="text-xl font-bold text-white">{currentStrategy.name || "Strategy"} Allocations</h1>
            </header>
          </div>

          {/* Allocation History Cards - sorted most recent first */}
          <div className="mx-auto flex w-full max-w-sm flex-col gap-4 px-4 pb-10 md:max-w-md md:px-6">
            {strategies.length === 0 ? (
              <div className="rounded-3xl p-8 backdrop-blur-xl shadow-sm border border-slate-100/50 text-center" style={{ background: 'rgba(255,255,255,0.7)' }}>
                <p className="text-sm font-semibold text-slate-900 mb-1">No allocations yet</p>
                <p className="text-xs text-slate-500">Your strategy allocations will appear here once you start investing.</p>
              </div>
            ) : (
              [...strategies].sort((a, b) => new Date(b.entryDate || 0) - new Date(a.entryDate || 0)).map((allocation) => {
                const topPerformers = Array.isArray(allocation.holdings) ? allocation.holdings.slice(0, 3) : [];
                return (
                  <div
                    key={allocation.id}
                    className="rounded-3xl p-5 backdrop-blur-xl shadow-sm border border-slate-100/50"
                    style={{
                      background: 'rgba(255,255,255,0.7)',
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-xs text-slate-500 mb-1">Amount</p>
                        <p className="text-xl font-bold text-slate-900">
                          {formatCurrency(allocation.investedAmount || 0)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-500 mb-1">Return</p>
                        <p className={`text-xl font-bold ${(allocation.previousMonthChange || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {(allocation.previousMonthChange || 0) >= 0 ? '+' : ''}{(allocation.previousMonthChange || 0).toFixed(1)}%
                        </p>
                      </div>
                    </div>


                    <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                      <div>
                        <p className="text-xs text-slate-500 mb-1">{allocation.entryDate ? 'Date' : 'Strategy'}</p>
                        <p className="text-sm font-medium text-slate-700">
                          {allocation.entryDate ? formatDate(allocation.entryDate) : allocation.name}
                        </p>
                      </div>

                      {topPerformers.length > 0 && (
                        <div className="flex items-center -space-x-2">
                          {topPerformers.map((asset, index) => {
                            const matchedStock = stocksList.find(st => st.ticker === asset.symbol);
                            const logo = asset.logo_url || asset.logo || matchedStock?.logo || null;
                            return (
                              <div
                                key={asset.symbol}
                                className="h-9 w-9 rounded-full bg-white border-2 border-white shadow-md overflow-hidden"
                                style={{ zIndex: 3 - index }}
                              >
                                {failedLogos[asset.symbol] || !logo ? (
                                  <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-violet-100 to-purple-100 text-[10px] font-bold text-violet-700">
                                    {asset.symbol.slice(0, 2)}
                                  </div>
                                ) : (
                                  <img
                                    src={logo}
                                    alt={asset.symbol}
                                    className="h-full w-full object-cover"
                                    onError={() => setFailedLogos(prev => ({ ...prev, [asset.symbol]: true }))}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </SwipeBackWrapper>
    );
  }

  return (
    <div className="min-h-screen pb-[env(safe-area-inset-bottom)] text-white relative overflow-x-hidden">
      {/* Gradient background - scrolls with content */}
      <div className="absolute inset-x-0 top-0 -z-10 h-full">
        {/* Base gradient: seamless purple to lavender to white transition using vh units for consistent position */}
        <div
          className="absolute inset-x-0 top-0"
          style={{
            height: '100vh',
            background: 'linear-gradient(180deg, #0d0d12 0%, #0e0a14 0.5%, #100b18 1%, #120c1c 1.5%, #150e22 2%, #181028 2.5%, #1c122f 3%, #201436 3.5%, #25173e 4%, #2a1a46 5%, #301d4f 6%, #362158 7%, #3d2561 8%, #44296b 9%, #4c2e75 10%, #54337f 11%, #5d3889 12%, #663e93 13%, #70449d 14%, #7a4aa7 15%, #8451b0 16%, #8e58b9 17%, #9860c1 18%, #a268c8 19%, #ac71ce 20%, #b57ad3 21%, #be84d8 22%, #c68edc 23%, #cd98e0 24%, #d4a2e3 25%, #daace6 26%, #dfb6e9 27%, #e4c0eb 28%, #e8c9ed 29%, #ecd2ef 30%, #efdaf1 31%, #f2e1f3 32%, #f4e7f5 33%, #f6ecf7 34%, #f8f0f9 35%, #f9f3fa 36%, #faf5fb 38%, #fbf7fc 40%, #fcf9fd 42%, #fdfafd 45%, #faf8fc 55%, #f8f6fa 100%)'
          }}
        />
        {/* Continuation for rest of page - matches end of gradient */}
        <div
          className="absolute inset-x-0 top-[100vh] bottom-0"
          style={{ background: '#f8f6fa' }}
        />

        {/* Subtle ambient glow behind account balance */}
        <div
          className="absolute top-[6%] left-1/2 -translate-x-1/2 w-[300px] h-[160px] rounded-full"
          style={{ background: 'radial-gradient(ellipse at center, rgba(91,33,182,0.15) 0%, rgba(76,29,149,0.08) 40%, transparent 70%)', filter: 'blur(50px)' }}
        />
      </div>

      {/* Header section */}
      <div className="relative px-5 pb-6 pt-10 md:px-8">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-4 md:max-w-md">
          {/* Top row: Avatar stacked with greeting, notification on right */}
          <header className="flex items-start justify-between">
            <div className="flex flex-col gap-1">
              <FamilyDropdown
                profile={profile}
                userId={profile?.id}
                initials={initials}
                avatarUrl={profile?.avatarUrl}
                onOpenFamily={() =>
                  window.dispatchEvent(new CustomEvent("navigate-within-app", { detail: { page: "family" } }))
                }
                onSelectMember={(member) =>
                  window.dispatchEvent(new CustomEvent("navigate-within-app", { detail: { page: "memberPortfolio", member } }))
                }
              />
              <p className="text-lg font-medium text-white/90 mt-1">{fullName}</p>
            </div>
            <button
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 backdrop-blur-sm transition hover:bg-white/10"
              onClick={onOpenNotifications}
            >
              <Bell className="h-5 w-5 text-white/90" />
            </button>
          </header>

          {/* Account balance */}
          <section className="relative">
            <div className="absolute -inset-8 bg-gradient-radial from-[#7c3aed]/20 via-transparent to-transparent rounded-full blur-2xl -z-10" />
            {(() => {
              const totalPnl = displayAccountValue - displayTotalCostBasis;
              const totalPnlPct = displayTotalCostBasis > 0 ? (totalPnl / displayTotalCostBasis) * 100 : 0;
              const isPnlPos = totalPnl >= 0;
              const balanceDisplay = displayAccountValue;

              return (
                <>
                  <div className="flex items-center gap-3">
                    <p className="text-4xl font-bold tracking-tight" style={{ minWidth: '180px' }}>
                      R{balanceVisible ? balanceDisplay.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "••••••••"}
                    </p>
                    <button
                      onClick={() => setBalanceVisible(!balanceVisible)}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm transition hover:bg-white/25"
                    >
                      {balanceVisible ? (
                        <Eye className="h-5 w-5 text-white/70" />
                      ) : (
                        <EyeOff className="h-5 w-5 text-white/70" />
                      )}
                    </button>
                  </div>
                  {!balanceVisible ? (
                    <p className="mt-1 text-sm text-white/60">Account Value</p>
                  ) : (
                    <>
                      <div className="mt-1 flex items-center gap-2.5">
                        <span className="text-lg font-bold" style={{ color: isPnlPos ? '#6ee7b7' : '#fca5a5' }}>
                          {isPnlPos ? '+' : '-'}R{Math.abs(totalPnl).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold"
                          style={{ backdropFilter: 'blur(4px)', background: 'rgba(255,255,255,0.12)', border: `1px solid ${isPnlPos ? 'rgba(52,211,153,0.6)' : 'rgba(251,113,133,0.6)'}`, color: isPnlPos ? '#6ee7b7' : '#fca5a5' }}>
                          {isPnlPos ? '▲' : '▼'} {isPnlPos ? '+' : ''}{totalPnlPct.toFixed(1)}%
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-white/50">Account Value</p>
                    </>
                  )}
                </>
              );
            })()}
          </section>

          {/* Tabs: Strategy, Holdings */}
          <section className="flex gap-2 mt-1 justify-center">
            {[
              { id: "strategy", label: "Strategies" },
              { id: "holdings", label: "Holdings" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={(e) => {
                  if (tab.id === activeTab) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const y = e.clientY - rect.top;
                  setTabRipple({ id: tab.id, x, y, key: Date.now() });
                  const oldIdx = tabOrder.indexOf(activeTab);
                  const newIdx = tabOrder.indexOf(tab.id);
                  setTabDirection(newIdx > oldIdx ? 1 : -1);
                  setActiveTab(tab.id);
                }}
                className={`relative overflow-hidden px-4 py-2.5 rounded-full text-sm font-semibold transition-all duration-300 ${activeTab === tab.id
                    ? "bg-violet-500 text-white shadow-lg shadow-violet-500/30"
                    : "border border-white/60 text-white backdrop-blur-xl hover:bg-white/20"
                  }`}
                style={activeTab !== tab.id ? { background: 'rgba(255,255,255,0.15)', textShadow: '0 0 8px rgba(0,0,0,0.5), 0 1px 4px rgba(0,0,0,0.3)' } : {}}
              >
                {tabRipple && tabRipple.id === tab.id && (
                  <motion.span
                    key={tabRipple.key}
                    className="absolute rounded-full pointer-events-none"
                    style={{
                      left: tabRipple.x,
                      top: tabRipple.y,
                      background: 'radial-gradient(circle, rgba(255,255,255,0.5) 0%, rgba(139,92,246,0.3) 50%, transparent 70%)',
                      transform: 'translate(-50%, -50%)',
                    }}
                    initial={{ width: 0, height: 0, opacity: 0.8 }}
                    animate={{ width: 300, height: 300, opacity: 0 }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                    onAnimationComplete={() => setTabRipple(null)}
                  />
                )}
                <span className="relative z-10">{tab.label}</span>
              </button>
            ))}
          </section>
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {/* Strategy Tab Content */}
        {activeTab === "strategy" && (
          <motion.div
            key="strategy"
            initial={{ opacity: 0, x: tabDirection * 40, filter: 'blur(6px)' }}
            animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, x: tabDirection * -40, filter: 'blur(6px)' }}
            transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <>
              {/* Chart section */}
              <div className="relative mx-auto flex w-full max-w-sm flex-col gap-4 px-4 md:max-w-md md:px-8">
                <section className="py-2">
                  {strategies.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 px-6">
                      <div className="w-16 h-16 rounded-full bg-purple-50 flex items-center justify-center mb-4">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2L2 7l10 5 10-5-10-5z" />
                          <path d="M2 17l10 5 10-5" />
                          <path d="M2 12l10 5 10-5" />
                        </svg>
                      </div>
                      <p className="text-lg font-semibold text-slate-900 mb-1">Invest in Your First Strategy</p>
                      <p className="text-sm text-slate-500 text-center max-w-[260px]">Choose a strategy and start building your portfolio. Your performance will show up here.</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-3 -ml-4">
                        <div className="relative" ref={dropdownRef}>
                          <button
                            onClick={() => setShowStrategyDropdown(!showStrategyDropdown)}
                            className="flex items-center gap-0.5 text-slate-900 hover:text-slate-700 transition"
                          >
                            <span className="text-lg font-semibold tracking-tight" style={{ fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}>
                              {currentStrategy.name || "Strategy"}
                            </span>
                            <ChevronDown className={`h-5 w-5 transition-transform duration-200 ${showStrategyDropdown ? 'rotate-180' : ''}`} />
                          </button>
                          {showStrategyDropdown && strategies.length > 0 && (
                            <div
                              className="absolute top-full left-0 mt-2 min-w-[200px] max-h-[280px] overflow-y-auto bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-200/50 z-50 overscroll-contain"
                              style={{ fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif", WebkitOverflowScrolling: 'touch' }}
                            >
                              {strategies.map((strategy) => (
                                <button
                                  key={strategy.strategyId}
                                  onClick={() => handleStrategySelect(strategy)}
                                  className={`w-full px-4 py-3.5 text-left hover:bg-purple-50/50 transition-colors duration-150 border-b border-slate-100/50 last:border-b-0 ${userSelectedStrategy?.strategyId === strategy.strategyId ? 'bg-purple-50' : ''
                                    }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <p className="font-medium text-slate-800 text-sm tracking-tight">{strategy.name}</p>
                                  </div>
                                  <p className="text-xs text-slate-400 mt-0.5 font-medium tabular-nums">
                                    R{(strategy.currentValue || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </p>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1">
                          {[
                            { id: "D", label: "D" },
                            { id: "W", label: "W" },
                            { id: "M", label: "M" },
                            { id: "ALL", label: "All" },
                          ].map((filter) => (
                            <button
                              key={filter.id}
                              onClick={() => setTimeFilter(filter.id)}
                              className={`px-3 h-9 rounded-full text-sm font-bold transition-all ${timeFilter === filter.id
                                  ? "bg-slate-700/80 text-white shadow-lg backdrop-blur-md border border-white/20"
                                  : "text-slate-400 hover:text-slate-600 hover:bg-slate-200/30"
                                }`}
                              style={timeFilter === filter.id ? {
                                boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.1), 0 4px 12px rgba(0,0,0,0.15)'
                              } : {}}
                            >
                              {filter.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="mb-3 px-1">
                        {(() => {
                          const cv = currentStrategy.currentValue || 0;
                          const ia = currentStrategy.investedAmount || 0;
                          const isStratPending = cv === 0 && ia === 0;
                          const pnl = cv - ia;
                          const pnlPct = ia > 0 ? (pnl / ia) * 100 : 0;
                          const isPos = pnl >= 0;
                          if (isStratPending) {
                            return (
                              <>
                                <p className="text-3xl font-bold text-slate-900">R0,00</p>
                                <div className="flex items-center gap-2 mt-1">
                                  <SettlementBadge status="pending" size="md" />
                                  <span className="text-xs text-slate-400">Awaiting trade execution</span>
                                </div>
                              </>
                            );
                          }
                          return (
                            <>
                              <p className="text-3xl font-bold text-slate-900">R{cv.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className={`text-sm font-semibold ${isPos ? 'text-emerald-500' : 'text-rose-500'}`}>
                                  {isPos ? '+' : '-'}R{Math.abs(pnl).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${isPos ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'}`}>
                                  {isPos ? '+' : ''}{pnlPct.toFixed(1)}%
                                </span>
                              </div>
                            </>
                          );
                        })()}
                      </div>

                      <div style={{ width: '100%', height: 220, marginBottom: 8 }}>
                        {currentChartData.length === 0 ? (
                          <div style={{ width: '100%', height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <div className="text-slate-400 text-sm">{isLoadingData ? 'Loading chart...' : 'No data available'}</div>
                          </div>
                        ) : (
                          <ResponsiveContainer width="100%" height={220}>
                            <ComposedChart
                              data={currentChartData}
                              margin={{ top: 10, right: 15, left: 5, bottom: 30 }}
                            >
                              <defs>
                                <linearGradient id="glowGradientVertical" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.4" />
                                  <stop offset="50%" stopColor="#a78bfa" stopOpacity="0.2" />
                                  <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0.02" />
                                </linearGradient>
                              </defs>

                              <XAxis
                                dataKey="day"
                                axisLine={false}
                                tickLine={false}
                                tickMargin={8}
                                interval={currentChartData.length <= 8 ? 0 : Math.max(0, Math.ceil(currentChartData.length / 6) - 1)}
                                tick={({ x, y, payload }) => {
                                  if (!payload.value) return null;
                                  return <text x={x} y={y} dy={12} textAnchor="middle" fill="#64748b" fontSize={11} fontWeight={500}>{payload.value}</text>;
                                }}
                              />

                              <YAxis
                                domain={strategyAxisConfig.domain}
                                ticks={strategyAxisConfig.ticks}
                                tickFormatter={formatPnlAxis}
                                tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 500 }}
                                axisLine={false}
                                tickLine={false}
                                width={55}
                              />

                              <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="3 3" strokeWidth={1} />

                              <Tooltip
                                content={({ active, payload, label }) => {
                                  if (active && payload && payload.length) {
                                    const fullDate = payload[0]?.payload?.fullDate || label;
                                    const val = payload[0].value;
                                    const isPos = val >= 0;
                                    return (
                                      <div className="bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg px-3 py-1.5 shadow-md">
                                        <div className="text-xs text-slate-500 mb-0.5">{fullDate}</div>
                                        <div className="text-sm font-bold text-violet-700">
                                          {isPos ? '+' : '-'}R{Math.abs(val).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </div>
                                      </div>
                                    );
                                  }
                                  return null;
                                }}
                                cursor={false}
                                wrapperStyle={{ outline: 'none' }}
                              />

                              <Area
                                type="monotone"
                                dataKey="value"
                                stroke="none"
                                fill="url(#glowGradientVertical)"
                                fillOpacity={1}
                              />

                              <Line
                                type="monotone"
                                dataKey="value"
                                stroke="#7c3aed"
                                strokeWidth={2.5}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                dot={false}
                                activeDot={{
                                  r: 6,
                                  fill: '#7c3aed',
                                  stroke: '#c4b5fd',
                                  strokeWidth: 2,
                                }}
                              />
                            </ComposedChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    </>
                  )}
                </section>
              </div>

              {/* Scrollable content section - starts after chart */}
              <div className="relative mx-auto flex w-full max-w-sm flex-col gap-4 px-4 pb-10 md:max-w-md md:px-8">
                {strategies.length === 0 ? (
                  <button
                    onClick={() => onOpenStrategies && onOpenStrategies()}
                    className="w-full py-3.5 rounded-full bg-gradient-to-r from-slate-800 to-slate-900 text-sm font-semibold uppercase tracking-[0.1em] text-white shadow-lg shadow-slate-900/30 transition hover:-translate-y-0.5 hover:shadow-xl"
                  >
                    Make Your First Investment
                  </button>
                ) : (
                  <button
                    onClick={() => { setCurrentView("allocations"); window.scrollTo(0, 0); }}
                    className="w-full py-3.5 rounded-full bg-gradient-to-r from-slate-800 to-slate-900 text-sm font-semibold uppercase tracking-[0.1em] text-white shadow-lg shadow-slate-900/30 transition hover:-translate-y-0.5 hover:shadow-xl"
                  >
                    View All Allocations
                  </button>
                )}

                <section className="rounded-3xl bg-white/70 backdrop-blur-xl p-5 shadow-sm border border-slate-100/50">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-semibold text-slate-900">Portfolio Holdings</p>
                  </div>
                  <p className="text-xs text-slate-400 mb-4">All holdings by weight</p>

                  <div className="space-y-3">
                    {holdings.map((holding) => (
                      <div
                        key={holding.symbol}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 overflow-hidden">
                            {holding.isStrategy && holding.topLogos?.length > 0 ? (
                              <div className="flex -space-x-1.5 items-center justify-center">
                                {holding.topLogos.slice(0, 3).map((logo, li) => (
                                  <img key={li} src={logo} className="w-5 h-5 rounded-full object-cover border border-white shadow-sm" referrerPolicy="no-referrer" crossOrigin="anonymous" />
                                ))}
                              </div>
                            ) : failedLogos[holding.symbol] || !holding.logo ? (
                              <span className="text-xs font-bold text-slate-600">
                                {holding.symbol.slice(0, 3)}
                              </span>
                            ) : (
                              <img
                                src={holding.logo}
                                alt={holding.name}
                                className="h-8 w-8 object-contain"
                                referrerPolicy="no-referrer"
                                crossOrigin="anonymous"
                                onError={() => setFailedLogos(prev => ({ ...prev, [holding.symbol]: true }))}
                              />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-semibold text-slate-900">{holding.symbol}</p>
                            </div>
                            <p className="text-xs text-slate-500">{holding.name}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-semibold ${holding.change >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {holding.change >= 0 ? '+' : ''}{holding.change.toFixed(1)}%
                          </p>
                          <p className="text-[10px] text-slate-400">{holding.weight.toFixed(1)}% of portfolio</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Calendar Returns */}
                <section className="rounded-3xl bg-white/70 backdrop-blur-xl p-5 shadow-sm border border-slate-100/50">
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <p className="text-sm font-semibold text-slate-900">Calendar Returns</p>
                    <div className="flex items-center gap-2">
                      <div className="relative" ref={calendarFilterRef}>
                        <button
                          onClick={() => setShowCalendarFilterDropdown(!showCalendarFilterDropdown)}
                          className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 max-w-[140px]"
                        >
                          <span className="truncate">{calendarFilterOptions.find(o => o.id === calendarFilter)?.label || "Overall Portfolio"}</span>
                          <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 transition-transform duration-200 ${showCalendarFilterDropdown ? 'rotate-180' : ''}`} />
                        </button>
                        {showCalendarFilterDropdown && (
                          <div className="absolute right-0 top-full mt-1 min-w-[160px] max-h-[200px] overflow-y-auto bg-white rounded-xl shadow-xl border border-slate-200/50 z-50 overflow-hidden">
                            {calendarFilterOptions.map((option) => (
                              <button
                                key={option.id}
                                onClick={() => { setCalendarFilter(option.id); setShowCalendarFilterDropdown(false); }}
                                className={`w-full px-4 py-2.5 text-left text-xs font-semibold transition-colors ${option.id === calendarFilter
                                    ? "bg-violet-50 text-violet-700"
                                    : "text-slate-600 hover:bg-slate-50"
                                  }`}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {availableCalendarYears.length > 0 && (
                        <div className="relative" ref={yearDropdownRef}>
                          <button
                            onClick={() => setShowYearDropdown(!showYearDropdown)}
                            className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
                          >
                            {calendarYear}
                            <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${showYearDropdown ? 'rotate-180' : ''}`} />
                          </button>
                          {showYearDropdown && (
                            <div className="absolute right-0 top-full mt-1 min-w-[80px] bg-white rounded-xl shadow-xl border border-slate-200/50 z-50 overflow-hidden">
                              {availableCalendarYears.map((year) => (
                                <button
                                  key={year}
                                  onClick={() => { setCalendarYear(Number(year)); setShowYearDropdown(false); }}
                                  className={`w-full px-4 py-2.5 text-left text-xs font-semibold transition-colors ${Number(year) === calendarYear
                                      ? "bg-violet-50 text-violet-700"
                                      : "text-slate-600 hover:bg-slate-50"
                                    }`}
                                >
                                  {year}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {monthNames.map((label, index) => {
                      const monthKey = String(index + 1).padStart(2, "0");
                      const value = calendarData[String(calendarYear)]?.[monthKey];
                      const hasData = value != null;
                      return (
                        <div
                          key={`${calendarYear}-${label}`}
                          className={`rounded-xl px-3 py-2.5 text-center ${hasData ? getReturnColor(value) : "bg-slate-50"}`}
                        >
                          <p className={`text-[10px] font-semibold ${hasData ? "text-slate-500" : "text-slate-300"}`}>{label}</p>
                          <p className={`mt-0.5 text-sm font-bold ${hasData ? "" : "text-slate-300"}`}>
                            {hasData ? `${(Number(value) * 100).toFixed(2)}%` : "—"}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {strategies.length > 0 && (
                  <button
                    onClick={() => (onOpenStrategies || onOpenInvest) && (onOpenStrategies || onOpenInvest)()}
                    className="w-full py-3.5 rounded-full bg-gradient-to-r from-slate-800 to-slate-900 text-sm font-semibold uppercase tracking-[0.1em] text-white shadow-lg shadow-slate-900/30 transition hover:-translate-y-0.5 hover:shadow-xl flex items-center justify-center gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Buy More Strategies
                  </button>
                )}
              </div>
            </>
          </motion.div>
        )}

        {/* Individual Stocks Tab Content */}
        {activeTab === "stocks" && (
          <motion.div
            key="stocks"
            initial={{ opacity: 0, x: tabDirection * 40, filter: 'blur(6px)' }}
            animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, x: tabDirection * -40, filter: 'blur(6px)' }}
            transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            {(() => {
              const isMyStock = myStockIds.has(selectedStock?.id);
              const userHolding = isMyStock && selectedSecurityId ? (rawHoldings || []).find(h => h.security_id === selectedSecurityId) : null;
              const userQuantity = userHolding ? (userHolding.quantity || 0) : 0;
              const avgFillRands = userHolding ? (userHolding.avg_fill || 0) / 100 : 0;
              const costBasisStock = avgFillRands * userQuantity;
              const showStockPnl = isMyStock && userQuantity > 0 && avgFillRands > 0;
              const stockChartData = liveStockChartData.length > 0
                ? (showStockPnl
                  ? (() => {
                    const pts = [{ ...liveStockChartData[0], day: null, value: 0 }];
                    liveStockChartData.forEach(d => {
                      pts.push({ ...d, value: Number(((d.value * userQuantity) - costBasisStock).toFixed(2)) });
                    });
                    return pts;
                  })()
                  : liveStockChartData)
                : (showStockPnl
                  ? [{ day: null, value: 0 }, { day: "Today", value: 0 }]
                  : []);
              const stockAxisConfig = computePnlAxisConfig(stockChartData);
              if (!selectedStock) {
                if (quotesLoading || holdingsLoading) {
                  return <div className="text-center py-10 text-slate-500">Loading stocks...</div>;
                }
                if (stocksList.length === 0) {
                  return <div className="text-center py-10 text-slate-500">No stocks available.</div>;
                }
                return null;
              }
              const otherStocks = stocksList.filter(s => s.id !== selectedStock?.id && !myStockIds.has(s.id));
              const hasNoHoldings = myStocks.length === 0;
              return (
                <>
                  {hasNoHoldings ? (
                    <div className="flex flex-col items-center justify-center py-12 px-6">
                      <div className="w-16 h-16 rounded-full bg-purple-50 flex items-center justify-center mb-4">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                          <polyline points="16 7 22 7 22 13" />
                        </svg>
                      </div>
                      <p className="text-lg font-semibold text-slate-900 mb-1">Invest in Your First Stock</p>
                      <p className="text-sm text-slate-500 text-center max-w-[260px] mb-5">Browse individual stocks and start building your portfolio. Your holdings will show up here.</p>
                      <button
                        onClick={() => onOpenInvest && onOpenInvest()}
                        className="w-full max-w-[280px] py-3.5 rounded-full bg-gradient-to-r from-slate-800 to-slate-900 text-sm font-semibold uppercase tracking-[0.1em] text-white shadow-lg shadow-slate-900/30 transition hover:-translate-y-0.5 hover:shadow-xl"
                      >
                        Make Your First Investment
                      </button>
                    </div>
                  ) : (
                    <div className="relative mx-auto flex w-full max-w-sm flex-col gap-4 px-4 md:max-w-md md:px-8">
                      <section className="py-2">
                        {/* Chart and stock selector only shown when user has holdings */}
                        <div className="flex items-center justify-between mb-3 px-1">
                          <div className="relative" ref={stockDropdownRef}>
                            <button
                              onClick={() => setShowStockDropdown(!showStockDropdown)}
                              className="flex items-center gap-2 text-slate-900 hover:text-slate-700 transition"
                            >
                              <span className="text-lg font-semibold tracking-tight" style={{ fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}>
                                {selectedStock.name}
                              </span>
                              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${showStockDropdown ? 'rotate-180' : ''}`} />
                            </button>
                            {showStockDropdown && (myStocks.length > 0 || stocksList.length > 0) && (
                              <div
                                className="absolute top-full left-0 mt-2 min-w-[200px] max-h-[280px] overflow-y-auto bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-200/50 z-50 overscroll-contain"
                                style={{ fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif", WebkitOverflowScrolling: 'touch' }}
                              >
                                {(myStocks.length > 0 ? myStocks : stocksList.slice(0, 20)).map((stock) => (
                                  <button
                                    key={stock.id}
                                    onClick={() => { setSelectedStock(stock); setShowStockDropdown(false); }}
                                    className={`w-full px-4 py-3.5 text-left hover:bg-purple-50/50 transition-colors duration-150 border-b border-slate-100/50 last:border-b-0 ${selectedStock.id === stock.id ? 'bg-purple-50' : ''
                                      }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <p className="font-medium text-slate-800 text-sm tracking-tight">{stock.name}</p>
                                    </div>
                                    <p className="text-xs text-slate-400 mt-0.5 font-medium tabular-nums">
                                      {formatCurrency(liveQuotes[stock.ticker]?.price || stock.price)}
                                    </p>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-1">
                            {[
                              { id: "D", label: "D" },
                              { id: "W", label: "W" },
                              { id: "M", label: "M" },
                              { id: "ALL", label: "All" },
                            ].map((filter) => (
                              <button
                                key={filter.id}
                                onClick={() => setStockTimeFilter(filter.id)}
                                className={`px-3 h-9 rounded-full text-sm font-bold transition-all ${stockTimeFilter === filter.id
                                    ? "bg-slate-700/80 text-white shadow-lg backdrop-blur-md border border-white/20"
                                    : "text-slate-400 hover:text-slate-600 hover:bg-slate-200/30"
                                  }`}
                                style={stockTimeFilter === filter.id ? {
                                  boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.1), 0 4px 12px rgba(0,0,0,0.15)'
                                } : {}}
                              >
                                {filter.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="mb-3 px-1">
                          {(() => {
                            if (isMyStock && userHolding && userQuantity > 0) {
                              const holdingMarketValue = liveHoldingValue(userHolding);
                              const costBasis = ((userHolding.avg_fill || 0) * userQuantity) / 100;
                              const pnl = holdingMarketValue - costBasis;
                              const pnlPct = costBasis > 0 ? ((pnl / costBasis) * 100) : 0;
                              const dailyChangePct = userHolding.change_percent || 0;
                              const dailyChangeAmt = (holdingMarketValue * dailyChangePct) / (100 + dailyChangePct);
                              return (
                                <>
                                  <p className="text-3xl font-bold text-slate-900">{formatCurrency(holdingMarketValue)}</p>
                                  <p className={`text-sm ${pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                    {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)} ({pnl >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
                                  </p>
                                </>
                              );
                            }
                            const perSharePrice = liveQuotes[selectedStock.ticker]?.price || selectedStock.price;
                            const changePct = liveQuotes[selectedStock.ticker]?.changePercent ?? selectedStock.dailyChange;
                            return (
                              <>
                                <p className="text-3xl font-bold text-slate-900">{formatCurrency(perSharePrice)}</p>
                                <p className={`text-sm ${changePct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                  ({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}% Today)
                                </p>
                              </>
                            );
                          })()}
                        </div>

                        <div style={{ width: '100%', height: 220, marginBottom: 8 }}>
                          {stockChartData.length === 0 ? (
                            <div style={{ width: '100%', height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <div className="text-slate-400 text-sm">{stockChartLoading ? 'Loading chart...' : 'No data available'}</div>
                            </div>
                          ) : (
                            <ResponsiveContainer width="100%" height={220}>
                              <ComposedChart
                                data={stockChartData}
                                margin={{ top: 10, right: 15, left: 5, bottom: 30 }}
                              >
                                <defs>
                                  <linearGradient id="stockGlowGradientVertical" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.4" />
                                    <stop offset="50%" stopColor="#a78bfa" stopOpacity="0.2" />
                                    <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0.02" />
                                  </linearGradient>
                                </defs>

                                <XAxis
                                  dataKey="day"
                                  axisLine={false}
                                  tickLine={false}
                                  tickMargin={8}
                                  interval={stockTimeFilter === 'D'
                                    ? Math.max(0, Math.ceil(stockChartData.length / 4) - 1)
                                    : stockChartData.length <= 8 ? 0 : Math.max(0, Math.ceil(stockChartData.length / 6) - 1)}
                                  tick={({ x, y, payload }) => {
                                    if (!payload.value) return null;
                                    const val = String(payload.value);
                                    if (stockTimeFilter === 'D' && val.includes('|')) {
                                      const [dayPart, timePart] = val.split('|');
                                      return (
                                        <text x={x} y={y} textAnchor="middle" fill="#64748b" fontSize={10} fontWeight={500}>
                                          <tspan x={x} dy={10}>{dayPart}</tspan>
                                          <tspan x={x} dy={13}>{timePart}</tspan>
                                        </text>
                                      );
                                    }
                                    return <text x={x} y={y} dy={12} textAnchor="middle" fill="#64748b" fontSize={11} fontWeight={500}>{payload.value}</text>;
                                  }}
                                />

                                <YAxis
                                  domain={stockAxisConfig.domain}
                                  ticks={stockAxisConfig.ticks}
                                  tickFormatter={formatPnlAxis}
                                  tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 500 }}
                                  axisLine={false}
                                  tickLine={false}
                                  width={55}
                                />

                                {showStockPnl && (
                                  <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="3 3" strokeWidth={1} />
                                )}

                                <Tooltip
                                  content={({ active, payload, label }) => {
                                    if (active && payload && payload.length) {
                                      let fullDate = payload[0]?.payload?.fullDate || label;
                                      if (typeof fullDate === 'string' && fullDate.includes('|')) {
                                        fullDate = fullDate.replace('|', ' ');
                                      }
                                      const val = payload[0].value;
                                      const isPos = val >= 0;
                                      return (
                                        <div className="bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg px-3 py-1.5 shadow-md">
                                          <div className="text-xs text-slate-500 mb-0.5">{fullDate}</div>
                                          <div className="text-sm font-bold text-violet-700">
                                            {showStockPnl ? (isPos ? '+' : '-') + 'R' + Math.abs(val).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'R' + val.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                          </div>
                                        </div>
                                      );
                                    }
                                    return null;
                                  }}
                                  cursor={false}
                                  wrapperStyle={{ outline: 'none' }}
                                />

                                <Area
                                  type="monotone"
                                  dataKey="value"
                                  stroke="none"
                                  fill="url(#stockGlowGradientVertical)"
                                  fillOpacity={1}
                                />

                                <Line
                                  type="monotone"
                                  dataKey="value"
                                  stroke="#7c3aed"
                                  strokeWidth={2.5}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  dot={false}
                                  activeDot={{
                                    r: 6,
                                    fill: '#7c3aed',
                                    stroke: '#c4b5fd',
                                    strokeWidth: 2,
                                  }}
                                />
                              </ComposedChart>
                            </ResponsiveContainer>
                          )}
                        </div>
                      </section>
                    </div>
                  )}

                  <div className="relative mx-auto flex w-full max-w-sm flex-col gap-4 px-4 pb-10 md:max-w-md md:px-8">
                    {myStocks.length > 0 && (() => {
                      const STOCKS_PER_PAGE = 6;
                      const myTotalPages = Math.ceil(myStocks.length / STOCKS_PER_PAGE);
                      const myPagedStocks = myStocks.slice(myStocksPage * STOCKS_PER_PAGE, (myStocksPage + 1) * STOCKS_PER_PAGE);
                      return (
                        <section
                          className="rounded-3xl bg-white/70 backdrop-blur-xl p-5 shadow-sm border border-slate-100/50"
                          style={{ fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}
                        >
                          <div className="flex items-center justify-between mb-4">
                            <p className="text-sm font-semibold text-slate-900">My Stocks</p>
                            {myTotalPages > 1 && (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setMyStocksPage(p => Math.max(0, p - 1))}
                                  disabled={myStocksPage === 0}
                                  className={`h-7 w-7 rounded-full flex items-center justify-center transition ${myStocksPage === 0 ? 'text-slate-300' : 'text-slate-600 hover:bg-slate-100 active:bg-slate-200'}`}
                                >
                                  <ChevronLeft className="h-4 w-4" />
                                </button>
                                <span className="text-xs font-medium text-slate-400 tabular-nums">{myStocksPage + 1}/{myTotalPages}</span>
                                <button
                                  onClick={() => setMyStocksPage(p => Math.min(myTotalPages - 1, p + 1))}
                                  disabled={myStocksPage >= myTotalPages - 1}
                                  className={`h-7 w-7 rounded-full flex items-center justify-center transition ${myStocksPage >= myTotalPages - 1 ? 'text-slate-300' : 'text-slate-600 hover:bg-slate-100 active:bg-slate-200'}`}
                                >
                                  <ChevronRight className="h-4 w-4" />
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="space-y-3">
                            {myPagedStocks.map((stock) => {
                              const livePrice = liveQuotes[stock.ticker]?.price || stock.price;
                              const liveChange = liveQuotes[stock.ticker]?.changePercent ?? stock.dailyChange;
                              const isPositive = liveChange >= 0;
                              const stockSecId = liveQuotes[stock.ticker]?.id || null;
                              const stockHolding = stockSecId ? (rawHoldings || []).find(h => h.security_id === stockSecId) : null;
                              const stockQty = stockHolding ? (stockHolding.quantity || 0) : 0;
                              const displayPrice = stockQty > 0 ? livePrice * stockQty : livePrice;
                              return (
                                <button
                                  key={stock.id}
                                  onClick={() => setSelectedStock(stock)}
                                  className="w-full flex items-center gap-3 rounded-2xl bg-white/70 backdrop-blur-xl p-3 shadow-sm border border-slate-100/50 transition hover:bg-white/90 text-left"
                                >
                                  <div className="h-11 w-11 rounded-full bg-white border border-slate-200 shadow-sm overflow-hidden flex-shrink-0">
                                    {failedLogos[stock.ticker] ? (
                                      <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-violet-100 to-purple-100 text-xs font-bold text-violet-700">
                                        {stock.ticker.slice(0, 2)}
                                      </div>
                                    ) : (
                                      <img
                                        src={stock.logo}
                                        alt={stock.name}
                                        className="h-full w-full object-cover"
                                        onError={() => setFailedLogos(prev => ({ ...prev, [stock.ticker]: true }))}
                                      />
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <p className="text-sm font-semibold text-slate-900 truncate">{stock.name}</p>
                                    </div>
                                    <p className="text-xs text-slate-500 font-medium">{stockQty > 0 ? `${Math.round(stockQty)} shares` : stock.ticker}</p>
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <p className="text-sm font-bold text-slate-900">{formatCurrency(displayPrice)}</p>
                                    <p className={`text-xs font-medium ${isPositive ? 'text-emerald-500' : 'text-rose-500'}`}>
                                      {isPositive ? '+' : ''}{liveChange.toFixed(2)}%
                                    </p>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })()}

                    {!hasNoHoldings && (
                      <button
                        onClick={() => onOpenInvest && onOpenInvest()}
                        className="w-full py-3.5 rounded-full bg-gradient-to-r from-slate-800 to-slate-900 text-sm font-semibold uppercase tracking-[0.1em] text-white shadow-lg shadow-slate-900/30 transition hover:-translate-y-0.5 hover:shadow-xl flex items-center justify-center gap-2"
                      >
                        <Plus className="h-4 w-4" />
                        Buy More Stocks
                      </button>
                    )}
                  </div>
                </>
              );
            })()}
          </motion.div>
        )}

        {/* Holdings Tab Content */}
        {activeTab === "holdings" && (
          <motion.div
            key="holdings"
            initial={{ opacity: 0, x: tabDirection * 40, filter: 'blur(6px)' }}
            animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, x: tabDirection * -40, filter: 'blur(6px)' }}
            transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            {(() => {
              if (holdingsLoading || strategiesLoading) {
                return (
                  <div className="relative mx-auto flex w-full max-w-sm flex-col gap-4 px-4 pb-10 md:max-w-md md:px-8">
                    <div className="text-center py-10 text-slate-500">Loading holdings...</div>
                  </div>
                );
              }
              const pieColors = ["#4C1D95", "#5B21B6", "#6D28D9", "#7C3AED", "#8B5CF6", "#A78BFA", "#C4B5FD", "#DDD6FE", "#EDE9FE", "#F5F3FF"];

              const holdingsData = allStrategyHoldings.map(h => ({
                id: h.symbol,
                name: h.name,
                ticker: h.symbol,
                logo: h.logo,
                isStrategy: h.isStrategy || false,
                securityId: h.securityId || null,
                topLogos: h.topLogos || [],
                strategyId: h.strategyId || null,
                strategyHoldings: h.strategyHoldings || [],
                currentValue: h.currentValue || 0,
                investedAmount: h.investedAmount || 0,
                change: h.change || 0,
                isPending: h.isPending || false,
                settlement_status: h.settlement_status || null,
              })).sort((a, b) => b.currentValue - a.currentValue);

              const flatPieData = (() => {
                const map = new Map();
                holdingsData.forEach(h => {
                  if (h.isStrategy && h.strategyHoldings?.length > 0) {
                    const totalWeight = h.strategyHoldings.reduce((s, c) => s + (c.weight || 0), 0) || 100;
                    h.strategyHoldings.forEach(c => {
                      const pct = (c.weight || 0) / totalWeight;
                      const val = h.currentValue * pct;
                      const key = c.symbol || c.name;
                      if (map.has(key)) {
                        map.get(key).value += val;
                      } else {
                        map.set(key, { name: c.symbol || c.name, displayName: c.name || c.symbol, value: val });
                      }
                    });
                  } else if (!h.isStrategy) {
                    const key = h.ticker;
                    if (map.has(key)) {
                      map.get(key).value += h.currentValue;
                    } else {
                      map.set(key, { name: h.ticker, displayName: h.name, value: h.currentValue });
                    }
                  }
                });
                return Array.from(map.values()).sort((a, b) => b.value - a.value);
              })();

              if (holdingsData.length === 0) {
                return (
                  <div className="relative mx-auto flex w-full max-w-sm flex-col gap-4 px-4 pb-10 md:max-w-md md:px-8">
                    <div
                      className="rounded-3xl p-8 backdrop-blur-xl shadow-sm border border-slate-100/50 text-center"
                      style={{ background: 'rgba(255,255,255,0.7)', fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}
                    >
                      <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center">
                        <TrendingUp className="h-7 w-7 text-violet-500" />
                      </div>
                      <p className="text-lg font-semibold text-slate-900 mb-1">No holdings yet</p>
                      <p className="text-sm text-slate-500">Your investment holdings will appear here once you start investing.</p>
                    </div>
                    {investmentGoals && investmentGoals.length > 0 && (
                      <section className="rounded-3xl bg-white/70 backdrop-blur-xl p-5 shadow-sm border border-slate-100/50">
                        <div className="flex items-center justify-between mb-4">
                          <p className="text-sm font-semibold text-slate-900">Your Goals</p>
                          <span className="text-xs font-semibold text-violet-600 bg-violet-50 rounded-full px-2 py-0.5">{investmentGoals.length}</span>
                        </div>
                        <div className="space-y-3">
                          {investmentGoals.map((g) => {
                            const currentValue = g.currentAmount || 0;
                            const invested = g.investedAmount || 0;
                            const target = g.targetAmount || 0;
                            const remaining = Math.max(0, target - currentValue);
                            const pct = target > 0 ? Math.min(100, (currentValue / target) * 100) : 0;
                            const gainLoss = currentValue - invested;
                            return (
                              <div key={g.id || (g.label + g.targetAmount)} className="rounded-2xl bg-slate-50 p-4">
                                <div className="flex items-center justify-between mb-1">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-900">{g.label}</p>
                                    <div className="flex items-center gap-1.5">
                                      {g.linkedAssetName && (
                                        <p className="text-[10px] text-slate-400">Linked to {g.linkedAssetName}</p>
                                      )}
                                      {g.targetDate && !isNaN(new Date(g.targetDate).getTime()) && (
                                        <p className="text-[10px] text-slate-400">
                                          {g.linkedAssetName ? '• ' : ''}{new Date(g.targetDate).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                  <p className="text-xs font-semibold text-slate-600">
                                    {formatCurrency(currentValue)} / {formatCurrency(target)}
                                  </p>
                                </div>
                                <div className="h-2.5 w-full rounded-full bg-slate-200 overflow-hidden mb-2">
                                  <div
                                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-600 transition-all"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <div className="flex items-center justify-between">
                                  <p className="text-xs text-slate-500">
                                    {pct >= 100 ? "Goal reached!" : `${formatCurrency(remaining)} remaining`}
                                  </p>
                                  <div className="flex items-center gap-2">
                                    {gainLoss !== 0 && invested > 0 && (
                                      <span className={`text-[10px] font-semibold ${gainLoss > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                        {gainLoss > 0 ? '+' : ''}{formatCurrency(gainLoss)}
                                      </span>
                                    )}
                                    <p className="text-xs font-semibold text-violet-600">{pct.toFixed(0)}%</p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    )}
                  </div>
                );
              }

              const totalValue = holdingsData.reduce((sum, h) => sum + h.currentValue, 0);
              const totalCostBasisValue = holdingsData.reduce((sum, h) => sum + (h.costBasis || h.currentValue), 0);
              const totalDistinct = flatPieData.length;

              const top10 = flatPieData.slice(0, 10).map((h, idx) => ({
                name: h.name,
                displayName: h.displayName,
                value: h.value,
                color: pieColors[idx % pieColors.length],
              }));
              const othersValue = flatPieData.slice(10).reduce((sum, h) => sum + h.value, 0);
              const pieData = othersValue > 0
                ? [...top10, { name: "Others", displayName: "Others", value: othersValue, color: "#E9D5FF" }]
                : top10;

              return (
                <div className="relative mx-auto flex w-full max-w-sm flex-col gap-4 px-4 pb-10 md:max-w-md md:px-8">
                  {/* Summary Card with Pie Chart */}
                  <div
                    className="rounded-3xl p-5 backdrop-blur-xl shadow-sm border border-slate-100/50"
                    style={{ background: 'rgba(255,255,255,0.7)', fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col gap-3">
                        <div>
                          <p className="text-xs text-slate-500 mb-0.5">Total Portfolio Value</p>
                          <p className="text-2xl font-bold text-slate-900">{formatCurrency(totalValue)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-3xl font-bold text-slate-900">{totalDistinct}</p>
                          <div className="flex flex-col justify-center">
                            <p className="text-xs text-slate-500 leading-tight">Total Holdings</p>
                            <p className="text-xs text-slate-500 leading-tight">assets</p>
                          </div>
                        </div>
                      </div>

                      {/* Right: Pie Chart */}
                      <div className="relative h-44 w-44 -mr-4 md:mr-0" style={{ pointerEvents: isLoadingData ? 'none' : 'auto', opacity: isLoadingData ? 0.5 : 1, transition: 'opacity 0.3s ease' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <defs>
                              <filter id="glow">
                                <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                                <feMerge>
                                  <feMergeNode in="coloredBlur" />
                                  <feMergeNode in="SourceGraphic" />
                                </feMerge>
                              </filter>
                            </defs>
                            <Pie
                              data={pieData}
                              cx="50%"
                              cy="50%"
                              outerRadius={80}
                              paddingAngle={2}
                              dataKey="value"
                              stroke="rgba(255,255,255,0.9)"
                              strokeWidth={1.5}
                              animationBegin={0}
                              animationDuration={800}
                              animationEasing="ease-out"
                            >
                              {pieData.map((entry, index) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={entry.color}
                                  opacity={activePieIndex >= 0 && activePieIndex !== index ? 0.4 : 1}
                                  style={{
                                    transform: activePieIndex === index
                                      ? 'scale(1.1)'
                                      : activePieIndex >= 0
                                        ? 'scale(0.94)'
                                        : 'scale(1)',
                                    transformOrigin: 'center',
                                    transition: 'transform 0.6s cubic-bezier(0.25, 0.1, 0.25, 1), opacity 0.5s ease-out, filter 0.5s ease-out',
                                    cursor: 'pointer',
                                    filter: activePieIndex === index ? 'url(#glow)' : 'none'
                                  }}
                                  onMouseEnter={() => !isLoadingData && setActivePieIndex(index)}
                                  onMouseLeave={() => !isLoadingData && setActivePieIndex(-1)}
                                  onClick={() => !isLoadingData && setActivePieIndex(activePieIndex === index ? -1 : index)}
                                />
                              ))}
                            </Pie>
                            <Tooltip
                              wrapperStyle={{ outline: 'none', zIndex: 100 }}
                              position={{ x: -80, y: -10 }}
                              content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                  const data = payload[0].payload;
                                  const percent = ((data.value / totalValue) * 100).toFixed(1);
                                  return (
                                    <div
                                      className="px-3 py-2 rounded-xl shadow-2xl border border-white/20"
                                      style={{
                                        background: 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(248,250,252,0.9) 100%)',
                                        backdropFilter: 'blur(20px)',
                                        WebkitBackdropFilter: 'blur(20px)',
                                        minWidth: '70px',
                                        textAlign: 'center'
                                      }}
                                    >
                                      <p className="text-xs font-bold text-slate-800">{data.displayName || data.name}</p>
                                      <p className="text-base font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
                                        {percent}%
                                      </p>
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  {/* Holdings List */}
                  {(() => {
                    const HOLDINGS_PER_PAGE = 6;
                    const holdingsTotalPages = Math.ceil(holdingsData.length / HOLDINGS_PER_PAGE);
                    const pagedHoldings = holdingsData.slice(holdingsPage * HOLDINGS_PER_PAGE, (holdingsPage + 1) * HOLDINGS_PER_PAGE);
                    return (
                      <>
                        <section
                          className="rounded-3xl bg-white/70 backdrop-blur-xl p-5 shadow-sm border border-slate-100/50"
                          style={{ fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}
                        >
                          <div className="flex items-center justify-between mb-4">
                            <p className="text-sm font-semibold text-slate-900">Your Assets</p>
                            {holdingsTotalPages > 1 && (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setHoldingsPage(p => Math.max(0, p - 1))}
                                  disabled={holdingsPage === 0}
                                  className={`h-7 w-7 rounded-full flex items-center justify-center transition ${holdingsPage === 0 ? 'text-slate-300' : 'text-slate-600 hover:bg-slate-100 active:bg-slate-200'}`}
                                >
                                  <ChevronLeft className="h-4 w-4" />
                                </button>
                                <span className="text-xs font-medium text-slate-400 tabular-nums">{holdingsPage + 1}/{holdingsTotalPages}</span>
                                <button
                                  onClick={() => setHoldingsPage(p => Math.min(holdingsTotalPages - 1, p + 1))}
                                  disabled={holdingsPage >= holdingsTotalPages - 1}
                                  className={`h-7 w-7 rounded-full flex items-center justify-center transition ${holdingsPage >= holdingsTotalPages - 1 ? 'text-slate-300' : 'text-slate-600 hover:bg-slate-100 active:bg-slate-200'}`}
                                >
                                  <ChevronRight className="h-4 w-4" />
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="space-y-3">
                            {pagedHoldings.map((stock) => {
                              const pctValue = totalValue > 0 ? ((stock.currentValue / totalValue) * 100) : 0;
                              const changePnl = stock.change || 0;
                              const isExpanded = stock.isStrategy && expandedStrategyId === stock.strategyId;
                              return (
                                <div key={stock.id} ref={isExpanded ? expandedRowRef : null}>
                                  <div
                                    className={`rounded-2xl bg-white/70 backdrop-blur-xl p-4 shadow-sm border transition-all duration-200 cursor-pointer active:scale-[0.98] ${stock.isStrategy ? 'border-violet-100/60' : 'border-slate-100/50'}`}
                                    onClick={() => {
                                      if (stock.isStrategy) {
                                        setExpandedStrategyId(isExpanded ? null : stock.strategyId);
                                      } else {
                                        setModalHolding(stock);
                                        setModalTimeFilter("W");
                                      }
                                    }}
                                  >
                                    <div className="flex items-center gap-3">
                                      <div className="h-11 w-11 rounded-full bg-white border border-slate-200 shadow-sm overflow-hidden flex-shrink-0">
                                        {stock.isStrategy && stock.topLogos?.length > 0 ? (
                                          <div className="flex -space-x-1.5 items-center justify-center h-full w-full bg-gradient-to-br from-violet-50 to-purple-50">
                                            {stock.topLogos.slice(0, 3).map((logo, li) => (
                                              <img key={li} src={logo} className="w-5 h-5 rounded-full object-cover border border-white shadow-sm" referrerPolicy="no-referrer" crossOrigin="anonymous" />
                                            ))}
                                          </div>
                                        ) : !stock.logo || failedLogos[stock.ticker] ? (
                                          <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-violet-100 to-purple-100 text-xs font-bold text-violet-700">
                                            {stock.ticker.slice(0, 2)}
                                          </div>
                                        ) : (
                                          <img
                                            src={stock.logo}
                                            alt={stock.name}
                                            className="h-full w-full object-cover"
                                            onError={() => setFailedLogos(prev => ({ ...prev, [stock.ticker]: true }))}
                                          />
                                        )}
                                      </div>

                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-slate-900 truncate">{stock.name}</p>
                                        <p className="text-xs text-slate-500 font-medium">{stock.isStrategy ? `${(stock.strategyHoldings || []).length} assets` : stock.ticker}</p>
                                      </div>

                                      <div className="flex items-center gap-2">
                                        <div className="text-right flex-shrink-0">
                                          <p className="text-sm font-bold text-slate-900">
                                            {stock.isPending ? "—" : formatCurrency(stock.currentValue)}
                                          </p>
                                          {stock.isPending ? (
                                            <p className="text-xs text-amber-500 font-semibold">Pending</p>
                                          ) : (
                                            <div className="flex flex-col items-end">
                                              <p className={`text-xs font-semibold ${changePnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                {changePnl >= 0 ? '+' : ''}{changePnl.toFixed(1)}%{stock.isStrategy ? ' Total Return' : ''}
                                              </p>
                                              {stock.isStrategy && stock.ytd_return != null && (
                                                <p className={`text-[10px] font-medium mt-0.5 ${stock.ytd_return >= 0 ? 'text-emerald-500/70' : 'text-rose-500/70'}`}>
                                                  {stock.ytd_return >= 0 ? '+' : ''}{(stock.ytd_return * 100).toFixed(1)}% Strategy YTD
                                                </p>
                                              )}
                                            </div>
                                          )}
                                          <p className="text-[10px] text-slate-400">{pctValue.toFixed(1)}% of portfolio</p>
                                        </div>
                                        {stock.isStrategy && (
                                          <ChevronDown className={`h-4 w-4 text-slate-400 flex-shrink-0 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Expandable constituent stocks */}
                                  {stock.isStrategy && isExpanded && stock.strategyHoldings?.length > 0 && (
                                    <div className="mt-1.5 ml-3 space-y-1.5 border-l-2 border-violet-100 pl-3">
                                      {stock.strategyHoldings.map((c, ci) => {
                                        const matchedHolding = (rawHoldings || []).find(h => h.symbol === c.symbol);
                                        const matchedStock = stocksList?.find(s => s.ticker === c.symbol);
                                        const logo = matchedHolding?.logo || matchedStock?.logo || null;
                                        let pnlRands, pnlPct;
                                        if (c.pnlRands != null) {
                                          pnlRands = c.pnlRands;
                                          pnlPct = c.pnlPct ?? 0;
                                        } else {
                                          const totalW = stock.strategyHoldings.reduce((s, x) => s + (x.weight || 0), 0) || 100;
                                          const fraction = (c.weight || 0) / totalW;
                                          const constituentCurrentVal = stock.currentValue * fraction;
                                          const constituentCostBasis = (stock.investedAmount || stock.currentValue) * fraction;
                                          pnlRands = constituentCurrentVal - constituentCostBasis;
                                          pnlPct = constituentCostBasis > 0 ? (pnlRands / constituentCostBasis) * 100 : 0;
                                        }
                                        const isGain = pnlRands >= 0;
                                        const onOpenConstituent = () => {
                                          if (!matchedStock) return;
                                          const rawH = (rawHoldings || []).find(h => h.security_id === matchedStock.id);
                                          const livePrice = liveQuotes[matchedStock.ticker]?.price || matchedStock.price || 0;
                                          const qty = rawH ? (rawH.quantity || 0) : 0;
                                          setModalHolding({ ...matchedStock, currentValue: qty * livePrice });
                                          setModalTimeFilter("W");
                                        };
                                        return (
                                          <button key={ci} onClick={onOpenConstituent} className="w-full rounded-xl bg-white/80 backdrop-blur-sm p-3 border border-slate-100/50 flex items-center gap-3 text-left transition hover:bg-white/95 active:scale-[0.98]">
                                            <div className="h-8 w-8 rounded-full bg-white border border-slate-200 shadow-sm overflow-hidden flex-shrink-0">
                                              {logo && !failedLogos[c.symbol] ? (
                                                <img
                                                  src={logo}
                                                  alt={c.symbol}
                                                  className="h-full w-full object-cover"
                                                  referrerPolicy="no-referrer"
                                                  crossOrigin="anonymous"
                                                  onError={() => setFailedLogos(prev => ({ ...prev, [c.symbol]: true }))}
                                                />
                                              ) : (
                                                <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
                                                  <span className="text-[9px] font-bold text-slate-500">{(c.symbol || '').slice(0, 3)}</span>
                                                </div>
                                              )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                              <p className="text-xs font-semibold text-slate-800 truncate">{c.name || c.symbol}</p>
                                              <p className="text-[10px] text-slate-500">{c.symbol}</p>
                                            </div>
                                            <div className="text-right flex-shrink-0">
                                              {stock.isPending ? (
                                                <SettlementBadge status="pending" size="xs" />
                                              ) : (
                                                <>
                                                  <p className={`text-xs font-bold ${isGain ? 'text-emerald-600' : 'text-rose-500'}`}>
                                                    {isGain ? '+' : ''}{formatCurrency(pnlRands)}
                                                  </p>
                                                  <p className={`text-[10px] font-semibold ${isGain ? 'text-emerald-500' : 'text-rose-400'}`}>
                                                    {isGain ? '+' : ''}{pnlPct.toFixed(2)}%
                                                  </p>
                                                </>
                                              )}
                                            </div>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </section>

                        {closedHoldings && closedHoldings.length > 0 && (
                          <section className="rounded-3xl bg-white/70 backdrop-blur-xl p-5 shadow-sm border border-slate-100/50" style={{ fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}>
                            <p className="text-sm font-semibold text-slate-900 mb-4">Closed Positions</p>
                            <div className="space-y-3">
                              {closedHoldings.map((h) => {
                                const exitPriceRands = (h.exit_price || 0) / 100;
                                const avgFillRands = (h.avg_fill || 0) / 100;
                                const pnlRands = (exitPriceRands - avgFillRands) * (h.quantity || 0);
                                const isGain = pnlRands >= 0;
                                return (
                                  <div key={h.id} className="flex items-center gap-3 rounded-2xl bg-slate-50 p-4">
                                    <div className="h-10 w-10 rounded-full bg-white border border-slate-200 shadow-sm overflow-hidden flex-shrink-0">
                                      {h.logo_url ? (
                                        <img src={h.logo_url} alt={h.name} className="h-full w-full object-cover" />
                                      ) : (
                                        <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-xs font-bold text-slate-500">
                                          {(h.symbol || '').slice(0, 2)}
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-semibold text-slate-900 truncate">{h.name}</p>
                                      <p className="text-xs text-slate-500">{h.symbol} · Exit: R{exitPriceRands.toFixed(2)}</p>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                      <span className="inline-block text-[10px] font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5 mb-1">Exited</span>
                                      {h.exit_price > 0 && (
                                        <p className={`text-xs font-bold ${isGain ? 'text-emerald-600' : 'text-rose-500'}`}>
                                          {isGain ? '+' : ''}R{Math.abs(pnlRands).toFixed(2)}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </section>
                        )}

                        {(() => {
                          const STOCKS_PER_PAGE = 6;
                          const holdingsOtherStocks = stocksList.filter(s => !myStockIds.has(s.id));
                          const otherTotalPages = Math.ceil(holdingsOtherStocks.length / STOCKS_PER_PAGE);
                          const otherPagedStocks = holdingsOtherStocks.slice(otherStocksPage * STOCKS_PER_PAGE, (otherStocksPage + 1) * STOCKS_PER_PAGE);
                          if (holdingsOtherStocks.length === 0) return null;
                          return (
                            <section className="rounded-3xl bg-white/70 backdrop-blur-xl p-5 shadow-sm border border-slate-100/50 mt-4">
                              <div className="flex items-center justify-between mb-4">
                                <p className="text-sm font-semibold text-slate-900">Other Stocks</p>
                                {otherTotalPages > 1 && (
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => setOtherStocksPage(p => Math.max(0, p - 1))}
                                      disabled={otherStocksPage === 0}
                                      className={`h-7 w-7 rounded-full flex items-center justify-center transition ${otherStocksPage === 0 ? 'text-slate-300' : 'text-slate-600 hover:bg-slate-100 active:bg-slate-200'}`}
                                    >
                                      <ChevronLeft className="h-4 w-4" />
                                    </button>
                                    <span className="text-xs font-medium text-slate-400 tabular-nums">{otherStocksPage + 1}/{otherTotalPages}</span>
                                    <button
                                      onClick={() => setOtherStocksPage(p => Math.min(otherTotalPages - 1, p + 1))}
                                      disabled={otherStocksPage >= otherTotalPages - 1}
                                      className={`h-7 w-7 rounded-full flex items-center justify-center transition ${otherStocksPage >= otherTotalPages - 1 ? 'text-slate-300' : 'text-slate-600 hover:bg-slate-100 active:bg-slate-200'}`}
                                    >
                                      <ChevronRight className="h-4 w-4" />
                                    </button>
                                  </div>
                                )}
                              </div>
                              <div className="space-y-3">
                                {otherPagedStocks.map((stock) => {
                                  const livePrice = liveQuotes[stock.ticker]?.price || stock.price;
                                  const liveChange = liveQuotes[stock.ticker]?.changePercent ?? stock.dailyChange;
                                  const isPositive = liveChange >= 0;
                                  return (
                                    <button
                                      key={stock.id}
                                      onClick={() => { setModalHolding(stock); setModalTimeFilter("W"); }}
                                      className="w-full flex items-center gap-3 rounded-2xl bg-white/70 backdrop-blur-xl p-3 shadow-sm border border-slate-100/50 transition hover:bg-white/90 text-left"
                                    >
                                      <div className="h-11 w-11 rounded-full bg-white border border-slate-200 shadow-sm overflow-hidden flex-shrink-0">
                                        {failedLogos[stock.ticker] ? (
                                          <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-violet-100 to-purple-100 text-xs font-bold text-violet-700">
                                            {stock.ticker.slice(0, 2)}
                                          </div>
                                        ) : (
                                          <img
                                            src={stock.logo}
                                            alt={stock.name}
                                            className="h-full w-full object-cover"
                                            onError={() => setFailedLogos(prev => ({ ...prev, [stock.ticker]: true }))}
                                          />
                                        )}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-slate-900 truncate">{stock.name}</p>
                                        <p className="text-xs text-slate-500 font-medium">{stock.ticker}</p>
                                      </div>
                                      <div className="text-right flex-shrink-0">
                                        <p className="text-sm font-bold text-slate-900">{formatCurrency(livePrice)}</p>
                                        <p className={`text-xs font-medium ${isPositive ? 'text-emerald-500' : 'text-rose-500'}`}>
                                          {isPositive ? '+' : ''}{liveChange.toFixed(2)}%
                                        </p>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </section>
                          );
                        })()}

                        {investmentGoals && investmentGoals.length > 0 && (
                          <section className="rounded-3xl bg-white/70 backdrop-blur-xl p-5 shadow-sm border border-slate-100/50 mt-4">
                            <div className="flex items-center justify-between mb-4">
                              <p className="text-sm font-semibold text-slate-900">Your Goals</p>
                              <span className="text-xs font-semibold text-violet-600 bg-violet-50 rounded-full px-2 py-0.5">{investmentGoals.length}</span>
                            </div>
                            <div className="space-y-3">
                              {investmentGoals.map((g) => {
                                const currentValue = g.currentAmount || 0;
                                const invested = g.investedAmount || 0;
                                const target = g.targetAmount || 0;
                                const remaining = Math.max(0, target - currentValue);
                                const pct = target > 0 ? Math.min(100, (currentValue / target) * 100) : 0;
                                const gainLoss = currentValue - invested;
                                return (
                                  <div key={g.id || (g.label + g.targetAmount)} className="rounded-2xl bg-slate-50 p-4">
                                    <div className="flex items-center justify-between mb-1">
                                      <div>
                                        <p className="text-sm font-semibold text-slate-900">{g.label}</p>
                                        <div className="flex items-center gap-1.5">
                                          {g.linkedAssetName && (
                                            <p className="text-[10px] text-slate-400">Linked to {g.linkedAssetName}</p>
                                          )}
                                          {g.targetDate && !isNaN(new Date(g.targetDate).getTime()) && (
                                            <p className="text-[10px] text-slate-400">
                                              {g.linkedAssetName ? '• ' : ''}{new Date(g.targetDate).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                      <p className="text-xs font-semibold text-slate-600">
                                        {formatCurrency(currentValue)} / {formatCurrency(target)}
                                      </p>
                                    </div>
                                    <div className="h-2.5 w-full rounded-full bg-slate-200 overflow-hidden mb-2">
                                      <div
                                        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-600 transition-all"
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <p className="text-xs text-slate-500">
                                        {pct >= 100 ? "Goal reached!" : `${formatCurrency(remaining)} remaining`}
                                      </p>
                                      <div className="flex items-center gap-2">
                                        {gainLoss !== 0 && invested > 0 && (
                                          <span className={`text-[10px] font-semibold ${gainLoss > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            {gainLoss > 0 ? '+' : ''}{formatCurrency(gainLoss)}
                                          </span>
                                        )}
                                        <p className="text-xs font-semibold text-violet-600">{pct.toFixed(0)}%</p>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </section>
                        )}
                      </>
                    );
                  })()}
                </div>
              );
            })()}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Holding Stock Chart Modal */}
      <AnimatePresence>
        {modalHolding && (() => {
          const mHolding = modalHolding;
          const mRawHolding = (rawHoldings || []).find(h =>
            String(h.security_id) === String(modalSecurityId) ||
            String(h.security_id) === String(mHolding.securityId)
          );
          const mQty = mRawHolding ? (mRawHolding.quantity || 0) : 0;
          const mAvgFill = mRawHolding ? (mRawHolding.avg_fill || 0) / 100 : 0;
          const mCostBasis = mAvgFill * mQty;
          const mShowPnl = mQty > 0 && mAvgFill > 0;
          const mMarketValue = mHolding.currentValue || 0;
          const mPnl = mShowPnl ? mMarketValue - mCostBasis : 0;
          const mPnlPct = mShowPnl && mCostBasis > 0 ? (mPnl / mCostBasis) * 100 : 0;
          const mLiveChange = liveQuotes[mHolding.ticker]?.changePercent ?? mHolding.change ?? 0;

          // Use the date string as-is from the DB (no timezone conversion).
          const mPurchaseTs = modalPurchaseDate
            ? new Date(modalPurchaseDate.slice(0, 10) + 'T00:00:00').getTime()
            : null;

          // Format a date string to match each filter's x-axis label style.
          const mFormatLabel = (isoStr, filter) => {
            if (!isoStr) return '';
            const d = new Date(isoStr.slice(0, 10) + 'T00:00:00');
            const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
            const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const dow = d.getDay(), dy = d.getDate(), mo = d.getMonth(), yr = d.getFullYear();
            if (filter === 'D') return DAY[dow] + ' ' + dy + ' ' + MON[mo];
            if (filter === 'W') return DAY[dow] + ' ' + dy;
            if (filter === 'M') return dy + ' ' + MON[mo];
            return MON[mo] + " '" + String(yr).slice(-2);
          };
          const mPurchaseLabel = mFormatLabel(modalPurchaseDate, modalTimeFilter);
          const mNowLabel = mFormatLabel(new Date().toISOString(), modalTimeFilter);

          // Keep only chart points on or after the local purchase date.
          // Falls back to an empty array if bought today and no close price exists yet (e.g. weekend).
          const mBaseChartData = (() => {
            if (!modalRawChartData.length) return [];
            if (!mPurchaseTs) return modalRawChartData;
            return modalRawChartData.filter(d => (d.timestamp || 0) >= mPurchaseTs);
          })();

          const mIsPending = mQty > 0 && mAvgFill === 0;
          const mChartData = mIsPending
            ? [{ day: mPurchaseLabel || 'Purchase', value: 0 }, { day: mNowLabel || 'Now', value: 0 }]
            : mBaseChartData.length > 0
              ? (mShowPnl
                ? mBaseChartData.map(d => ({
                  ...d,
                  value: Number(((d.value * mQty) - mCostBasis).toFixed(2)),
                }))
                : mBaseChartData)
              // No closes after purchase yet (e.g. bought on weekend): flat line at current P&L.
              : (mShowPnl ? [{ day: mPurchaseLabel, value: 0 }, { day: mNowLabel, value: Number(mPnl.toFixed(2)) }] : []);
          const mAxisConfig = computePnlAxisConfig(mChartData);
          return (
            <>
              <motion.div
                key="modal-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[1090]"
                onClick={() => setModalHolding(null)}
              />
              <motion.div
                key="modal-sheet"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                className="fixed bottom-0 left-0 right-0 z-[1100] rounded-t-3xl bg-white/95 backdrop-blur-2xl shadow-2xl"
                style={{ maxHeight: '92vh', overflowY: 'auto', paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))', fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}
                onClick={e => e.stopPropagation()}
              >
                {/* Drag handle */}
                <div className="flex justify-center pt-3 pb-1">
                  <div className="w-10 h-1 rounded-full bg-slate-200" />
                </div>

                {/* Header */}
                <div className="flex items-center justify-between px-5 pt-2 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-white border border-slate-200 shadow-sm overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {mHolding.logo && !failedLogos[mHolding.ticker] ? (
                        <img
                          src={mHolding.logo}
                          alt={mHolding.ticker}
                          className="h-full w-full object-contain"
                          onError={() => setFailedLogos(prev => ({ ...prev, [mHolding.ticker]: true }))}
                        />
                      ) : (
                        <span className="text-xs font-bold text-slate-500">{(mHolding.ticker || '').slice(0, 2)}</span>
                      )}
                    </div>
                    <div>
                      <p className="text-base font-semibold text-slate-900 leading-tight">{mHolding.name}</p>
                      <p className="text-xs font-medium text-slate-400">{mHolding.ticker}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setModalHolding(null)}
                    className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>

                {/* Value + P&L */}
                <div className="px-6 mb-3">
                  {mIsPending ? (
                    <>
                      <p className="text-3xl font-bold text-amber-500">Pending</p>
                      <p className="text-sm mt-0.5 text-slate-400">Awaiting broker fill — value not yet settled</p>
                    </>
                  ) : mShowPnl ? (
                    <>
                      <p className="text-3xl font-bold text-slate-900">{formatCurrency(mMarketValue)}</p>
                      <p className={`text-sm mt-0.5 ${mPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {mPnl >= 0 ? '+' : ''}{formatCurrency(mPnl)} ({mPnlPct >= 0 ? '+' : ''}{mPnlPct.toFixed(2)}%) since purchase
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-3xl font-bold text-slate-900">{formatCurrency(mMarketValue)}</p>
                      <p className={`text-sm mt-0.5 ${mLiveChange >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {mLiveChange >= 0 ? '+' : ''}{mLiveChange.toFixed(2)}% today
                      </p>
                    </>
                  )}
                </div>

                {/* Time filter */}
                <div className="flex gap-1 px-5 mb-2">
                  {[{ id: "D", label: "D" }, { id: "W", label: "W" }, { id: "M", label: "M" }, { id: "ALL", label: "All" }].map(f => (
                    <button
                      key={f.id}
                      onClick={() => setModalTimeFilter(f.id)}
                      className={`px-3 h-9 rounded-full text-sm font-bold transition-all ${modalTimeFilter === f.id
                          ? "bg-slate-700/80 text-white shadow-lg backdrop-blur-md border border-white/20"
                          : "text-slate-400 hover:text-slate-600 hover:bg-slate-200/30"
                        }`}
                      style={modalTimeFilter === f.id ? { boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.1), 0 4px 12px rgba(0,0,0,0.15)' } : {}}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* Chart */}
                <div style={{ width: '100%', height: 230, paddingBottom: 8 }}>
                  {modalChartLoading || mChartData.length === 0 ? (
                    <div style={{ width: '100%', height: 230, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div className="text-slate-400 text-sm">{modalChartLoading ? 'Loading chart...' : 'No data available'}</div>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={230}>
                      <ComposedChart data={mChartData} margin={{ top: 10, right: 55, left: 5, bottom: 30 }}>
                        <defs>
                          <linearGradient id="modalStockGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.4" />
                            <stop offset="50%" stopColor="#a78bfa" stopOpacity="0.2" />
                            <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0.02" />
                          </linearGradient>
                        </defs>
                        <XAxis
                          dataKey="day"
                          axisLine={false}
                          tickLine={false}
                          tickMargin={8}
                          interval={modalTimeFilter === 'D'
                            ? Math.max(0, Math.ceil(mChartData.length / 4) - 1)
                            : mChartData.length <= 8 ? 0 : Math.max(0, Math.ceil(mChartData.length / 6) - 1)}
                          tick={({ x, y, payload }) => {
                            if (!payload.value) return null;
                            const val = String(payload.value);
                            if (modalTimeFilter === 'D' && val.includes('|')) {
                              const [dayPart, timePart] = val.split('|');
                              return (
                                <text x={x} y={y} textAnchor="middle" fill="#64748b" fontSize={10} fontWeight={500}>
                                  <tspan x={x} dy={10}>{dayPart}</tspan>
                                  <tspan x={x} dy={13}>{timePart}</tspan>
                                </text>
                              );
                            }
                            return <text x={x} y={y} dy={12} textAnchor="middle" fill="#64748b" fontSize={11} fontWeight={500}>{payload.value}</text>;
                          }}
                        />
                        <YAxis
                          domain={mAxisConfig.domain}
                          ticks={mAxisConfig.ticks}
                          tickFormatter={formatPnlAxis}
                          tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 500 }}
                          axisLine={false}
                          tickLine={false}
                          width={55}
                        />
                        {mShowPnl && <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="3 3" strokeWidth={1} />}
                        <Tooltip
                          content={({ active, payload, label }) => {
                            if (active && payload && payload.length) {
                              let fullDate = payload[0]?.payload?.fullDate || label;
                              if (typeof fullDate === 'string' && fullDate.includes('|')) fullDate = fullDate.replace('|', ' ');
                              const val = payload[0].value;
                              const isPos = val >= 0;
                              return (
                                <div className="bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg px-3 py-1.5 shadow-md">
                                  <div className="text-xs text-slate-500 mb-0.5">{fullDate}</div>
                                  <div className="text-sm font-bold text-violet-700">
                                    {mShowPnl ? (isPos ? '+' : '-') + 'R' + Math.abs(val).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'R' + val.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          }}
                          cursor={false}
                          wrapperStyle={{ outline: 'none' }}
                        />
                        <Area type="monotone" dataKey="value" stroke="none" fill="url(#modalStockGradient)" fillOpacity={1} />
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke="#7c3aed"
                          strokeWidth={2.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          dot={false}
                          activeDot={{ r: 6, fill: '#7c3aed', stroke: '#c4b5fd', strokeWidth: 2 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Holdings detail row */}
                {mShowPnl && (
                  <div className="mx-5 mb-6 rounded-2xl bg-slate-50 px-4 py-3 flex items-center justify-between">
                    <div className="text-center">
                      <p className="text-[10px] text-slate-400 font-medium mb-0.5">Shares</p>
                      <p className="text-sm font-semibold text-slate-800">{Math.round(mQty)}</p>
                    </div>
                    <div className="w-px h-8 bg-slate-200" />
                    <div className="text-center">
                      <p className="text-[10px] text-slate-400 font-medium mb-0.5">Avg Price</p>
                      <p className="text-sm font-semibold text-slate-800">{formatCurrency(mAvgFill)}</p>
                    </div>
                    <div className="w-px h-8 bg-slate-200" />
                    <div className="text-center">
                      <p className="text-[10px] text-slate-400 font-medium mb-0.5">Cost Basis</p>
                      <p className="text-sm font-semibold text-slate-800">{formatCurrency(mCostBasis)}</p>
                    </div>
                    <div className="w-px h-8 bg-slate-200" />
                    <div className="text-center">
                      <p className="text-[10px] text-slate-400 font-medium mb-0.5">Return</p>
                      <p className={`text-sm font-semibold ${mPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {mPnl >= 0 ? '+' : ''}{formatCurrency(mPnl)}
                      </p>
                    </div>
                  </div>
                )}
              </motion.div>
            </>
          );
        })()}
      </AnimatePresence>

    </div>
  );
};

export default NewPortfolioPage;
