import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";
import { parseOnboardingFlags } from "./checkOnboardingComplete";

async function fetchOnboardingStatus() {
  if (!supabase) {
    return { isComplete: false, isLoading: false, error: null };
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      return { isComplete: false, isLoading: false, error: null };
    }

    try {
      const res = await fetch("/api/onboarding/status", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const json = await res.json();
        console.log("[useOnboardingStatus] Total Onboarding Status:", json.is_fully_onboarded ? "COMPLETE ✅" : "INCOMPLETE ❌", json);
        return { isComplete: json.is_fully_onboarded === true, isLoading: false, error: null };
      }
    } catch (e) {
      console.warn("[useOnboardingStatus] API fallback to DB:", e.message);
    }

    const { data, error: dbError } = await supabase
      .from("user_onboarding")
      .select("kyc_status, sumsub_raw")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (dbError) throw dbError;

    if (data && data.length > 0) {
      const flags = parseOnboardingFlags(data[0]);
      console.log("[useOnboardingStatus] DB Fallback Flags:", flags.allComplete ? "COMPLETE ✅" : "INCOMPLETE ❌", flags);
      return { isComplete: flags.allComplete, isLoading: false, error: null };
    } else {
      return { isComplete: false, isLoading: false, error: null };
    }
  } catch (err) {
    console.error("[useOnboardingStatus] Error:", err);
    return { isComplete: false, isLoading: false, error: err };
  }
}

export const useOnboardingStatus = ({ enabled = true } = {}) => {
  const [state, setState] = useState({
    onboardingComplete: false,
    loading: enabled,
    error: null,
  });

  const checkStatus = useCallback(async () => {
    if (!enabled) return;
    setState({ onboardingComplete: false, loading: true, error: null });
    const result = await fetchOnboardingStatus();
    setState({
      onboardingComplete: result.isComplete,
      loading: false,
      error: result.error,
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    checkStatus();
  }, [enabled, checkStatus]);

  return {
    onboardingComplete: state.onboardingComplete,
    loading: state.loading,
    error: state.error,
    refetch: checkStatus,
  };
};
