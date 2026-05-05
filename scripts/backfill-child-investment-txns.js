#!/usr/bin/env node
/**
 * Backfill child-investment transactions.
 *
 * For each active stock_holdings_c row where family_member_id is not null,
 * groups by (family_member_id, strategy_id) and inserts a single
 * "Strategy Investment" transaction with amount = sum(quantity * avg_fill).
 *
 * Idempotent: skips groups that already have a transaction with
 * store_reference starting with `BACKFILL-CHILD-INV-<family_member_id>-<strategy_id>`.
 *
 * Run: node scripts/backfill-child-investment-txns.js [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually so the script works regardless of environment
try {
  const envPath = resolve(__dirname, "..", ".env");
  const text = readFileSync(envPath, "utf-8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
} catch {}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");
const db = createClient(SUPABASE_URL, SERVICE_KEY);

async function main() {
  console.log(`[backfill] ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

  const { data: holdings, error: hErr } = await db
    .from("stock_holdings_c")
    .select("id, family_member_id, strategy_id, quantity, avg_fill, created_at, user_id")
    .not("family_member_id", "is", null)
    .eq("Status", "active");
  if (hErr) throw hErr;
  console.log(`[backfill] Found ${holdings.length} child holdings`);

  // Group by (family_member_id, strategy_id)
  const groups = new Map();
  for (const h of holdings) {
    const key = `${h.family_member_id}::${h.strategy_id || "none"}`;
    const g = groups.get(key) || {
      family_member_id: h.family_member_id,
      strategy_id: h.strategy_id,
      user_id: h.user_id,
      amountCents: 0,
      earliest: h.created_at,
    };
    g.amountCents += Math.round(Number(h.quantity || 0) * Number(h.avg_fill || 0));
    if (h.created_at && (!g.earliest || h.created_at < g.earliest)) g.earliest = h.created_at;
    groups.set(key, g);
  }
  console.log(`[backfill] ${groups.size} (child, strategy) groups`);

  // Preload strategies + children for nice descriptions
  const strategyIds = [...new Set([...groups.values()].map(g => g.strategy_id).filter(Boolean))];
  const childIds = [...new Set([...groups.values()].map(g => g.family_member_id))];

  const [{ data: strategies }, { data: children }] = await Promise.all([
    strategyIds.length
      ? db.from("strategies_c").select("id, name").in("id", strategyIds)
      : Promise.resolve({ data: [] }),
    db.from("family_members").select("id, first_name").in("id", childIds),
  ]);
  const stratMap = Object.fromEntries((strategies || []).map(s => [s.id, s]));
  const childMap = Object.fromEntries((children || []).map(c => [c.id, c]));

  let inserted = 0;
  let skipped = 0;

  for (const g of groups.values()) {
    const refPrefix = `BACKFILL-CHILD-INV-${g.family_member_id}-${g.strategy_id || "none"}`;

    // Idempotency check
    const { data: existing, error: exErr } = await db
      .from("transactions")
      .select("id")
      .ilike("store_reference", `${refPrefix}%`)
      .limit(1);
    if (exErr) throw exErr;
    if (existing && existing.length > 0) {
      skipped++;
      continue;
    }

    const strat = stratMap[g.strategy_id];
    const child = childMap[g.family_member_id];
    const strategyName = strat?.name || "Strategy";
    const childName = child?.first_name || "child";

    const row = {
      user_id: g.user_id,
      family_member_id: g.family_member_id,
      name: `Strategy Investment: ${strategyName}`,
      direction: "debit",
      amount: g.amountCents,
      description: `${strategyName} investment for ${childName}`,
      store_reference: `${refPrefix}-${Date.now()}`,
      status: "posted",
      created_at: g.earliest,
      transaction_date: g.earliest,
    };

    console.log(
      `[backfill] ${DRY_RUN ? "WOULD INSERT" : "INSERT"}: ${childName} / ${strategyName} / ${(g.amountCents / 100).toFixed(2)} ZAR @ ${g.earliest}`,
    );

    if (!DRY_RUN) {
      const { error: insErr } = await db.from("transactions").insert(row);
      if (insErr) {
        console.error("[backfill] insert failed:", insErr.message);
        continue;
      }
    }
    inserted++;
  }

  console.log(`[backfill] Done. inserted=${inserted}, skipped=${skipped}`);
}

main().catch(e => {
  console.error("[backfill] fatal:", e);
  process.exit(1);
});
