import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { supabase } from "./lib/supabase.js";
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import SwipeBackWrapper from "./components/SwipeBackWrapper.jsx";

import AuthPage from "./pages/AuthPage.jsx";
import HomePage from "./pages/HomePage.jsx";
import CreditHome from "./pages/credit/CreditHome";
import CreditApplyPage from "./pages/CreditApplyPage.jsx";
import UnsecuredCreditDashboard from "./pages/credit/UnsecuredCreditDashboard.jsx";
import CreditRepayPage from "./pages/CreditRepayPage.jsx";
import InvestmentsPage from "./pages/InvestmentsPage.jsx";
import NewPortfolioPage from "./pages/NewPortfolioPage.jsx";
import InvestPage from "./pages/InvestPage.jsx";
import InvestAmountPage from "./pages/InvestAmountPage.jsx";
import PaymentPage from "./pages/PaymentPage.jsx";
import PaymentSuccessPage from "./pages/PaymentSuccessPage.jsx";
import PaymentPendingPage from "./pages/PaymentPendingPage.jsx";
import PaymentMethodModal from "./components/PaymentMethodModal.jsx";
import FactsheetPage from "./pages/FactsheetPage.jsx";
import OpenStrategiesPage from "./pages/OpenStrategiesPage.jsx";
import MorePage from "./pages/MorePage.jsx";
import OnboardingPage from "./pages/OnboardingPage.jsx";
import InstantLiquidityPage from "./pages/credit/InstantLiquidity.jsx";
import { useProfile } from "./lib/useProfile";
import SettingsPage from "./pages/SettingsPage.jsx";
import TransactPage from "./pages/TransactPage.jsx";
import UserOnboardingPage from "./pages/UserOnboardingPage.jsx";
import AppLayout from "./layouts/AppLayout.jsx";
import BiometricsDebugPage from "./pages/BiometricsDebugPage.jsx";
import EditProfilePage from "./pages/EditProfilePage.jsx";
import NotificationsPage from "./pages/NotificationsPage.jsx";
import NotificationSettingsPage from "./pages/NotificationSettingsPage.jsx";
import MintBalancePage from "./pages/MintBalancePage.jsx";
import MarketsPage from "./pages/MarketsPage.jsx";
import StockDetailPage from "./pages/StockDetailPage.jsx";
import StockBuyPage from "./pages/StockBuyPage.jsx";
import NewsArticlePage from "./pages/NewsArticlePage.jsx";
import { NotificationsProvider, createWelcomeNotification, useNotificationsContext } from "./lib/NotificationsContext.jsx";
import ActivityPage from "./pages/ActivityPage.jsx";
import ActionsPage from "./pages/ActionsPage.jsx";
import ProfileDetailsPage from "./pages/ProfileDetailsPage.jsx";
import ChangePasswordPage from "./pages/ChangePasswordPage.jsx";
import LegalDocumentationPage from "./pages/LegalDocumentationPage.jsx";
import StatementsPage from "./pages/StatementsPage.jsx";
import DepositPage from "./pages/DepositPage.jsx";
import IdentityCheckPage from "./pages/IdentityCheckPage.jsx";
import BankLinkPage from "./pages/BankLinkPage.jsx";
import MintBankPage from "./pages/MintBankPage.jsx";
import InvitePage from "./pages/InvitePage.jsx";
import ActiveSessionsPage from "./pages/ActiveSessionsPage.jsx";
import PinSetupPage from "./pages/PinSetupPage.jsx";
import FamilyDashboardPage from "./pages/FamilyDashboardPage.jsx";
import ChildDashboardPage from "./pages/ChildDashboardPage.jsx";
import FuneralCoverPage from "./pages/FuneralCoverPage.jsx";
import { useInactivityTimeout } from "./lib/useInactivityTimeout.jsx";
import PinLockScreen from "./components/PinLockScreen.jsx";
import { isPinEnabled } from "./lib/usePin.js";
import GoalLinkModal from "./components/GoalLinkModal.jsx";
import { useOnboardingStatus } from "./lib/useOnboardingStatus.js";
import { checkOnboardingComplete } from "./lib/checkOnboardingComplete.js";
import MaintenanceModal from "./components/MaintenanceModal.jsx";

const PERSISTENT_KEYS = [
  'mint_device_id',
  'mint_theme',
  'mint_language',
  'mint_onboarding_completed'
];

const clearUserStorage = () => {
  const keysToKeep = {};
  PERSISTENT_KEYS.forEach(key => {
    const value = localStorage.getItem(key);
    if (value !== null) keysToKeep[key] = value;
  });

  localStorage.clear();

  Object.entries(keysToKeep).forEach(([key, value]) => {
    localStorage.setItem(key, value);
  });

  sessionStorage.clear();
};

const initialHash = window.location.hash;
const isRecoveryMode = initialHash.includes('type=recovery');

const getHashParams = (hash) => {
  if (!hash) return {};
  return Object.fromEntries(new URLSearchParams(hash.substring(1)));
};

const hashParams = getHashParams(initialHash);
const hasError = hashParams.error === 'access_denied';
const errorCode = hashParams.error_code;

const getTokensFromHash = (hash) => {
  if (!hash) return null;
  const params = new URLSearchParams(hash.substring(1));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken) {
    return { accessToken, refreshToken: refreshToken || accessToken };
  }
  return null;
};

const recoveryTokens = isRecoveryMode ? getTokensFromHash(initialHash) : null;

const mainTabs = ['home', 'credit', 'transact', 'investments', 'markets', 'deposit', 'more', 'welcome', 'auth'];

