import React, { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "../lib/supabase";
import {
  ArrowDownToLine,
  BadgeCheck,
  FileSignature,
  HandCoins,
  Landmark,
  Info,
  UserPlus,
  TrendingUp,
  ShieldCheck,
  Wallet,
  Send,
  MapPin,
  Receipt,
  Users,
  X,
  LayoutGrid,
  Newspaper,
  Target,
  Plus,
  Calendar,
  ChevronRight,
  Handshake,
  Gift,
  Umbrella,
} from "lucide-react";
import { useProfile } from "../lib/useProfile";
import NavigationPill from "../components/NavigationPill";
import { useRequiredActions } from "../lib/useRequiredActions";
import { useSumsubStatus } from "../lib/useSumsubStatus";
import { parseOnboardingFlags } from "../lib/checkOnboardingComplete";
import { useOnboardingStatus } from "../lib/useOnboardingStatus";
import { useFinancialData, useInvestments } from "../lib/useFinancialData";
import { useRealtimePrices } from "../lib/useRealtimePrices";
import { getHoldingsArray, normalizeSymbol, buildHoldingsBySymbol, getStrategyHoldingsSnapshot } from "../lib/strategyUtils";
import HomeSkeleton from "../components/HomeSkeleton";
import Skeleton from "../components/Skeleton";
import SwipeableBalanceCard from "../components/SwipeableBalanceCard";
import OutstandingActionsSection from "../components/OutstandingActionsSection";
import TransactionHistorySection from "../components/TransactionHistorySection";
import SettlementBadge from "../components/PendingBadge";
import NotificationBell from "../components/NotificationBell";
import FamilyDropdown from "../components/FamilyDropdown";

// Feature flags — set VITE_ENABLE_INSURE=true in Replit Secrets to preview.
// Leave unset in Vercel production to keep the feature hidden from live users.
const INSURE_ENABLED = import.meta.env.VITE_ENABLE_INSURE === "true";

const CARD_VISIBILITY_KEY = "mintBalanceVisible";

const HomePage = ({
  onOpenNotifications,
  onOpenMintBalance,
  onOpenActivity,
  onOpenActions,
  onOpenInstantLiquidity,
  onOpenInvestments,
  onOpenCredit,
  onOpenCreditApply,
  onOpenCreditRepay,
  onOpenInvest,
  onOpenWithdraw,
  onOpenSettings,
  onOpenStrategies,
  onOpenStrategyInPortfolio,
  onOpenMarkets,
  onOpenDeposit,
  onOpenNews,
  onOpenNewsArticle,
  onOpenFamily,
  onOpenInsure,
  onSelectMember,
}) => {
  const { profile, loading } = useProfile();
  const { bankLinked, loading: actionsLoading, refetch: fetchRequiredActions } = useRequiredActions();
  const { kycVerified, kycPending, kycNeedsResubmission } = useSumsubStatus();
  const { balance, investments, transactions, bestAssets, loading: financialLoading, refetch: fetchFinancialData } = useFinancialData();
  const { monthlyChangePercent } = useInvestments();
  const { lastUpdated: pricesLastUpdated } = useRealtimePrices();
  const [bestStrategies, setBestStrategies] = useState([]);
  const [holdingsSecurities, setHoldingsSecurities] = useState([]);
  const [failedLogos, setFailedLogos] = useState({});
  const [showPayModal, setShowPayModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [news, setNews] = useState([]);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [loadingNews, setLoadingNews] = useState(false);
  const [homeTab, setHomeTab] = useState("balance");
  const [userId, setUserId] = useState(null);
  const [localBestAssets, setLocalBestAssets] = useState([]);
  const [hasAnyHoldings, setHasAnyHoldings] = useState(false);
  const { onboardingComplete, loading: onboardingLoading, refetch: fetchOnboardingStatus } = useOnboardingStatus();
  const onboardingChecked = !onboardingLoading;

  const [isCardVisible] = useState(() => {
    if (typeof window !== "undefined") {
      return window.localStorage.getItem(CARD_VISIBILITY_KEY) !== "false";
    }
    return true;
  });

  const [showGoalsModal, setShowGoalsModal] = useState(false);
  const [goals, setGoals] = useState([]);
  const [loadingGoals, setLoadingGoals] = useState(false);
  const [isCreatingGoal, setIsCreatingGoal] = useState(false);
  const [newGoal, setNewGoal] = useState({ name: "", target_amount: "", target_date: "" });
  const [editingGoalId, setEditingGoalId] = useState(null);

  const assetsToDisplay = localBestAssets.length > 0 ? localBestAssets : (bestAssets || []);
  const displayName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  const fetchBestAssets = React.useCallback(async () => {
    if (!profile?.id) return;
    try {
      const { data: holdings, error: holdingsError } = await supabase
        .from('stock_holdings_c')
        .select('id, security_id, strategy_id, quantity, avg_fill, market_value, unrealized_pnl, Status')
        .eq('user_id', profile.id)
        .eq('Status', 'active');

      if (holdingsError) throw holdingsError;

      const directHoldings = (holdings || []).filter(h => !h.strategy_id && h.security_id);
      const strategyHoldings = (holdings || []).filter(h => h.strategy_id);

      if (holdings && holdings.length > 0) setHasAnyHoldings(true);

      if (directHoldings.length > 0) {
        const holdings = directHoldings;
        const securityIds = holdings.map(h => h.security_id).filter(Boolean);
        let securitiesMap = {};
        if (securityIds.length > 0) {
          const { data: secData } = await supabase
            .from('securities_c')
            .select('id, symbol, name, logo_url, last_price, change_percent')
            .in('id', securityIds);
          (secData || []).forEach(s => { securitiesMap[s.id] = s; });
        }

        const formatted = holdings
          .filter(h => securitiesMap[h.security_id])
          .map(h => {
            const sec = securitiesMap[h.security_id];
            const qty = Number(h.quantity || 0);
            const avgFill = Number(h.avg_fill || 0);
            const isPending = !avgFill || avgFill === 0;
            if (isPending) {
              return {
                symbol: sec.symbol,
                name: sec.name,
                logo: sec.logo_url,
                value: 0,
                change: 0,
                pnlRands: 0,
                pnlPct: 0,
                isPending: true,
              };
            }
            // last_price is in rands; avg_fill is in cents — normalize live price to cents.
            const livePriceCents = sec.last_price != null
              ? Math.round(Number(sec.last_price) * 100)
              : avgFill;
            const marketVal = (livePriceCents * qty) / 100;
            const costBasis = (avgFill * qty) / 100;
            const pnlRands = marketVal - costBasis;
            const pnlPct = costBasis > 0 ? ((pnlRands / costBasis) * 100) : 0;
            return {
              symbol: sec.symbol,
              name: sec.name,
              logo: sec.logo_url,
              value: marketVal,
              change: Number(sec.change_percent) || 0,
              pnlRands,
              pnlPct,
            };
          });

        const profitable = formatted.filter(a => !a.isPending && a.pnlPct > 0).sort((a, b) => b.pnlPct - a.pnlPct);
        const pending = formatted.filter(a => a.isPending);
        const sorted = [...profitable, ...pending].slice(0, 5);
        setLocalBestAssets(sorted);
        return;
      }

      // No direct holdings — rank the underlying securities inside the user's strategy investments.
      if (strategyHoldings.length > 0) {
        const securityIds = [...new Set(strategyHoldings.map(h => h.security_id).filter(Boolean))];
        if (securityIds.length > 0) {
          const { data: secData } = await supabase
            .from('securities_c')
            .select('id, symbol, name, logo_url, last_price, change_percent')
            .in('id', securityIds);
          const secMap = Object.fromEntries((secData || []).map(s => [s.id, s]));

          const formatted = strategyHoldings
            .filter(h => secMap[h.security_id])
            .map(h => {
              const sec = secMap[h.security_id];
              const qty = Number(h.quantity || 0);
              const avgFill = Number(h.avg_fill || 0);
              const livePriceCents = sec.last_price != null
                ? Math.round(Number(sec.last_price) * 100)
                : avgFill;
              const marketVal = (livePriceCents * qty) / 100;
              const costBasis = (avgFill * qty) / 100;
              const pnlRands = marketVal - costBasis;
              const pnlPct = costBasis > 0 ? ((pnlRands / costBasis) * 100) : 0;
              return {
                symbol: sec.symbol,
                name: sec.name,
                logo: sec.logo_url,
                value: marketVal,
                change: Number(sec.change_percent) || 0,
                pnlRands,
                pnlPct,
                isPending: !avgFill,
              };
            });

          const profitable = formatted.filter(a => !a.isPending && a.pnlPct > 0).sort((a, b) => b.pnlPct - a.pnlPct);
          const ranked = profitable.slice(0, 5);
          if (ranked.length > 0) {
            setLocalBestAssets(ranked);
            return;
          }
        }
      }

      const { data: allocData, error: allocError } = await supabase
        .from('allocations')
        .select('value, security_id')
        .eq('user_id', profile.id)
        .order('value', { ascending: false })
        .limit(5);

      if (allocError) throw allocError;

      if (allocData && allocData.length > 0) {
        const securityIds = allocData.map(item => item.security_id).filter(Boolean);
        let securitiesMap = {};
        if (securityIds.length > 0) {
          const { data: secData } = await supabase
            .from('securities_c')
            .select('id, symbol, name, logo_url, change_percent')
            .in('id', securityIds);
          (secData || []).forEach(s => { securitiesMap[s.id] = s; });
        }

        const formatted = allocData
          .filter(item => securitiesMap[item.security_id])
          .map(item => {
            const sec = securitiesMap[item.security_id];
            return {
              symbol: sec.symbol,
              name: sec.name,
              logo: sec.logo_url,
              value: item.value,
              change: Number(sec.change_percent) || 0,
            };
          });

        setLocalBestAssets(formatted);
      }
    } catch (e) {
      console.error("Asset fetch error:", e.message);
    }
  }, [profile?.id]);

  const fetchGoals = React.useCallback(async () => {
    if (!profile?.id) return;
    setLoadingGoals(true);
    try {
      let { data, error } = await supabase
        .from('investment_goals')
        .select('id, name, target_amount, current_amount, is_active, target_date')
        .eq('user_id', profile.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setGoals(data || []);
    } catch (e) {
      console.error("Goal fetch error:", e.message);
    } finally {
      setLoadingGoals(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    const getUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) setUserId(session.user.id);
    };
    getUser();
  }, []);

  useEffect(() => {
    if (!profile?.id || profile?.mintNumber) return;

    const ensureMintNumber = async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess?.session?.access_token;
        if (!token) return;

        const resp = await fetch('/api/user/ensure-mint-number', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.ok) {
          const result = await resp.json();
        }
      } catch (err) { }
    };
    ensureMintNumber();
  }, [profile?.id, profile?.mintNumber]);

  useEffect(() => {
    if (!profile?.id) return;

    const homeSubscription = supabase
      .channel('home_realtime_updates')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'investment_goals',
        filter: `user_id=eq.${profile.id}`
      }, () => fetchGoals())
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'transactions',
        filter: `user_id=eq.${profile.id}`
      }, () => {
        fetchBestAssets();
        if (typeof fetchFinancialData === 'function') fetchFinancialData();
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'required_actions',
        filter: `user_id=eq.${profile.id}`
      }, () => {
        if (typeof fetchRequiredActions === 'function') fetchRequiredActions();
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'user_onboarding',
        filter: `user_id=eq.${profile.id}`
      }, () => {
        fetchOnboardingStatus();
      })
      .subscribe();

    fetchBestAssets();
    fetchGoals();

    return () => {
      supabase.removeChannel(homeSubscription);
    };
  }, [profile?.id, fetchBestAssets, fetchGoals, fetchFinancialData, fetchRequiredActions, fetchOnboardingStatus]);

  useEffect(() => {
    if (pricesLastUpdated && profile?.id) {
      fetchBestAssets();
      if (typeof fetchFinancialData === 'function') fetchFinancialData();
    }
  }, [pricesLastUpdated]);

  useEffect(() => {
    if (showGoalsModal && profile?.id) {
      fetchGoals();
    }
  }, [showGoalsModal, profile?.id, fetchGoals]);

  useEffect(() => {
    const fetchStrategies = async () => {
      try {
        if (!profile?.id) return;

        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) {
          setBestStrategies([]);
          return;
        }

        const res = await fetch("/api/user/strategies", {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          console.error("[HomePage] Failed to fetch user strategies:", res.status);
          setBestStrategies([]);
          return;
        }

        const json = await res.json();
        const serverStrategies = json.strategies || [];

        if (serverStrategies.length === 0) {
          setBestStrategies([]);
          return;
        }

        const formatted = serverStrategies.map((s) => {
          const invested = s.investedAmount || 0;
          const currentValue = s.currentMarketValue != null ? Number(s.currentMarketValue.toFixed(2)) : invested;
          const isPending = invested === 0 && currentValue === 0;
          const stratPnlRands = currentValue - invested;
          const changePctVal = invested > 0 ? (stratPnlRands / invested) * 100 : 0;
          const stratPnlPct = changePctVal;
          return {
            id: s.id,
            name: s.name,
            short_name: s.shortName,
            description: s.description,
            risk_level: s.riskLevel,
            sector: s.sector,
            icon_url: s.iconUrl,
            image_url: s.imageUrl,
            holdings: s.holdings || [],
            investedAmount: invested,
            currentValue,
            isPending,
            change_pct: changePctVal,
            pnlRands: stratPnlRands,
            pnlPct: stratPnlPct,
            strategy_metrics: s.metrics ? [s.metrics] : [],
          };
        });

        const sorted = formatted
          .sort((a, b) => (b.change_pct || 0) - (a.change_pct || 0))
          .slice(0, 5);
        setBestStrategies(sorted);
      } catch (error) {
        console.error("Failed to load strategies", error);
        setBestStrategies([]);
      }
    };
    fetchStrategies();
  }, [profile?.id, pricesLastUpdated]);

  const holdingsBySymbol = useMemo(() => buildHoldingsBySymbol(holdingsSecurities), [holdingsSecurities]);

  useEffect(() => {
    const fetchHoldingsSecurities = async () => {
      if (!supabase || bestStrategies.length === 0) return;

      try {
        const allTickers = [...new Set(
          bestStrategies.flatMap((strategy) =>
            getHoldingsArray(strategy).flatMap((h) => {
              const rawSymbol = h.ticker || h.symbol || h;
              const normalizedSym = normalizeSymbol(rawSymbol);
              return normalizedSym && normalizedSym !== rawSymbol
                ? [rawSymbol, normalizedSym]
                : [rawSymbol];
            })
          )
        )];

        if (allTickers.length === 0) return;

        const chunkSize = 50;
        const chunks = [];
        for (let i = 0; i < allTickers.length; i += chunkSize) {
          chunks.push(allTickers.slice(i, i + chunkSize));
        }

        const results = await Promise.all(
          chunks.map((symbols) =>
            supabase
              .from("securities_c")
              .select("id, symbol, logo_url, name")
              .in("symbol", symbols)
          )
        );

        const merged = [];
        results.forEach(({ data, error }) => {
          if (error) {
            console.error("Error fetching holdings securities chunk:", error);
            return;
          }
          if (data?.length) merged.push(...data);
        });

        if (merged.length) {
          setHoldingsSecurities(merged);
        }
      } catch (error) {
        console.error("Error fetching holdings securities:", error);
      }
    };

    fetchHoldingsSecurities();
  }, [bestStrategies]);

  useEffect(() => {
    const fetchNews = async () => {
      setLoadingNews(true);
      try {
        const { data, error } = await supabase
          .from('News_articles')
          .select('id, title, source, published_at, body_text')
          .order('published_at', { ascending: false })
          .limit(3);
        if (error) throw error;
        setNews(data || []);
      } catch (err) {
        console.error("News error:", err.message);
      } finally {
        setLoadingNews(false);
      }
    };
    fetchNews();
  }, []);

  const handleEditClick = (goal) => {
    setNewGoal({
      name: goal.name,
      target_amount: goal.target_amount,
      target_date: goal.target_date || ""
    });
    setEditingGoalId(goal.id);
    setIsCreatingGoal(true);
    setShowGoalsModal(true);
  };

  const handleUpdateGoal = async (e) => {
    e.preventDefault();
    if (!editingGoalId) return;
    setLoadingGoals(true);
    try {
      const updatePayload = {
        name: newGoal.name,
        target_amount: parseFloat(newGoal.target_amount),
      };
      if (newGoal.target_date) {
        updatePayload.target_date = newGoal.target_date;
      }
      const { error } = await supabase
        .from('investment_goals')
        .update(updatePayload)
        .eq('id', editingGoalId);
      if (error) throw error;
      setEditingGoalId(null);
      setIsCreatingGoal(false);
      setNewGoal({ name: "", target_amount: "", target_date: "" });
      fetchGoals();
    } catch (error) { console.error("Update error:", error.message); }
    finally { setLoadingGoals(false); }
  };

  const handleCreateGoal = async (e) => {
    e.preventDefault();
    if (!newGoal.name || !newGoal.target_amount) return;

    setLoadingGoals(true);
    try {
      const { error } = await supabase.from('investment_goals').insert({
        user_id: profile.id,
        name: newGoal.name,
        target_amount: parseFloat(newGoal.target_amount),
        target_date: newGoal.target_date || null,
        current_amount: 0
      });

      if (error) throw error;

      setNewGoal({ name: "", target_amount: "", target_date: "" });
      setIsCreatingGoal(false);
      fetchGoals();
    } catch (error) {
      console.error("Error creating goal:", error);
    } finally {
      setLoadingGoals(false);
    }
  };

  const handleDeleteGoal = async (goalId) => {
    if (!window.confirm("Are you sure you want to delete this goal?")) return;
    setLoadingGoals(true);
    try {
      const { error } = await supabase.from('investment_goals').delete().eq('id', goalId);
      if (error) throw error;
      setEditingGoalId(null);
      setIsCreatingGoal(false);
      setNewGoal({ name: "", target_amount: "", target_date: "" });
      fetchGoals();
    } catch (error) { console.error("Delete error:", error.message); }
    finally { setLoadingGoals(false); }
  };

  if (loading || financialLoading) {
    return <HomeSkeleton />;
  }

  const handleMintBalancePress = () => {
    if (onOpenMintBalance) {
      onOpenMintBalance();
    }
  };

  const identityFullyComplete = onboardingComplete || (kycVerified && onboardingComplete);

  const getIdentityStatusForHome = () => {
    if (identityFullyComplete) return { text: "Verified", style: "bg-green-100 text-green-600" };
    if (kycNeedsResubmission) return { text: "Documents Required", style: "bg-amber-100 text-amber-700" };
    if (kycPending) return { text: "Under Review", style: "bg-blue-100 text-blue-600" };
    if (kycVerified && !onboardingComplete) return { text: "Continue Onboarding", style: "bg-blue-100 text-blue-600" };
    return { text: "Action Required", style: "bg-red-50 text-red-600" };
  };

  const identityStatusHome = getIdentityStatusForHome();

  const getIdentityDescription = () => {
    if (identityFullyComplete) return "Identity and onboarding complete";
    if (kycNeedsResubmission) return "Some documents need to be submitted or resubmitted";
    if (kycPending) return "Your documents are being reviewed";
    if (kycVerified && !onboardingComplete) return "Identity verified — complete remaining onboarding steps";
    return "Verify your identity to get started";
  };

  const actionsData = [
    {
      id: "onboarding",
      title: "Complete onboarding",
      description: getIdentityDescription(),
      priority: 1,
      status: identityStatusHome.text,
      statusStyle: identityStatusHome.style,
      icon: ShieldCheck,
      routeName: "actions",
      isComplete: identityFullyComplete,
    },
  ];

  const outstandingActions = actionsData.filter((action) => !action.isComplete);

  const transactionHistory = transactions.slice(0, 3).map((t) => ({
    title: t.name || t.description || "Transaction",
    date: formatDate(t.transaction_date || t.created_at),
    amount: formatAmount((t.amount || 0) / 100, t.direction),
    direction: t.direction,
    status: t.status,
    settlement_status: t.settlement_status || null,
    description: t.description,
    logo_url: t.logo_url,
    holding_logos: t.holding_logos || [],
  }));

  const handleActionNavigation = (action) => {
    const routes = {
      investments: onOpenInvestments,
      credit: onOpenCredit,
      settings: onOpenSettings,
      actions: onOpenActions,
    };

    const handler = routes[action.routeName];
    if (handler) {
      handler();
    }
  };

  const hasProfitableAssets = assetsToDisplay.length > 0;
  const hasInvestments = hasAnyHoldings || assetsToDisplay.length > 0;
  const hasStrategies = bestStrategies && bestStrategies.length > 0;

  return (
    <div
      className="min-h-screen pb-[env(safe-area-inset-bottom)] text-slate-900 relative overflow-x-hidden"
      style={{
        backgroundColor: '#f8f6fa',
        backgroundImage: 'linear-gradient(180deg, #0d0d12 0%, #0e0a14 0.5%, #100b18 1%, #120c1c 1.5%, #150e22 2%, #181028 2.5%, #1c122f 3%, #201436 3.5%, #25173e 4%, #2a1a46 5%, #301d4f 6%, #362158 7%, #3d2561 8%, #44296b 9%, #4c2e75 10%, #54337f 11%, #5d3889 12%, #663e93 13%, #70449d 14%, #7a4aa7 15%, #8451b0 16%, #8e58b9 17%, #9860c1 18%, #a268c8 19%, #ac71ce 20%, #b57ad3 21%, #be84d8 22%, #c68edc 23%, #cd98e0 24%, #d4a2e3 25%, #daace6 26%, #dfb6e9 27%, #e4c0eb 28%, #e8c9ed 29%, #ecd2ef 30%, #efdaf1 31%, #f2e1f3 32%, #f4e7f5 33%, #f6ecf7 34%, #f8f0f9 35%, #f9f3fa 36%, #faf5fb 38%, #fbf7fc 40%, #fcf9fd 42%, #fdfafd 45%, #faf8fc 55%, #f8f6fa 100%)',
        backgroundRepeat: 'no-repeat',
        backgroundSize: '100% 100vh',
      }}
    >

      <div className="rounded-b-[36px] bg-transparent px-4 pb-12 pt-12 text-white md:px-8">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-6 md:max-w-md">
          <header className="relative flex items-center justify-between text-white">
            <FamilyDropdown
              profile={profile}
              userId={userId}
              initials={initials}
              avatarUrl={profile.avatarUrl}
              onOpenFamily={onOpenFamily}
              onSelectMember={onSelectMember}
            />

            <NavigationPill
              activeTab="home"
              onTabChange={(id) => {
                if (id === "credit") {
                  onOpenCredit();
                } else if (id === "home") {
                  setHomeTab("invest");
                }
              }}
            />

            <NotificationBell onClick={onOpenNotifications} />
          </header>


          {homeTab === "balance" || homeTab === "invest" ? (
            <div className="relative select-none">
              <div className="relative w-full touch-pan-y h-auto">
                <div className="relative h-auto rounded-[28px] border border-white/10">
                  <SwipeableBalanceCard
                    userId={userId}
                    isBackFacing
                    forceVisible={isCardVisible}
                    mintNumber={profile.mintNumber}
                  />
                </div>
              </div>
            </div>
          ) : (
            <SwipeableBalanceCard userId={userId} mintNumber={profile.mintNumber} />
          )}
        </div>
      </div>

      <div className="mx-auto -mt-10 flex w-full max-w-sm flex-col gap-6 px-4 pb-10 md:max-w-md md:px-8">
        <section className="flex flex-col gap-3">
          {/* Row 1 — primary actions */}
          <div className="grid grid-cols-4 gap-2 text-[11px] font-medium">
            {[
              { label: "Invest", icon: LayoutGrid, onClick: onOpenStrategies || onOpenInvest },
              { label: "Deposit", icon: ArrowDownToLine, onClick: onOpenDeposit },
              { label: "News", icon: Newspaper, onClick: () => (onOpenNews ? onOpenNews("news") : (onOpenInvest && onOpenInvest("news"))) },
              { label: "Goals", icon: Target, onClick: () => setShowGoalsModal(true) },
            ].map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={index}
                  className="flex flex-col items-center gap-2 rounded-2xl bg-white px-1 py-3 text-slate-700 shadow-md transition-all active:scale-95 active:shadow-sm"
                  type="button"
                  onClick={item.onClick}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-50 text-violet-700">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="text-center leading-tight">{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Row 2 — service hub */}
          <div className="grid grid-cols-4 gap-2 text-[11px] font-medium">
            {[
              { label: "Family", icon: Users, onClick: onOpenFamily, comingSoon: false },
              { label: "Stokvel", icon: Handshake, onClick: null, comingSoon: true },
              { label: "Insure", icon: Umbrella, onClick: INSURE_ENABLED ? onOpenInsure : null, comingSoon: !INSURE_ENABLED },
              { label: "Rewards", icon: Gift, onClick: null, comingSoon: true },
            ].map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={index}
                  disabled={item.comingSoon}
                  onClick={item.onClick}
                  className={`relative flex flex-col items-center gap-2 rounded-2xl px-1 py-3 transition-all ${
                    item.comingSoon
                      ? "bg-slate-100/70 cursor-not-allowed border border-slate-200/60"
                      : "bg-white shadow-md active:scale-95 active:shadow-sm"
                  }`}
                >
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full ${
                    item.comingSoon ? "bg-slate-200 text-slate-400" : "bg-violet-50 text-violet-700"
                  }`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className={`text-center leading-tight font-medium ${item.comingSoon ? "text-slate-400" : "text-slate-700"}`}>
                    {item.label}
                  </span>
                  {item.comingSoon && (
                    <span
                      className="absolute bottom-1.5 left-1/2 -translate-x-1/2 inline-flex items-center px-1.5 py-px rounded-full text-[7px] font-bold uppercase tracking-wider text-white"
                      style={{
                        background: "linear-gradient(135deg, #6d28d9 0%, #8b5cf6 100%)",
                        boxShadow: "0 1px 4px rgba(109,40,217,0.3)",
                      }}
                    >
                      Soon
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {onboardingChecked && outstandingActions.length > 0 ? (
          <OutstandingActionsSection
            actions={outstandingActions}
            onViewAll={onOpenActions}
            onSelectAction={handleActionNavigation}
          />
        ) : null}

        {/* Market Insights */}
        <section className="rounded-3xl bg-white shadow-[0_2px_16px_-2px_rgba(0,0,0,0.08)] overflow-hidden">
          <div className="flex items-end justify-between px-5 py-4 border-b border-slate-100">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">
                Market Insights
              </p>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 text-slate-500 bg-slate-50">
                  <Newspaper className="h-2.5 w-2.5" />
                </span>
                <span>Latest updates for your portfolio</span>
              </div>
            </div>
            <button
              onClick={() => onOpenNews && onOpenNews()}
              className="mb-1 text-xs font-semibold text-violet-600 active:opacity-70 transition-colors"
            >
              View all
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {news.length > 0 ? (
              news.slice(0, 4).map((item) => (
                <button
                  key={item.id}
                  onClick={() => onOpenNewsArticle && onOpenNewsArticle(item.id)}
                  className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors active:bg-slate-50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-violet-600 bg-violet-50 px-2 py-0.5 rounded-md">
                        {item.source || 'Market'}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {formatDate(item.published_at)}
                      </span>
                    </div>
                    <p className="text-[13px] font-semibold text-slate-900 line-clamp-2 leading-snug">
                      {item.title}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
                </button>
              ))
            ) : !loadingNews && (
              <div className="p-6 text-center">
                <p className="text-xs text-slate-400">No recent insights available.</p>
              </div>
            )}

            {loadingNews && (
              <div className="divide-y divide-slate-100">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="px-5 py-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-14 rounded-full" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Investment Goals */}
        <section className="rounded-3xl bg-white shadow-[0_2px_16px_-2px_rgba(0,0,0,0.08)] overflow-hidden">
          <div className="flex items-end justify-between px-5 py-4 border-b border-slate-100">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">
                Investment Goals
              </p>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 text-slate-500 bg-slate-50">
                  <Target className="h-2.5 w-2.5" />
                </span>
                <span>Track your long-term wealth</span>
              </div>
            </div>
            <button
              onClick={() => setShowGoalsModal(true)}
              className="mb-1 text-xs font-semibold text-violet-600 active:opacity-70 transition-colors"
            >
              Manage
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {loadingGoals ? (
              <div className="divide-y divide-slate-100">
                {[0, 1].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-4">
                    <Skeleton className="h-10 w-10 rounded-2xl" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-1.5 w-full rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : goals.length > 0 ? (
              goals.map((goal) => {
                const invested = goal.current_amount || 0;
                const target = goal.target_amount || 0;
                const progress = target > 0 ? Math.min(100, (invested / target) * 100) : 0;
                return (
                  <button
                    key={goal.id}
                    type="button"
                    onClick={() => handleEditClick(goal)}
                    className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors active:bg-slate-50"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-50 text-violet-600 flex-shrink-0">
                      <Target className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-semibold text-slate-900 truncate">{goal.name}</p>
                        <p className="text-xs font-semibold text-slate-600 ml-2 flex-shrink-0">
                          {Math.round(progress)}%
                        </p>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden mb-1">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-600 transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <p className="text-[10px] text-slate-400">
                            R{Number(invested).toLocaleString()} of R{Number(target).toLocaleString()}
                          </p>
                          {goal.target_date && !isNaN(new Date(goal.target_date).getTime()) && (
                            <p className="text-[10px] text-slate-400">
                              • {new Date(goal.target_date).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                            </p>
                          )}
                        </div>
                        {goal.linked_asset_name && (
                          <p className="text-[10px] text-violet-500 truncate ml-2">
                            {goal.linked_asset_name}
                          </p>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
                  </button>
                );
              })
            ) : (
              <div className="p-10 text-center">
                <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-violet-50 text-violet-600 mb-4">
                  <Target className="h-8 w-8" />
                </div>
                <p className="text-sm font-semibold text-slate-900 mb-1">No goals yet</p>
                <p className="text-xs text-slate-500 mb-6">Set investment goals to track your progress</p>
                <button
                  type="button"
                  onClick={() => setShowGoalsModal(true)}
                  className="inline-flex items-center justify-center rounded-full bg-slate-900 px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-white shadow-lg shadow-slate-900/20 transition hover:-translate-y-0.5"
                >
                  Create Goal
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Best Performing Assets */}
        <section>
          <div className="flex items-end justify-between px-5 mb-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">
                Your best performing assets
              </p>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 text-slate-500">
                  <Info className="h-3 w-3" />
                </span>
                <span>Based on your investment portfolio</span>
              </div>
            </div>
            {hasInvestments && (
              <button
                onClick={onOpenInvestments}
                className="mb-1 text-xs font-semibold text-violet-600 active:opacity-70 transition-colors"
              >
                View all
              </button>
            )}
          </div>

          {hasProfitableAssets ? (
            <div className="flex gap-3 overflow-x-auto pb-1 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {assetsToDisplay.slice(0, 5).map((asset) => (
                <div
                  key={asset.symbol}
                  className="flex min-w-[260px] flex-1 snap-start items-center gap-4 rounded-3xl bg-white p-4 shadow-md"
                >
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
                    {failedLogos[asset.symbol] || !asset.logo ? (
                      <span className="text-sm font-semibold text-slate-600">
                        {asset.symbol}
                      </span>
                    ) : (
                      <img
                        src={asset.logo}
                        alt={asset.name}
                        className="h-10 w-10 object-contain"
                        referrerPolicy="no-referrer"
                        crossOrigin="anonymous"
                        onError={() =>
                          setFailedLogos((prev) => ({ ...prev, [asset.symbol]: true }))
                        }
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold text-slate-900">{asset.symbol}</p>
                      {asset.isPending && <SettlementBadge status="pending" size="xs" />}
                    </div>
                    <p className="text-xs text-slate-500 line-clamp-1">{asset.name}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {asset.isPending ? (
                      <p className="text-xs text-slate-400">Awaiting fill</p>
                    ) : asset.pnlRands != null ? (
                      <>
                        <p className={`text-sm font-semibold ${asset.pnlRands >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {asset.pnlRands >= 0 ? '+' : ''}R{Math.abs(asset.pnlRands).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                        <p className={`text-xs font-semibold ${asset.pnlPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                          ({asset.pnlPct >= 0 ? '+' : ''}{asset.pnlPct.toFixed(2)}%)
                        </p>
                      </>
                    ) : (
                      <p className={`text-sm font-semibold ${asset.change >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {asset.change >= 0 ? '+' : ''}{typeof asset.change === 'number' ? asset.change.toFixed(2) : (asset.change || '0.00')}%
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-3xl bg-white p-6 shadow-md text-center">
              <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-violet-50 text-violet-600 mb-4">
                <TrendingUp className="h-8 w-8" />
              </div>
              {hasInvestments ? (
                <>
                  <p className="text-sm font-semibold text-slate-900 mb-1">No profitable assets yet</p>
                  <p className="text-xs text-slate-500">Your best performers will appear here once any of your assets are in profit.</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-slate-900 mb-1">No investments yet</p>
                  <p className="text-xs text-slate-500 mb-4">Start investing to see your best performing assets here</p>
                  <button
                    type="button"
                    onClick={() => onOpenInvest && onOpenInvest("invest")}
                    className="inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-white shadow-lg shadow-slate-900/20 transition hover:-translate-y-0.5"
                  >
                    Make your first investment
                  </button>
                </>
              )}
            </div>
          )}
        </section>

        {/* Best Performing Strategies */}
        <section>
          <div className="flex items-end justify-between px-5 mb-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">
                Your best performing strategies
              </p>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 text-slate-500">
                  <LayoutGrid className="h-3 w-3" />
                </span>
                <span>Top performing curated portfolios</span>
              </div>
            </div>
            {hasStrategies && (
              <button
                onClick={onOpenStrategies}
                className="mb-1 text-xs font-semibold text-violet-600 active:opacity-70 transition-colors"
              >
                View all
              </button>
            )}
          </div>

          {hasStrategies ? (
            <div className="flex gap-3 overflow-x-auto pb-1 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {bestStrategies.slice(0, 5).map((strategy) => {
                const holdingsSnapshot = getStrategyHoldingsSnapshot(strategy, holdingsBySymbol);
                const pct = strategy.change_pct || 0;
                return (
                  <button
                    key={strategy.id}
                    type="button"
                    onClick={() => onOpenStrategyInPortfolio ? onOpenStrategyInPortfolio(strategy.id) : onOpenStrategies && onOpenStrategies(strategy)}
                    className="flex-shrink-0 w-[280px] snap-start rounded-3xl border border-slate-100/80 bg-white/90 backdrop-blur-sm p-4 text-left shadow-[0_2px_16px_-2px_rgba(0,0,0,0.08)] transition-all active:scale-[0.97]"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 flex items-start justify-between gap-4">
                        <div className="text-left space-y-1 min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{strategy.name}</p>
                          <p className="text-xs text-slate-600 line-clamp-1">
                            {strategy.risk_level || 'Balanced'}{strategy.objective ? ` • ${strategy.objective}` : ''}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          {strategy.isPending ? (
                            <SettlementBadge status="pending" size="sm" />
                          ) : (
                            <>
                              <p className="text-sm font-semibold text-slate-900">
                                {strategy.currentValue ? `R${strategy.currentValue.toFixed(2)}` : strategy.investedAmount ? `R${strategy.investedAmount.toFixed(2)}` : '—'}
                              </p>
                              {strategy.pnlRands != null && strategy.investedAmount > 0 ? (
                                <p className={`text-xs font-semibold ${strategy.pnlRands >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {strategy.pnlRands >= 0 ? '+' : ''}R{Math.abs(strategy.pnlRands).toFixed(2)} ({strategy.pnlPct >= 0 ? '+' : ''}{strategy.pnlPct.toFixed(2)}%)
                                </p>
                              ) : (
                                <p className={`text-xs font-semibold ${pct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      {strategy.risk_level && (
                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">{strategy.risk_level}</span>
                      )}
                      {holdingsSnapshot.length > 0 && (
                        <div className="flex items-center gap-2">
                          <div className="flex -space-x-2">
                            {holdingsSnapshot.slice(0, 3).map((h) => (
                              <div
                                key={`${strategy.id}-${h.id || h.symbol}-snap`}
                                className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-white bg-white shadow-sm"
                              >
                                {h.logo_url ? (
                                  <img src={h.logo_url} alt={h.name} className="h-full w-full object-cover" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center bg-slate-100 text-[8px] font-bold text-slate-600">
                                    {h.symbol?.substring(0, 2)}
                                  </div>
                                )}
                              </div>
                            ))}
                            {holdingsSnapshot.length > 3 && (
                              <div className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-500">
                                +{holdingsSnapshot.length - 3}
                              </div>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400">Holdings</span>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-3xl bg-white p-6 shadow-md text-center">
              <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-slate-50 text-slate-400 mb-4">
                <LayoutGrid className="h-8 w-8" />
              </div>
              <p className="text-sm font-semibold text-slate-900 mb-1">Invest in your first strategy</p>
              <p className="text-xs text-slate-500 mb-4">Explore our curated investment portfolios</p>
              <button
                type="button"
                onClick={onOpenStrategies}
                className="inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-white shadow-lg shadow-slate-900/20 transition hover:-translate-y-0.5"
              >
                Browse Strategies
              </button>
            </div>
          )}
        </section>

        {transactionHistory.length > 0 ? (
          <TransactionHistorySection items={transactionHistory} onViewAll={onOpenActivity} />
        ) : (
          <section className="rounded-3xl bg-white p-5 shadow-md">
            <p className="text-sm font-semibold text-slate-900 mb-3">Recent Activity</p>
            <div className="text-center py-4">
              <p className="text-xs text-slate-500">No transactions yet</p>
              <p className="text-xs text-slate-400 mt-1">Your activity will appear here</p>
            </div>
          </section>
        )}
      </div>

      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4">
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default"
            aria-label="Close modal"
            onClick={() => setShowPayModal(false)}
          />
          <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-[32px] bg-white shadow-2xl">
            <div className="flex items-center justify-center pt-3">
              <div className="h-1.5 w-12 rounded-full bg-slate-200" />
            </div>
            <div className="p-6">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">Pay</h2>
                <button
                  type="button"
                  onClick={() => setShowPayModal(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3">
                <button
                  type="button"
                  disabled
                  className="flex w-full cursor-not-allowed items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left opacity-60"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-purple-600 text-white">
                    <Send className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-900">Coming soon</p>
                    <p className="text-xs text-slate-500">Transfers are not available yet</p>
                  </div>
                </button>
                <button
                  type="button"
                  disabled
                  className="flex w-full cursor-not-allowed items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left opacity-60"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-emerald-600 to-teal-600 text-white">
                    <MapPin className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-900">Coming soon</p>
                    <p className="text-xs text-slate-500">GeoPay is not available yet</p>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showReceiveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4">
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default"
            aria-label="Close modal"
            onClick={() => setShowReceiveModal(false)}
          />
          <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-[32px] bg-white shadow-2xl">
            <div className="flex items-center justify-center pt-3">
              <div className="h-1.5 w-12 rounded-full bg-slate-200" />
            </div>
            <div className="p-6">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">Receive</h2>
                <button
                  type="button"
                  onClick={() => setShowReceiveModal(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3">
                <button
                  type="button"
                  disabled
                  className="flex w-full cursor-not-allowed items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left opacity-60"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-white">
                    <Receipt className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-900">Coming soon</p>
                    <p className="text-xs text-slate-500">Requests are not available yet</p>
                  </div>
                </button>
                <button
                  type="button"
                  disabled
                  className="flex w-full cursor-not-allowed items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left opacity-60"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-amber-600 to-orange-600 text-white">
                    <Users className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-900">Coming soon</p>
                    <p className="text-xs text-slate-500">Bill split is not available yet</p>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showGoalsModal && (
        <div className="fixed inset-0 z-[950] flex items-end justify-center bg-slate-900/60 px-4 pb-20 sm:items-center sm:pb-0">
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default backdrop-blur-sm"
            aria-label="Close modal"
            onClick={() => {
              setShowGoalsModal(false);
              setIsCreatingGoal(false);
              setEditingGoalId(null);
            }}
          />
          <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-[32px] bg-white shadow-2xl animate-in slide-in-from-bottom duration-300">
            <div className="flex items-center justify-center pt-3">
              <div className="h-1.5 w-12 rounded-full bg-slate-200" />
            </div>
            <div className="p-6">
              <header className="mb-6 flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900">
                  {editingGoalId ? "Edit Goal" : (isCreatingGoal || goals.length === 0) ? "New Goal" : "Your Goals"}
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setShowGoalsModal(false);
                    setIsCreatingGoal(false);
                    setEditingGoalId(null);
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-50 text-slate-400"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </header>

              <div className="max-h-[60vh] overflow-y-auto pr-1">
                {loadingGoals ? (
                  <div className="space-y-4">
                    {[0, 1].map((i) => (
                      <div key={i} className="rounded-2xl border border-slate-100 p-4 space-y-3">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-48" />
                        <Skeleton className="h-2 w-full rounded-full" />
                      </div>
                    ))}
                  </div>
                ) : isCreatingGoal || editingGoalId || goals.length === 0 ? (
                  <form onSubmit={editingGoalId ? handleUpdateGoal : handleCreateGoal} className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Goal Name</label>
                      <input
                        type="text"
                        placeholder="e.g. New Car, Holiday"
                        value={newGoal.name}
                        onChange={(e) => setNewGoal(prev => ({ ...prev, name: e.target.value }))}
                        className="w-full rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-semibold focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Target Amount (R)</label>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={newGoal.target_amount}
                        onChange={(e) => setNewGoal(prev => ({ ...prev, target_amount: e.target.value }))}
                        className="w-full rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-semibold focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Target Date (Optional)</label>
                      <input
                        type="date"
                        value={newGoal.target_date}
                        onChange={(e) => setNewGoal(prev => ({ ...prev, target_date: e.target.value }))}
                        className="w-full rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-semibold focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                      />
                    </div>
                    <div className="flex flex-col gap-3 pt-2">
                      <button
                        type="submit"
                        disabled={loadingGoals}
                        className="w-full rounded-2xl bg-[#31005e] py-4 font-bold uppercase tracking-widest text-white shadow-lg transition-active active:scale-95"
                      >
                        {editingGoalId ? "Update Goal" : "Save Goal"}
                      </button>
                      {editingGoalId && (
                        <button
                          type="button"
                          onClick={() => handleDeleteGoal(editingGoalId)}
                          className="w-full rounded-2xl bg-rose-50 py-4 text-xs font-bold uppercase tracking-widest text-rose-600 transition-active active:scale-95"
                        >
                          Delete Goal
                        </button>
                      )}
                      {goals.length > 0 && !editingGoalId && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsCreatingGoal(false);
                            setNewGoal({ name: "", target_amount: "", target_date: "" });
                          }}
                          className="w-full rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-600"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </form>
                ) : (
                  <div className="space-y-4">
                    {goals.map((goal) => (
                      <div key={goal.id} className="group relative rounded-3xl border border-slate-100 bg-white p-5 shadow-sm transition-all hover:shadow-md">
                        <div className="mb-3 flex items-start justify-between">
                          <div>
                            <h3 className="font-bold text-slate-900">{goal.name}</h3>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              Target: R{Number(goal.target_amount).toLocaleString()}
                            </p>
                          </div>
                          <button
                            onClick={() => handleEditClick(goal)}
                            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-50 text-slate-400 hover:bg-violet-50 hover:text-violet-600"
                          >
                            <FileSignature size={18} />
                          </button>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                            <span className="text-violet-600">{Math.round(goal.target_amount > 0 ? Math.min(100, ((goal.current_amount || 0) / goal.target_amount) * 100) : 0)}% Complete</span>
                            <span className="text-slate-300">R{Math.max(0, (goal.target_amount || 0) - (goal.current_amount || 0)).toLocaleString()} Left</span>
                          </div>
                          <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-violet-600 to-purple-500 rounded-full transition-all duration-1000"
                              style={{ width: `${goal.target_amount > 0 ? Math.min(100, ((goal.current_amount || 0) / goal.target_amount) * 100) : 0}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={() => setIsCreatingGoal(true)}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 py-4 text-sm font-bold text-slate-400 transition-all hover:border-violet-300 hover:bg-violet-50 active:scale-95"
                    >
                      <Plus size={18} />
                      <span>Add New Goal</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function formatDate(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

function formatAmount(amount, direction) {
  if (amount === undefined || amount === null) return "R0.00";
  return `R${Math.abs(amount).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default HomePage;