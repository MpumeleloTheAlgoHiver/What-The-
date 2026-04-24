import { useSyncExternalStore, useCallback } from "react";
import { supabase } from "./supabase";

const globalState = {
  lastUpdated: null,
  isConnected: false,
  channel: null,
  listeners: new Set(),
  subscriberCount: 0,
  isSettingUp: false,
};

function notifyListeners() {
  globalState.listeners.forEach((listener) => listener());
}

function getSnapshot() {
  return globalState;
}

function subscribe(listener) {
  globalState.listeners.add(listener);
  globalState.subscriberCount++;

  if (globalState.subscriberCount === 1 && !globalState.channel && !globalState.isSettingUp) {
    setupRealtimePrices();
  }

  return () => {
    globalState.listeners.delete(listener);
    globalState.subscriberCount--;
    if (globalState.subscriberCount <= 0) {
      teardownRealtimePrices();
      globalState.subscriberCount = 0;
    }
  };
}

export function setupRealtimePrices() {
  if (!supabase || globalState.channel || globalState.isSettingUp) return;

  globalState.isSettingUp = true;
  console.log("[realtime-prices] Setting up singleton subscription");

  globalState.channel = supabase
    .channel("prices-realtime-singleton")
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "securities_c",
      },
      (payload) => {
        const changed = payload.new;
        if (
          changed.last_price !== undefined ||
          changed.change_price !== undefined ||
          changed.change_percent !== undefined ||
          changed.change_percentage !== undefined
        ) {
          console.log("[realtime-prices] Security price updated:", changed.symbol || changed.id);
          globalState.lastUpdated = Date.now();
          notifyListeners();
        }
      }
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "stock_returns_c",
      },
      (payload) => {
        console.log("[realtime-prices] New price record inserted for security:", payload.new?.security_id);
        globalState.lastUpdated = Date.now();
        notifyListeners();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "stock_holdings_c",
      },
      (payload) => {
        console.log("[realtime-prices] Holding updated:", payload.new?.id);
        globalState.lastUpdated = Date.now();
        notifyListeners();
      }
    )
    .subscribe((status, err) => {
      console.log("[realtime-prices] Subscription status:", status);
      if (err) {
        console.error("[realtime-prices] Subscription error:", err);
      }

      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn(`[realtime-prices] Connection issue: ${status}. Realtime updates may be delayed.`);
      }

      const wasConnected = globalState.isConnected;
      globalState.isConnected = status === "SUBSCRIBED";
      globalState.isSettingUp = false;
      if (wasConnected !== globalState.isConnected) {
        notifyListeners();
      }
    });
}

export function teardownRealtimePrices() {
  if (globalState.channel) {
    console.log("[realtime-prices] Tearing down subscription");
    supabase.removeChannel(globalState.channel);
    globalState.channel = null;
    globalState.isConnected = false;
    globalState.isSettingUp = false;
    notifyListeners();
  }
}

let snapshotRef = { lastUpdated: null, isConnected: false };

function getStableSnapshot() {
  const current = globalState;
  if (
    snapshotRef.lastUpdated !== current.lastUpdated ||
    snapshotRef.isConnected !== current.isConnected
  ) {
    snapshotRef = {
      lastUpdated: current.lastUpdated,
      isConnected: current.isConnected,
    };
  }
  return snapshotRef;
}

export const useRealtimePrices = () => {
  const state = useSyncExternalStore(subscribe, getStableSnapshot, getStableSnapshot);
  return state;
};