const App = () => {
  const [currentPage, setCurrentPage] = useState(hasError ? "linkExpired" : (isRecoveryMode ? "auth" : "welcome"));
  const [previousPageName, setPreviousPageName] = useState(null);
  const [authStep, setAuthStep] = useState(isRecoveryMode ? "newPassword" : "email");
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [notificationReturnPage, setNotificationReturnPage] = useState("home");
  const [modal, setModal] = useState(null);
  const [selectedSecurity, setSelectedSecurity] = useState(null);
  const [selectedStrategy, setSelectedStrategy] = useState(null);
  const [selectedArticleId, setSelectedArticleId] = useState(null);
  const [selectedFamilyChild, setSelectedFamilyChild] = useState(null);
  const [funeralCoverInitialDependents, setFuneralCoverInitialDependents] = useState([]);
  const [marketsInitialView, setMarketsInitialView] = useState(null);
  const [portfolioDeepLink, setPortfolioDeepLink] = useState(null);
  const [investmentAmount, setInvestmentAmount] = useState(0);
  const [baseInvestmentAmount, setBaseInvestmentAmount] = useState(0);
  const [stockCheckout, setStockCheckout] = useState({ security: null, amount: 0, baseAmount: 0 });
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [showPaymentMethodModal, setShowPaymentMethodModal] = useState(false);
  const [pendingPaymentMethod, setPendingPaymentMethod] = useState(null);
  const [pendingPaymentInfo, setPendingPaymentInfo] = useState(null);
  const [pendingGoalFlow, setPendingGoalFlow] = useState(null);
  const [selectedGoalId, setSelectedGoalId] = useState(null);
  const selectedGoalIdRef = useRef(null);
  const goalInvestAmountRef = useRef(0);
  const pendingPaymentTypeRef = useRef(null);
  const recoveryHandled = useRef(false);
  const { refetch: refetchNotifications, reset: resetNotifications } = useNotificationsContext();
  const [showPinLock, setShowPinLock] = useState(false);
  const [showOpenStrategiesMaintenance, setShowOpenStrategiesMaintenance] = useState(false);

  const isAuthenticated = !['welcome', 'auth', 'linkExpired'].includes(currentPage);
  const { profile, loading: profileLoading } = useProfile({ enabled: isAuthenticated });
  const { onboardingComplete, loading: onboardingLoading } = useOnboardingStatus({ enabled: isAuthenticated });
  const onboardingRef = useRef({ complete: false, loading: true });

  useEffect(() => {
    onboardingRef.current = { complete: onboardingComplete, loading: onboardingLoading };
  }, [onboardingComplete, onboardingLoading]);

  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  useInactivityTimeout({
    enabled: isAuthenticated,
    onLogout: () => {
      if (supabase) supabase.auth.signOut({ scope: 'local' });
      sessionStorage.removeItem('mint_pin_unlocked');
      setShowPinLock(false);
      setCurrentPage("welcome");
    },
  });

  const justLoggedInRef = useRef(false);
  // Read ozow param synchronously at init — before any effect can clear the URL
  const ozowReturnParam = useRef(new URLSearchParams(window.location.search).get("ozow"));
  const ozowRecordedRef = useRef(false);

  useEffect(() => {
    if (ozowReturnParam.current) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (currentPage !== "paymentSuccess" || ozowRecordedRef.current) return;
    const pending = sessionStorage.getItem("ozow_pending");
    if (!pending) return;
    let parsed;
    try { parsed = JSON.parse(pending); } catch { return; }
    if (!parsed?.transactionRef || !parsed?.strategyId || !parsed?.amount) return;
    ozowRecordedRef.current = true;
    sessionStorage.removeItem("ozow_pending");
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const resp = await fetch("/api/ozow/record-success", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            transactionRef: parsed.transactionRef,
            strategyId: parsed.strategyId,
            amount: parsed.amount,
          }),
        });
        const result = await resp.json();
        if (result.success) {
          console.log("[ozow] Investment recorded from success page", result.alreadyRecorded ? "(already done)" : "");
        } else {
          console.error("[ozow] record-success failed:", result.error);
        }
      } catch (err) {
        console.error("[ozow] record-success error:", err);
      }
    })();
  }, [currentPage]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        localStorage.setItem('mint_app_hidden_at', Date.now().toString());
      } else {
        if (justLoggedInRef.current) return;
        const hiddenAt = localStorage.getItem('mint_app_hidden_at');
        if (hiddenAt) {
          const elapsed = Date.now() - parseInt(hiddenAt, 10);
          const FOUR_MINUTES = 4 * 60 * 1000;
          if (elapsed >= FOUR_MINUTES && isAuthenticated && !isCheckingAuth) {
            if (isPinEnabled()) {
              sessionStorage.removeItem('mint_pin_unlocked');
              setShowPinLock(true);
            } else {
              if (supabase) supabase.auth.signOut({ scope: 'local' });
              sessionStorage.removeItem('mint_pin_unlocked');
              setShowPinLock(false);
              setCurrentPage("welcome");
            }
          }
          localStorage.removeItem('mint_app_hidden_at');
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isAuthenticated, isCheckingAuth]);

  const navigationHistory = useRef([]);
  const pageStateCache = useRef({});

  const cacheCurrentPageState = useCallback(() => {
    pageStateCache.current[currentPage] = {
      selectedSecurity,
      selectedStrategy,
      selectedArticleId,
      investmentAmount,
      stockCheckout,
      notificationReturnPage,
    };
  }, [currentPage, selectedSecurity, selectedStrategy, selectedArticleId, investmentAmount, stockCheckout, notificationReturnPage]);

  const pendingProgrammaticBacks = useRef(0);

  const navigateTo = useCallback((page) => {
    if (page === currentPage) return;

    // Protected routes that REQUIRE onboarding
    const protectedPages = ["deposit", "creditApply", "creditRepay"];


    if (protectedPages.includes(page) && !onboardingRef.current.loading && !onboardingRef.current.complete) {
      console.log(`[App] Onboarding required for page: ${page}. Redirecting.`);
      setCurrentPage("userOnboarding"); // Redirect to the actual onboarding flow
      return;
    }

    if (!mainTabs.includes(page)) {
      cacheCurrentPageState();
      navigationHistory.current.push(currentPage);
      if (navigationHistory.current.length > 20) {
        navigationHistory.current = navigationHistory.current.slice(-20);
      }
      setPreviousPageName(currentPage);

      if (!Capacitor.isNativePlatform()) {
        window.history.pushState({ mintPage: page }, '');
      }
    } else {
      navigationHistory.current = [];
      setPreviousPageName(null);
    }

    setCurrentPage(page);
  }, [currentPage, cacheCurrentPageState, onboardingComplete]);

  const handleTabChange = useCallback((tab) => {
    navigationHistory.current = [];
    setPreviousPageName(null);
    setCurrentPage(tab);
  }, []);

  const goBack = useCallback(() => {
    if (navigationHistory.current.length > 0) {
      const prevPage = navigationHistory.current.pop();
      const newPreviousPage = navigationHistory.current.length > 0
        ? navigationHistory.current[navigationHistory.current.length - 1]
        : null;
      setPreviousPageName(newPreviousPage);
      setCurrentPage(prevPage);

      if (!Capacitor.isNativePlatform()) {
        pendingProgrammaticBacks.current++;
        window.history.back();
      }
      return true;
    }

    if (!mainTabs.includes(currentPage)) {
      setPreviousPageName(null);
      setCurrentPage('home');

      if (!Capacitor.isNativePlatform()) {
        pendingProgrammaticBacks.current++;
        window.history.back();
      }
      return true;
    }

    return false;
  }, [currentPage]);

  const canSwipeBack = !mainTabs.includes(currentPage);

  const lastBackPressRef = useRef(0);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
      return;
    }

    const handleBackButton = () => {
      if (navigationHistory.current.length > 0) {
        const prevPage = navigationHistory.current.pop();
        const newPreviousPage = navigationHistory.current.length > 0
          ? navigationHistory.current[navigationHistory.current.length - 1]
          : null;
        setPreviousPageName(newPreviousPage);
        setCurrentPage(prevPage);
        return;
      }

      if (!mainTabs.includes(currentPage)) {
        setPreviousPageName(null);
        setCurrentPage('home');
        return;
      }

      const now = Date.now();
      if (now - lastBackPressRef.current < 2000) {
        CapacitorApp.exitApp();
      } else {
        lastBackPressRef.current = now;
      }
    };

    const listener = CapacitorApp.addListener('backButton', handleBackButton);

    return () => {
      listener.then(l => l.remove());
    };
  }, [currentPage]);

  useEffect(() => {
    const handleNavigationEvent = (e) => {
      const { page, member } = e.detail || {};
      if (member) setSelectedMember(member);
      if (page) {
        const normalizedPage = page === 'family' ? 'familyDashboard' : page;
        if (page === 'childDashboard' && e.detail?.child) {
          setSelectedFamilyChild(e.detail.child);
        }
        if (page === 'userOnboarding') {
          setNotificationReturnPage(currentPage);
        }
        navigateTo(normalizedPage);
      }
    };

    window.addEventListener('navigate-within-app', handleNavigationEvent);
    return () => window.removeEventListener('navigate-within-app', handleNavigationEvent);
  }, [navigateTo, currentPage]);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;

    window.history.replaceState({ mintPage: 'root' }, '');

    const handlePopState = () => {
      if (pendingProgrammaticBacks.current > 0) {
        pendingProgrammaticBacks.current--;
        return;
      }

      if (navigationHistory.current.length > 0) {
        const prevPage = navigationHistory.current.pop();
        const newPreviousPage = navigationHistory.current.length > 0
          ? navigationHistory.current[navigationHistory.current.length - 1]
          : null;
        setPreviousPageName(newPreviousPage);
        setCurrentPage(prevPage);
      } else if (!mainTabs.includes(currentPageRef.current)) {
        setPreviousPageName(null);
        setCurrentPage('home');
      } else {
        window.history.pushState({ mintPage: 'root' }, '');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const appContent = document.querySelector(".app-content");
      if (appContent) {
        appContent.scrollTo({ top: 0, left: 0 });
      }
      window.scrollTo({ top: 0, left: 0 });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [currentPage]);

  useEffect(() => {
    if (hasError) {
      window.history.replaceState({}, document.title, window.location.pathname);
      setIsCheckingAuth(false);
      return;
    }

    const setupRecoverySession = async () => {
      if (isRecoveryMode && recoveryTokens && supabase) {
        try {
          const { error } = await supabase.auth.setSession({
            access_token: recoveryTokens.accessToken,
            refresh_token: recoveryTokens.refreshToken
          });

          if (!error) {
            setSessionReady(true);
          }
        } catch (err) {
          console.error('Error setting recovery session:', err);
        }
        window.history.replaceState({}, document.title, window.location.pathname);
      }
      setIsCheckingAuth(false);
    };

    const checkExistingSession = async () => {
      // Safety timeout: never block on the black screen for more than 1s.
      // Supabase auth lock can deadlock for 5s+ in React StrictMode causing
      // the spinner to hang indefinitely. The timeout ensures the UI always
      // unblocks; the session check still completes in the background.
      const safetyTimer = setTimeout(() => setIsCheckingAuth(false), 1000);

      if (supabase && !isRecoveryMode && !hasError) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          clearTimeout(safetyTimer);
          if (session) {
            if (ozowReturnParam.current === "success") {
              setCurrentPage("paymentSuccess");
            } else {
              setCurrentPage("home");
            }
            const alreadyUnlocked = sessionStorage.getItem('mint_pin_unlocked') === 'true';
            if (isPinEnabled() && !alreadyUnlocked) {
              setShowPinLock(true);
            }
          }
        } catch (err) {
          clearTimeout(safetyTimer);
          console.error("Session check error:", err);
        }
      } else {
        clearTimeout(safetyTimer);
      }
      setIsCheckingAuth(false);
    };

    if (isRecoveryMode) {
      setupRecoverySession();
    } else {
      checkExistingSession();
    }
  }, []);

  useEffect(() => {
    if (!supabase || isRecoveryMode) {
      return;
    }

    const handleRecoveryFlow = () => {
      if (recoveryHandled.current) return;
      recoveryHandled.current = true;
      setAuthStep("newPassword");
      setCurrentPage("auth");
      window.history.replaceState({}, document.title, window.location.pathname);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        handleRecoveryFlow();
      }
      if (event === 'SIGNED_OUT') {
        clearUserStorage();
        if (resetNotifications) resetNotifications();

        // Don't force navigate - let SessionExpired overlay handle UX gracefully
        // This prevents jarring redirects and shows users why they were logged out

        if (justLoggedInRef.current || Date.now() < sessionCheckSkipUntilRef.current) {
          return;
        }
        if (['welcome', 'auth', 'linkExpired'].includes(currentPageRef.current)) {
          return;
        }
        sessionExpiredPageRef.current = currentPageRef.current;
        setShowSessionExpired(true);
        setShowPinLock(false);
      }
      if (event === 'TOKEN_REFRESHED' && session) {
        setSessionReady(true);
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  const [showSessionExpired, setShowSessionExpired] = useState(false);
  const sessionExpiredPageRef = useRef(null);

  const sessionCheckSkipUntilRef = useRef(0);


  useEffect(() => {
    if (!supabase || !isAuthenticated) return;

    const checkSession = async () => {
      if (justLoggedInRef.current) return;
      if (Date.now() < sessionCheckSkipUntilRef.current) return;
      if (document.hidden) return;

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          // Silently try to refresh — if it succeeds great, if not we wait for
          // onAuthStateChange(SIGNED_OUT) to show the expired screen.
          await supabase.auth.refreshSession();
          return;
        }
        const fingerprint = localStorage.getItem('mint_session_fingerprint');
        if (fingerprint && session?.access_token) {
          try {
            const res = await fetch(`/api/sessions/validate?fingerprint=${encodeURIComponent(fingerprint)}`, {
              headers: { Authorization: `Bearer ${session.access_token}` },
            });
            if (res.ok) {
              const json = await res.json();
              if (json.success && json.valid === false) {
                console.log('[session-check] Session revoked remotely');
                await supabase.auth.signOut({ scope: 'local' });
                setShowPinLock(false);
                setCurrentPage("welcome");
                return;
              }
            }
          } catch (valErr) {
            // ignore validation errors
          }
        }
      } catch (err) {
        console.error('[session-check] Error:', err);
      }
    };

    const initialDelay = setTimeout(() => checkSession(), 60000);
    const interval = setInterval(checkSession, 120000);

    return () => {
      clearTimeout(initialDelay);
      clearInterval(interval);
    };
  }, [isAuthenticated]);

  const openAuthFlow = (step) => {
    setAuthStep(step);
    setCurrentPage("auth");
  };

  const openModal = (title, message) => {
    setModal({ title, message });
  };

  const closeModal = () => {
    setModal(null);
  };

  const handleWithdrawRequest = async () => {
    try {
      if (!supabase) {
        openModal("Withdraw", "You don't have any allocations to withdraw from.");
        return;
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) {
        openModal("Withdraw", "You don't have any allocations to withdraw from.");
        return;
      }

      const { count, error } = await supabase
        .from("allocations")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userData.user.id);

      if (error || !count) {
        openModal("Withdraw", "You don't have any allocations to withdraw from.");
        return;
      }

      openModal("Withdraw", "Withdrawals are coming soon.");
    } catch (err) {
      console.error("Failed to check allocations", err);
      openModal("Withdraw", "You don't have any allocations to withdraw from.");
    }
  };

  const handleShowComingSoon = (label) => {
    openModal(label, "Coming soon.");
  };

  const renderPageContent = useCallback((pageName, isPreview = false) => {
    const cachedState = pageStateCache.current[pageName] || {};
    const previewSecurity = isPreview ? (cachedState.selectedSecurity || selectedSecurity) : selectedSecurity;
    const previewStrategy = isPreview ? (cachedState.selectedStrategy || selectedStrategy) : selectedStrategy;
    const previewArticleId = isPreview ? (cachedState.selectedArticleId || selectedArticleId) : selectedArticleId;

    const noOp = () => { };

    switch (pageName) {
      case 'home':
        return (
          <AppLayout
            activeTab="home"
            onTabChange={noOp}
            onWithdraw={noOp}
            onShowComingSoon={noOp}
            modal={null}
            onCloseModal={noOp}
          >
            <HomePage
              onOpenNotifications={noOp}
              onOpenMintBalance={noOp}
              onOpenActivity={noOp}
              onOpenActions={noOp}
              onOpenInvestments={noOp}
              onOpenCredit={noOp}
              onOpenCreditApply={noOp}
              onOpenCreditRepay={noOp}
              onOpenInvest={noOp}
              onOpenWithdraw={noOp}
              onOpenSettings={noOp}
              onOpenFamily={() => navigateTo("familyDashboard")}
              onOpenInsure={() => navigateTo("funeralCover")}
            />
          </AppLayout>
        );
      case "credit":
        return (
          <CreditHome
            profile={profile}
            onOpenNotifications={() => setShowNotifications(true)}
            onTabChange={setCurrentPage}
          />
        );
      case 'statements':
        return (
          <AppLayout
            activeTab="statements"
            onTabChange={noOp}
            onWithdraw={noOp}
            onShowComingSoon={noOp}
            modal={null}
            onCloseModal={noOp}
          >
            <StatementsPage onOpenNotifications={noOp} />
          </AppLayout>
        );
      case 'investments':
        return (
          <AppLayout
            activeTab="investments"
            onTabChange={noOp}
            onWithdraw={noOp}
            onShowComingSoon={noOp}
            modal={null}
            onCloseModal={noOp}
          >
            <NewPortfolioPage
              onBack={noOp}
              onOpenNotifications={noOp}
              onOpenInvest={noOp}
              onOpenStrategies={noOp}
            />
          </AppLayout>
        );

      case 'instantLiquidity':
        return (
          <AppLayout
            activeTab="credit" // Keeps the credit tab highlighted in the layout
            onTabChange={handleTabChange}
            onWithdraw={handleWithdrawRequest}
            onShowComingSoon={handleShowComingSoon}
            modal={modal}
            onCloseModal={closeModal}
          >
            <InstantLiquidityPage profile={profile} onBack={goBack} />
          </AppLayout>
        );

      case 'more':
        return (
          <AppLayout
            activeTab="more"
            onTabChange={noOp}
            onWithdraw={noOp}
            onShowComingSoon={noOp}
            modal={null}
            onCloseModal={noOp}
          >
            <MorePage onNavigate={noOp} />
          </AppLayout>
        );
      case 'markets':
        return (
          <AppLayout
            activeTab="markets"
            onTabChange={noOp}
            onWithdraw={noOp}
            onShowComingSoon={noOp}
            modal={null}
            onCloseModal={noOp}
          >
            <MarketsPage
              onBack={noOp}
              onOpenNotifications={noOp}
              onOpenStockDetail={noOp}
              onOpenNewsArticle={noOp}
              onOpenFactsheet={noOp}
            />
          </AppLayout>
        );
      case 'deposit':
        return (
          <AppLayout
            activeTab="deposit"
            onTabChange={noOp}
            onWithdraw={noOp}
            onShowComingSoon={noOp}
            modal={null}
            onCloseModal={noOp}
          >
            <DepositPage onBack={noOp} />
          </AppLayout>
        );
      case 'stockDetail':
        return (
          <StockDetailPage
            security={previewSecurity}
            onBack={noOp}
            onOpenBuy={noOp}
          />
        );
      case 'stockBuy':
        return (
          <StockBuyPage
            security={previewSecurity}
            onBack={noOp}
            onContinue={noOp}
          />
        );
      case 'factsheet':
        return (
          <FactsheetPage
            onBack={noOp}
            strategy={previewStrategy}
            onOpenInvest={noOp}
          />
        );
      case 'investAmount':
        return (
          <InvestAmountPage
            onBack={noOp}
            strategy={previewStrategy}
            onContinue={noOp}
          />
        );
      case 'notifications':
        return (
          <NotificationsPage
            onBack={noOp}
            onOpenSettings={noOp}
          />
        );
      case 'notificationSettings':
        return <NotificationSettingsPage onBack={noOp} />;
      case 'settings':
        return (
          <AppLayout
            activeTab="more"
            onTabChange={noOp}
            onWithdraw={noOp}
            onShowComingSoon={noOp}
            modal={null}
            onCloseModal={noOp}
          >
            <SettingsPage onNavigate={noOp} onBack={noOp} />
          </AppLayout>
        );
      case 'mintBalance':
        return (
          <AppLayout
            activeTab="home"
            onTabChange={noOp}
            onWithdraw={noOp}
            onShowComingSoon={noOp}
            modal={null}
            onCloseModal={noOp}
          >
            <MintBalancePage
              onBack={noOp}
              onOpenInvestments={noOp}
              onOpenCredit={noOp}
              onOpenActivity={noOp}
              onOpenSettings={noOp}
              onOpenInvest={noOp}
              onOpenCreditApply={noOp}
            />
          </AppLayout>
        );
      case 'activity':
        return (
          <AppLayout
            activeTab="home"
            onTabChange={noOp}
            onWithdraw={noOp}
            onShowComingSoon={noOp}
            modal={null}
            onCloseModal={noOp}
          >
            <ActivityPage onBack={noOp} />
          </AppLayout>
        );
      case 'actions':
        return (
          <ActionsPage
            onBack={noOp}
            onNavigate={noOp}
          />
        );
      case 'editProfile':
        return <EditProfilePage onNavigate={noOp} onBack={noOp} />;
      case 'profileDetails':
        return <ProfileDetailsPage onNavigate={noOp} onBack={noOp} />;
      case 'creditApply':
        return <CreditApplyPage onBack={noOp} onTabChange={setCurrentPage} />;
      case 'creditRepay':
        return <CreditRepayPage onBack={noOp} />;
      case 'identityCheck':
        return <IdentityCheckPage onBack={noOp} onComplete={noOp} />;
      case 'bankLink':
        return <MintBankPage onBack={noOp} onComplete={noOp} />;
      case 'invite':
        return <InvitePage onBack={noOp} />;
      case 'newsArticle':
        return <NewsArticlePage articleId={previewArticleId} onBack={noOp} />;
      case 'openStrategies':
        return <OpenStrategiesPage onBack={noOp} onOpenFactsheet={noOp} />;
      case 'changePassword':
        return <ChangePasswordPage onNavigate={noOp} onBack={noOp} />;
      case 'legal':
        return <LegalDocumentationPage onNavigate={noOp} onBack={noOp} />;
      case 'invest':
        return (
          <AppLayout
            activeTab="home"
            onTabChange={noOp}
            onWithdraw={noOp}
            onShowComingSoon={noOp}
            modal={null}
            onCloseModal={noOp}
          >
            <InvestPage
              onBack={noOp}
              onOpenOpenStrategies={noOp}
              onOpenMarkets={noOp}
            />
          </AppLayout>
        );
      case 'biometricsDebug':
        return (
          <AppLayout
            activeTab="more"
            onTabChange={noOp}
            onWithdraw={noOp}
            onShowComingSoon={noOp}
            modal={null}
            onCloseModal={noOp}
          >
            <BiometricsDebugPage onNavigate={noOp} onBack={noOp} />
          </AppLayout>
        );
      case 'transact':
        return (
          <AppLayout
            activeTab="transact"
            onTabChange={noOp}
            onWithdraw={noOp}
            onShowComingSoon={noOp}
            modal={null}
            onCloseModal={noOp}
          >
            <TransactPage />
          </AppLayout>
        );
      case 'creditScore':
        return (
          <AppLayout
            activeTab="credit"
            onTabChange={noOp}
            onWithdraw={noOp}
            onShowComingSoon={noOp}
            modal={null}
            onCloseModal={noOp}
          >
            <CreditPage
              initialView="score"
              onOpenNotifications={noOp}
              onOpenCreditApply={noOp}
            />
          </AppLayout>
        );
      case 'stockPayment': {
        const previewStockCheckout = isPreview ? (cachedState.stockCheckout || stockCheckout) : stockCheckout;
        const currency = previewStockCheckout.security?.currency || "R";
        const normalizedCurrency = currency.toUpperCase() === "ZAC" ? "R" : currency;
        const paymentItem = previewStockCheckout.security
          ? { ...previewStockCheckout.security, name: previewStockCheckout.security?.name || previewStockCheckout.security?.symbol || "Stock", currency: normalizedCurrency }
          : null;
        return (
          <PaymentPage
            onBack={noOp}
            strategy={paymentItem}
            amount={previewStockCheckout.amount}
            baseAmount={previewStockCheckout.baseAmount}
            shareCount={previewStockCheckout.shareCount}
            onSuccess={noOp}
            onCancel={noOp}
            onOpenDeposit={noOp}
          />
        );
      }
      case 'payment': {
        const previewAmount = isPreview ? (cachedState.investmentAmount || investmentAmount) : investmentAmount;
        return (
          <PaymentPage
            onBack={noOp}
            strategy={previewStrategy}
            amount={previewAmount}
            baseAmount={isPreview ? cachedState.baseInvestmentAmount : baseInvestmentAmount}
            onSuccess={noOp}
            onCancel={noOp}
            onOpenDeposit={() => navigateTo("deposit")}
            initialMethod={pendingPaymentMethod}
          />
        );
      }
      case 'paymentSuccess':
        return <PaymentSuccessPage onDone={noOp} />;
      case 'userOnboarding':
        return <UserOnboardingPage onComplete={noOp} />;
      case 'familyDashboard':
        return (
          <FamilyDashboardPage
            onBack={noOp}
            userId={profile?.id}
            onOpenChildDashboard={(child) => {
              setSelectedFamilyChild(child);
              navigateTo('childDashboard');
            }}
            onGetInsured={(members) => {
              setFuneralCoverInitialDependents(members);
              navigateTo('funeralCover');
            }}
          />
        );
      case 'childDashboard':
        return (
          <ChildDashboardPage
            child={selectedFamilyChild}
            onBack={noOp}
          />
        );
      default:
        return null;
    }
  }, [selectedSecurity, selectedStrategy, selectedArticleId, stockCheckout, investmentAmount, selectedFamilyChild]);

  const previousPageComponent = useMemo(() => {
    if (!previousPageName || mainTabs.includes(currentPage)) return null;

    // Skip background rendering for SDK-heavy pages to prevent duplicate listeners
    const sdkPages = ["identityCheck", "userOnboarding", "bankLink", "creditApply"];
    if (sdkPages.includes(previousPageName)) return null;

    return renderPageContent(previousPageName, true);
  }, [previousPageName, currentPage, renderPageContent]);

  const handleLockLogout = useCallback(() => {
    if (supabase) supabase.auth.signOut({ scope: 'local' });
    sessionStorage.removeItem('mint_pin_unlocked');
    setShowPinLock(false);
    setCurrentPage("welcome");
  }, []);



  if (isCheckingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0d0d12]">
        <div className="w-8 h-8 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (currentPage === "linkExpired") {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-semibold text-slate-900 mb-3">Link Expired</h1>
          <p className="text-slate-600 mb-6">
            This password reset link has expired or is no longer valid. Please request a new one.
          </p>
          <button
            onClick={() => openAuthFlow("forgotPassword")}
            className="inline-flex items-center justify-center rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-white shadow-lg shadow-slate-900/20 transition hover:-translate-y-0.5"
          >
            Request New Link
          </button>
        </div>
      </div>
    );
  }

  if (showSessionExpired && isAuthenticated) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-50">
        <div className="flex w-full max-w-sm flex-col items-center px-8">
          <div className="flex items-center gap-3 mb-10">
            <img src="/assets/mint-logo.svg" alt="Mint" className="h-6 w-auto" />
            <span className="mint-brand text-lg font-semibold tracking-[0.12em]">MINT</span>
          </div>
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white border-2 border-slate-200 shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-slate-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="mt-6 text-2xl font-bold text-slate-900">Session Expired</h1>
          <p className="mt-2 text-center text-sm text-slate-500">
            Your session has expired. Please log in again to continue.
          </p>
          <button
            type="button"
            onClick={() => {
              setShowSessionExpired(false);
              setShowPinLock(false);
              setCurrentPage("auth");
              setAuthStep("loginEmail");
            }}
            className="mt-8 w-full rounded-full bg-slate-900 py-3.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition active:scale-95"
          >
            Log In Again
          </button>
        </div>
      </div>
    );
  }

  if (showPinLock && isAuthenticated) {
    return (
      <PinLockScreen
        onUnlock={() => {
          setShowPinLock(false);
          sessionStorage.setItem('mint_pin_unlocked', 'true');
        }}
        onLogout={handleLockLogout}
      />
    );
  }


  if (currentPage === "home") {
    return (
      <>
      {showOpenStrategiesMaintenance && <MaintenanceModal onClose={() => setShowOpenStrategiesMaintenance(false)} />}
      <AppLayout
        activeTab="home"
        onTabChange={handleTabChange}
        onWithdraw={handleWithdrawRequest}
        onShowComingSoon={handleShowComingSoon}
        modal={modal}
        onCloseModal={closeModal}
      >
        <HomePage
          onOpenNotifications={() => {
            setNotificationReturnPage("home");
            navigateTo("notifications");
          }}
          onOpenMintBalance={() => navigateTo("mintBalance")}
          onOpenActivity={() => navigateTo("activity")}
          onOpenActions={() => navigateTo("actions")}
          onOpenInvestments={() => setCurrentPage("investments")}
          onOpenCredit={() => setCurrentPage("credit")}
          onOpenCreditApply={() => navigateTo("creditApply")}
          onOpenCreditRepay={() => navigateTo("creditRepay")}
          onOpenInvest={() => { setMarketsInitialView(null); navigateTo("markets"); }}
          onOpenWithdraw={handleWithdrawRequest}
          onOpenSettings={() => navigateTo("settings")}
          onOpenStrategies={() => { setMarketsInitialView("openstrategies"); navigateTo("markets"); }}
          onOpenMarkets={() => { setMarketsInitialView("invest"); navigateTo("markets"); }}
          onOpenDeposit={() => handleTabChange("deposit")}
          onOpenNews={() => { setMarketsInitialView("news"); navigateTo("markets"); }}
          onOpenNewsArticle={(articleId) => { setSelectedArticleId(articleId); navigateTo("newsArticle"); }}
          onOpenInstantLiquidity={() => navigateTo("instantLiquidity")}
          onOpenFamily={() => navigateTo("familyDashboard")}
          onOpenInsure={() => navigateTo("funeralCover")}
        />
      </AppLayout>
      </>
    );
  }
  if (currentPage === "credit") {
    return (
      <AppLayout
        activeTab="credit"
        onTabChange={handleTabChange}
        onWithdraw={handleWithdrawRequest}
        onShowComingSoon={handleShowComingSoon}
        modal={modal}
        onCloseModal={closeModal}
      >
        <CreditHome
          profile={profile}
          onOpenNotifications={() => {
            setNotificationReturnPage("credit");
            navigateTo("notifications");
          }}
          onTabChange={setCurrentPage}
        />
      </AppLayout>
    );
  }

  if (currentPage === "creditScore") {
    return (
      <AppLayout
        activeTab="credit"
        onTabChange={handleTabChange}
        onWithdraw={handleWithdrawRequest}
        onShowComingSoon={handleShowComingSoon}
        modal={modal}
        onCloseModal={closeModal}
      >
        <CreditPage
          initialView="score"
          onOpenNotifications={() => {
            setNotificationReturnPage("credit");
            navigateTo("notifications");
          }}
          onOpenCreditApply={() => navigateTo("creditApply")}
        />
      </AppLayout>
    );
  }

  if (currentPage === "instantLiquidity") {
    return (
      <AppLayout
        activeTab="instantLiquidity"
        onTabChange={handleTabChange}
        onWithdraw={handleWithdrawRequest}
        onShowComingSoon={handleShowComingSoon}
        modal={modal}
        onCloseModal={closeModal}
      >
        <InstantLiquidityPage
          profile={profile}
          onBack={goBack}
          onTabChange={handleTabChange}
          onLinkBank={() => navigateTo("bankLink")}
          onOpenNotifications={() => {
            setNotificationReturnPage("instantLiquidity");
            navigateTo("notifications");
          }}
        />
      </AppLayout>
    );
  }

  if (currentPage === "statements") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <AppLayout
          activeTab="statements"
          onTabChange={handleTabChange}
          onWithdraw={handleWithdrawRequest}
          onShowComingSoon={handleShowComingSoon}
          modal={modal}
          onCloseModal={closeModal}
        >
          <StatementsPage
            onOpenNotifications={() => {
              setNotificationReturnPage("statements");
              navigateTo("notifications");
            }}
          />
        </AppLayout>
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "transact") {
    return (
      <AppLayout
        activeTab="transact"
        onTabChange={handleTabChange}
        onWithdraw={handleWithdrawRequest}
        onShowComingSoon={handleShowComingSoon}
        modal={modal}
        onCloseModal={closeModal}
      >
        <TransactPage />
      </AppLayout>
    );
  }

  if (currentPage === "investments") {
    return (
      <>
      {showOpenStrategiesMaintenance && <MaintenanceModal onClose={() => setShowOpenStrategiesMaintenance(false)} />}
      <AppLayout
        activeTab="investments"
        onTabChange={handleTabChange}
        onWithdraw={handleWithdrawRequest}
        onShowComingSoon={handleShowComingSoon}
        modal={modal}
        onCloseModal={closeModal}
      >
        <NewPortfolioPage
          onBack={goBack}
          onOpenNotifications={() => {
            setNotificationReturnPage("investments");
            navigateTo("notifications");
          }}
          onOpenInvest={() => navigateTo("markets")}
          onOpenStrategies={() => { setMarketsInitialView("openstrategies"); navigateTo("markets"); }}
          deepLink={portfolioDeepLink}
          onDeepLinkConsumed={() => setPortfolioDeepLink(null)}
        />
      </AppLayout>
      </>
    );
  }

  if (currentPage === "invest") {
    return (
      <>
      {showOpenStrategiesMaintenance && <MaintenanceModal onClose={() => setShowOpenStrategiesMaintenance(false)} />}
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <AppLayout
          activeTab="home"
          onTabChange={handleTabChange}
          onWithdraw={handleWithdrawRequest}
          onShowComingSoon={handleShowComingSoon}
          modal={modal}
          onCloseModal={closeModal}
        >
          <InvestPage
            onBack={goBack}
            onOpenOpenStrategies={() => setShowOpenStrategiesMaintenance(true)}
            onOpenMarkets={() => navigateTo("markets")}
          />
        </AppLayout>
      </SwipeBackWrapper>
      </>
    );
  }

  if (currentPage === "markets") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <AppLayout
          activeTab="markets"
          onTabChange={handleTabChange}
          onWithdraw={() => { }}
          onShowComingSoon={() => { }}
          modal={null}
          onCloseModal={() => { }}
        >
          <MarketsPage
            onBack={canSwipeBack ? goBack : undefined}
            initialViewMode={marketsInitialView}
            onViewModeChange={(mode) => setMarketsInitialView(mode)}
            onOpenNotifications={() => {
              setNotificationReturnPage("markets");
              navigateTo("notifications");
            }}
            onOpenStockDetail={(security) => {
              setSelectedSecurity(security);
              navigateTo("stockDetail");
            }}
            onOpenNewsArticle={(articleId) => {
              setSelectedArticleId(articleId);
              navigateTo("newsArticle");
            }}
            onOpenFactsheet={(strategy) => {
              setSelectedStrategy(strategy);
              navigateTo("factsheet");
            }}
          />
        </AppLayout>
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "deposit") {
    return (
      <AppLayout
        activeTab="deposit"
        onTabChange={handleTabChange}
        onWithdraw={() => { }}
        onShowComingSoon={() => { }}
        modal={null}
        onCloseModal={() => { }}
      >
        <DepositPage onBack={canSwipeBack ? goBack : () => handleTabChange("home")} />
      </AppLayout>
    );
  }

  if (currentPage === "stockDetail") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <StockDetailPage
          security={selectedSecurity}
          onBack={goBack}
          onOpenBuy={() => navigateTo("stockBuy")}
          onNavigateToOnboarding={() => navigateTo("identityCheck")}
        />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "stockBuy") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <StockBuyPage
          security={selectedSecurity}
          paymentMethod={pendingPaymentMethod}
          onBack={goBack}
          onContinue={(amount, security, baseAmount, shareCount) => {
            setStockCheckout({ security, amount, baseAmount: baseAmount || amount, shareCount });
            setPendingGoalFlow({
              type: "stock",
              amount,
              baseAmount: baseAmount || amount,
              assetName: security?.name || security?.symbol || "Stock",
              securityId: security?.id || null,
            });
            setShowGoalModal(true);
          }}
        />
        <GoalLinkModal
          isOpen={showGoalModal && pendingGoalFlow?.type === "stock"}
          onClose={() => { setShowGoalModal(false); setPendingGoalFlow(null); setSelectedGoalId(null); selectedGoalIdRef.current = null; goalInvestAmountRef.current = 0; }}
          onConfirm={async (goalId) => {
            setSelectedGoalId(goalId);
            selectedGoalIdRef.current = goalId;
            goalInvestAmountRef.current = pendingGoalFlow?.baseAmount || pendingGoalFlow?.amount || stockCheckout.amount;
            pendingPaymentTypeRef.current = "stock";
            setShowGoalModal(false);
            setPendingGoalFlow(null);

            // Use ref for latest status to avoid race conditions and destructuring bugs
            if (!onboardingRef.current.complete) {
              navigateTo("identityCheck");
              return;
            }
            setShowPaymentMethodModal(true);
          }}
          investmentAmount={pendingGoalFlow?.baseAmount || pendingGoalFlow?.amount || stockCheckout.amount}
          assetName={pendingGoalFlow?.assetName || selectedSecurity?.name || "Stock"}
        />
        <PaymentMethodModal
          isOpen={showPaymentMethodModal}
          onClose={() => setShowPaymentMethodModal(false)}
          amount={stockCheckout.amount}
          strategyName={stockCheckout.security?.name || stockCheckout.security?.symbol || "Stock"}
          onSelectPaystack={() => { setShowPaymentMethodModal(false); setPendingPaymentMethod("paystack"); navigateTo("stockPayment"); }}
          onSelectWallet={() => { setShowPaymentMethodModal(false); setPendingPaymentMethod("wallet"); navigateTo("stockPayment"); }}
          onSelectOzow={async () => {
            try {
              const { data: { user } } = await supabase.auth.getUser();
              const baseUrl = window.location.origin;
              const resp = await fetch("/api/ozow/initiate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  amount: stockCheckout.amount,
                  strategyName: stockCheckout.security?.name || stockCheckout.security?.symbol || "Stock",
                  strategyId: stockCheckout.security?.id || null,
                  userId: user?.id || null,
                  userEmail: user?.email || null,
                  successUrl: `${baseUrl}/?ozow=success`,
                  cancelUrl: `${baseUrl}/?ozow=cancel`,
                  errorUrl: `${baseUrl}/?ozow=error`,
                }),
              });
              const data = await resp.json();
              if (data.success && data.action_url) {
                sessionStorage.setItem("ozow_pending", JSON.stringify({
                  transactionRef: data.TransactionReference,
                  strategyId: data.Optional1,
                  amount: data.Amount,
                }));
                const form = document.createElement("form");
                form.method = "POST";
                form.action = data.action_url;
                const skipFields = ["success", "action_url"];
                Object.entries(data).forEach(([key, value]) => {
                  if (skipFields.includes(key)) return;
                  const input = document.createElement("input");
                  input.type = "hidden";
                  input.name = key;
                  input.value = value;
                  form.appendChild(input);
                });
                document.body.appendChild(form);
                form.submit();
                document.body.removeChild(form);
              } else {
                alert(data.error || "Failed to initiate Ozow payment. Please try again.");
              }
            } catch (err) {
              console.error("Ozow error:", err);
              alert("Could not connect to Ozow. Please try another payment method.");
            }
          }}
          onEFTConfirm={async () => {
            setShowPaymentMethodModal(false);
            try {
              const { data: { session } } = await supabase.auth.getSession();
              const token = session?.access_token;
              const eftRef = `EFT-${Date.now()}`;
              const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
              await fetch("/api/eft-deposit", {
                method: "POST",
                headers,
                body: JSON.stringify({
                  amount: stockCheckout.amount,
                  baseAmount: stockCheckout.baseAmount || stockCheckout.amount,
                  reference: eftRef,
                  securityId: stockCheckout.security?.id,
                  symbol: stockCheckout.security?.symbol || "",
                  name: stockCheckout.security?.name || "",
                  ...(stockCheckout.shareCount ? { shareCount: Number(stockCheckout.shareCount) } : {}),
                }),
              });
            } catch (e) {
              console.error("EFT record error:", e);
            }
            setPendingPaymentInfo({ strategy: stockCheckout.security?.name || stockCheckout.security?.symbol, amount: stockCheckout.amount });
            navigationHistory.current = [];
            setPreviousPageName(null);
            setCurrentPage("paymentPending");
          }}
        />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "stockPayment") {
    const currency = stockCheckout.security?.currency || "R";
    const normalizedCurrency = currency.toUpperCase() === "ZAC" ? "R" : currency;
    const paymentItem = stockCheckout.security
      ? { ...stockCheckout.security, name: stockCheckout.security?.name || stockCheckout.security?.symbol || "Stock", currency: normalizedCurrency }
      : null;
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <PaymentPage
          onBack={goBack}
          strategy={paymentItem}
          amount={stockCheckout.amount}
          baseAmount={stockCheckout.baseAmount}
          shareCount={stockCheckout.shareCount}
          initialMethod={pendingPaymentMethod}
          onOpenDeposit={() => navigateTo("deposit")}
          onSuccess={async (response) => {
            console.log("Payment successful:", response);
            const goalId = selectedGoalIdRef.current;
            const goalAmount = goalInvestAmountRef.current;
            if (goalId && supabase) {
              try {
                const { data: { session } } = await supabase.auth.getSession();
                if (session?.user) {
                  const { data: goal, error: fetchErr } = await supabase
                    .from("investment_goals")
                    .select("current_amount, target_amount")
                    .eq("id", goalId)
                    .single();
                  if (fetchErr) console.error("Error fetching goal for update:", fetchErr);
                  if (goal) {
                    const prevInvested = goal.current_amount || 0;
                    const newInvested = prevInvested + (goalAmount || 0);
                    const progress = goal.target_amount > 0 ? Math.min(100, (newInvested / goal.target_amount) * 100) : 0;
                    const { error: updateErr } = await supabase
                      .from("investment_goals")
                      .update({ current_amount: newInvested })
                      .eq("id", goalId);
                    if (updateErr) {
                      console.error("Goal update failed:", updateErr);
                    } else {
                      console.log("Goal updated successfully:", { goalId, newInvested, progress });
                    }
                  }
                }
              } catch (e) {
                console.error("Error updating goal:", e);
              }
            }
            selectedGoalIdRef.current = null;
            goalInvestAmountRef.current = 0;
            setSelectedGoalId(null);
            navigationHistory.current = [];
            setPreviousPageName(null);
            setCurrentPage("paymentSuccess");
          }}
          onCancel={goBack}
        />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "newsArticle") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <NewsArticlePage
          articleId={selectedArticleId}
          onBack={goBack}
        />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "openStrategies") {
    goBack();
    if (!showOpenStrategiesMaintenance) setShowOpenStrategiesMaintenance(true);
    return null;
  }

  if (currentPage === "factsheet") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <FactsheetPage
          onBack={goBack}
          strategy={selectedStrategy}
          onOpenInvest={(strategy) => {
            setSelectedStrategy(strategy);
            navigateTo("investAmount");
          }}
          onNavigateToOnboarding={() => navigateTo("identityCheck")}
        />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "investAmount") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <InvestAmountPage
          onBack={goBack}
          strategy={selectedStrategy}
          paymentMethod={pendingPaymentMethod}
          onContinue={(amount, baseAmount) => {
            setInvestmentAmount(amount);
            setBaseInvestmentAmount(baseAmount || amount);
            setPendingGoalFlow({
              type: "strategy",
              amount,
              baseAmount: baseAmount || amount,
              assetName: selectedStrategy?.name || "Strategy",
              strategyId: selectedStrategy?.id || selectedStrategy?.strategyId || null,
            });
            setShowGoalModal(true);
          }}
        />
        <GoalLinkModal
          isOpen={showGoalModal && pendingGoalFlow?.type === "strategy"}
          onClose={() => { setShowGoalModal(false); setPendingGoalFlow(null); setSelectedGoalId(null); selectedGoalIdRef.current = null; goalInvestAmountRef.current = 0; }}
          onConfirm={async (goalId) => {
            setSelectedGoalId(goalId);
            selectedGoalIdRef.current = goalId;
            goalInvestAmountRef.current = pendingGoalFlow?.baseAmount || pendingGoalFlow?.amount || investmentAmount;
            pendingPaymentTypeRef.current = "strategy";
            setShowGoalModal(false);
            setPendingGoalFlow(null);

            // Use ref for latest status to avoid race conditions and destructuring bugs
            if (!onboardingRef.current.complete) {
              navigateTo("identityCheck");
              return;
            }
            setShowPaymentMethodModal(true);
          }}
          investmentAmount={pendingGoalFlow?.baseAmount || pendingGoalFlow?.amount || investmentAmount}
          assetName={pendingGoalFlow?.assetName || selectedStrategy?.name || "Strategy"}
        />
        <PaymentMethodModal
          isOpen={showPaymentMethodModal}
          onClose={() => setShowPaymentMethodModal(false)}
          amount={investmentAmount}
          strategyName={selectedStrategy?.name || "Investment"}
          onSelectPaystack={() => { setShowPaymentMethodModal(false); setPendingPaymentMethod("paystack"); navigateTo("payment"); }}
          onSelectWallet={() => { setShowPaymentMethodModal(false); setPendingPaymentMethod("wallet"); navigateTo("payment"); }}
          onSelectOzow={async () => {
            try {
              const { data: { user } } = await supabase.auth.getUser();
              const baseUrl = window.location.origin;
              const resp = await fetch("/api/ozow/initiate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  amount: investmentAmount,
                  strategyName: selectedStrategy?.name || "Investment",
                  strategyId: selectedStrategy?.id || null,
                  userId: user?.id || null,
                  userEmail: user?.email || null,
                  successUrl: `${baseUrl}/?ozow=success`,
                  cancelUrl: `${baseUrl}/?ozow=cancel`,
                  errorUrl: `${baseUrl}/?ozow=error`,
                }),
              });
              const data = await resp.json();
              if (data.success && data.action_url) {
                sessionStorage.setItem("ozow_pending", JSON.stringify({
                  transactionRef: data.TransactionReference,
                  strategyId: data.Optional1,
                  amount: data.Amount,
                }));
                const form = document.createElement("form");
                form.method = "POST";
                form.action = data.action_url;
                const skipFields = ["success", "action_url"];
                Object.entries(data).forEach(([key, value]) => {
                  if (skipFields.includes(key)) return;
                  const input = document.createElement("input");
                  input.type = "hidden";
                  input.name = key;
                  input.value = value;
                  form.appendChild(input);
                });
                document.body.appendChild(form);
                form.submit();
                document.body.removeChild(form);
              } else {
                alert(data.error || "Failed to initiate Ozow payment. Please try again.");
              }
            } catch (err) {
              console.error("Ozow error:", err);
              alert("Could not connect to Ozow. Please try another payment method.");
            }
          }}
          onEFTConfirm={async () => {
            setShowPaymentMethodModal(false);
            try {
              const { data: { session } } = await supabase.auth.getSession();
              const token = session?.access_token;
              const eftRef = `EFT-${Date.now()}`;
              const stratId = selectedStrategy?.strategyId || selectedStrategy?.id || null;
              const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
              await fetch("/api/eft-deposit", {
                method: "POST",
                headers,
                body: JSON.stringify({
                  amount: investmentAmount,
                  baseAmount: baseInvestmentAmount || investmentAmount,
                  reference: eftRef,
                  securityId: selectedStrategy?.id,
                  symbol: selectedStrategy?.symbol || selectedStrategy?.short_name || "",
                  name: selectedStrategy?.name || "",
                  strategyId: stratId,
                }),
              });
            } catch (e) {
              console.error("EFT record error:", e);
            }
            setPendingPaymentInfo({ strategy: selectedStrategy?.name, amount: investmentAmount });
            navigationHistory.current = [];
            setPreviousPageName(null);
            setCurrentPage("paymentPending");
          }}
        />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "payment") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <PaymentPage
          onBack={goBack}
          strategy={selectedStrategy}
          amount={investmentAmount}
          baseAmount={baseInvestmentAmount}
          initialMethod={pendingPaymentMethod}
          onOpenDeposit={() => navigateTo("deposit")}
          onSuccess={async (response) => {
            console.log("Payment successful:", response);
            const goalId = selectedGoalIdRef.current;
            const goalAmount = goalInvestAmountRef.current;
            if (goalId && supabase) {
              try {
                const { data: { session } } = await supabase.auth.getSession();
                if (session?.user) {
                  const { data: goal, error: fetchErr } = await supabase
                    .from("investment_goals")
                    .select("current_amount, target_amount")
                    .eq("id", goalId)
                    .single();
                  if (fetchErr) console.error("Error fetching goal for update:", fetchErr);
                  if (goal) {
                    const prevInvested = goal.current_amount || 0;
                    const newInvested = prevInvested + (goalAmount || 0);
                    const progress = goal.target_amount > 0 ? Math.min(100, (newInvested / goal.target_amount) * 100) : 0;
                    const { error: updateErr } = await supabase
                      .from("investment_goals")
                      .update({ current_amount: newInvested })
                      .eq("id", goalId);
                    if (updateErr) {
                      console.error("Goal update failed:", updateErr);
                    } else {
                      console.log("Goal updated successfully:", { goalId, newInvested, progress });
                    }
                  }
                }
              } catch (e) {
                console.error("Error updating goal:", e);
              }
            }
            selectedGoalIdRef.current = null;
            goalInvestAmountRef.current = 0;
            setSelectedGoalId(null);
            navigationHistory.current = [];
            setPreviousPageName(null);
            setCurrentPage("paymentSuccess");
          }}
          onCancel={goBack}
        />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "paymentSuccess") {
    return <PaymentSuccessPage onDone={() => setCurrentPage("home")} />;
  }

  if (currentPage === "paymentPending") {
    return (
      <PaymentPendingPage
        strategy={pendingPaymentInfo?.strategy}
        amount={pendingPaymentInfo?.amount}
        onDone={() => { setPendingPaymentInfo(null); setCurrentPage("home"); }}
      />
    );
  }

  if (currentPage === "more") {
    return (
      <AppLayout
        activeTab="more"
        onTabChange={handleTabChange}
        onWithdraw={handleWithdrawRequest}
        onShowComingSoon={handleShowComingSoon}
        modal={modal}
        onCloseModal={closeModal}
      >
        <MorePage onNavigate={navigateTo} />
      </AppLayout>
    );
  }

  if (currentPage === "settings") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <AppLayout
          activeTab="more"
          onTabChange={handleTabChange}
          onWithdraw={handleWithdrawRequest}
          onShowComingSoon={handleShowComingSoon}
          modal={modal}
          onCloseModal={closeModal}
        >
          <SettingsPage onNavigate={navigateTo} onBack={goBack} />
        </AppLayout>
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "biometricsDebug") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <AppLayout
          activeTab="more"
          onTabChange={handleTabChange}
          onWithdraw={handleWithdrawRequest}
          onShowComingSoon={handleShowComingSoon}
          modal={modal}
          onCloseModal={closeModal}
        >
          <BiometricsDebugPage onNavigate={navigateTo} onBack={goBack} />
        </AppLayout>
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "editProfile") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <EditProfilePage onNavigate={navigateTo} onBack={goBack} />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "familyDashboard") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <FamilyDashboardPage
          onBack={goBack}
          userId={profile?.id}
          onOpenChildDashboard={(child) => {
            setSelectedFamilyChild(child);
            navigateTo("childDashboard");
          }}
        />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "childDashboard") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <ChildDashboardPage
          child={selectedFamilyChild}
          onBack={goBack}
        />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "funeralCover") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <FuneralCoverPage onBack={goBack} userId={profile?.id} profile={profile} initialDependents={funeralCoverInitialDependents} />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "profileDetails") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <ProfileDetailsPage onNavigate={navigateTo} onBack={goBack} />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "notifications") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <NotificationsPage
          onBack={goBack}
          onOpenSettings={() => navigateTo("notificationSettings")}
        />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "notificationSettings") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <NotificationSettingsPage onBack={goBack} />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "mintBalance") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <AppLayout
          activeTab="home"
          onTabChange={handleTabChange}
          onWithdraw={handleWithdrawRequest}
          onShowComingSoon={handleShowComingSoon}
          modal={modal}
          onCloseModal={closeModal}
        >
          <MintBalancePage
            onBack={goBack}
            onOpenInvestments={() => setCurrentPage("investments")}
            onOpenCredit={() => setCurrentPage("credit")}
            onOpenActivity={() => navigateTo("activity")}
            onOpenSettings={() => navigateTo("settings")}
            onOpenInvest={() => navigateTo("markets")}
            onOpenCreditApply={() => navigateTo("creditApply")}
          />
        </AppLayout>
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "activity") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <AppLayout
          activeTab="home"
          onTabChange={handleTabChange}
          onWithdraw={handleWithdrawRequest}
          onShowComingSoon={handleShowComingSoon}
          modal={modal}
          onCloseModal={closeModal}
        >
          <ActivityPage onBack={goBack} />
        </AppLayout>
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "actions") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <ActionsPage
          onBack={goBack}
          onNavigate={navigateTo}
        />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "identityCheck") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <IdentityCheckPage
          onBack={() => navigateTo("home")}
          onComplete={() => navigateTo("home")}
        />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "bankLink") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <MintBankPage
          onBack={goBack}
          onComplete={() => setCurrentPage("home")}
        />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "invite") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <InvitePage onBack={goBack} />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "creditApply") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <AppLayout
          activeTab="creditApply"
          onTabChange={handleTabChange}
          onWithdraw={handleWithdrawRequest}
          onShowComingSoon={handleShowComingSoon}
          modal={modal}
          onCloseModal={closeModal}
        >
          <CreditApplyPage
            onBack={goBack}
            onTabChange={navigateTo}
            onOpenNotifications={() => {
              setNotificationReturnPage("creditApply");
              navigateTo("notifications");
            }}
          />
        </AppLayout>
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "unsecuredCreditDashboard") {
    return (
      <AppLayout
        activeTab="creditApply"
        onTabChange={handleTabChange}
        onWithdraw={handleWithdrawRequest}
        onShowComingSoon={handleShowComingSoon}
        modal={modal}
        onCloseModal={closeModal}
      >
        <UnsecuredCreditDashboard
          profile={profile}
          onTabChange={navigateTo}
          onOpenNotifications={() => {
            setNotificationReturnPage("unsecuredCreditDashboard");
            navigateTo("notifications");
          }}
        />
      </AppLayout>
    );
  }

  if (currentPage === "creditRepay") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <CreditRepayPage onBack={goBack} />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "changePassword") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <ChangePasswordPage onNavigate={navigateTo} onBack={goBack} />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "activeSessions") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <ActiveSessionsPage onBack={goBack} onLogout={() => { if (supabase) supabase.auth.signOut(); setCurrentPage("welcome"); }} />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "pinSetup") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <PinSetupPage onBack={goBack} />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "legal") {
    return (
      <SwipeBackWrapper onBack={goBack} enabled={canSwipeBack} previousPage={previousPageComponent}>
        <LegalDocumentationPage onNavigate={navigateTo} onBack={goBack} />
      </SwipeBackWrapper>
    );
  }

  if (currentPage === "userOnboarding") {
    return <UserOnboardingPage onComplete={() => setCurrentPage("home")} />;
  }

  if (currentPage === "welcome") {
    return (
      <OnboardingPage
        onCreateAccount={() => openAuthFlow("email")}
        onLogin={() => openAuthFlow("loginEmail")}
      />
    );
  }

  const recordSession = async () => {
    try {
      if (!supabase) return;
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) return;
      const ua = navigator.userAgent || '';
      let browser = 'Unknown';
      if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
      else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
      else if (ua.includes('Firefox')) browser = 'Firefox';
      else if (ua.includes('Edg')) browser = 'Edge';
      else if (ua.includes('Opera') || ua.includes('OPR')) browser = 'Opera';
      let os = 'Unknown';
      if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
      else if (ua.includes('Android')) os = 'Android';
      else if (ua.includes('Mac OS')) os = 'macOS';
      else if (ua.includes('Windows')) os = 'Windows';
      else if (ua.includes('Linux')) os = 'Linux';
      const isMobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
      const deviceType = isMobile ? 'mobile' : 'desktop';
      let fingerprint = localStorage.getItem('mint_session_fingerprint');
      if (!fingerprint) {
        fingerprint = 'sf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('mint_session_fingerprint', fingerprint);
      }
      const res = await fetch('/api/sessions/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userAgent: ua, browser, os, deviceType, sessionFingerprint: fingerprint }),
      });
      const json = await res.json();
      if (json.sessionId) {
        localStorage.setItem('mint_session_id', json.sessionId);
      }
    } catch (err) {
      console.error('Failed to record session:', err);
    }
  };

  const handleSignupComplete = async () => {
    justLoggedInRef.current = true;
    sessionCheckSkipUntilRef.current = Date.now() + 30000;
    localStorage.setItem('mint_last_activity', Date.now().toString());
    setCurrentPage("home");
    try {
      await recordSession();
      if (supabase) {
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user) {
          await createWelcomeNotification(userData.user.id).catch(() => { });
          await refetchNotifications().catch(() => { });
        }
      }
    } catch (err) {
      console.error('Post-signup tasks error:', err);
    }
    justLoggedInRef.current = false;
  };

  const handleLoginComplete = async () => {
    justLoggedInRef.current = true;
    sessionCheckSkipUntilRef.current = Date.now() + 30000;
    setShowSessionExpired(false);
    localStorage.setItem('mint_last_activity', Date.now().toString());
    const returnPage = sessionExpiredPageRef.current;
    if (returnPage && !['welcome', 'auth', 'linkExpired'].includes(returnPage)) {
      setCurrentPage(returnPage);
      sessionExpiredPageRef.current = null;
    } else {
      setCurrentPage("home");
    }
    try {
      await recordSession();
      if (supabase) {
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user) {
          await refetchNotifications().catch(() => { });
        }
      }
    } catch (err) {
      console.error('Post-login tasks error:', err);
    }
    justLoggedInRef.current = false;
  };

  const handlePreLogin = () => {
    justLoggedInRef.current = true;
    sessionCheckSkipUntilRef.current = Date.now() + 30000;
  };

  return (
    <AuthPage
      initialStep={authStep}
      onSignupComplete={handleSignupComplete}
      onLoginComplete={handleLoginComplete}
      onPreLogin={handlePreLogin}
    />
  );
};

export default App;
