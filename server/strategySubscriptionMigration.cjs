"use strict";

const DDL = `
  CREATE TABLE IF NOT EXISTS strategy_subscriptions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL,
    strategy_id      UUID NOT NULL,
    strategy_name    TEXT,
    next_billing_date DATE NOT NULL,
    amount_cents     INTEGER NOT NULL DEFAULT 2900,
    status           TEXT NOT NULL DEFAULT 'active',
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, strategy_id)
  );
`;

async function ensureSupabaseTable(supabaseAdmin, supabaseAnon) {
  const client = supabaseAdmin || supabaseAnon;
  if (!client) return;
  try {
    const { error } = await client.rpc("exec_sql", { query: DDL });
    if (error) {
      console.warn("[strategy-sub-migration] Supabase exec_sql warning:", error.message);
    } else {
      console.log("[strategy-sub-migration] strategy_subscriptions table ensured in Supabase");
    }
  } catch (e) {
    console.warn("[strategy-sub-migration] Could not ensure Supabase table:", e.message);
  }
}

async function runStrategySubscriptionMigration(pgPool, supabaseAdmin, supabaseAnon) {
  // 1. Local Postgres (for dev/cron)
  if (pgPool) {
    let client;
    try {
      client = await pgPool.connect();
      await client.query(DDL);
      console.log("[strategy-sub-migration] strategy_subscriptions table ready (local pg)");
    } catch (e) {
      console.error("[strategy-sub-migration] Local migration failed:", e.message);
    } finally {
      if (client) client.release();
    }
  }

  // 2. Supabase (for production / Vercel)
  await ensureSupabaseTable(supabaseAdmin, supabaseAnon);
}

module.exports = { runStrategySubscriptionMigration };
