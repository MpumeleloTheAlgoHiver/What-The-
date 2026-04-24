const fs = require("fs");
const path = require("path");

// Simple .env loader for local development (no dotenv dependency required)
try {
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    envContent.split("\n").forEach(line => {
      // Basic key=value parsing
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || "";
        // Remove quotes if present
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
        // Only set if not already set by system environment
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    });
    console.log("[Server] Local .env file loaded");
  }
} catch (e) {
  console.warn("[Server] Could not load .env file:", e.message);
}

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { Pool } = require("pg");
const truIDClient = require("./truidClient.cjs");
const { Resend } = require("resend");
const { runFuneralCoverMigration } = require("./funeralCoverMigration.cjs");

// Helper to check both standard and VITE_ prefixed env vars
const readEnv = (key) => process.env[key] || process.env[`VITE_${key}`];

let _resendClient = null;
function getResendClient() {
  if (!_resendClient && process.env.RESEND_API_KEY) {
    _resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return _resendClient;
}

async function sendOrderFillEmail(db, { transactionId, holdingId }) {
  try {
    const resend = getResendClient();
    if (!resend) return;

    const dedupKey = transactionId || holdingId;
    if (dedupKey) {
      const { data: existing } = await db.from("order_emails")
        .select("id, fill_status")
        .or(`transaction_id.eq.${dedupKey},holding_id.eq.${dedupKey}`)
        .limit(1)
        .maybeSingle();
      if (existing && existing.fill_status === "sent") {
        console.log(`[order-fill-email] Already sent for tx:${transactionId} holding:${holdingId} — skipping`);
        return;
      }
    }

    let userId = null;
    let txData = null;
    let holdingData = null;

    if (transactionId) {
      const { data } = await db.from("transactions").select("user_id, name, amount, store_reference, transaction_date").eq("id", transactionId).maybeSingle();
      if (data) { txData = data; userId = data.user_id; }
    }
    if (holdingId) {
      const { data } = await db.from("stock_holdings_c").select("user_id, security_id, quantity, avg_fill, market_value").eq("id", holdingId).maybeSingle();
      if (data) { holdingData = data; if (!userId) userId = data.user_id; }
    }
    if (!userId) return;

    let userEmail = null;
    const { data: userData } = await db.auth.admin.getUserById(userId);
    if (userData?.user?.email) userEmail = userData.user.email;
    if (!userEmail) return;

    let assetName = null;
    let assetSymbol = null;
    let strategyName = null;
    const txName = txData?.name || "";
    if (txName.startsWith("Strategy Investment:")) {
      strategyName = txName.replace("Strategy Investment: ", "");
    } else {
      assetName = txName.replace("Purchased ", "");
    }

    if (holdingData?.security_id) {
      const { data: sec } = await db.from("securities_c").select("name, symbol").eq("id", holdingData.security_id).maybeSingle();
      if (sec) { assetName = sec.name; assetSymbol = sec.symbol; }
    }

    const amountCents = txData?.amount || (holdingData?.market_value) || 0;
    const fillPriceCents = holdingData?.avg_fill || null;
    const quantity = holdingData?.quantity || null;
    const reference = txData?.store_reference || null;
    const orderDate = txData?.transaction_date || null;
    const fillDate = new Date().toISOString();

    const displayName = strategyName || assetName || assetSymbol || "Asset";
    const subject = `Order Filled \u2014 ${displayName}`;

    const { buildOrderFillHtml } = await import('../api/_lib/order-email-templates.js');
    const html = buildOrderFillHtml({
      assetName, assetSymbol, strategyName,
      amountCents, quantity, fillPriceCents,
      reference, orderDate, fillDate,
    });

    const resp = await resend.emails.send({
      from: "Mint <orders@mymint.co.za>",
      to: [userEmail],
      subject,
      html,
    });

    const resendId = resp?.data?.id || null;

    const fillStatus = resp.error ? "failed" : "sent";
    const existingRow = await db.from("order_emails")
      .select("id")
      .or(`transaction_id.eq.${transactionId || ""},holding_id.eq.${holdingId || ""}`)
      .limit(1)
      .maybeSingle();

    if (existingRow?.data?.id) {
      await db.from("order_emails").update({
        fill_status: fillStatus,
        fill_resend_id: resendId,
        fill_sent_at: fillDate,
        fill_price_cents: fillPriceCents,
        fill_date: fillDate,
        updated_at: new Date().toISOString(),
      }).eq("id", existingRow.data.id).then(() => { }).catch((err) => console.warn("[order-fill-email] Log update error:", err?.message));
    } else {
      await db.from("order_emails").insert({
        user_id: userId,
        email: userEmail,
        asset_name: assetName || null,
        asset_symbol: assetSymbol || null,
        strategy_name: strategyName || null,
        amount_cents: amountCents,
        quantity,
        reference,
        order_date: orderDate,
        confirmation_status: "unknown",
        fill_status: fillStatus,
        fill_resend_id: resendId,
        fill_sent_at: fillDate,
        fill_price_cents: fillPriceCents,
        fill_date: fillDate,
        transaction_id: transactionId || null,
        holding_id: holdingId || null,
      }).then(() => { }).catch((err) => console.warn("[order-fill-email] Log insert error:", err?.message));
    }

    console.log(`[order-fill-email] Sent to ${userEmail} for ${displayName}`);
  } catch (err) {
    console.error("[order-fill-email] Failed:", err.message);
  }
}

async function sendOrderConfirmationEmail(db, { userId, userEmail, assetName, assetSymbol, strategyName, amountCents, quantity, priceCents, reference, orderDate, paymentMethod }) {
  try {
    const resend = getResendClient();
    if (!resend) {
      console.log("[order-email] RESEND_API_KEY not set — skipping confirmation email");
      return;
    }

    const isStrategy = !!strategyName;
    const displayName = strategyName || assetName || assetSymbol || "Unknown";
    const subject = isStrategy
      ? `Order Confirmed \u2014 ${strategyName}`
      : `Order Confirmed \u2014 ${assetName || assetSymbol || "Stock"}`;

    const { buildOrderConfirmationHtml } = await import('../api/_lib/order-email-templates.js');
    const html = buildOrderConfirmationHtml({
      assetName, assetSymbol, strategyName,
      amountCents, quantity, priceCents,
      reference, orderDate,
      paymentMethod,
    });

    const resp = await resend.emails.send({
      from: "Mint <orders@mymint.co.za>",
      to: [userEmail],
      subject,
      html,
    });

    const resendId = resp?.data?.id || null;
    if (resp.error) {
      console.error("[order-email] Resend error:", resp.error.message);
    }

    await db.from("order_emails").insert({
      user_id: userId,
      email: userEmail,
      asset_name: assetName || null,
      asset_symbol: assetSymbol || null,
      strategy_name: strategyName || null,
      amount_cents: amountCents,
      quantity: quantity || null,
      reference: reference || null,
      order_date: orderDate,
      confirmation_status: resp.error ? "failed" : "sent",
      confirmation_resend_id: resendId,
      confirmation_sent_at: new Date().toISOString(),
      confirmation_price_cents: priceCents || null,
    }).then(() => { }).catch((err) => console.warn("[order-email] Log write error:", err?.message));

    console.log(`[order-email] Confirmation sent to ${userEmail} for ${displayName}`);
  } catch (err) {
    console.error("[order-email] Failed to send confirmation:", err.message);
  }
}

const pgPool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
}) : null;

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

// Local Content Security Policy for testing framing of and by TrueID
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "frame-ancestors 'self' http://localhost:5000 http://localhost:5001 http://localhost:5002 https://*.truidconnect.io https://truidconnect.io https://*.thealgohive.com https://thealgohive.com https://algo-money-nine.vercel.app"
  );
  next();
});

// Sumsub configuration
const SUMSUB_APP_TOKEN = readEnv("SUMSUB_APP_TOKEN");
const SUMSUB_SECRET_KEY = readEnv("SUMSUB_SECRET_KEY");
const SUMSUB_BASE_URL = "https://api.sumsub.com";
const SUMSUB_LEVEL_NAME = readEnv("SUMSUB_LEVEL_NAME") || "mint-advanced-kyc";

// Create signature for Sumsub API requests
function createSumsubSignature(ts, method, path, body = "") {
  const data = ts + method.toUpperCase() + path + body;
  return crypto
    .createHmac("sha256", SUMSUB_SECRET_KEY)
    .update(data)
    .digest("hex");
}

// Create Sumsub applicant
async function createSumsubApplicant(externalUserId, levelName = SUMSUB_LEVEL_NAME) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const path = `/resources/applicants?levelName=${encodeURIComponent(levelName)}`;
  const body = JSON.stringify({ externalUserId });
  const signature = createSumsubSignature(ts, "POST", path, body);

  const response = await fetch(`${SUMSUB_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-App-Access-Ts": ts,
      "X-App-Access-Sig": signature,
      "X-App-Token": SUMSUB_APP_TOKEN,
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create applicant: ${errorText}`);
  }

  return response.json();
}

// Generate Sumsub access token
async function generateSumsubAccessToken(userId, levelName = SUMSUB_LEVEL_NAME) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const path = `/resources/accessTokens?userId=${encodeURIComponent(userId)}&levelName=${encodeURIComponent(levelName)}`;
  const method = "POST";

  const signature = createSumsubSignature(ts, method, path);

  const response = await fetch(`${SUMSUB_BASE_URL}${path}`, {
    method,
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-App-Token": SUMSUB_APP_TOKEN,
      "X-App-Access-Ts": ts,
      "X-App-Access-Sig": signature,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Sumsub API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

// Get applicant status from Sumsub
async function getSumsubApplicantStatus(applicantId) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const path = `/resources/applicants/${applicantId}/requiredIdDocsStatus`;
  const method = "GET";

  const signature = createSumsubSignature(ts, method, path);

  const response = await fetch(`${SUMSUB_BASE_URL}${path}`, {
    method,
    headers: {
      "Accept": "application/json",
      "X-App-Token": SUMSUB_APP_TOKEN,
      "X-App-Access-Ts": ts,
      "X-App-Access-Sig": signature,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Sumsub API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

// Get applicant by external user ID
async function getSumsubApplicantByExternalId(externalUserId) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const path = `/resources/applicants/-;externalUserId=${encodeURIComponent(externalUserId)}/one`;
  const method = "GET";

  const signature = createSumsubSignature(ts, method, path);

  const response = await fetch(`${SUMSUB_BASE_URL}${path}`, {
    method,
    headers: {
      "Accept": "application/json",
      "X-App-Token": SUMSUB_APP_TOKEN,
      "X-App-Access-Ts": ts,
      "X-App-Access-Sig": signature,
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    const errorText = await response.text();
    throw new Error(`Sumsub API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

// Get required docs status for an applicant (checks which steps are complete/incomplete)
async function getSumsubRequiredDocsStatus(applicantId) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const path = `/resources/applicants/${applicantId}/requiredIdDocsStatus`;
  const method = "GET";

  const signature = createSumsubSignature(ts, method, path);

  const response = await fetch(`${SUMSUB_BASE_URL}${path}`, {
    method,
    headers: {
      "Accept": "application/json",
      "X-App-Token": SUMSUB_APP_TOKEN,
      "X-App-Access-Ts": ts,
      "X-App-Access-Sig": signature,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Failed to get required docs status:", errorText);
    return null;
  }

  return response.json();
}

const SUPABASE_URL = readEnv('SUPABASE_URL') || readEnv('VITE_SUPABASE_URL');
const SUPABASE_ANON_KEY = readEnv('SUPABASE_ANON_KEY') || readEnv('VITE_SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
let supabaseAdmin = null;
try {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    if (SUPABASE_SERVICE_ROLE_KEY) {
      supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      console.log('Supabase admin client initialized (service role)');
    }
  }
} catch (e) {
  console.warn('Supabase client not available:', e.message);
}

const { startMintMorningsListener, sendTestEmail } = require('./mintMorningsCron.cjs');
if (supabaseAdmin) {
  // startMintMorningsListener(supabaseAdmin);
}

function getAuthenticatedDb(token) {
  if (supabaseAdmin) return supabaseAdmin;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !token) return supabase;
  try {
    const { createClient } = require('@supabase/supabase-js');
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
  } catch (e) {
    return supabase;
  }
}

async function cleanupInvalidHoldings() {
  const db = supabaseAdmin || supabase;
  if (!db) return;
  try {
    const { data: holdings } = await db.from('stock_holdings_c').select('id, security_id');
    if (!holdings || holdings.length === 0) return;
    const secIds = holdings.map(h => h.security_id).filter(Boolean);
    const { data: strategies } = await db.from('strategies').select('id').in('id', secIds);
    const strategyIds = new Set((strategies || []).map(s => s.id));
    for (const h of holdings) {
      if (strategyIds.has(h.security_id)) {
        console.log('[cleanup] Deleting invalid stock_holding', h.id, 'security_id is a strategy');
        await db.from('stock_holdings_c').delete().eq('id', h.id);
      }
    }
  } catch (e) {
    console.error('[cleanup] Error cleaning up invalid holdings:', e.message);
  }
}

cleanupInvalidHoldings();

// ============================================================
// Settlement Status System
// Tracks investment lifecycle: pending (awaiting fill) → pending_broker → confirmed
// ============================================================
const SETTLEMENT_STATUSES = {
  PENDING: 'pending',
  PENDING_BROKER: 'pending_broker',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
};

const settlementConfig = {
  csdpEnabled: !!(process.env.CSDP_API_KEY && process.env.CSDP_API_URL),
  brokerEnabled: !!(process.env.BROKER_API_KEY && process.env.BROKER_API_URL),
  get isFullyIntegrated() {
    return this.csdpEnabled && this.brokerEnabled;
  },
};

console.log('[settlement] Config:', {
  csdpEnabled: settlementConfig.csdpEnabled,
  brokerEnabled: settlementConfig.brokerEnabled,
  fullyIntegrated: settlementConfig.isFullyIntegrated,
});

async function runSettlementMigration() {
  const db = supabaseAdmin || supabase;
  if (!db) return;

  try {
    const { data: testTx } = await db
      .from('transactions')
      .select('settlement_status')
      .limit(1);

    if (testTx !== null) {
      console.log('[settlement] settlement_status column already exists on transactions');
    }
  } catch (e) {
    if (e.message?.includes('settlement_status') || e.code === '42703') {
      console.log('[settlement] Adding settlement_status column to transactions...');
      try {
        const { error } = await db.rpc('exec_sql', {
          query: "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS settlement_status TEXT DEFAULT 'pending_csdp'"
        });
        if (error) {
          console.log('[settlement] Could not add column via RPC (expected if RPC not configured):', error.message);
        }
      } catch (rpcErr) {
        console.log('[settlement] RPC not available, settlement_status column needs manual addition');
      }
    }
  }

  try {
    const { data: testH } = await db
      .from('stock_holdings_c')
      .select('settlement_status')
      .limit(1);

    if (testH !== null) {
      console.log('[settlement] settlement_status column already exists on stock_holdings_c');
    }
  } catch (e) {
    if (e.message?.includes('settlement_status') || e.code === '42703') {
      console.log('[settlement] Adding settlement_status column to stock_holdings_c...');
      try {
        const { error } = await db.rpc('exec_sql', {
          query: "ALTER TABLE stock_holdings_c ADD COLUMN IF NOT EXISTS settlement_status TEXT DEFAULT 'pending_csdp'"
        });
        if (error) {
          console.log('[settlement] Could not add column via RPC:', error.message);
        }
      } catch (rpcErr) {
        console.log('[settlement] RPC not available for stock_holdings_c');
      }
    }
  }

  // Add is_active and exit_price columns if not present
  try {
    await db.rpc('exec_sql', { query: "ALTER TABLE stock_holdings_c ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true" });
    await db.rpc('exec_sql', { query: "ALTER TABLE stock_holdings_c ADD COLUMN IF NOT EXISTS exit_price BIGINT" });
    console.log('[holdings] is_active and exit_price columns ensured');
  } catch (e) {
    console.log('[holdings] Could not add is_active/exit_price columns (may already exist)');
  }

  // Add ytd_start_price column to securities for live YTD return calculation
  try {
    await db.rpc('exec_sql', { query: 'ALTER TABLE securities ADD COLUMN IF NOT EXISTS ytd_start_price INTEGER' });
    console.log('[securities] ytd_start_price column ensured');
  } catch (e) {
    console.log('[securities] ytd_start_price column may already exist (ok)');
  }
}

async function migrateGoalColumns() {
  const db = supabaseAdmin || supabase;
  if (!db) return;
  try {
    console.log('[goals] Ensuring all investment_goals columns exist...');
    const cols = [
      "ALTER TABLE investment_goals ADD COLUMN IF NOT EXISTS linked_strategy_id text",
      "ALTER TABLE investment_goals ADD COLUMN IF NOT EXISTS linked_security_id text",
      "ALTER TABLE investment_goals ADD COLUMN IF NOT EXISTS invested_amount numeric DEFAULT 0",
      "ALTER TABLE investment_goals ADD COLUMN IF NOT EXISTS linked_asset_name text",
      "ALTER TABLE investment_goals ADD COLUMN IF NOT EXISTS target_date date",
      "ALTER TABLE investment_goals ADD COLUMN IF NOT EXISTS progress_percent numeric DEFAULT 0",
    ];
    for (const sql of cols) {
      try {
        await db.rpc('exec_sql', { query: sql });
      } catch (e) {
        console.log('[goals] RPC failed for column, may need manual addition:', e.message);
      }
    }
  } catch (e) {
    console.log('[goals] Migration check error:', e.message);
  }
}
migrateGoalColumns();

async function migrateWalletColumns() {
  const db = supabaseAdmin || supabase;
  if (!db) return;
  try {
    const cols = [
      "ALTER TABLE wallets ADD COLUMN IF NOT EXISTS pending_balance numeric DEFAULT 0",
    ];
    for (const sql of cols) {
      try {
        await db.rpc('exec_sql', { query: sql });
      } catch (e) {
        console.log('[wallets] RPC failed for column, may need manual addition:', e.message);
      }
    }
    console.log('[wallets] pending_balance column ensured');
  } catch (e) {
    console.log('[wallets] Migration check error:', e.message);
  }
}
migrateWalletColumns();

async function ensureUserSessionsTable() {
  if (!pgPool) return;
  const client = await pgPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id         BIGSERIAL PRIMARY KEY,
        user_id    UUID NOT NULL,
        session_token TEXT NOT NULL,
        user_agent TEXT DEFAULT '',
        browser    TEXT DEFAULT '',
        os         TEXT DEFAULT '',
        device_type TEXT DEFAULT 'desktop',
        ip_address TEXT DEFAULT '',
        is_current BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_active_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token)`);
    console.log('[sessions] user_sessions table ready');
  } catch (e) {
    console.error('[sessions] Failed to create user_sessions table:', e.message);
  } finally {
    client.release();
  }
}
ensureUserSessionsTable();
runFuneralCoverMigration(pgPool);

function generateChildMintNumber(firstName, idNumber, dateOfBirth) {
  const normalized = (firstName || 'CHD').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const namePart = normalized.toUpperCase().replace(/[^A-Z]/g, '').padEnd(3, 'X').substring(0, 3);

  let idPart = '0000';
  if (idNumber && String(idNumber).length >= 10) {
    idPart = String(idNumber).substring(6, 10);
  } else if (dateOfBirth) {
    const dob = new Date(dateOfBirth);
    if (!isNaN(dob.getTime())) {
      const mm = String(dob.getMonth() + 1).padStart(2, '0');
      const yy = String(dob.getFullYear()).slice(-2);
      idPart = mm + yy;
    }
  }

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);

  return namePart + idPart + dd + mm + yy;
}

function generateMintNumber(firstName, idNumber, createdAt, suffix = '', userId = null) {
  const normalized = (firstName || 'MNT').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const namePart = normalized.toUpperCase().replace(/[^A-Z]/g, '').padEnd(3, 'X').substring(0, 3);

  let idPart = '0000';
  if (idNumber && idNumber.length >= 10) {
    idPart = idNumber.substring(6, 10);
  } else if (userId) {
    const cleanId = String(userId).replace(/-/g, '');
    idPart = cleanId.substring(cleanId.length - 4).toUpperCase();
  }

  let datePart = '000000';
  if (createdAt) {
    const d = new Date(createdAt);
    if (!isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yy = String(d.getFullYear()).slice(-2);
      datePart = dd + mm + yy;
    }
  }

  return namePart + idPart + datePart + suffix;
}

function extractIdNumberFromPackDetails(packDetails) {
  try {
    const info = packDetails?.info;
    if (!info) return null;
    const idDocs = info.idDocs;
    if (!Array.isArray(idDocs)) return null;
    for (const doc of idDocs) {
      if (doc.number && doc.number.length >= 10 && (doc.idDocType === 'ID_CARD' || doc.idDocType === 'PASSPORT' || doc.idDocType === 'DRIVERS')) {
        return doc.number;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function getIdNumberWithFallback(db, userId, profileIdNumber) {
  if (profileIdNumber && profileIdNumber.length >= 10) {
    return profileIdNumber;
  }
  try {
    const { data: onboarding } = await db
      .from('user_onboarding_pack_details')
      .select('pack_details')
      .eq('user_id', userId)
      .maybeSingle();
    if (onboarding?.pack_details) {
      return extractIdNumberFromPackDetails(onboarding.pack_details);
    }
  } catch (e) {
    console.log('[mint] Fallback ID lookup error for', userId, e.message);
  }
  return null;
}

let mintColumnAvailable = false;

async function ensureMintNumberColumn() {
  const db = supabaseAdmin || supabase;
  if (!db) return;
  try {
    const { data: test, error: testErr } = await db.from('profiles').select('mint_number').limit(1);
    if (!testErr) {
      console.log('[mint] mint_number column exists');
      mintColumnAvailable = true;
      return;
    }
    console.log('[mint] mint_number column not available via PostgREST. Please add it via Supabase SQL Editor:');
    console.log('[mint] ALTER TABLE profiles ADD COLUMN IF NOT EXISTS mint_number TEXT;');
    console.log('[mint] Then reload the PostgREST schema from Supabase dashboard (Settings > API > Reload schema)');
    mintColumnAvailable = false;
  } catch (e) {
    console.log('[mint] Column check error:', e.message);
    mintColumnAvailable = false;
  }
}

async function populateMintNumbers() {
  const db = supabaseAdmin || supabase;
  if (!db) return;

  try {
    await ensureMintNumberColumn();

    if (!mintColumnAvailable) {
      console.log('[mint] Skipping population - column not available');
      return;
    }

    const { data: allProfiles } = await db
      .from('profiles')
      .select('id, first_name, id_number, created_at, mint_number');

    if (!allProfiles || allProfiles.length === 0) {
      console.log('[mint] No profiles found');
      return;
    }

    let backfilledCount = 0;
    let mintUpdatedCount = 0;

    for (const p of allProfiles) {
      const resolvedId = await getIdNumberWithFallback(db, p.id, p.id_number);

      if (resolvedId && (!p.id_number || p.id_number.length < 10)) {
        const { error: idErr } = await db
          .from('profiles')
          .update({ id_number: resolvedId })
          .eq('id', p.id);
        if (!idErr) backfilledCount++;
      }

      const effectiveId = resolvedId || p.id_number;
      const mintNum = generateMintNumber(p.first_name, effectiveId, p.created_at, '', p.id);

      if (mintNum !== p.mint_number) {
        let finalMintNum = mintNum;
        let retryCount = 0;
        let success = false;

        while (retryCount < 5 && !success) {
          const { error: updateErr } = await db
            .from('profiles')
            .update({ mint_number: finalMintNum })
            .eq('id', p.id);

          if (!updateErr) {
            success = true;
            mintUpdatedCount++;
          } else if (updateErr.message?.includes('unique constraint') || updateErr.code === '23505') {
            retryCount++;
            const randomSuffix = '-' + Math.random().toString(36).substring(2, 5).toUpperCase();
            finalMintNum = generateMintNumber(p.first_name, effectiveId, p.created_at, randomSuffix, p.id);
            console.log(`[mint] Collision for ${p.id}, retrying with ${finalMintNum}`);
          } else {
            console.log(`[mint] Failed to update profile ${p.id}:`, updateErr.message);
            break;
          }
        }
      }
    }

    console.log(`[mint] Complete: backfilled ${backfilledCount} ID numbers, updated ${mintUpdatedCount} mint numbers`);
  } catch (e) {
    console.log('[mint] Error populating mint numbers:', e.message);
  }
}

populateMintNumbers();

function deriveSettlementStatus(record) {
  if (record.settlement_status) {
    return record.settlement_status;
  }

  if (settlementConfig.isFullyIntegrated) {
    return SETTLEMENT_STATUSES.CONFIRMED;
  }

  const name = ((record.name || '') + ' ' + (record.description || '')).toLowerCase();
  const isInvestment = name.includes('invest') || name.includes('strategy') ||
    name.includes('purchas') || name.includes('buy') || name.includes('bought') ||
    name.includes('allocat') || name.includes('order') ||
    (record.direction === 'debit' && (name.includes('stock') || name.includes('share') || name.includes('securit'))) ||
    (record.store_reference && record.direction === 'debit');

  if (isInvestment) {
    if (!settlementConfig.brokerEnabled) {
      return SETTLEMENT_STATUSES.PENDING_BROKER;
    }
    return SETTLEMENT_STATUSES.CONFIRMED;
  }

  return record.status || null;
}

function deriveHoldingSettlementStatus(holding) {
  if (holding.settlement_status) {
    return holding.settlement_status;
  }

  const avgFill = Number(holding.avg_fill || 0);
  if (!avgFill || avgFill === 0) {
    return SETTLEMENT_STATUSES.PENDING;
  }

  if (settlementConfig.isFullyIntegrated) {
    return SETTLEMENT_STATUSES.CONFIRMED;
  }

  if (!settlementConfig.brokerEnabled) {
    return SETTLEMENT_STATUSES.PENDING_BROKER;
  }
  return SETTLEMENT_STATUSES.CONFIRMED;
}

runSettlementMigration();

function parseServices(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

// Sumsub API endpoints
app.post("/api/sumsub/access-token", async (req, res) => {
  try {
    if (!SUMSUB_APP_TOKEN || !SUMSUB_SECRET_KEY) {
      return res.status(500).json({
        success: false,
        error: { message: "Sumsub credentials not configured. Please add SUMSUB_APP_TOKEN and SUMSUB_SECRET_KEY." }
      });
    }

    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");
    const db = supabaseAdmin || supabase;
    let authenticatedUserId = null;

    if (token && db) {
      try {
        const { data: { user } } = await db.auth.getUser(token);
        if (user) authenticatedUserId = user.id;
      } catch (e) { }
    }

    const { levelName = SUMSUB_LEVEL_NAME } = req.body;
    const userId = authenticatedUserId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { message: "Authentication required" }
      });
    }

    let applicantData = null;
    try {
      applicantData = await createSumsubApplicant(userId, levelName);
    } catch (err) {
      if (!err.message.includes("already exists")) {
        console.error("Create applicant error:", err.message);
      }
    }

    const tokenData = await generateSumsubAccessToken(userId, levelName);

    const onbDb = supabaseAdmin || supabase;
    if (onbDb) {
      try {
        const { data: existing } = await onbDb
          .from("user_onboarding")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle();

        if (!existing) {
          const { error: insErr } = await onbDb.from("user_onboarding").insert({
            user_id: userId,
            employment_status: "not_provided",
            sumsub_external_user_id: userId,
            sumsub_applicant_id: applicantData?.id || null,
            kyc_status: "pending",
            kyc_checked_at: new Date().toISOString(),
            annual_income_currency: "USD",
          });
          if (insErr) {
            console.error("[Sumsub] Failed to create onboarding record:", insErr.message);
          } else {
            console.log(`[Sumsub] Created onboarding record for user ${userId}`);
          }
        } else if (applicantData?.id) {
          await onbDb.from("user_onboarding")
            .update({ sumsub_applicant_id: applicantData.id, sumsub_external_user_id: userId, updated_at: new Date().toISOString() })
            .eq("id", existing.id)
            .eq("user_id", userId);
        }
      } catch (dbErr) {
        console.error("[Sumsub] Onboarding record error:", dbErr.message);
      }
    }

    res.json({
      success: true,
      token: tokenData.token,
      userId: tokenData.userId
    });
  } catch (error) {
    console.error("Sumsub access token error:", error);
    res.status(500).json({
      success: false,
      error: { message: error.message || "Failed to generate access token" }
    });
  }
});

app.post("/api/sumsub/reset", async (req, res) => {
  try {
    if (!SUMSUB_APP_TOKEN || !SUMSUB_SECRET_KEY) {
      return res.status(500).json({ success: false, error: { message: "Sumsub credentials not configured" } });
    }

    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");
    const db = supabaseAdmin || supabase;
    let authenticatedUserId = null;

    if (token && db) {
      try {
        const { data: { user } } = await db.auth.getUser(token);
        if (user) authenticatedUserId = user.id;
      } catch (e) { }
    }

    if (!authenticatedUserId) {
      return res.status(401).json({ success: false, error: { message: "Authentication required" } });
    }

    const applicant = await getSumsubApplicantByExternalId(authenticatedUserId);
    if (!applicant) {
      return res.status(404).json({ success: false, error: { message: "No applicant found" } });
    }

    const applicantId = applicant.id;
    const ts = Math.floor(Date.now() / 1000).toString();
    const resetPath = `/resources/applicants/${applicantId}/reset`;
    const signature = createSumsubSignature(ts, "POST", resetPath);

    const resetResponse = await fetch(`${SUMSUB_BASE_URL}${resetPath}`, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-App-Token": SUMSUB_APP_TOKEN,
        "X-App-Access-Ts": ts,
        "X-App-Access-Sig": signature,
      },
    });

    if (!resetResponse.ok) {
      const errorText = await resetResponse.text();
      console.error(`Sumsub reset error: ${resetResponse.status} - ${errorText}`);
      return res.status(resetResponse.status).json({
        success: false,
        error: { message: `Failed to reset applicant: ${errorText}` }
      });
    }

    console.log(`[Sumsub] Reset applicant ${applicantId} for user ${authenticatedUserId}`);

    const onbDb = supabaseAdmin || supabase;
    if (onbDb) {
      try {
        await onbDb.from("user_onboarding").update({
          sumsub_review_status: "init",
          sumsub_review_answer: null,
          sumsub_outcome: null,
          kyc_status: "pending",
          kyc_verified_at: null,
          updated_at: new Date().toISOString(),
        }).eq("user_id", authenticatedUserId);
      } catch (dbErr) {
        console.error("[Sumsub] Failed to update onboarding on reset:", dbErr.message);
      }
    }

    res.json({ success: true, message: "Applicant reset successfully" });
  } catch (error) {
    console.error("Sumsub reset error:", error);
    res.status(500).json({ success: false, error: { message: error.message || "Failed to reset applicant" } });
  }
});

async function getSumsubApplicantById(applicantId) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const path = `/resources/applicants/${applicantId}/one`;
  const method = "GET";

  const signature = createSumsubSignature(ts, method, path);

  const response = await fetch(`${SUMSUB_BASE_URL}${path}`, {
    method,
    headers: {
      "Accept": "application/json",
      "X-App-Token": SUMSUB_APP_TOKEN,
      "X-App-Access-Ts": ts,
      "X-App-Access-Sig": signature,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Sumsub API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

app.get("/api/sumsub/status/:applicantId", async (req, res) => {
  try {
    if (!SUMSUB_APP_TOKEN || !SUMSUB_SECRET_KEY) {
      return res.status(500).json({
        success: false,
        error: { message: "Sumsub credentials not configured" }
      });
    }

    const { applicantId } = req.params;

    // Get both the applicant info and required docs status
    const [applicant, requiredDocsStatus] = await Promise.all([
      getSumsubApplicantById(applicantId),
      getSumsubApplicantStatus(applicantId)
    ]);

    // Calculate normalized status
    let hasAnySubmittedSteps = false;
    let hasRejectedSteps = false;

    if (requiredDocsStatus) {
      for (const [stepName, stepData] of Object.entries(requiredDocsStatus)) {
        if (stepData !== null) {
          hasAnySubmittedSteps = true;
          if (stepData?.reviewResult?.reviewAnswer === "RED") {
            hasRejectedSteps = true;
          }
        }
      }
    }

    const reviewStatus = applicant?.review?.reviewStatus;
    const reviewAnswer = applicant?.review?.reviewResult?.reviewAnswer;

    let normalizedStatus = "not_verified";
    if (reviewAnswer === "GREEN") {
      normalizedStatus = "verified";
    } else if (hasRejectedSteps || reviewAnswer === "RED") {
      normalizedStatus = "needs_resubmission";
    } else if (reviewStatus === "onHold") {
      normalizedStatus = "needs_resubmission";
    } else if (reviewStatus === "pending" || reviewStatus === "queued") {
      normalizedStatus = "pending";
    } else if (hasAnySubmittedSteps) {
      normalizedStatus = "pending";
    } else {
      normalizedStatus = "not_verified";
    }

    res.json({
      success: true,
      normalizedStatus,
      requiredDocsStatus,
      hasAnySubmittedSteps,
      hasRejectedSteps,
      review: applicant?.review || null,
      createdAt: applicant?.createdAt
    });
  } catch (error) {
    console.error("Sumsub status error:", error);
    res.status(500).json({
      success: false,
      error: { message: error.message || "Failed to get applicant status" }
    });
  }
});

app.post("/api/sumsub/check-status", async (req, res) => {
  try {
    if (!SUMSUB_APP_TOKEN || !SUMSUB_SECRET_KEY) {
      return res.status(500).json({
        success: false,
        error: { message: "Sumsub credentials not configured" }
      });
    }

    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: { message: "userId is required" }
      });
    }

    const applicant = await getSumsubApplicantByExternalId(userId);

    if (!applicant) {
      return res.json({
        success: true,
        status: null,
        message: "No applicant found for this user"
      });
    }

    res.json({
      success: true,
      status: {
        applicantId: applicant.id,
        reviewStatus: applicant.review?.reviewStatus,
        reviewResult: applicant.review?.reviewResult,
        createdAt: applicant.createdAt,
        inspectionId: applicant.inspectionId
      }
    });
  } catch (error) {
    console.error("Sumsub check-status error:", error);
    res.status(500).json({
      success: false,
      error: { message: error.message || "Failed to check status" }
    });
  }
});

app.post("/api/sumsub/status", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: { message: "userId is required" }
      });
    }

    const db = supabaseAdmin || supabase;
    if (db) {
      try {
        const { data: packRecord } = await db
          .from("user_onboarding_pack_details")
          .select("user_id")
          .eq("user_id", userId)
          .maybeSingle();

        if (packRecord) {
          console.log(`[Sumsub] User ${userId} already verified (found in user_onboarding_pack_details), skipping Sumsub API`);
          return res.json({
            success: true,
            status: "verified",
            applicantId: null,
            reviewStatus: "completed",
            reviewAnswer: "GREEN",
            rejectLabels: [],
            hasIncompleteSteps: false,
            hasRejectedSteps: false,
            allStepsGreen: true,
            createdAt: null
          });
        }
      } catch (dbErr) {
        console.error("[Sumsub] Error checking user_onboarding_pack_details:", dbErr.message);
      }
    }

    if (!SUMSUB_APP_TOKEN || !SUMSUB_SECRET_KEY) {
      console.error("[Sumsub] Credentials not configured in environment variables");
      return res.status(500).json({
        success: false,
        error: { message: "Sumsub credentials not configured" }
      });
    }

    const applicant = await getSumsubApplicantByExternalId(userId);

    if (!applicant) {
      return res.json({
        success: true,
        status: "not_verified",
        applicantId: null,
        reviewStatus: null,
        reviewAnswer: null,
        rejectLabels: [],
        createdAt: null
      });
    }

    // Get the required docs status to check for incomplete steps
    const requiredDocsStatus = await getSumsubRequiredDocsStatus(applicant.id);

    // Check document status - distinguish between "never started" and "started but incomplete"
    let hasIncompleteSteps = false;
    let hasRejectedSteps = false;
    let allStepsGreen = true;
    let hasAnySubmittedSteps = false; // Track if user ever submitted anything

    if (requiredDocsStatus) {
      for (const [stepName, stepData] of Object.entries(requiredDocsStatus)) {
        if (stepData === null) {
          // Step not started yet
          hasIncompleteSteps = true;
          allStepsGreen = false;
          console.log(`Step ${stepName} is not started (null)`);
        } else {
          // Step has some data - user submitted something
          hasAnySubmittedSteps = true;
          if (stepData?.reviewResult?.reviewAnswer === "RED") {
            hasRejectedSteps = true;
            allStepsGreen = false;
            console.log(`Step ${stepName} is rejected`);
          } else if (stepData?.reviewResult?.reviewAnswer !== "GREEN") {
            allStepsGreen = false;
            console.log(`Step ${stepName} is not GREEN:`, stepData?.reviewResult?.reviewAnswer);
          }
        }
      }
    }

    const reviewStatus = applicant.review?.reviewStatus;
    const reviewAnswer = applicant.review?.reviewResult?.reviewAnswer;
    const rejectLabels = applicant.review?.reviewResult?.rejectLabels || [];
    const reviewRejectType = applicant.review?.reviewResult?.reviewRejectType;

    // Log detailed Sumsub status for debugging
    console.log(`=== Sumsub Status for ${userId} ===`);
    console.log(`Applicant ID: ${applicant.id}`);
    console.log(`Review Status: ${reviewStatus}`);
    console.log(`Review Answer: ${reviewAnswer}`);
    console.log(`Review Reject Type: ${reviewRejectType}`);
    console.log(`Reject Labels: ${JSON.stringify(rejectLabels)}`);
    console.log(`Has Incomplete Steps: ${hasIncompleteSteps}`);
    console.log(`Has Rejected Steps: ${hasRejectedSteps}`);
    console.log(`Has Any Submitted Steps: ${hasAnySubmittedSteps}`);
    console.log(`All Steps Green: ${allStepsGreen}`);

    let status = "not_verified";

    // Priority order for status determination:
    // 1. If all steps are GREEN and review is GREEN → verified
    // 2. If any steps are rejected or on hold → needs_resubmission
    // 3. If there are incomplete/missing steps → needs_resubmission (documents required)
    // 4. If all submitted and review pending → pending (under review)
    // 5. If user never submitted anything → not_verified

    if (allStepsGreen && reviewAnswer === "GREEN") {
      status = "verified";
      console.log(`Status: verified (all steps GREEN)`);

      const db = supabaseAdmin || supabase;
      if (db) {
        try {
          const { data: existingPack } = await db
            .from("user_onboarding_pack_details")
            .select("user_id")
            .eq("user_id", userId)
            .maybeSingle();

          if (!existingPack) {
            await db
              .from("user_onboarding_pack_details")
              .insert({ user_id: userId, pack_details: applicant, updated_at: new Date().toISOString() });
            console.log(`[Status] Created user_onboarding_pack_details for user ${userId}`);
          }

          const onboardingUpdate = {
            sumsub_external_user_id: userId,
            sumsub_applicant_id: applicant.id,
            sumsub_review_status: reviewStatus || "completed",
            sumsub_review_answer: reviewAnswer,
            kyc_checked_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          const { data: existingOnboarding } = await db
            .from("user_onboarding")
            .select("id, kyc_status")
            .eq("user_id", userId)
            .maybeSingle();

          if (existingOnboarding) {
            if (existingOnboarding.kyc_status !== "onboarding_complete") {
              onboardingUpdate.kyc_status = "verified";
            }
            onboardingUpdate.kyc_verified_at = new Date().toISOString();
            await db.from("user_onboarding").update(onboardingUpdate).eq("id", existingOnboarding.id).eq("user_id", userId);
            console.log(`[Status] Updated user_onboarding for user ${userId}`);
          } else {
            onboardingUpdate.kyc_status = "verified";
            onboardingUpdate.kyc_verified_at = new Date().toISOString();
            const { error: insErr } = await db.from("user_onboarding").insert({
              user_id: userId,
              employment_status: "not_provided",
              annual_income_currency: "ZAR",
              ...onboardingUpdate,
            });
            if (insErr) {
              console.error(`[Status] Failed to create user_onboarding for ${userId}:`, insErr.message);
            } else {
              console.log(`[Status] Created user_onboarding for verified user ${userId}`);
            }
          }

          const { data: existingAction } = await db
            .from("required_actions")
            .select("id")
            .eq("user_id", userId)
            .maybeSingle();

          if (existingAction) {
            await db.from("required_actions").update({ kyc_verified: true, kyc_pending: false, kyc_needs_resubmission: false }).eq("user_id", userId);
          } else {
            await db.from("required_actions").insert({ user_id: userId, kyc_verified: true, kyc_pending: false, kyc_needs_resubmission: false });
          }
        } catch (dbErr) {
          console.error(`[Status] Error updating onboarding for ${userId}:`, dbErr.message);
        }
      }
    } else if (hasRejectedSteps || reviewAnswer === "RED") {
      status = "needs_resubmission";
      console.log(`Status: needs_resubmission (rejected)`);
    } else if (reviewStatus === "onHold") {
      status = "needs_resubmission";
      console.log(`Status: needs_resubmission (on hold)`);
    } else if (hasIncompleteSteps && hasAnySubmittedSteps) {
      status = "needs_resubmission";
      console.log(`Status: needs_resubmission (documents missing or cleared)`);
    } else if (hasIncompleteSteps && !hasAnySubmittedSteps) {
      status = "not_verified";
      console.log(`Status: not_verified (no documents submitted yet)`);
    } else if (!allStepsGreen) {
      status = "needs_resubmission";
      console.log(`Status: needs_resubmission (not all steps green)`);
    } else if (reviewStatus === "pending" || reviewStatus === "queued") {
      status = "pending";
      console.log(`Status: pending (review pending/queued)`);
    } else if (hasAnySubmittedSteps && !hasIncompleteSteps) {
      status = "pending";
      console.log(`Status: pending (verification in progress)`);
    } else {
      status = "not_verified";
      console.log(`Status: not_verified (no documents submitted)`);
    }

    res.json({
      success: true,
      status,
      applicantId: applicant.id,
      reviewStatus: reviewStatus || null,
      reviewAnswer: reviewAnswer || null,
      reviewRejectType: reviewRejectType || null,
      rejectLabels,
      hasIncompleteSteps,
      hasRejectedSteps,
      allStepsGreen,
      createdAt: applicant.createdAt || null
    });
  } catch (error) {
    console.error("Sumsub status error:", error);
    res.status(500).json({
      success: false,
      error: { message: error.message || "Failed to get status" }
    });
  }
});

// Legacy endpoint - redirects to /api/sumsub/status (no database writes)
app.post("/api/sumsub/sync-status", async (req, res) => {
  try {
    if (!SUMSUB_APP_TOKEN || !SUMSUB_SECRET_KEY) {
      return res.status(500).json({
        success: false,
        error: { message: "Sumsub credentials not configured" }
      });
    }

    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: { message: "userId is required" }
      });
    }

    const applicant = await getSumsubApplicantByExternalId(userId);

    if (!applicant) {
      return res.json({
        success: true,
        status: "not_verified",
        applicantId: null,
        reviewStatus: null,
        reviewAnswer: null,
        rejectLabels: [],
        createdAt: null
      });
    }

    const reviewStatus = applicant.review?.reviewStatus;
    const reviewAnswer = applicant.review?.reviewResult?.reviewAnswer;
    const rejectLabels = applicant.review?.reviewResult?.rejectLabels || [];

    let status = "not_verified";

    if (reviewAnswer === "GREEN") {
      status = "verified";
    } else if (reviewAnswer === "RED") {
      status = rejectLabels.length > 0 ? "needs_resubmission" : "not_verified";
    } else if (reviewStatus === "pending" || reviewStatus === "queued") {
      status = "pending";
    } else if (reviewStatus === "onHold" || applicant.requiredIdDocs?.length > 0) {
      status = "needs_resubmission";
    } else if (reviewStatus === "init" || !reviewStatus) {
      status = "not_verified";
    } else {
      status = "pending";
    }

    res.json({
      success: true,
      status,
      applicantId: applicant.id,
      reviewStatus,
      reviewAnswer: reviewAnswer || null,
      rejectLabels,
      createdAt: applicant.createdAt || null,
      applicant: {
        id: applicant.id,
        reviewStatus,
        reviewAnswer: reviewAnswer || null,
        rejectLabels
      }
    });
  } catch (error) {
    console.error("Sumsub sync-status error:", error);
    res.status(500).json({
      success: false,
      error: { message: error.message || "Failed to sync status" }
    });
  }
});

app.post("/api/sumsub/webhook", async (req, res) => {
  const digestHeader = req.headers["x-payload-digest"] || req.headers["x-signature"];
  if (SUMSUB_SECRET_KEY && digestHeader) {
    try {
      const rawBody = JSON.stringify(req.body);
      const computed = crypto.createHmac("sha256", SUMSUB_SECRET_KEY).update(rawBody).digest("hex");
      if (computed !== digestHeader) {
        console.warn("[Webhook] Signature mismatch, rejecting");
        return res.status(403).json({ error: "Invalid signature" });
      }
    } catch (sigErr) {
      console.warn("[Webhook] Signature verification error:", sigErr.message);
    }
  }

  console.log("[Webhook] Sumsub webhook received:", JSON.stringify(req.body, null, 2));

  const { type, applicantId, reviewResult, reviewStatus, externalUserId } = req.body;
  const db = supabaseAdmin || supabase;

  if (!db || !externalUserId) {
    console.log("[Webhook] No database client or externalUserId, skipping");
    return res.status(200).json({ received: true });
  }

  try {
    let kycUpdate = null;
    let onboardingKycStatus = null;
    let reviewAnswer = null;

    if (type === "applicantReviewed") {
      reviewAnswer = reviewResult?.reviewAnswer;
      const rejectLabels = reviewResult?.rejectLabels || [];

      if (reviewAnswer === "GREEN") {
        console.log(`[Webhook] User ${externalUserId} KYC verified successfully`);
        kycUpdate = { kyc_verified: true, kyc_pending: false, kyc_needs_resubmission: false };
        onboardingKycStatus = "verified";

        try {
          const applicantData = await getSumsubApplicantByExternalId(externalUserId);
          if (applicantData) {
            const { data: existingPack } = await db
              .from("user_onboarding_pack_details")
              .select("user_id, pack_details")
              .eq("user_id", externalUserId)
              .maybeSingle();

            if (existingPack) {
              // Preserve existing agreements if they exist
              const currentDetails = existingPack.pack_details || {};
              if (Array.isArray(currentDetails.agreements) && currentDetails.agreements.length > 0) {
                applicantData.agreements = currentDetails.agreements;
              }

              await db
                .from("user_onboarding_pack_details")
                .update({ pack_details: applicantData, updated_at: new Date().toISOString() })
                .eq("user_id", externalUserId);
              console.log(`[Webhook] Updated user_onboarding_pack_details for user ${externalUserId} (preserved ${applicantData.agreements?.length || 0} agreements)`);
            } else {
              await db
                .from("user_onboarding_pack_details")
                .insert({ user_id: externalUserId, pack_details: applicantData, updated_at: new Date().toISOString() });
              console.log(`[Webhook] Created user_onboarding_pack_details for user ${externalUserId}`);
            }
          }
        } catch (packErr) {
          console.error(`[Webhook] Failed to save pack_details for ${externalUserId}:`, packErr.message);
        }
      } else if (reviewAnswer === "RED") {
        const canResubmit = rejectLabels.some(label =>
          ["DOCUMENT_PAGE_MISSING", "INCOMPLETE_DOCUMENT", "UNSATISFACTORY_PHOTOS",
            "DOCUMENT_DAMAGED", "SCREENSHOTS", "SPAM", "NOT_DOCUMENT", "SELFIE_MISMATCH",
            "FORGERY", "GRAPHIC_EDITOR", "DOCUMENT_DEPRIVED"].includes(label)
        );

        if (canResubmit) {
          console.log(`[Webhook] User ${externalUserId} KYC needs resubmission: ${rejectLabels.join(", ")}`);
          kycUpdate = { kyc_verified: false, kyc_pending: false, kyc_needs_resubmission: true };
          onboardingKycStatus = "resubmission_required";
        } else {
          console.log(`[Webhook] User ${externalUserId} KYC rejected permanently: ${rejectLabels.join(", ")}`);
          kycUpdate = { kyc_verified: false, kyc_pending: false, kyc_needs_resubmission: false };
          onboardingKycStatus = "rejected";
        }
      }
    } else if (type === "applicantPending" || type === "applicantCreated") {
      console.log(`[Webhook] User ${externalUserId} KYC is pending review`);
      kycUpdate = { kyc_verified: false, kyc_pending: true, kyc_needs_resubmission: false };
      onboardingKycStatus = "pending";
    } else if (type === "applicantOnHold") {
      console.log(`[Webhook] User ${externalUserId} KYC on hold`);
      kycUpdate = { kyc_verified: false, kyc_pending: false, kyc_needs_resubmission: true };
      onboardingKycStatus = "on_hold";
    } else if (type === "applicantActionPending") {
      console.log(`[Webhook] User ${externalUserId} KYC action pending`);
      kycUpdate = { kyc_verified: false, kyc_pending: false, kyc_needs_resubmission: true };
      onboardingKycStatus = "action_required";
    }

    if (kycUpdate) {
      const { data: existingAction } = await db
        .from("required_actions")
        .select("id")
        .eq("user_id", externalUserId)
        .maybeSingle();

      if (existingAction) {
        await db.from("required_actions").update(kycUpdate).eq("user_id", externalUserId);
      } else {
        await db.from("required_actions").insert({ user_id: externalUserId, ...kycUpdate });
      }
      console.log(`[Webhook] Updated required_actions for user ${externalUserId}`);
    }

    if (onboardingKycStatus) {
      const onboardingUpdate = {
        sumsub_external_user_id: externalUserId,
        sumsub_applicant_id: applicantId || null,
        sumsub_review_status: reviewStatus || type,
        sumsub_review_answer: reviewAnswer,
        kyc_status: onboardingKycStatus,
        kyc_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (onboardingKycStatus === "verified") {
        onboardingUpdate.kyc_verified_at = new Date().toISOString();
      }

      const { data: existingOnboarding } = await db
        .from("user_onboarding")
        .select("id, kyc_status")
        .eq("user_id", externalUserId)
        .maybeSingle();

      if (existingOnboarding) {
        if (existingOnboarding.kyc_status === "onboarding_complete" && onboardingKycStatus !== "onboarding_complete") {
          delete onboardingUpdate.kyc_status;
          console.log(`[Webhook] Preserving onboarding_complete status for user ${externalUserId} (not overwriting with ${onboardingKycStatus})`);
        }
        await db.from("user_onboarding").update(onboardingUpdate).eq("id", existingOnboarding.id).eq("user_id", externalUserId);
        console.log(`[Webhook] Updated user_onboarding for user ${externalUserId} -> ${onboardingUpdate.kyc_status || existingOnboarding.kyc_status}`);
      } else {
        const { error: insErr } = await db.from("user_onboarding").insert({
          user_id: externalUserId,
          employment_status: "not_provided",
          ...onboardingUpdate,
        });
        if (insErr) {
          console.error(`[Webhook] Failed to create user_onboarding for ${externalUserId}:`, insErr.message);
        } else {
          console.log(`[Webhook] Created user_onboarding for user ${externalUserId} -> ${onboardingKycStatus}`);
        }
      }
    }
  } catch (err) {
    console.error("[Webhook] Failed to process Sumsub webhook:", err);
  }

  res.status(200).json({ received: true });
});

app.post("/api/truid/initiate", async (req, res) => {
  try {
    const requiredEnv = ['TRUID_API_KEY', 'BRAND_ID'];
    const missing = requiredEnv.filter((key) => !readEnv(key));
    if (missing.length) {
      return res.status(500).json({
        success: false,
        error: { message: `Missing required environment variables: ${missing.join(', ')}` }
      });
    }

    const { name, idNumber, idType = 'id', email, mobile, services } = req.body;

    if (!name || !idNumber) {
      return res.status(400).json({
        success: false,
        error: { message: 'Name and ID number are required' }
      });
    }

    const requestedServices = parseServices(services);
    const envServices = parseServices(process.env.TRUID_SERVICES);
    const defaultServices = envServices.length ? envServices : [
      "eeh03fzauckvj8u982dbeq1d8",
      "amqfuupe00xk3cfw3dergvb9n",
      "s8d7f67de8w9iekjrfu",
      "mk2weodif8gutjre4kwsdfd",
      "12wsdofikgjtm5k4eiduy",
      "apw99w0lj1nwde4sfxd0",
    ];
    const finalServices = requestedServices.length ? requestedServices : defaultServices;

    const collection = await truIDClient.createCollection({
      name,
      idNumber,
      idType,
      email,
      mobile,
      services: finalServices,
      force: true // Force fresh consent to bypass stale server-side sessions
    });

    res.status(201).json({
      success: true,
      collectionId: collection.collectionId,
      consumerUrl: collection.consumerUrl,
      consentId: collection.consentId
    });
  } catch (error) {
    console.error("TruID initiate error:", error);
    res.status(error.status || 500).json({
      success: false,
      error: { message: error.message || "Internal server error" }
    });
  }
});

app.get("/api/truid/status", async (req, res) => {
  try {
    const { collectionId } = req.query;
    if (!collectionId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Missing collectionId' }
      });
    }

    const result = await truIDClient.getCollection(collectionId);
    const statusNode = result.data?.status || result.data?.current_status;
    const fallbackStatus = statusNode?.code || statusNode || result.data?.state;
    const currentStatus =
      fallbackStatus ||
      extractLatestStatus(result.data?.statuses) ||
      extractLatestMilestone(result.data?.milestones) ||
      'UNKNOWN';

    let outcome = 'pending';
    const upperStatus = String(currentStatus).toUpperCase();
    if (upperStatus === 'COMPLETED' || upperStatus === 'COMPLETE' || upperStatus === 'SUCCESS') {
      outcome = 'completed';
    } else if (upperStatus === 'FAILED' || upperStatus === 'REJECTED' || upperStatus === 'ERROR') {
      outcome = 'failed';
    }

    res.json({
      success: true,
      collectionId,
      currentStatus,
      outcome,
      raw: result.data
    });
  } catch (error) {
    console.error("TruID status error:", error);
    res.status(error.status || 500).json({
      success: false,
      error: { message: error.message || "Internal server error" }
    });
  }
});

app.post("/api/truid/webhook", async (req, res) => {
  console.log("TruID webhook received:", JSON.stringify(req.body, null, 2));
  res.status(200).json({ received: true });
});

// ============ BANKING API ENDPOINTS ============

app.post("/api/banking/initiate", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: { message: "Missing or invalid Authorization header" }
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const db = supabaseAdmin || supabase;
    if (!db) {
      return res.status(500).json({
        success: false,
        error: { message: "Database not configured" }
      });
    }

    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({
        success: false,
        error: { message: "Invalid or expired token" }
      });
    }

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("first_name, last_name, id_number")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Profile lookup error:", profileError.message);
      return res.status(500).json({ success: false, error: { message: "Internal server error looking up profile" } });
    }

    // Resilience: Fallback to metadata if profile record is missing or incomplete
    let firstName = profile?.first_name || user.user_metadata?.first_name || "";
    let lastName = profile?.last_name || user.user_metadata?.last_name || "";
    let idNumber = profile?.id_number || "";

    if (!idNumber) {
      try {
        const applicant = await getSumsubApplicantByExternalId(user.id);
        if (applicant?.info?.idDocs?.length) {
          const idDoc = applicant.info.idDocs.find(d => d.number) || {};
          idNumber = idDoc.number || null;
        }
        if (!idNumber && applicant?.fixedInfo?.idDocs?.length) {
          const idDoc = applicant.fixedInfo.idDocs.find(d => d.number) || {};
          idNumber = idDoc.number || null;
        }
        if (idNumber) {
          // Sync profile if it exists, otherwise create it
          if (profile) {
            await db.from("profiles").update({ id_number: idNumber }).eq("id", user.id);
          } else {
            // If no profile exists, create one with what we have
            await db.from("profiles").insert({
              id: user.id,
              first_name: firstName,
              last_name: lastName,
              id_number: idNumber
            });
          }
        }
      } catch (sumsubErr) {
        console.warn("[initiate] Could not fetch ID from Sumsub:", sumsubErr.message);
      }
    }

    const fullName = [firstName, lastName].filter(Boolean).join(" ");

    if (!fullName || !idNumber) {
      console.error("[initiate] Profile incomplete:", { hasName: !!fullName, hasIdNumber: !!idNumber });
      return res.status(400).json({
        success: false,
        error: { message: "Profile is missing name or ID number. Please complete your profile first." }
      });
    }

    const envServices = parseServices(process.env.TRUID_SERVICES);
    const defaultServices = envServices.length ? envServices : [
      "eeh03fzauckvj8u982dbeq1d8",
      "amqfuupe00xk3cfw3dergvb9n",
      "s8d7f67de8w9iekjrfu",
      "mk2weodif8gutjre4kwsdfd",
      "12wsdofikgjtm5k4eiduy",
      "apw99w0lj1nwde4sfxd0",
    ];

    const collection = await truIDClient.createCollection({
      name: fullName,
      idNumber: idNumber,
      email: user.email,
      services: defaultServices,
      force: true
    });

    res.status(201).json({
      success: true,
      collectionId: collection.collectionId,
      consumerUrl: collection.consumerUrl
    });
  } catch (error) {
    console.error("Banking initiate error COMPLETE:", error);
    res.status(error.status || 500).json({
      success: false,
      error: {
        message: error.message || "Internal server error",
        status: error.status,
        details: error.data || error.response?.data
      }
    });
  }
});

app.post("/api/loan/email-agreement", async (req, res) => {
  try {
    const { loanId, pdfBase64, fileName, amount, assets } = req.body;
    if (!loanId || !pdfBase64) {
      return res.status(400).json({ success: false, error: { message: "Missing loanId or pdfBase64" } });
    }

    const authHeader = req.headers.authorization?.split(" ")[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader);
    if (authError || !user) return res.status(401).json({ success: false, error: { message: "Unauthorized" } });

    const resend = getResendClient();
    if (!resend) {
      return res.status(500).json({ success: false, error: { message: "Email service not configured" } });
    }

    // Convert data URL to base64 if needed
    const base64Data = pdfBase64.includes(",") ? pdfBase64.split(",")[1] : pdfBase64;

    const formattedAmount = "R " + (amount || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const assetList = (assets || []).join(", ");
    const firstName = user.user_metadata?.first_name || 'Client';

    const { data, error } = await resend.emails.send({
      from: 'Mint Platforms <alerts@thealgohive.com>',
      to: [user.email],
      subject: 'Order Received: Asset Sale Confirmation',
      html: `
        <div style="font-family: sans-serif; color: #374151; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; padding: 32px;">
          <h2 style="color: #0d1b2e; margin-top: 0;">Order Received</h2>
          <p>Hello <b>${firstName}</b>,</p>
          <p>We have received your signed document. This email confirms that your order to sell <b>${assetList}</b> for the final amount of <b>${formattedAmount}</b> has been received and is currently being processed.</p>
          <p>For your records, we have attached the signed <b>Share Pledge and Secured Lending Agreement</b> to this email.</p>
          <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin-top: 24px;">
            <p style="margin: 0; font-size: 12px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700;">Transaction Details</p>
            <p style="margin: 8px 0 0; font-size: 14px; color: #374151;"><b>Order ID:</b> ${loanId}</p>
            <p style="margin: 4px 0 0; font-size: 14px; color: #374151;"><b>Status:</b> Agreement Signed</p>
          </div>
          <p style="margin-top: 32px; font-size: 14px; color: #6b7280;">
            Best regards,<br/>
            <b>The Mint Team</b>
          </p>
        </div>
      `,
      attachments: [
        {
          filename: fileName || 'Loan_Agreement.pdf',
          content: Buffer.from(base64Data, 'base64'),
        },
      ],
    });


    if (error) throw error;

    res.json({ success: true, message: "Email sent successfully" });
  } catch (error) {
    console.error("Email agreement error:", error);
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

app.get("/api/banking/status", async (req, res) => {
  try {
    const { collectionId } = req.query;
    if (!collectionId) {
      return res.status(400).json({
        success: false,
        error: { message: "Missing collectionId" }
      });
    }

    const result = await truIDClient.getCollection(collectionId);
    const statusNode = result.data?.status || result.data?.current_status;
    const fallbackStatus = statusNode?.code || statusNode || result.data?.state;
    const currentStatus =
      fallbackStatus ||
      extractLatestStatus(result.data?.statuses) ||
      extractLatestMilestone(result.data?.milestones) ||
      "UNKNOWN";

    const numericCode = Number(currentStatus);
    const isNumeric = Number.isFinite(numericCode);

    let outcome = "pending";
    const upperStatus = String(currentStatus).toUpperCase();
    if (
      upperStatus === "COMPLETED" || upperStatus === "COMPLETE" || upperStatus === "SUCCESS" ||
      (isNumeric && numericCode === 1099) ||
      (isNumeric && numericCode >= 2000 && numericCode < 3000)
    ) {
      outcome = "completed";
    } else if (
      upperStatus === "FAILED" || upperStatus === "REJECTED" || upperStatus === "ERROR" ||
      upperStatus === "CANCELLED" || upperStatus === "EXPIRED" ||
      (isNumeric && numericCode >= 4000)
    ) {
      outcome = "failed";
    }

    console.log(`Banking status poll: collectionId=${collectionId}, currentStatus=${currentStatus}, outcome=${outcome}`);

    res.json({
      success: true,
      collectionId,
      currentStatus,
      outcome
    });
  } catch (error) {
    console.error("Banking status error:", error);
    res.status(error.status || 500).json({
      success: false,
      error: { message: error.message || "Internal server error" }
    });
  }
});

app.post("/api/banking/capture", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: { message: "Missing or invalid Authorization header" }
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const db = supabaseAdmin || supabase;
    if (!db) {
      return res.status(500).json({
        success: false,
        error: { message: "Database not configured" }
      });
    }

    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({
        success: false,
        error: { message: "Invalid or expired token" }
      });
    }

    const { collectionId } = req.body;
    if (!collectionId) {
      return res.status(400).json({
        success: false,
        error: { message: "collectionId is required" }
      });
    }

    const data = await truIDClient.getCollectionData(collectionId);

    let bankAccounts = [];
    try {
      console.log("TruID capture raw data:", JSON.stringify(data, null, 2));
      const summary = data?.data || data;
      const statement = summary?.statement || {};
      const customer = statement?.customer || {};
      const bankName = customer.bank || customer.institution || customer.bankName || "";

      if (statement.accounts && Array.isArray(statement.accounts) && statement.accounts.length > 0) {
        bankAccounts = statement.accounts.map(acc => ({
          bankName: acc.bank || acc.institution || bankName || "Bank Account",
          accountNumber: acc.accountNumber || acc.account_number || acc.number || acc.accountId || "",
          accountType: acc.accountType || acc.account_type || acc.type || "Current",
        }));
      }

      if (bankAccounts.length === 0 && bankName) {
        try {
          const detailRes = await truIDClient.deliveryClient.get(`/collections/${collectionId}/products`);
          console.log("TruID products detail:", JSON.stringify(detailRes.data, null, 2));
          const products = detailRes.data;

          const extractAccounts = (obj) => {
            if (!obj || typeof obj !== 'object') return;
            if (Array.isArray(obj)) {
              obj.forEach(item => extractAccounts(item));
              return;
            }
            const accNum = obj.accountNumber || obj.account_number || obj.number || obj.accountId || obj.accountNo || "";
            if (accNum) {
              bankAccounts.push({
                bankName: obj.bank || obj.institution || bankName,
                accountNumber: accNum,
                accountType: obj.accountType || obj.account_type || obj.type || "Current",
              });
            }
            for (const val of Object.values(obj)) {
              if (typeof val === 'object') extractAccounts(val);
            }
          };
          extractAccounts(products);
        } catch (detailErr) {
          console.log("TruID products detail not available:", detailErr.message);
        }
      }

      if (bankAccounts.length === 0 && bankName) {
        bankAccounts = [{ bankName, accountNumber: customer.id || "", accountType: customer.type || "Current" }];
      }

      const seen = new Set();
      bankAccounts = bankAccounts.filter(a => {
        const key = `${a.bankName}|${a.accountNumber}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } catch (parseErr) {
      console.error("Error parsing TruID bank data:", parseErr);
    }

    if (bankAccounts.length === 0) {
      bankAccounts = [{ bankName: "Bank Account", accountNumber: "", accountType: "Current" }];
    }

    console.log("Extracted bank accounts:", JSON.stringify(bankAccounts));

    const { data: existingAction } = await db
      .from("required_actions")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingAction) {
      await db
        .from("required_actions")
        .update({ bank_linked: true, bank_in_review: false })
        .eq("user_id", user.id);
    } else {
      await db
        .from("required_actions")
        .insert({ user_id: user.id, bank_linked: true, bank_in_review: false });
    }

    try {
      const bankJson = JSON.stringify(bankAccounts);
      const { data: existingOnboarding } = await db
        .from("user_onboarding")
        .select("id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingOnboarding) {
        await db
          .from("user_onboarding")
          .update({ sumsub_outcome: bankJson })
          .eq("id", existingOnboarding.id);
      }
    } catch (bankSaveErr) {
      console.error("Failed to save bank details:", bankSaveErr.message);
    }

    res.json({
      success: true,
      snapshot: data,
      bankAccounts
    });
  } catch (error) {
    console.error("Banking capture error:", error);
    res.status(error.status || 500).json({
      success: false,
      error: { message: error.message || "Internal server error" }
    });
  }
});


app.get("/api/banking/accounts", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, error: "Missing token" });

    const db = supabaseAdmin || supabase;
    const authClient = supabaseAdmin || supabase;
    const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ success: false, error: "Invalid session" });

    const { data, error } = await db
      .from("user_onboarding")
      .select("sumsub_outcome")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    let accounts = [];
    if (data?.sumsub_outcome) {
      try {
        accounts = JSON.parse(data.sumsub_outcome);
      } catch (e) {
        accounts = [];
      }
    }

    res.json({ success: true, accounts });
  } catch (error) {
    console.error("Fetch bank accounts error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/banking/capture-confirm", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, error: "Missing token" });

    const db = supabaseAdmin || supabase;
    const authClient = supabaseAdmin || supabase;
    if (!authClient) {
      return res.status(500).json({ success: false, error: "Database not configured" });
    }
    const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ success: false, error: "Invalid session" });

    const { accounts } = req.body;
    if (!accounts || !Array.isArray(accounts)) {
      return res.status(400).json({ success: false, error: "accounts array required" });
    }

    const bankJson = JSON.stringify(accounts);

    const { data: existing } = await db
      .from("user_onboarding")
      .select("id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      await db
        .from("user_onboarding")
        .update({ sumsub_outcome: bankJson })
        .eq("id", existing.id);
    }

    const { data: existingAction } = await db
      .from("required_actions")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    const actionData = { bank_linked: true, bank_in_review: false, bank_linked_at: new Date().toISOString() };
    if (existingAction) {
      await db.from("required_actions").update(actionData).eq("id", existingAction.id);
    } else {
      await db.from("required_actions").insert({ user_id: user.id, ...actionData });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Capture confirm error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/banking/unlink", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, error: "Missing token" });

    const db = supabaseAdmin || supabase;
    const authClient = supabaseAdmin || supabase;
    if (!authClient) {
      return res.status(500).json({ success: false, error: "Database not configured" });
    }
    const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ success: false, error: "Invalid session" });

    const { accountIndex, unlinkAll } = req.body;

    const { data: onboarding } = await db
      .from("user_onboarding")
      .select("id, sumsub_outcome")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let remainingAccounts = [];
    if (onboarding?.sumsub_outcome) {
      try {
        const accounts = JSON.parse(onboarding.sumsub_outcome);
        if (unlinkAll) {
          remainingAccounts = [];
        } else if (typeof accountIndex === "number" && accountIndex >= 0 && accountIndex < accounts.length) {
          remainingAccounts = accounts.filter((_, i) => i !== accountIndex);
        } else {
          return res.status(400).json({ success: false, error: "Valid accountIndex or unlinkAll flag required" });
        }
      } catch (e) {
        remainingAccounts = [];
      }
    }

    if (onboarding) {
      await db
        .from("user_onboarding")
        .update({ sumsub_outcome: remainingAccounts.length > 0 ? JSON.stringify(remainingAccounts) : null })
        .eq("id", onboarding.id);
    }

    if (remainingAccounts.length === 0) {
      await db
        .from("required_actions")
        .update({ bank_linked: false, bank_in_review: false, bank_linked_at: null })
        .eq("user_id", user.id);
    }

    res.json({ success: true, remainingAccounts, message: remainingAccounts.length > 0 ? "Account removed" : "All bank accounts unlinked" });
  } catch (error) {
    console.error("Unlink error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/account/reset", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, error: "Missing token" });

    const db = supabaseAdmin || supabase;
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ success: false, error: "Invalid session" });

    const uid = user.id;
    const results = {};

    const tables = [
      { name: "required_actions", action: "update", data: { bank_linked: false, bank_in_review: false, bank_linked_at: null, kyc_verified: false } },
      { name: "user_onboarding", action: "delete" },
      { name: "transactions", action: "delete" },
      { name: "loan_engine_score", action: "delete" },
      { name: "loan_application", action: "delete" },
      { name: "investment_goals", action: "delete" },
      { name: "notifications", action: "delete" },
      { name: "stock_holdings_c", action: "delete" },
      { name: "allocations", action: "delete" },
    ];

    for (const t of tables) {
      try {
        if (t.action === "delete") {
          const { error } = await db.from(t.name).delete().eq("user_id", uid);
          results[t.name] = error ? `error: ${error.message}` : "cleared";
        } else if (t.action === "update") {
          const { error } = await db.from(t.name).update(t.data).eq("user_id", uid);
          results[t.name] = error ? `error: ${error.message}` : "reset";
        }
      } catch (e) {
        results[t.name] = `skipped: ${e.message}`;
      }
    }

    console.log("Account reset results for", uid, results);
    res.json({ success: true, message: "Account reset complete", results });
  } catch (error) {
    console.error("Account reset error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

function extractLatestStatus(statuses) {
  if (!Array.isArray(statuses) || !statuses.length) return null;
  const sorted = [...statuses].sort((a, b) => {
    const aTime = Date.parse(a?.time || a?.created || a?.timestamp || 0);
    const bTime = Date.parse(b?.time || b?.created || b?.timestamp || 0);
    return bTime - aTime;
  });
  const latest = sorted[0];
  return latest?.code || latest?.status || latest?.state || null;
}

function extractLatestMilestone(milestones) {
  if (!Array.isArray(milestones) || !milestones.length) return null;
  const sorted = [...milestones].sort((a, b) => {
    const aTime = Date.parse(a?.time || a?.created || a?.timestamp || 0);
    const bTime = Date.parse(b?.time || b?.created || b?.timestamp || 0);
    return bTime - aTime;
  });
  const latest = sorted[0];
  return latest?.code || latest?.status || latest?.state || latest?.name || null;
}

// ============ STOCK MARKET DATA ENDPOINTS ============

app.get("/api/stocks/quote", async (req, res) => {
  try {
    const { symbols } = req.query;
    if (!symbols) return res.status(400).json({ error: "symbols parameter required" });

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbols.split(',')[0]}?interval=1d&range=1d`;

    const symbolList = symbols.split(',').map(s => s.trim());
    const results = {};

    await Promise.all(symbolList.map(async (symbol) => {
      try {
        const response = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          }
        );
        const data = await response.json();
        const result = data?.chart?.result?.[0];
        if (result) {
          const meta = result.meta;
          const prevClose = meta.chartPreviousClose || meta.previousClose;
          const currentPrice = meta.regularMarketPrice;
          const change = currentPrice - prevClose;
          const changePercent = prevClose ? ((change / prevClose) * 100) : 0;

          results[symbol] = {
            symbol: symbol,
            name: meta.shortName || meta.longName || symbol,
            price: currentPrice,
            previousClose: prevClose,
            change: change,
            changePercent: changePercent,
            currency: meta.currency || 'USD',
            exchange: meta.exchangeName || '',
          };
        }
      } catch (err) {
        console.error(`Error fetching quote for ${symbol}:`, err.message);
        results[symbol] = { symbol, error: err.message };
      }
    }));

    res.json(results);
  } catch (error) {
    console.error("Stock quote error:", error);
    res.status(500).json({ error: "Failed to fetch stock quotes" });
  }
});

app.get("/api/stocks/chart", async (req, res) => {
  try {
    const { symbol, range = '5d', interval = '15m' } = req.query;
    if (!symbol) return res.status(400).json({ error: "symbol parameter required" });

    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      }
    );

    const data = await response.json();
    const result = data?.chart?.result?.[0];

    if (!result) {
      return res.status(404).json({ error: "No data found for symbol" });
    }

    const timestamps = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0] || {};
    const closes = quotes.close || [];

    const chartPoints = timestamps.map((ts, i) => {
      const date = new Date(ts * 1000);
      let label;

      if (range === '1d') {
        label = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      } else if (range === '5d') {
        label = date.toLocaleDateString('en-US', { weekday: 'short' });
      } else if (range === '1mo') {
        label = date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
      } else if (range === '6mo' || range === '1y') {
        label = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      } else {
        label = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      }

      return {
        day: label,
        value: closes[i] != null ? Number(closes[i].toFixed(2)) : null,
        timestamp: ts,
      };
    }).filter(p => p.value != null);

    const meta = result.meta;

    res.json({
      symbol: symbol,
      currency: meta.currency || 'USD',
      chartPoints,
      currentPrice: meta.regularMarketPrice,
      previousClose: meta.chartPreviousClose || meta.previousClose,
    });
  } catch (error) {
    console.error("Stock chart error:", error);
    res.status(500).json({ error: "Failed to fetch stock chart data" });
  }
});

async function authenticateUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { user: null, error: "Missing or invalid Authorization header" };
  }
  const token = authHeader.replace("Bearer ", "");
  if (!supabase) {
    return { user: null, error: "Database client not initialized" };
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return { user: null, error: error?.message || "Invalid token" };
  }
  return { user: data.user, error: null };
}

async function verifyPaystackPayment(reference) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return { verified: false, error: "Paystack secret key not configured" };
  }
  console.log("[paystack-verify] Verifying reference:", reference, "key prefix:", secretKey.substring(0, 8) + "...");
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${secretKey}`,
    },
  });
  const result = await response.json();
  console.log("[paystack-verify] API response status:", result.status, "data.status:", result.data?.status, "data.gateway_response:", result.data?.gateway_response, "message:", result.message);
  if (!result.status || result.data?.status !== "success") {
    return { verified: false, error: "Payment not successful", data: result.data };
  }
  return { verified: true, data: result.data };
}

app.post("/api/reconcile-payments", async (req, res) => {
  try {
    console.log("[reconcile] === ENDPOINT CALLED ===");

    if (!supabase) {
      return res.status(500).json({ success: false, error: "Database not connected" });
    }

    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: authError || "Unauthorized" });
    }

    const userId = user.id;
    console.log("[reconcile] Authenticated user:", userId);

    const paystackKey = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackKey) {
      return res.status(500).json({ success: false, error: "Paystack not configured" });
    }

    const https = require("https");
    const fetchPaystackPage = (page) => {
      return new Promise((resolve) => {
        const options = {
          hostname: "api.paystack.co",
          path: `/transaction?perPage=100&page=${page}&status=success`,
          method: "GET",
          headers: { Authorization: `Bearer ${paystackKey}` },
        };
        const req = https.request(options, (resp) => {
          let body = "";
          resp.on("data", (d) => (body += d));
          resp.on("end", () => {
            try { resolve(JSON.parse(body)); } catch (e) { resolve({ status: false }); }
          });
        });
        req.on("error", () => resolve({ status: false }));
        req.end();
      });
    };

    let allPaystackTxns = [];
    let page = 1;
    const maxPages = 10;
    while (page <= maxPages) {
      const result = await fetchPaystackPage(page);
      if (!result.status || !result.data || result.data.length === 0) break;
      allPaystackTxns = allPaystackTxns.concat(result.data);
      if (result.data.length < 100) break;
      page++;
    }

    console.log("[reconcile] Fetched", allPaystackTxns.length, "total Paystack transactions across", page, "pages");

    const userPaystackTxns = allPaystackTxns.filter(
      (t) =>
        t.status === "success" &&
        t.reference?.startsWith("MINT-") &&
        t.metadata?.user_id === userId
    );

    console.log("[reconcile] Found", userPaystackTxns.length, "successful MINT payments for this user");

    const { data: existingTxns } = await (supabaseAdmin || supabase)
      .from("transactions")
      .select("store_reference")
      .eq("user_id", userId);

    const recordedRefs = new Set((existingTxns || []).map((t) => t.store_reference));
    const candidates = userPaystackTxns.filter((t) => !recordedRefs.has(t.reference));

    console.log("[reconcile] Candidates missing from DB:", candidates.length);

    const recovered = [];
    const skipped = [];
    const db = supabaseAdmin || supabase;

    for (const candidate of candidates) {
      const ref = candidate.reference;

      const { verified, error: verifyErr, data: verifiedData } = await verifyPaystackPayment(ref);
      if (!verified) {
        console.log("[reconcile] SKIPPING", ref, "- verification failed:", verifyErr);
        skipped.push({ reference: ref, reason: verifyErr || "Verification failed" });
        continue;
      }

      if (verifiedData.metadata?.user_id !== userId) {
        console.log("[reconcile] SKIPPING", ref, "- user_id mismatch in verified data");
        skipped.push({ reference: ref, reason: "User ID mismatch" });
        continue;
      }

      const paidAmount = verifiedData.amount / 100;
      const meta = verifiedData.metadata || {};
      const securityId = meta.strategy_id;
      const assetName = meta.strategy_name || "";
      const investmentAmount = meta.investment_amount || paidAmount;
      const shareCount = meta.share_count ? Number(meta.share_count) : null;

      console.log("[reconcile] Verified & recovering:", ref, "R" + paidAmount, assetName);

      const { data: securityCheck } = await db
        .from("securities_c")
        .select("id, last_price")
        .eq("id", securityId)
        .maybeSingle();

      const isStrategy = !securityCheck;
      const description = isStrategy
        ? `Invested in strategy ${assetName}`
        : `Purchased shares of ${assetName}`;

      const { error: txError } = await db.from("transactions").insert({
        user_id: userId,
        amount: investmentAmount,
        description,
        store_reference: ref,
        direction: "debit",
        name: isStrategy ? `Invested ${assetName}` : `Purchased ${assetName}`,
        currency: "ZAR",
        status: "posted",
      });

      if (txError) {
        console.error("[reconcile] Transaction insert error for", ref, ":", txError.message);
        skipped.push({ reference: ref, reason: "DB insert failed: " + txError.message });
        continue;
      }

      if (securityCheck) {
        const currentPriceCents = securityCheck.last_price || 0;
        const currentPriceRands = currentPriceCents / 100;
        const quantity = shareCount || (currentPriceRands > 0 ? Math.max(1, Math.floor(investmentAmount / currentPriceRands)) : 1);
        const avgFillCents = currentPriceCents;
        const marketValueCents = quantity * currentPriceCents;

        const { data: existing } = await db
          .from("stock_holdings_c")
          .select("*")
          .eq("user_id", userId)
          .eq("security_id", securityId)
          .maybeSingle();

        if (existing) {
          const newQty = existing.quantity + quantity;
          const newMarketValue = newQty * currentPriceCents;
          await db
            .from("stock_holdings_c")
            .update({ quantity: newQty, market_value: newMarketValue, as_of_date: new Date().toISOString().split("T")[0] })
            .eq("id", existing.id);
        } else {
          await db.from("stock_holdings_c").insert({
            user_id: userId,
            security_id: securityId,
            quantity,
            avg_fill: avgFillCents,
            market_value: marketValueCents,
            Status: "active",
            as_of_date: new Date().toISOString().split("T")[0],
          });
        }
      }

      if (isStrategy && meta.strategy_id) {
        const { data: existingStrat } = await db
          .from("user_strategies")
          .select("*")
          .eq("user_id", userId)
          .eq("strategy_id", meta.strategy_id)
          .maybeSingle();

        if (existingStrat) {
          await db
            .from("user_strategies")
            .update({ invested_amount: (existingStrat.invested_amount || 0) + investmentAmount })
            .eq("id", existingStrat.id);
        } else {
          await db.from("user_strategies").insert({
            user_id: userId,
            strategy_id: meta.strategy_id,
            invested_amount: investmentAmount,
            status: "active",
          });
        }
      }

      recovered.push({ reference: ref, amount: paidAmount, asset: assetName });
    }

    console.log("[reconcile] === DONE === Recovered:", recovered.length, "Skipped:", skipped.length);
    res.json({ success: true, recovered: recovered.length, skipped: skipped.length, details: recovered, skippedDetails: skipped });
  } catch (error) {
    console.error("[reconcile] === UNCAUGHT ERROR ===", error);
    res.status(500).json({ success: false, error: error.message || "Reconciliation failed" });
  }
});

app.post("/api/record-investment", async (req, res) => {
  try {
    console.log("[record-investment] === ENDPOINT CALLED ===");
    console.log("[record-investment] Request body:", JSON.stringify(req.body, null, 2));

    if (!supabase) {
      console.log("[record-investment] ERROR: Database not connected");
      return res.status(500).json({ success: false, error: "Database not connected" });
    }

    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) {
      console.log("[record-investment] AUTH FAILED:", authError || "No user");
      return res.status(401).json({ success: false, error: authError || "Unauthorized" });
    }
    const userId = user.id;
    console.log("[record-investment] Authenticated user:", userId);
    const db = supabaseAdmin || supabase;
    console.log("[record-investment] Using DB client:", supabaseAdmin ? "admin (service role)" : "anon");

    const { securityId, symbol, name, amount, baseAmount, strategyId, paymentReference, shareCount, paymentMethod } = req.body;
    // baseAmount = investment amount excluding fees; amount = total charged including fees
    const investAmount = (baseAmount && baseAmount > 0) ? baseAmount : amount;
    console.log("[record-investment] Parsed fields - securityId:", securityId, "symbol:", symbol, "name:", name, "amount:", amount, "baseAmount:", baseAmount, "strategyId:", strategyId, "paymentReference:", paymentReference, "shareCount:", shareCount, "paymentMethod:", paymentMethod);

    if (!securityId || !amount || !paymentReference) {
      console.log("[record-investment] MISSING FIELDS - securityId:", !!securityId, "amount:", !!amount, "paymentReference:", !!paymentReference);
      return res.status(400).json({ success: false, error: "Missing required fields: securityId, amount, paymentReference" });
    }

    let payData = { amount: Math.round(amount * 100) };
    const skipVerification = paymentMethod === "wallet" || paymentMethod === "direct_eft" || paymentMethod === "ozow";

    if (!skipVerification) {
      console.log("[record-investment] Verifying Paystack payment:", paymentReference);
      const { verified, error: payError, data: vPayData } = await verifyPaystackPayment(paymentReference);
      if (!verified) {
        console.log("[record-investment] PAYSTACK VERIFICATION FAILED:", payError);
        return res.status(400).json({ success: false, error: payError || "Payment verification failed" });
      }
      payData = vPayData;
      console.log("[record-investment] Paystack verified OK. Paid amount (kobo):", payData.amount, "= R", payData.amount / 100);
    } else {
      console.log(`[record-investment] Skipping Paystack verification for ${paymentMethod} payment using reference: ${paymentReference}`);
    }

    // ── WALLET PAYMENT HANDLER (PROMPT 1) ───────────────────────────────────
    let originalWalletBalance = null;
    let newWalletBalance = null;
    let deductionSuccessful = false;

    if (paymentMethod === "wallet") {
      const { data: wallet, error: walletQueryError } = await db
        .from("wallets")
        .select("balance")
        .eq("user_id", userId)
        .maybeSingle();

      if (walletQueryError || !wallet) {
        console.log("[record-investment] WALLET NOT FOUND for user:", userId);
        return res.status(400).json({ success: false, error: "Wallet not found" });
      }

      originalWalletBalance = Number(wallet.balance);
      if (originalWalletBalance < amount) {
        console.log("[record-investment] INSUFFICIENT FUNDS. Balance:", originalWalletBalance, "Required:", amount);
        return res.status(400).json({ success: false, error: "Insufficient funds" });
      }

      newWalletBalance = originalWalletBalance - amount;
      const { error: deductError } = await db
        .from("wallets")
        .update({ balance: newWalletBalance })
        .eq("user_id", userId);

      if (deductError) {
        console.error("[record-investment] WALLET DEDUCTION ERROR:", deductError.message);
        return res.status(500).json({ success: false, error: "Failed to deduct wallet balance" });
      }

      deductionSuccessful = true;
      const feeDeducted = amount - (baseAmount || amount);
      console.log(`[Wallet] Deducted R${amount} from user ${userId}. Base: R${baseAmount || amount}, Fee: R${feeDeducted.toFixed(2)}, Final balance: R${newWalletBalance}`);
    }

    const { data: existingTx } = await db
      .from("transactions")
      .select("id")
      .eq("store_reference", paymentReference)
      .maybeSingle();
    if (existingTx) {
      console.log("[record-investment] DUPLICATE: Transaction already recorded for ref:", paymentReference, "tx id:", existingTx.id);
      return res.status(409).json({ success: true, message: "Already recorded", duplicate: true });
    }

    const paidAmount = payData.amount / 100;
    if (!skipVerification && Math.abs(paidAmount - amount) > 1) {
      console.log("[record-investment] AMOUNT MISMATCH: paid", paidAmount, "expected", amount);
      return res.status(400).json({ success: false, error: `Amount mismatch: paid ${paidAmount}, expected ${amount}` });
    }

    const isStrategyInvestment = !!strategyId;

    if (isStrategyInvestment) {
      console.log("[record-investment] Strategy investment detected - strategyId:", strategyId);

      const { data: strategyData, error: stratError } = await db
        .from("strategies_c")
        .select("holdings")
        .eq("id", strategyId)
        .maybeSingle();

      if (stratError || !strategyData?.holdings?.length) {
        console.warn("[record-investment] Could not fetch strategy holdings:", stratError?.message);
        return res.status(500).json({ success: false, error: "Could not load strategy holdings to record positions" });
      }

      const strategyHoldings = strategyData.holdings;
      const symbols = strategyHoldings.map(h => h.symbol).filter(Boolean);

      const { data: securitiesData, error: secLookupError } = await db
        .from("securities_c")
        .select("id, symbol, last_price")
        .in("symbol", symbols);

      if (secLookupError) {
        return res.status(500).json({ success: false, error: "Could not look up securities for strategy" });
      }

      const secBySymbol = {};
      (securitiesData || []).forEach(s => { secBySymbol[s.symbol] = s; });

      // Compute total basket cost at current prices so we can scale by investAmount
      let totalBasketCostRands = 0;
      for (const holding of strategyHoldings) {
        const sec = secBySymbol[holding.symbol];
        if (!sec) continue;
        const qty = Number(holding.quantity || holding.shares || 0);
        const priceCents = Number(sec.last_price || 0);
        if (qty > 0 && priceCents > 0) totalBasketCostRands += (qty * priceCents) / 100;
      }
      // investAmount is how much the user actually put in (before fees)
      const scalingRatio = totalBasketCostRands > 0 ? investAmount / totalBasketCostRands : 1;
      console.log("[record-investment] Basket cost:", totalBasketCostRands.toFixed(2), "investAmount:", investAmount, "scalingRatio:", scalingRatio.toFixed(6));

      const now = new Date().toISOString();
      const today = now.split("T")[0];
      const insertedHoldings = [];
      const skippedSymbols = [];

      for (const holding of strategyHoldings) {
        const sec = secBySymbol[holding.symbol];
        if (!sec) {
          console.warn("[record-investment] Security not found for symbol:", holding.symbol);
          skippedSymbols.push(holding.symbol);
          continue;
        }

        const rawHoldingQty = Number(holding.quantity || holding.shares || 0);
        if (rawHoldingQty <= 0) {
          skippedSymbols.push(holding.symbol);
          continue;
        }

        // Scale shares proportionally to what the user actually invested — always whole shares
        const holdingQty = Math.max(1, Math.round(rawHoldingQty * scalingRatio));

        const priceCents = Number(sec.last_price || 0);
        if (priceCents <= 0) {
          console.warn("[record-investment] No price found for:", holding.symbol);
          skippedSymbols.push(holding.symbol);
          continue;
        }

        const { data: existing, error: lookupErr } = await db
          .from("stock_holdings_c")
          .select("id, quantity, avg_fill")
          .eq("user_id", userId)
          .eq("security_id", sec.id)
          .eq("strategy_id", strategyId)
          .maybeSingle();

        if (lookupErr) {
          console.error("[record-investment] Error looking up holding for", holding.symbol, lookupErr.message);
          return res.status(500).json({ success: false, error: `Failed to look up holding for ${holding.symbol}` });
        }

        if (existing) {
          const oldQty = Number(existing.quantity || 0);
          const newQty = Math.round(oldQty + holdingQty);
          const oldAvgFill = Number(existing.avg_fill || 0);
          const newAvgFill = oldQty > 0 && oldAvgFill > 0
            ? Math.round((oldAvgFill * oldQty + priceCents * holdingQty) / newQty)
            : priceCents;

          const { error: updateErr } = await db.from("stock_holdings_c").update({
            quantity: newQty,
            avg_fill: newAvgFill,
            market_value: Math.round(newQty * priceCents),
            as_of_date: today,
            updated_at: now,
          }).eq("id", existing.id);

          if (updateErr) {
            console.error("[record-investment] Failed to update holding for", holding.symbol, updateErr.message);
            return res.status(500).json({ success: false, error: `Failed to update holding for ${holding.symbol}` });
          }
          console.log("[record-investment] Updated holding:", holding.symbol, "qty:", newQty, "avg_fill:", newAvgFill);
        } else {
          const { error: insertErr } = await db.from("stock_holdings_c").insert({
            user_id: userId,
            security_id: sec.id,
            strategy_id: strategyId,
            quantity: holdingQty,
            avg_fill: priceCents,
            market_value: Math.round(holdingQty * priceCents),
            unrealized_pnl: 0,
            as_of_date: today,
            Status: "active",
          });

          if (insertErr) {
            console.error("[record-investment] Failed to insert holding for", holding.symbol, insertErr.message);
            return res.status(500).json({ success: false, error: `Failed to record holding for ${holding.symbol}` });
          }
          console.log("[record-investment] Inserted holding:", holding.symbol, "qty:", holdingQty, "avg_fill:", priceCents);
        }

        insertedHoldings.push({ symbol: holding.symbol, quantity: holdingQty, priceCents });
      }

      if (skippedSymbols.length > 0) {
        console.warn("[record-investment] Skipped symbols (no security/price):", skippedSymbols.join(", "));
      }
      console.log("[record-investment] Strategy holdings recorded:", insertedHoldings.length, "skipped:", skippedSymbols.length);
    }

    console.log("[record-investment] Checking if securityId exists in securities table:", securityId);
    const { data: securityCheck, error: secCheckError } = await db
      .from("securities_c")
      .select("id")
      .eq("id", securityId)
      .maybeSingle();
    console.log("[record-investment] Security check result:", securityCheck ? "FOUND" : "NOT FOUND", "error:", secCheckError ? JSON.stringify(secCheckError) : "none");

    let holdingResult = { data: null, error: null };
    let currentPriceCents = null;
    let calcQuantity = null;

    if (securityCheck && !isStrategyInvestment) {
      console.log("[record-investment] Security exists - will create/update stock_holdings_c");
      const { data: securityData, error: secError } = await db
        .from("securities_c")
        .select("last_price")
        .eq("id", securityId)
        .maybeSingle();

      if (!secError && securityData?.last_price) {
        currentPriceCents = Number(securityData.last_price);
        console.log("[record-investment] Got last_price from securities:", currentPriceCents, "cents");
      } else {
        console.log("[record-investment] No last_price in securities, checking security_prices table");
        const { data: priceData, error: priceError } = await db
          .from("stock_returns_c")
          .select("current_price")
          .eq("security_id", securityId)
          .order("as_of_date", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!priceError && priceData?.close_price) {
          currentPriceCents = Number(priceData.close_price);
          console.log("[record-investment] Got close_price from security_prices:", currentPriceCents, "cents");
        } else {
          console.log("[record-investment] No price found in security_prices either. priceError:", priceError ? JSON.stringify(priceError) : "none");
        }
      }

      const currentPriceRands = currentPriceCents ? currentPriceCents / 100 : amount;
      const rawQuantity = shareCount && Number(shareCount) > 0 ? Number(shareCount) : (currentPriceRands > 0 ? amount / currentPriceRands : 1);
      const quantity = Math.max(1, Math.round(rawQuantity));
      calcQuantity = quantity;
      console.log("[record-investment] Calculated - currentPriceRands:", currentPriceRands, "rawQuantity:", rawQuantity, "quantity:", quantity);

      const { data: existing, error: fetchError } = await db
        .from("stock_holdings_c")
        .select("id, quantity, avg_fill, market_value")
        .eq("user_id", userId)
        .eq("security_id", securityId)
        .maybeSingle();

      if (fetchError) {
        console.error("[record-investment] Error checking existing holding:", JSON.stringify(fetchError));
        return res.status(500).json({ success: false, error: fetchError.message });
      }

      if (existing) {
        console.log("[record-investment] Existing holding found, updating. Old qty:", existing.quantity);
        const oldQty = Number(existing.quantity || 0);
        const newQty = Math.round(oldQty + quantity);
        console.log("[record-investment] New qty:", newQty);
        const { data, error } = await db
          .from("stock_holdings_c")
          .update({
            quantity: newQty,
            as_of_date: new Date().toISOString().split("T")[0],
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .select();
        holdingResult = { data, error };
        console.log("[record-investment] Holding UPDATE result:", error ? "ERROR: " + JSON.stringify(error) : "OK", JSON.stringify(data));
      } else {
        console.log("[record-investment] No existing holding, inserting new");
        const holdingData = {
          user_id: userId,
          security_id: securityId,
          quantity: quantity,
          as_of_date: new Date().toISOString().split("T")[0],
          Status: "active",
          strategy_id: strategyId || null,
        };
        console.log("[record-investment] Insert data:", JSON.stringify(holdingData));
        const { data, error } = await db
          .from("stock_holdings_c")
          .insert(holdingData)
          .select();
        holdingResult = { data, error };
        console.log("[record-investment] Holding INSERT result:", error ? "ERROR: " + JSON.stringify(error) : "OK", JSON.stringify(data));
      }

      if (holdingResult.error) {
        console.error("[record-investment] HOLDING UPSERT FAILED:", JSON.stringify(holdingResult.error));
        return res.status(500).json({ success: false, error: holdingResult.error.message });
      }
    }

    console.log("[record-investment] isStrategyInvestment:", isStrategyInvestment);
    const descriptionText = isStrategyInvestment
      ? `Invested in strategy ${name || "Strategy"}`
      : `Purchased ${(holdingResult.data ? "shares" : "units")} of ${name || symbol || "Unknown"}`;

    console.log("[record-investment] Creating transaction record...");
    const txPayload = {
      user_id: userId,
      direction: "debit",
      name: isStrategyInvestment ? `Strategy Investment: ${name || symbol || "Strategy"}` : `Purchased ${name || symbol || "Stock"}`,
      description: descriptionText,
      amount: Math.round(amount * 100),
      store_reference: paymentReference || null,
      currency: "ZAR",
      status: "posted",
      transaction_date: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    let txData, txError;
    const txResult1 = await db.from("transactions").insert(txPayload).select();
    txData = txResult1.data;
    txError = txResult1.error;

    if (txError && txError.message && txError.message.includes("settlement_status")) {
      console.log("[record-investment] Retrying transaction insert without settlement_status...");
      const txResult2 = await db.from("transactions").insert(txPayload).select();
      txData = txResult2.data;
      txError = txResult2.error;
    }

    if (txError) {
      console.error("[record-investment] TRANSACTION INSERT ERROR:", JSON.stringify(txError));
    } else {
      console.log("[record-investment] Transaction created OK:", JSON.stringify(txData));
    }

    if (isStrategyInvestment) {
      console.log("[record-investment] Upserting user_strategies record for strategy:", strategyId);
      try {
        const { data: existingUS } = await db
          .from("user_strategies")
          .select("id, invested_amount")
          .eq("user_id", userId)
          .eq("strategy_id", strategyId)
          .maybeSingle();

        if (existingUS) {
          const newInvested = (existingUS.invested_amount || 0) + Math.round(amount * 100);
          const { error: usUpdateErr } = await db
            .from("user_strategies")
            .update({ invested_amount: newInvested, updated_at: new Date().toISOString() })
            .eq("id", existingUS.id);
          if (usUpdateErr) {
            console.error("[record-investment] user_strategies UPDATE error:", JSON.stringify(usUpdateErr));
          } else {
            console.log("[record-investment] user_strategies updated, new invested_amount:", newInvested);
          }
        } else {
          const usPayload = {
            user_id: userId,
            strategy_id: strategyId,
            invested_amount: Math.round(amount * 100),
            status: "active",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          const { error: usInsertErr } = await db
            .from("user_strategies")
            .insert(usPayload);
          if (usInsertErr) {
            console.error("[record-investment] user_strategies INSERT error:", JSON.stringify(usInsertErr));
          } else {
            console.log("[record-investment] user_strategies created for strategy:", strategyId);
          }
        }
      } catch (usErr) {
        console.error("[record-investment] user_strategies upsert failed:", usErr.message);
      }
    }

    const orderDate = new Date().toISOString();
    const confirmEmailData = {
      userId,
      userEmail: user.email,
      assetName: name || null,
      assetSymbol: symbol || null,
      strategyName: isStrategyInvestment ? (name || symbol || "Strategy") : null,
      amountCents: Math.round(amount * 100),
      quantity: calcQuantity,
      priceCents: currentPriceCents,
      reference: paymentReference,
      orderDate,
      paymentMethod,
    };
    sendOrderConfirmationEmail(db, confirmEmailData).catch(() => { });

    console.log("[record-investment] === SUCCESS === Holding:", JSON.stringify(holdingResult.data));
    res.json({
      success: true,
      holding: holdingResult.data,
      newWalletBalance: paymentMethod === "wallet" ? newWalletBalance : null
    });
  } catch (error) {
    console.error("[record-investment] === UNCAUGHT ERROR ===", error);

    // Rollback wallet deduction if anything failed after deduction was successful
    if (typeof paymentMethod !== 'undefined' && paymentMethod === "wallet" && typeof deductionSuccessful !== 'undefined' && deductionSuccessful && typeof originalWalletBalance !== 'undefined' && originalWalletBalance !== null) {
      try {
        const db = supabaseAdmin || supabase;
        console.log(`[Wallet] Rollback — Attempting to restore user wallet balance to ${originalWalletBalance}`);
        await db.from("wallets").update({ balance: originalWalletBalance }).eq("user_id", userId);
      } catch (rollbackErr) {
        console.error("[Wallet] Rollback CRITICAL FAILURE:", rollbackErr.message);
      }
    }

    res.status(500).json({ success: false, error: error.message || "Failed to record investment" });
  }
});

app.post("/api/eft-deposit", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) return res.status(401).json({ success: false, error: "Unauthorized" });

    const db = supabaseAdmin || supabase;
    const userId = user.id;
    const { amount, reference, securityId, symbol, name, strategyId, baseAmount, shareCount } = req.body;

    if (!amount || Number(amount) <= 0) return res.status(400).json({ success: false, error: "Invalid amount" });

    const amountCents = Math.round(Number(amount) * 100);
    const eftRef = reference || `EFT-${Date.now()}`;
    const now = new Date().toISOString();
    const assetName = name || symbol || "Investment";

    const purchaseIntent = {
      type: "eft_intent",
      securityId: securityId || null,
      symbol: symbol || null,
      name: name || null,
      strategyId: strategyId || null,
      amount: Number(amount),
      baseAmount: baseAmount ? Number(baseAmount) : Number(amount),
      shareCount: shareCount ? Number(shareCount) : null,
    };

    const { error: txError } = await db.from("transactions").insert({
      user_id: userId,
      direction: "credit",
      name: `EFT Deposit — ${assetName}`,
      description: JSON.stringify(purchaseIntent),
      amount: amountCents,
      store_reference: eftRef,
      currency: "ZAR",
      status: "pending",
      transaction_date: now,
      created_at: now,
    });

    if (txError) {
      console.error("[eft-deposit] Transaction insert error:", txError.message);
      return res.status(500).json({ success: false, error: "Failed to record pending deposit" });
    }

    try {
      const { data: wallet } = await db.from("wallets").select("pending_balance").eq("user_id", userId).maybeSingle();
      if (wallet !== null) {
        const currentPending = Number(wallet?.pending_balance || 0);
        await db.from("wallets").update({ pending_balance: currentPending + Number(amount) }).eq("user_id", userId);
      }
    } catch (walletErr) {
      console.warn("[eft-deposit] Could not update pending_balance:", walletErr?.message);
    }

    try {
      if (process.env.RESEND_API_KEY && user.email) {
        const { buildEFTPendingHtml } = await import('../api/_lib/order-email-templates.js');
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        const html = buildEFTPendingHtml({ assetName, amountCents, reference: eftRef, dateStr: now });
        const resp = await resend.emails.send({
          from: "Mint <orders@mymint.co.za>",
          to: [user.email],
          subject: `EFT Payment Noted — ${assetName}`,
          html,
        });
        if (resp.error) {
          console.error("[eft-deposit] Email error:", resp.error.message);
        } else {
          console.log(`[eft-deposit] Pending email sent to ${user.email} for ${assetName}`);
        }
      }
    } catch (emailErr) {
      console.warn("[eft-deposit] Could not send pending email:", emailErr?.message);
    }

    console.log(`[eft-deposit] Pending EFT of R${amount} recorded for user ${userId}, ref: ${eftRef}, asset: ${assetName}`);
    return res.status(200).json({ success: true, reference: eftRef });
  } catch (err) {
    console.error("[eft-deposit] Error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to record EFT deposit" });
  }
});

app.post("/api/confirm-eft-deposit", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const adminSecret = process.env.ADMIN_SECRET || process.env.CONFIRM_EFT_SECRET;
    const { reference, adminSecret: providedSecret } = req.body;

    if (!adminSecret || providedSecret !== adminSecret) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
    if (!reference) return res.status(400).json({ success: false, error: "Missing reference" });

    const db = supabaseAdmin || supabase;
    if (!db) return res.status(500).json({ success: false, error: "Database not connected" });

    const { data: tx, error: txLookupErr } = await db
      .from("transactions")
      .select("*")
      .eq("store_reference", reference)
      .eq("status", "pending")
      .maybeSingle();

    if (txLookupErr || !tx) {
      return res.status(404).json({ success: false, error: "Pending EFT transaction not found for reference: " + reference });
    }

    let intent = {};
    try {
      const parsed = JSON.parse(tx.description || "{}");
      if (parsed.type === "eft_intent") intent = parsed;
    } catch (_) { }

    const { securityId, symbol, name, strategyId, amount, baseAmount } = intent;
    const userId = tx.user_id;
    const amountCents = tx.amount;
    const investAmount = baseAmount && baseAmount > 0 ? baseAmount : (amount || amountCents / 100);
    const isStrategyInvestment = !!strategyId;
    const now = new Date().toISOString();
    const today = now.split("T")[0];
    let quantity = null;
    let currentPriceCents = null;

    let userEmail = null;
    try {
      const { data: authUser } = await (supabaseAdmin || supabase).auth.admin.getUserById(userId);
      userEmail = authUser?.user?.email || null;
    } catch (_) { }

    if (isStrategyInvestment && securityId) {
      const { data: strategyData } = await db.from("strategies_c").select("holdings").eq("id", strategyId).maybeSingle();
      if (strategyData?.holdings?.length) {
        const symbols = strategyData.holdings.map(h => h.symbol).filter(Boolean);
        const { data: securitiesData } = await db.from("securities_c").select("id, symbol, last_price").in("symbol", symbols);
        const secBySymbol = {};
        (securitiesData || []).forEach(s => { secBySymbol[s.symbol] = s; });
        let totalBasketCostRands = 0;
        for (const h of strategyData.holdings) {
          const sec = secBySymbol[h.symbol];
          if (!sec) continue;
          const qty = Number(h.quantity || h.shares || 0);
          const pc = Number(sec.last_price || 0);
          if (qty > 0 && pc > 0) totalBasketCostRands += (qty * pc) / 100;
        }
        const scalingRatio = totalBasketCostRands > 0 ? investAmount / totalBasketCostRands : 1;
        for (const h of strategyData.holdings) {
          const sec = secBySymbol[h.symbol];
          if (!sec) continue;
          const rawQty = Number(h.quantity || h.shares || 0);
          if (rawQty <= 0) continue;
          const holdingQty = rawQty * scalingRatio;
          const pc = Number(sec.last_price || 0);
          if (pc <= 0) continue;
          const { data: existing } = await db.from("stock_holdings_c").select("id, quantity, avg_fill").eq("user_id", userId).eq("security_id", sec.id).eq("strategy_id", strategyId).maybeSingle();
          if (existing) {
            const oldQty = Number(existing.quantity || 0);
            const newQty = oldQty + holdingQty;
            const newAvg = newQty > 0 ? ((Number(existing.avg_fill || 0) * oldQty) + (pc * holdingQty)) / newQty : pc;
            await db.from("stock_holdings_c").update({ quantity: newQty, avg_fill: Math.round(newAvg), market_value: Math.round(newQty * pc), as_of_date: today, updated_at: now }).eq("id", existing.id);
          } else {
            await db.from("stock_holdings_c").insert({ user_id: userId, security_id: sec.id, strategy_id: strategyId, quantity: holdingQty, avg_fill: pc, market_value: Math.round(holdingQty * pc), unrealized_pnl: 0, as_of_date: today, Status: "active" });
          }
        }

        // --- ADDED: user_strategies update for EFT confirmation ---
        console.log(`[confirm-eft] Upserting user_strategies for strategy: ${strategyId}`);
        const { data: existingUS } = await db.from("user_strategies").select("id, invested_amount").eq("user_id", userId).eq("strategy_id", strategyId).maybeSingle();
        if (existingUS) {
          const newInvested = (existingUS.invested_amount || 0) + amountCents;
          await db.from("user_strategies").update({ invested_amount: newInvested, updated_at: now }).eq("id", existingUS.id);
        } else {
          await db.from("user_strategies").insert({ user_id: userId, strategy_id: strategyId, invested_amount: amountCents, status: "active", created_at: now, updated_at: now });
        }
      }
    } else if (securityId && !isStrategyInvestment) {
      const { data: secData } = await db.from("securities_c").select("last_price").eq("id", securityId).maybeSingle();
      currentPriceCents = secData?.last_price ? Number(secData.last_price) : null;
      if (!currentPriceCents) {
        const { data: priceData } = await db.from("stock_returns_c").select("current_price").eq("security_id", securityId).order("as_of_date", { ascending: false }).limit(1).maybeSingle();
        if (priceData?.current_price) currentPriceCents = Number(priceData.current_price);
      }
      const priceRands = currentPriceCents ? currentPriceCents / 100 : investAmount;
      quantity = priceRands > 0 ? investAmount / priceRands : 1;
      const avgFill = currentPriceCents || Math.round(investAmount * 100);
      const { data: existing } = await db.from("stock_holdings_c").select("id, quantity, avg_fill").eq("user_id", userId).eq("security_id", securityId).maybeSingle();
      if (existing) {
        const oldQty = Number(existing.quantity || 0);
        const newQty = oldQty + quantity;
        const newAvg = newQty > 0 ? ((Number(existing.avg_fill || 0) * oldQty) + (avgFill * quantity)) / newQty : avgFill;
        await db.from("stock_holdings_c").update({ quantity: newQty, avg_fill: Math.round(newAvg), market_value: Math.round(newQty * (currentPriceCents || Math.round(newAvg))), as_of_date: today, updated_at: now }).eq("id", existing.id);
      } else {
        await db.from("stock_holdings_c").insert({ user_id: userId, security_id: securityId, quantity, avg_fill: avgFill, market_value: Math.round(quantity * (currentPriceCents || avgFill)), unrealized_pnl: 0, as_of_date: today, Status: "active", strategy_id: strategyId || null });
      }
    }

    await db.from("transactions").insert({
      user_id: userId,
      direction: "debit",
      name: isStrategyInvestment ? `Strategy Investment: ${name || symbol || "Strategy"}` : `Purchased ${name || symbol || "Stock"}`,
      description: isStrategyInvestment ? `Invested in strategy ${name || "Strategy"}` : `Purchased shares of ${name || symbol || "Unknown"}`,
      amount: amountCents,
      store_reference: `${reference}-INVEST`,
      currency: "ZAR",
      status: "posted",
      transaction_date: now,
      created_at: now,
    }).then(() => { }).catch(() => { });

    await db.from("transactions").update({ status: "posted" }).eq("store_reference", reference);

    try {
      const { data: wallet } = await db.from("wallets").select("balance, pending_balance").eq("user_id", userId).maybeSingle();
      if (wallet !== null) {
        const newBalance = Number(wallet.balance || 0) + (amount || amountCents / 100);
        const newPending = Math.max(0, Number(wallet.pending_balance || 0) - (amount || amountCents / 100));
        await db.from("wallets").update({ balance: newBalance, pending_balance: newPending }).eq("user_id", userId);
      }
    } catch (walletErr) {
      console.warn("[confirm-eft] Wallet update failed:", walletErr?.message);
    }

    if (userEmail) {
      try {
        sendOrderConfirmationEmail(db, {
          userId,
          userEmail,
          assetName: name || null,
          assetSymbol: symbol || null,
          strategyName: isStrategyInvestment ? (name || symbol || "Strategy") : null,
          amountCents,
          quantity,
          priceCents: currentPriceCents,
          reference,
          orderDate: now,
          paymentMethod: 'direct_eft',
        }).catch(() => { });
      } catch (_) { }
    }

    console.log(`[EFT] Payment confirmed for user ${userId}, ref: ${reference}, amount: R${amount || amountCents / 100}`);
    return res.status(200).json({ success: true, reference });
  } catch (err) {
    console.error("[confirm-eft] Error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to confirm EFT deposit" });
  }
});

app.post("/api/confirm-deposit", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const adminSecret = process.env.ADMIN_SECRET || process.env.CONFIRM_EFT_SECRET;
    const { reference, adminSecret: providedSecret, amount: manualAmount } = req.body;

    if (!adminSecret || providedSecret !== adminSecret) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
    if (!reference) return res.status(400).json({ success: false, error: "Missing reference" });

    const db = supabaseAdmin || supabase;
    const { data: tx, error: txErr } = await db
      .from("transactions")
      .select("*")
      .eq("store_reference", reference)
      .eq("type", "deposit")
      .eq("status", "pending")
      .maybeSingle();

    if (txErr || !tx) {
      return res.status(404).json({ success: false, error: "Pending deposit not found" });
    }

    const userId = tx.user_id;
    // Use manual amount from admin panel (cents) or stored amount
    const depositAmount = manualAmount || tx.amount;

    // 1. Update transaction status
    await db.from("transactions").update({
      status: "posted",
      amount: depositAmount,
      updated_at: new Date().toISOString()
    }).eq("id", tx.id);

    let newBalance = 0;
    const { data: wallet } = await db.from("wallets").select("id, balance").eq("user_id", userId).maybeSingle();
    if (wallet) {
      newBalance = (wallet.balance || 0) + depositAmount;
      await db.from("wallets").update({ balance: newBalance, updated_at: new Date().toISOString() }).eq("id", wallet.id);
    } else {
      newBalance = depositAmount;
      await db.from("wallets").insert({ user_id: userId, balance: depositAmount });
    }

    // 3. Send confirmation email
    try {
      const { data: authUser } = await (supabaseAdmin || supabase).auth.admin.getUserById(userId);
      const userEmail = authUser?.user?.email;

      if (userEmail && process.env.RESEND_API_KEY) {
        const { buildDepositConfirmationHtml } = await import("../api/_lib/order-email-templates.js");
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        const html = buildDepositConfirmationHtml({
          amountCents: depositAmount,
          newBalanceCents: newBalance,
          reference,
          dateStr: new Date().toISOString()
        });

        await resend.emails.send({
          from: "Mint <orders@mymint.co.za>",
          to: [userEmail],
          subject: "Wallet Top-up Confirmed",
          html,
        });
      }
    } catch (emailErr) {
      console.warn("[confirm-deposit] Email skip:", emailErr?.message);
    }

    console.log(`[confirm-deposit] User ${userId} wallet topped up by R${depositAmount / 100}`);
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("[confirm-deposit] Error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/user/ensure-mint-number", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ success: false, error: "Database not connected" });
    }
    if (!mintColumnAvailable) {
      return res.json({ success: true, mint_number: null });
    }
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: authError || "Unauthorized" });
    }
    const db = getAuthenticatedDb(req.headers.authorization?.replace('Bearer ', ''));
    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('id, first_name, id_number, created_at, mint_number')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError || !profile) {
      return res.json({ success: true, mint_number: null });
    }

    const resolvedId = await getIdNumberWithFallback(db, user.id, profile.id_number);

    if (resolvedId && (!profile.id_number || profile.id_number.length < 10)) {
      await db.from('profiles').update({ id_number: resolvedId }).eq('id', user.id);
    }

    const effectiveId = resolvedId || profile.id_number;
    const mintNum = generateMintNumber(profile.first_name, effectiveId, profile.created_at, '', profile.id);

    if (mintNum === profile.mint_number) {
      return res.json({ success: true, mint_number: profile.mint_number });
    }

    let finalMintNum = mintNum;
    let retryCount = 0;
    let success = false;
    let lastError = null;

    while (retryCount < 5 && !success) {
      const { error: updateErr } = await db
        .from('profiles')
        .update({ mint_number: finalMintNum })
        .eq('id', user.id);

      if (!updateErr) {
        success = true;
      } else if (updateErr.message?.includes('unique constraint') || updateErr.code === '23505') {
        retryCount++;
        const randomSuffix = '-' + Math.random().toString(36).substring(2, 5).toUpperCase();
        finalMintNum = generateMintNumber(profile.first_name, effectiveId, profile.created_at, randomSuffix, profile.id);
        console.log(`[mint] Collision for user ${user.id}, retrying with ${finalMintNum}`);
      } else {
        lastError = updateErr.message;
        break;
      }
    }

    if (!success) {
      console.log('[mint] Error setting mint number:', lastError || 'Max retries reached');
      return res.status(500).json({ success: false, error: lastError || 'Collision resolution failed' });
    }

    return res.json({ success: true, mint_number: finalMintNum });
  } catch (e) {
    console.error('[mint] ensure-mint-number error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/api/user/holdings", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ success: false, error: "Database not connected" });
    }

    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: authError || "Unauthorized" });
    }

    const db = supabaseAdmin || supabase;
    const userId = user.id;

    let holdings, holdingsError;

    // Attempt queries with progressively fewer optional columns to handle missing DB columns
    const holdingsFull = await db
      .from("stock_holdings_c")
      .select("id, user_id, security_id, strategy_id, quantity, avg_fill, market_value, unrealized_pnl, as_of_date, created_at, updated_at, Status, settlement_status, is_active, exit_price")
      .eq("user_id", userId);

    if (!holdingsFull.error) {
      holdings = holdingsFull.data;
      holdingsError = null;
    } else if (holdingsFull.error.code === "42703") {
      // One or more optional columns missing — try without settlement_status
      const noSettlement = await db
        .from("stock_holdings_c")
        .select("id, user_id, security_id, strategy_id, quantity, avg_fill, market_value, unrealized_pnl, as_of_date, created_at, updated_at, Status, is_active, exit_price")
        .eq("user_id", userId);

      if (!noSettlement.error) {
        holdings = noSettlement.data;
        holdingsError = null;
      } else if (noSettlement.error.code === "42703") {
        // Try without is_active and exit_price too
        const noExtras = await db
          .from("stock_holdings_c")
          .select("id, user_id, security_id, strategy_id, quantity, avg_fill, market_value, unrealized_pnl, as_of_date, created_at, updated_at, Status")
          .eq("user_id", userId);
        holdings = (noExtras.data || []).map(h => ({ ...h, is_active: true, exit_price: null }));
        holdingsError = noExtras.error;
      } else {
        holdings = noSettlement.data;
        holdingsError = noSettlement.error;
      }
    } else {
      holdings = holdingsFull.data;
      holdingsError = holdingsFull.error;
    }

    if (holdingsError) {
      console.error("Error fetching holdings:", holdingsError);
      return res.status(500).json({ success: false, error: holdingsError.message });
    }

    const rawHoldings = holdings || [];
    const securityIds = rawHoldings.map(h => h.security_id).filter(Boolean);
    let securitiesMap = {};
    let latestPricesMap = {};

    if (securityIds.length > 0) {
      const [secResult, pricesResult] = await Promise.all([
        db.from("securities_c")
          .select("id, symbol, name, logo_url, last_price, change_price, change_percent, sector, exchange")
          .in("id", securityIds),
        db.from("stock_returns_c")
          .select("security_id, current_price, as_of_date")
          .in("security_id", securityIds)
          .order("as_of_date", { ascending: false })
          .limit(securityIds.length * 2)
      ]);

      if (secResult.error) {
        console.error("Error fetching securities for holdings:", secResult.error);
      }
      if (secResult.data) {
        secResult.data.forEach(s => { 
          // Normalize to cents
          const normalizedSec = { ...s };
          if (s.last_price != null) normalizedSec.last_price = s.last_price * 100;
          if (s.change_price != null) normalizedSec.change_price = s.change_price * 100;
          securitiesMap[s.id] = normalizedSec; 
        });
      }

      const pricesBySecId = {};
      (pricesResult.data || []).forEach(p => {
        if (!pricesBySecId[p.security_id]) pricesBySecId[p.security_id] = [];
        if (pricesBySecId[p.security_id].length < 2) {
          // Already in cents in stock_returns_c
          pricesBySecId[p.security_id].push(p.current_price);
        }
      });
      for (const [secId, prices] of Object.entries(pricesBySecId)) {
        latestPricesMap[secId] = {
          latestPrice: prices[0],
          prevPrice: prices.length > 1 ? prices[1] : prices[0],
        };
      }
    }

    const enrichedHoldings = rawHoldings
      .filter(h => securitiesMap[h.security_id] && h.is_active !== false)
      .map(h => {
        const sec = securitiesMap[h.security_id];
        const priceData = latestPricesMap[h.security_id];
        const livePrice = sec?.last_price ?? priceData?.latestPrice ?? 0;
        const dailyChange = sec?.change_price ?? (livePrice - (priceData?.prevPrice ?? livePrice));
        const dailyChangePct = sec?.change_percent ?? (priceData?.prevPrice > 0 ? ((dailyChange / priceData.prevPrice) * 100) : 0);
        const quantity = h.quantity || 0;
        const avgFill = Number(h.avg_fill || 0);
        const isPending = !avgFill || avgFill === 0;
        const settlementStatus = deriveHoldingSettlementStatus(h);
        if (isPending) {
          return {
            ...h,
            market_value: 0,
            unrealized_pnl: 0,
            settlement_status: settlementStatus,
            symbol: sec?.symbol || "N/A",
            name: sec?.name || "Unknown",
            asset_class: sec?.sector || "Other",
            logo_url: sec?.logo_url || null,
            last_price: 0,
            change_price: 0,
            change_percent: 0,
            exchange: sec?.exchange || null,
          };
        }
        const costBasis = avgFill * quantity;
        const liveMarketValue = livePrice * quantity;
        const pnl = liveMarketValue - costBasis;
        const investedAmount = h.market_value || ((h.avg_fill || 0) * (h.quantity || 0));
        return {
          ...h,
          market_value: liveMarketValue,
          invested_amount: investedAmount,
          unrealized_pnl: pnl,
          settlement_status: settlementStatus,
          symbol: sec?.symbol || "N/A",
          name: sec?.name || "Unknown",
          asset_class: sec?.sector || "Other",
          logo_url: sec?.logo_url || null,
          last_price: livePrice,
          change_price: dailyChange,
          change_percent: Number(dailyChangePct.toFixed(2)),
          exchange: sec?.exchange || null,
        };
      });

    const closedHoldings = rawHoldings
      .filter(h => h.is_active === false && securitiesMap[h.security_id])
      .map(h => {
        const sec = securitiesMap[h.security_id];
        return {
          id: h.id,
          security_id: h.security_id,
          symbol: sec?.symbol || "N/A",
          name: sec?.name || "Unknown",
          logo_url: sec?.logo_url || null,
          avg_fill: h.avg_fill || 0,
          exit_price: h.exit_price || 0,
          quantity: h.quantity || 0,
          updated_at: h.updated_at,
        };
      });

    res.json({ success: true, holdings: enrichedHoldings, closedHoldings });
  } catch (error) {
    console.error("User holdings error:", error);
    res.status(500).json({ success: false, error: error.message || "Failed to fetch holdings" });
  }
});

app.get("/api/user/strategies", async (req, res) => {
  try {
    console.log("[user/strategies] Request received");
    console.log("[user/strategies] Supabase available:", !!supabase);
    console.log("[user/strategies] SupabaseAdmin available:", !!supabaseAdmin);

    if (!supabase) {
      console.log("[user/strategies] ERROR: Database not connected - supabase is null");
      return res.status(503).json({ success: false, error: "Database not available. Please check server configuration." });
    }

    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) {
      console.log("[user/strategies] Auth error:", authError);
      return res.status(401).json({ success: false, error: authError || "Unauthorized" });
    }

    console.log("[user/strategies] User authenticated:", user.id);

    const db = supabaseAdmin || supabase;
    const userId = user.id;

    // First, get user's strategy investments from transactions
    const { data: transactions, error: txError } = await db
      .from("transactions")
      .select("id, name, amount, direction, transaction_date")
      .eq("user_id", userId)
      .eq("direction", "debit");

    if (txError) {
      console.error("[user/strategies] Error fetching transactions:", txError);
      return res.status(500).json({ success: false, error: txError.message });
    }

    // Extract strategy names from transactions (for matching and first-date only)
    const strategyFirstDate = {};
    const strategyTxNames = new Set();
    for (const tx of (transactions || [])) {
      const txName = (tx.name || "").trim();
      let strategyName = null;
      if (txName.startsWith("Strategy Investment: ")) {
        strategyName = txName.replace("Strategy Investment: ", "").trim();
      } else if (txName.startsWith("Purchased ")) {
        strategyName = txName.replace("Purchased ", "").trim();
      }
      if (strategyName) {
        strategyTxNames.add(strategyName);
        if (tx.transaction_date) {
          if (!strategyFirstDate[strategyName] || tx.transaction_date < strategyFirstDate[strategyName]) {
            strategyFirstDate[strategyName] = tx.transaction_date;
          }
        }
      }
    }

    const strategyNames = Array.from(strategyTxNames);
    console.log("[user/strategies] Transactions found:", (transactions || []).length);
    console.log("[user/strategies] Strategy names from transactions:", strategyNames);

    // Also check stock_holdings_c for holdings with strategy_id (fallback when transactions are empty or RLS blocks them)
    const { data: userStratHoldings } = await db
      .from("stock_holdings_c")
      .select("id, security_id, strategy_id, quantity, avg_fill")
      .eq("user_id", userId)
      .not("strategy_id", "is", null);

    const holdingStrategyIds = [...new Set((userStratHoldings || []).map(h => h.strategy_id).filter(Boolean))];
    console.log("[user/strategies] Holdings with strategy_id found:", (userStratHoldings || []).length, "unique strategy IDs:", holdingStrategyIds);

    if (strategyNames.length === 0 && holdingStrategyIds.length === 0) {
      console.log("[user/strategies] No strategy names or holdings found — returning empty.");
      return res.status(200).json({ success: true, strategies: [] });
    }

    const stratHoldingsByStratId = {};
    for (const h of (userStratHoldings || [])) {
      if (!stratHoldingsByStratId[h.strategy_id]) stratHoldingsByStratId[h.strategy_id] = [];
      stratHoldingsByStratId[h.strategy_id].push(h);
    }

    // Fetch live prices for those securities
    const stratSecIds = (userStratHoldings || []).map(h => h.security_id).filter(Boolean);
    let stratLivePriceMap = {};
    const symbolPnlMap = {};
    if (stratSecIds.length > 0) {
      const { data: stratSecs } = await db
        .from("securities_c")
        .select("id, symbol, last_price")
        .in("id", stratSecIds);
      (stratSecs || []).forEach(s => { stratLivePriceMap[s.id] = (s.last_price || 0); }); // Keep as Rands as in DB

      // Build per-symbol P&L from actual user holdings (skip pending - no avg_fill)
      for (const h of (userStratHoldings || [])) {
        const sec = (stratSecs || []).find(s => s.id === h.security_id);
        if (!sec) continue;
        const qty = Number(h.quantity || 0);
        const avgFill = Number(h.avg_fill || 0);
        if (!avgFill) continue;
        const livePrice = (sec.last_price != null) ? (sec.last_price) : (avgFill / 100);
        symbolPnlMap[sec.symbol] = {
          pnlRands: (livePrice - (avgFill / 100)) * qty,
          pnlPct: avgFill > 0 ? ((livePrice - (avgFill / 100)) / (avgFill / 100)) * 100 : 0,
          currentValue: (livePrice * qty) * 100, // Send as cents
          costBasis: (avgFill * qty), // avgFill is already cents
        };
      }
    }

    // Get all active strategies
    const { data: allStrategies, error: stratErr } = await db
      .from("strategies_c")
      .select(`
        id, name, short_name, description, risk_level, sector, icon_url, image_url, holdings, status,
        strategy_metrics (
          *
        )
      `)
      .eq("status", "active");

    if (stratErr) {
      console.error("[user/strategies] Error fetching strategies:", stratErr);
      return res.status(500).json({ success: false, error: stratErr.message });
    }

    // Sort each strategy's metrics by date descending and keep only the latest row
    for (const strategy of (allStrategies || [])) {
      if (Array.isArray(strategy.strategy_metrics) && strategy.strategy_metrics.length > 1) {
        strategy.strategy_metrics.sort((a, b) =>
          (b.as_of_date || "").localeCompare(a.as_of_date || "")
        );
        strategy.strategy_metrics = [strategy.strategy_metrics[0]];
      }
    }

    // Get securities for logos
    const allHoldingSymbols = new Set();
    for (const strategy of (allStrategies || [])) {
      const h = strategy.holdings || [];
      if (Array.isArray(h)) {
        h.forEach(item => { if (item.symbol) allHoldingSymbols.add(item.symbol); });
      }
    }

    let securitiesMap = {};
    if (allHoldingSymbols.size > 0) {
      const { data: secs } = await db
        .from("securities_c")
        .select("symbol, logo_url, name, last_price, ytd_performance")
        .in("symbol", Array.from(allHoldingSymbols));
      if (secs) {
        secs.forEach(s => { 
          const normalized = { ...s };
          if (s.last_price != null) normalized.last_price = s.last_price * 100;
          securitiesMap[s.symbol] = normalized; 
        });
      }
    }

    // Dynamic import of Strategy utilities for YTD calculation
    let calculateYtdReturn = null;
    try {
      const utils = await import("../src/lib/strategyUtils.js");
      calculateYtdReturn = utils.calculateYtdReturn;
    } catch (e) {
      console.warn("[user/strategies] Failed to import calculateYtdReturn utility:", e.message);
    }

    // Match user's strategies (by transaction name OR by holdings strategy_id)
    const matchedStrategies = [];
    for (const strategy of (allStrategies || [])) {
      const matchKey = strategyNames.find(sn =>
        sn.toLowerCase() === (strategy.name || "").toLowerCase() ||
        sn.toLowerCase() === (strategy.short_name || "").toLowerCase()
      );
      const matchedByHoldings = holdingStrategyIds.includes(strategy.id);
      if (matchKey || matchedByHoldings) {
        const metrics = strategy.strategy_metrics;
        const latestMetric = Array.isArray(metrics) ? metrics[0] : metrics;
        const enrichedHoldings = (strategy.holdings || []).map(h => {
          const pnlData = symbolPnlMap[h.symbol] || null;
          return {
            ...h,
            logo_url: h.logo_url || securitiesMap[h.symbol]?.logo_url || null,
            name: h.name || securitiesMap[h.symbol]?.name || h.symbol,
            pnlRands: pnlData ? pnlData.pnlRands : null,
            pnlPct: pnlData ? pnlData.pnlPct : null,
            currentValue: pnlData ? pnlData.currentValue : null,
            costBasis: pnlData ? pnlData.costBasis : null,
          };
        });
        const stratHoldings = stratHoldingsByStratId[strategy.id] || [];
        let investedAmount = 0;
        let currentMarketValue = 0;
        const allPending = stratHoldings.length > 0 && stratHoldings.every(h => !h.avg_fill);
        if (stratHoldings.length === 0) {
          // No holdings allocated yet — compute invested amount from transactions
          for (const tx of (transactions || [])) {
            const txName = (tx.name || "").trim();
            let txStratName = null;
            if (txName.startsWith("Strategy Investment: ")) txStratName = txName.replace("Strategy Investment: ", "").trim();
            else if (txName.startsWith("Purchased ")) txStratName = txName.replace("Purchased ", "").trim();
            if (txStratName && (
              txStratName.toLowerCase() === (strategy.name || "").toLowerCase() ||
              txStratName.toLowerCase() === (strategy.short_name || "").toLowerCase()
            )) {
              investedAmount += Number(tx.amount || 0) / 100;
            }
          }
          currentMarketValue = investedAmount;
        } else if (!allPending) {
          for (const h of stratHoldings) {
            const qty = Number(h.quantity || 0);
            const avgFill = Number(h.avg_fill || 0);
            if (!avgFill) continue;
            const livePrice = stratLivePriceMap[h.security_id] || (avgFill / 100);
            const marketVal = (livePrice * qty); // In Rands
            console.log(`[user/strategies] Holding: ${h.security_id}, Price: ${livePrice}, Qty: ${qty}, Value: R${marketVal}`);
            investedAmount += (avgFill * qty) / 100;
            currentMarketValue += marketVal;
          }
        }

        // Calculate dynamic YTD if utility is available
        let rytd = latestMetric?.r_ytd_pct ?? latestMetric?.r_ytd ?? 0;
        if (calculateYtdReturn) {
          const matchedHoldingsMap = new Map();
          Object.entries(securitiesMap).forEach(([sym, sec]) => matchedHoldingsMap.set(sym, sec));
          const dynamicYtd = calculateYtdReturn(strategy, matchedHoldingsMap);
          if (dynamicYtd !== null) rytd = dynamicYtd;
        }

        console.log(`[user/strategies] Strategy: ${strategy.name}, Invested: R${investedAmount}, Market: R${currentMarketValue}, YTD: ${rytd}%`);
        matchedStrategies.push({
          id: strategy.id,
          name: strategy.name,
          shortName: strategy.short_name || strategy.name,
          description: strategy.description || "",
          riskLevel: strategy.risk_level || "Moderate",
          sector: strategy.sector || "",
          iconUrl: strategy.icon_url,
          imageUrl: strategy.image_url,
          holdings: enrichedHoldings,
          investedAmount: investedAmount, // Return as Rands
          currentMarketValue: currentMarketValue, // Return as Rands
          currentValue: currentMarketValue, // Return as Rands
          metrics: latestMetric ? { ...latestMetric, r_ytd: rytd } : { r_ytd: rytd },
          firstInvestedDate: strategyFirstDate[matchKey] || null,
        });
      }
    }

    console.log("[user/strategies] Found strategies for user:", matchedStrategies.length);
    return res.status(200).json({ success: true, strategies: matchedStrategies });
  } catch (error) {
    console.error("[user/strategies] Error:", error);
    return res.status(500).json({ success: false, error: error.message || "Failed to fetch user strategies" });
  }
});


app.get("/api/user/transactions", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ success: false, error: "Database not connected" });
    }

    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: authError || "Unauthorized" });
    }

    const db = supabaseAdmin || supabase;
    const userId = user.id;
    const limit = parseInt(req.query.limit) || 50;

    let transactions, txError;
    const txResult = await db
      .from("transactions")
      .select("id, user_id, direction, name, description, amount, store_reference, currency, status, settlement_status, transaction_date, created_at")
      .eq("user_id", userId)
      .order("transaction_date", { ascending: false })
      .limit(limit);

    if (txResult.error && txResult.error.message && txResult.error.message.includes("settlement_status")) {
      const fallback = await db
        .from("transactions")
        .select("id, user_id, direction, name, description, amount, store_reference, currency, status, transaction_date, created_at")
        .eq("user_id", userId)
        .order("transaction_date", { ascending: false })
        .limit(limit);
      transactions = fallback.data;
      txError = fallback.error;
    } else {
      transactions = txResult.data;
      txError = txResult.error;
    }

    if (txError) {
      console.error("Error fetching transactions:", txError);
      return res.status(500).json({ success: false, error: txError.message });
    }

    const txList = transactions || [];

    const extractedNames = new Map();
    for (const tx of txList) {
      const txName = (tx.name || "").trim();
      if (txName.startsWith("Strategy Investment: ")) {
        extractedNames.set(txName.replace("Strategy Investment: ", "").trim(), "strategy");
      } else if (txName.startsWith("Purchased ")) {
        extractedNames.set(txName.replace("Purchased ", "").trim(), "purchased");
      }
    }

    let strategyHoldingsMap = {};
    let securityLogoMap = {};

    if (extractedNames.size > 0) {
      const { data: allSecs } = await db
        .from("securities_c")
        .select("name, symbol, logo_url");
      if (allSecs) {
        for (const sec of allSecs) {
          if (sec.logo_url) {
            if (sec.name) securityLogoMap[sec.name.toLowerCase()] = sec.logo_url;
            if (sec.symbol) {
              securityLogoMap[sec.symbol.toLowerCase()] = sec.logo_url;
              const normalized = sec.symbol.split(".")[0].toUpperCase().toLowerCase();
              if (normalized !== sec.symbol.toLowerCase()) {
                securityLogoMap[normalized] = sec.logo_url;
              }
            }
          }
        }
      }

      const { data: strategies } = await db
        .from("strategies_c")
        .select("name, short_name, holdings")
        .eq("status", "active");

      if (strategies) {
        const findLogo = (sym) => {
          if (!sym) return null;
          const lower = sym.toLowerCase();
          const normalized = sym.split(".")[0].toLowerCase();
          return securityLogoMap[lower] || securityLogoMap[normalized] || securityLogoMap[lower + ".jo"] || securityLogoMap[normalized + ".jo"] || null;
        };
        for (const s of strategies) {
          const holdings = Array.isArray(s.holdings) ? s.holdings : [];
          const sorted = [...holdings].sort((a, b) => {
            return Number(b.weight || b.shares || b.quantity || 0) - Number(a.weight || a.shares || a.quantity || 0);
          });
          const top3 = [];
          for (const h of sorted) {
            if (top3.length >= 3) break;
            const sym = h.symbol || h.ticker || "";
            const logo = findLogo(sym);
            if (logo) {
              top3.push({ symbol: sym, logo_url: logo, name: h.name || sym });
            }
          }
          if (s.name) strategyHoldingsMap[s.name.toLowerCase()] = top3;
          if (s.short_name) strategyHoldingsMap[s.short_name.toLowerCase()] = top3;
        }
      }
    }

    const enrichedTx = txList.map(tx => {
      const txName = (tx.name || "").trim();
      let sName = null;
      if (txName.startsWith("Strategy Investment: ")) {
        sName = txName.replace("Strategy Investment: ", "").trim();
      } else if (txName.startsWith("Purchased ")) {
        sName = txName.replace("Purchased ", "").trim();
      }

      const settlement_status = deriveSettlementStatus(tx);

      if (sName) {
        const holdingLogos = strategyHoldingsMap[sName.toLowerCase()] || [];
        if (holdingLogos.length > 0) {
          return { ...tx, settlement_status, holding_logos: holdingLogos, logo_url: null };
        }
        const lower = sName.toLowerCase();
        const logo_url = securityLogoMap[lower] || securityLogoMap[lower.split(".")[0]] || null;
        return { ...tx, settlement_status, holding_logos: [], logo_url };
      }
      return { ...tx, settlement_status, holding_logos: [], logo_url: null };
    });

    res.json({ success: true, transactions: enrichedTx });
  } catch (error) {
    console.error("User transactions error:", error);
    res.status(500).json({ success: false, error: error.message || "Failed to fetch transactions" });
  }
});

app.get("/api/debug/user-investments", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ success: false, error: "Database not connected" });
    }

    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: authError || "Unauthorized" });
    }

    const db = supabaseAdmin || supabase;
    const userId = user.id;

    const [holdingsResult, transactionsResult] = await Promise.all([
      db.from("stock_holdings_c").select("*").eq("user_id", userId),
      db.from("transactions").select("id, direction, name, description, amount, store_reference, status, transaction_date").eq("user_id", userId).order("transaction_date", { ascending: false }).limit(20),
    ]);

    res.json({
      success: true,
      userId,
      stockHoldings: holdingsResult.data || [],
      recentTransactions: transactionsResult.data || [],
      summary: {
        stockHoldingsCount: (holdingsResult.data || []).length,
        transactionsCount: (transactionsResult.data || []).length,
      },
    });
  } catch (error) {
    console.error("Debug user investments error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

let lastCreditCheckDebug = null;

app.post("/api/credit-check", async (req, res) => {
  try {
    // Dynamic import for ESM service modules
    const { performCreditCheck } = await import("../services/creditCheckService.js");
    const {
      TOTAL_LOAN_ENGINE_WEIGHT,
      extractClientDeviceMetadata,
      computeCreditScoreContribution,
      computeAdverseListingsContribution,
      computeCreditUtilizationContribution,
      computeDeviceFingerprintContribution,
      computeDTIContribution,
      computeEmploymentTenureContribution,
      computeContractTypeContribution,
      computeEmploymentCategoryContribution,
      computeIncomeStabilityContribution,
      computeAlgolendRepaymentContribution,
      computeAglRetrievalContribution
    } = await import("../services/loanEngine.js");

    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body || '{}'); } catch { body = {}; }
    }

    const authHeader = req.headers.authorization || '';
    const accessToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : null;

    let userId = null;
    const db = supabaseAdmin || supabase;
    if (accessToken && db) {
      const { data: userData, error: userError } = await db.auth.getUser(accessToken);
      if (!userError && userData?.user?.id) {
        userId = userData.user.id;
      }
    }
    if (!userId) userId = 'anon-dev';

    let loanApplicationId = body.loanApplicationId || body.loan_application_id || null;
    const applicationId = body.applicationId || loanApplicationId || `app_${Date.now()}`;
    const overrides = body.userData || body;
    const normalizedOverrides = {
      ...overrides,
      identity_number: overrides?.identity_number || overrides?.id_number || overrides?.identityNumber,
      surname: overrides?.surname || overrides?.last_name || overrides?.lastName,
      forename: overrides?.forename || overrides?.first_name || overrides?.firstName,
      date_of_birth: overrides?.date_of_birth || overrides?.dateOfBirth,
      address1: overrides?.address1 || overrides?.address,
      postal_code: overrides?.postal_code || overrides?.postalCode || overrides?.postcode || overrides?.zip || overrides?.zip_code || '0152',
      contract_type: overrides?.contract_type || overrides?.contractType
    };

    const mockModeEnv = process.env.EXPERIAN_MOCK === 'true';
    const maskedIdentity = normalizedOverrides?.identity_number
      ? String(normalizedOverrides.identity_number).slice(0, 6).padEnd(String(normalizedOverrides.identity_number).length, '*')
      : null;
    console.log('[credit-check] incoming request', {
      applicationId,
      userId,
      mockModeEnv,
      hasPostalCode: Boolean(normalizedOverrides?.postal_code),
      postalCode: normalizedOverrides?.postal_code || null,
      hasAddress1: Boolean(normalizedOverrides?.address1),
      identity: maskedIdentity
    });

    if (normalizedOverrides?.annual_income && !normalizedOverrides?.gross_monthly_income) {
      const annualIncome = Number(normalizedOverrides.annual_income);
      if (Number.isFinite(annualIncome)) {
        normalizedOverrides.gross_monthly_income = annualIncome / 12;
      }
    }

    if (normalizedOverrides?.years_in_current_job && !normalizedOverrides?.months_in_current_job) {
      const yearsValue = Number(normalizedOverrides.years_in_current_job);
      if (Number.isFinite(yearsValue)) {
        normalizedOverrides.months_in_current_job = yearsValue * 12;
      }
    }

    // TruID snapshot lookup
    if (db && userId && userId !== 'anon-dev') {
      try {
        const { data: snapshotData } = await db
          .from('truid_bank_snapshots')
          .select('months_captured,main_salary')
          .eq('user_id', userId)
          .order('captured_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (snapshotData) {
          normalizedOverrides.truid_months_captured = snapshotData.months_captured;
          normalizedOverrides.truid_main_salary = snapshotData.main_salary;
        }
      } catch (err) {
        console.warn('TruID snapshot lookup failed:', err?.message);
      }
    }

    // ── PRIMARY ENRICHMENT: Sumsub pack_details (KYC-verified address/identity) ──
    if (db && userId && userId !== 'anon-dev') {
      try {
        const { data: packRow } = await db
          .from('user_onboarding_pack_details')
          .select('pack_details')
          .eq('user_id', userId)
          .maybeSingle();

        console.log('[credit-check] pack_details row found:', !!packRow);

        const pack = packRow?.pack_details || {};
        const info = pack?.info || {};
        const addresses = Array.isArray(info?.addresses) ? info.addresses : [];
        const idDocs = Array.isArray(info?.idDocs) ? info.idDocs : [];

        const firstAddress = addresses.find(a => a && (a.postCode || a.street || a.town)) || null;
        const addressDoc = idDocs.find(d => d?.address?.postCode || d?.rawAddress || d?.address?.street) || null;
        const idCardDoc = idDocs.find(d => d?.number) || null;

        const packPostalCode = firstAddress?.postCode || addressDoc?.address?.postCode || null;
        const packStreet = firstAddress?.street || addressDoc?.address?.street || null;
        const packTown = firstAddress?.town || addressDoc?.address?.town || null;
        const packFormatted = firstAddress?.formattedAddress || addressDoc?.address?.formattedAddress || addressDoc?.rawAddress || null;
        const packDob = info?.dob || idCardDoc?.dob || null;
        const packIdentity = idCardDoc?.number || null;
        const packFirstName = info?.firstNameEn || info?.firstName || idCardDoc?.firstNameEn || idCardDoc?.firstName || null;
        const packLastName = info?.lastNameEn || info?.lastName || idCardDoc?.lastNameEn || idCardDoc?.lastName || null;
        const packPhone = pack?.phone || null;

        console.log('[credit-check] pack_details extracted:', {
          packPostalCode,
          packStreet: packStreet ? packStreet.substring(0, 30) : null,
          packTown,
          packIdentity: packIdentity ? packIdentity.slice(0, 6) + '***' : null,
          packFirstName,
          packLastName,
          packDob,
          addressesCount: addresses.length,
          idDocsCount: idDocs.length
        });

        const deriveGenderFromSaId = (idValue) => {
          const raw = String(idValue || '').replace(/\D/g, '');
          if (raw.length !== 13) return null;
          const genderDigits = Number(raw.slice(6, 10));
          if (!Number.isFinite(genderDigits)) return null;
          return genderDigits >= 5000 ? 'M' : 'F';
        };
        const inferredGender = deriveGenderFromSaId(packIdentity || normalizedOverrides.identity_number);

        if (!normalizedOverrides.identity_number && packIdentity) normalizedOverrides.identity_number = packIdentity;
        if (!normalizedOverrides.forename && packFirstName) normalizedOverrides.forename = packFirstName;
        if (!normalizedOverrides.surname && packLastName) normalizedOverrides.surname = packLastName;
        if (!normalizedOverrides.date_of_birth && packDob) normalizedOverrides.date_of_birth = packDob;
        if (!normalizedOverrides.gender && inferredGender) normalizedOverrides.gender = inferredGender;
        if (!normalizedOverrides.address1 && packStreet) normalizedOverrides.address1 = packStreet;
        if (!normalizedOverrides.address2 && packTown) normalizedOverrides.address2 = packTown;
        if (!normalizedOverrides.address4 && packTown) normalizedOverrides.address4 = packTown;
        if (!normalizedOverrides.postal_code && packPostalCode) normalizedOverrides.postal_code = String(packPostalCode);
        if (!normalizedOverrides.cell_tel_no && packPhone) normalizedOverrides.cell_tel_no = packPhone;

        if (!normalizedOverrides.address1 && packFormatted) {
          normalizedOverrides.address1 = packFormatted;
        }

        console.log('[credit-check] after pack_details enrichment, postal_code =', normalizedOverrides.postal_code || '[STILL EMPTY]');
      } catch (err) {
        console.warn('Pack details lookup failed:', err?.message);
      }
    }

    // Profile enrichment — secondary source, fill only still-missing fields
    if (db && userId && userId !== 'anon-dev') {
      try {
        const { data: profile } = await db
          .from('profiles')
          .select('id_number,first_name,last_name,date_of_birth,gender,phone_number,address')
          .eq('id', userId)
          .maybeSingle();

        if (profile) {
          if (!normalizedOverrides.identity_number && profile.id_number) normalizedOverrides.identity_number = profile.id_number;
          if (!normalizedOverrides.surname && profile.last_name) normalizedOverrides.surname = profile.last_name;
          if (!normalizedOverrides.forename && profile.first_name) normalizedOverrides.forename = profile.first_name;
          if (!normalizedOverrides.date_of_birth && profile.date_of_birth) normalizedOverrides.date_of_birth = profile.date_of_birth;
          if (!normalizedOverrides.gender && profile.gender) normalizedOverrides.gender = profile.gender;
          if (!normalizedOverrides.cell_tel_no && profile.phone_number) normalizedOverrides.cell_tel_no = profile.phone_number;
          if (!normalizedOverrides.address1 && profile.address) normalizedOverrides.address1 = profile.address;
        }
      } catch (err) {
        console.warn('Profile lookup failed:', err?.message);
      }
    }

    // Onboarding enrichment
    if (db && userId && userId !== 'anon-dev') {
      try {
        const { data: onboarding } = await db
          .from('user_onboarding')
          .select('employer_name,employment_type,employer_industry')
          .eq('user_id', userId)
          .maybeSingle();

        if (onboarding) {
          if (!normalizedOverrides.employment_employer_name && onboarding.employer_name) normalizedOverrides.employment_employer_name = onboarding.employer_name;
          if (!normalizedOverrides.contract_type && onboarding.employment_type) normalizedOverrides.contract_type = onboarding.employment_type;
          if (!normalizedOverrides.employment_sector_type && onboarding.employer_industry) normalizedOverrides.employment_sector_type = onboarding.employer_industry;
        }
      } catch (err) {
        console.warn('Onboarding lookup failed:', err?.message);
      }
    }

    function normalizeDob(dob) { return dob ? String(dob).replace(/-/g, '') : dob; }

    const userPayload = {
      reference: 'mintcheck',
      identity_number: '', passport_number: '', surname: '', forename: '', middle_name: '',
      gender: '', date_of_birth: '', address1: '', address2: '', address3: '', address4: '',
      postal_code: '', cell_tel_no: '', work_tel_no: '', home_tel_no: '', email: '',
      user_id: '', client_ref: `MINT-${Date.now()}`,
      ...normalizedOverrides
    };
    userPayload.postal_code = String(userPayload.postal_code || '0152').trim() || '0152';
    userPayload.client_ref = String(userPayload.client_ref || `MINT${Date.now()}`).trim().slice(0, 20);
    if (userPayload.date_of_birth) userPayload.date_of_birth = normalizeDob(userPayload.date_of_birth);
    userPayload.user_id = overrides?.user_id || userId;

    // Lookup loan application
    if (!loanApplicationId && db && userId && userId !== 'anon-dev') {
      try {
        const { data: loanApp } = await db
          .from('loan_application')
          .select('id')
          .eq('user_id', userId)
          .eq('status', 'in_progress')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (loanApp?.id) loanApplicationId = loanApp.id;
      } catch (err) {
        console.warn('Loan application lookup failed:', err?.message);
      }
    }

    if (!userPayload.identity_number || !userPayload.surname || !userPayload.forename) {
      return res.status(400).json({ error: 'Missing required identity fields', required: ['identity_number', 'surname', 'forename'] });
    }

    // Log the fully-enriched payload that will be sent to Experian
    console.log('[credit-check] final enriched userPayload before Experian call:', {
      hasIdentity: Boolean(userPayload.identity_number),
      identity: userPayload.identity_number ? String(userPayload.identity_number).slice(0, 6) + '...' : null,
      hasSurname: Boolean(userPayload.surname),
      hasForename: Boolean(userPayload.forename),
      gender: userPayload.gender || null,
      dob: userPayload.date_of_birth || null,
      hasAddress1: Boolean(userPayload.address1),
      address2: userPayload.address2 || null,
      postal_code: userPayload.postal_code || null,
      cell_tel_no: userPayload.cell_tel_no || null,
      mockModeEnv: process.env.EXPERIAN_MOCK === 'true'
    });

    const result = await performCreditCheck(userPayload, applicationId, accessToken);
    const zipDataLength = typeof result?.zipData === 'string' ? result.zipData.length : 0;
    const retdataPreview = zipDataLength > 0 ? String(result.zipData).slice(0, 120) : null;
    console.log('[credit-check] experian response summary', {
      applicationId,
      success: result?.success === true,
      mockModeReturned: result?.mockMode,
      zipDataLength,
      message: result?.message || null,
      error: result?.error || null
    });
    if (retdataPreview) {
      console.log('[credit-check] retdata preview:', retdataPreview);
    }

    lastCreditCheckDebug = {
      checkedAt: new Date().toISOString(),
      applicationId,
      userId,
      mockModeEnv,
      mockModeReturned: result?.mockMode,
      success: result?.success === true,
      hasPostalCode: Boolean(userPayload?.postal_code),
      postalCode: userPayload?.postal_code || null,
      address1: userPayload?.address1 || null,
      gender: userPayload?.gender || null,
      enrichmentOrder: 'form → pack_details → profile → onboarding',
      experianEndpoint: process.env.EXPERIAN_URL || 'https://apis.experian.co.za/NormalSearchService',
      zipDataLength,
      retdataPreview,
      error: result?.error || null
    };

    const creditScoreData = (result && typeof result.creditScore === 'object' && result.creditScore)
      ? result.creditScore : (result?.creditScoreData || {});

    function normalizeCreditScore(r) {
      const candidates = [
        r?.extracted?.extractedCreditScore,
        typeof r?.creditScore === 'number' ? r.creditScore : r?.creditScore?.score,
        typeof r?.creditScoreData === 'number' ? r.creditScoreData : r?.creditScoreData?.score,
        r?.creditScoreData?.creditScore
      ];
      for (const c of candidates) {
        const s = Number(c);
        if (Number.isFinite(s) && s > 0) return s;
      }
      return 0;
    }

    const creditScoreValue = normalizeCreditScore({ ...result, creditScoreData, creditScore: creditScoreData });

    const accountExposure = creditScoreData?.accounts?.exposure || {};
    const accountSummary = creditScoreData?.accountSummary || {};
    const accountMetrics = { ...accountExposure, ...accountSummary, totalMonthlyInstallment: accountExposure.totalMonthlyInstallments ?? accountSummary.totalMonthlyInstallments ?? 0 };
    const employmentHistory = creditScoreData?.employmentHistory || result?.employmentHistory || [];
    const deviceFingerprint = extractClientDeviceMetadata(req);

    const creditScoreBreakdown = computeCreditScoreContribution(creditScoreValue);
    const adverseListingsBreakdown = computeAdverseListingsContribution(creditScoreData);
    const creditUtilizationBreakdown = computeCreditUtilizationContribution(accountMetrics);
    const deviceFingerprintBreakdown = computeDeviceFingerprintContribution(deviceFingerprint);
    const dtiBreakdown = computeDTIContribution(accountMetrics.totalMonthlyInstallment || 0, Number(userPayload.gross_monthly_income || 0));
    const employmentTenureBreakdown = computeEmploymentTenureContribution(userPayload.months_in_current_job);
    const contractTypeBreakdown = computeContractTypeContribution(userPayload.contract_type);
    const employmentCategoryBreakdown = computeEmploymentCategoryContribution(userPayload);
    const incomeStabilityBreakdown = computeIncomeStabilityContribution(userPayload);
    const algolendRepaymentBreakdown = computeAlgolendRepaymentContribution(userPayload.algolend_is_new_borrower);
    const aglRetrievalBreakdown = computeAglRetrievalContribution();

    const breakdown = {
      creditScore: creditScoreBreakdown, creditUtilization: creditUtilizationBreakdown,
      adverseListings: adverseListingsBreakdown, deviceFingerprint: deviceFingerprintBreakdown,
      dti: dtiBreakdown, employmentTenure: employmentTenureBreakdown,
      contractType: contractTypeBreakdown, employmentCategory: employmentCategoryBreakdown,
      incomeStability: incomeStabilityBreakdown, algolendRepayment: algolendRepaymentBreakdown,
      aglRetrieval: aglRetrievalBreakdown
    };

    const experianSnapshot = {
      score: Number.isFinite(creditScoreValue) ? creditScoreValue : null,
      riskType: creditScoreData?.riskType || null,
      enquiryId: creditScoreData?.enquiryId || null,
      clientRef: creditScoreData?.clientRef || null,
      declineReasons: Array.isArray(creditScoreData?.declineReasons) ? creditScoreData.declineReasons : [],
      activities: creditScoreData?.activities || {},
      accountSummary: creditScoreData?.accountSummary || {},
      retdataLength: zipDataLength,
      xmlPreview: typeof result?.xmlContent === 'string' ? result.xmlContent.slice(0, 20000) : null,
      extractedAt: new Date().toISOString()
    };
    const engineResultPayload = {
      ...breakdown,
      experianReport: experianSnapshot
    };

    const loanEngineScore = Object.values(breakdown).map(i => i?.contributionPercent).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
    const loanEngineScoreMax = TOTAL_LOAN_ENGINE_WEIGHT;
    const loanEngineScoreNormalized = loanEngineScoreMax > 0 ? Math.min(100, (loanEngineScore / loanEngineScoreMax) * 100) : 0;

    const creditExposure = {
      totalBalance: accountMetrics.totalBalance || 0, totalLimits: accountMetrics.totalLimits || 0,
      revolvingBalance: accountMetrics.revolvingBalance || 0, revolvingLimits: accountMetrics.revolvingLimits || 0,
      totalMonthlyInstallment: accountMetrics.totalMonthlyInstallment || 0
    };

    const scoreReasons = [];
    if (creditScoreValue < 580) scoreReasons.push('Low credit score');
    if (creditUtilizationBreakdown.ratioPercent !== null && creditUtilizationBreakdown.ratioPercent > 75) scoreReasons.push('High credit utilization');
    if ((adverseListingsBreakdown.totalAdverse || 0) > 0) scoreReasons.push('Adverse listings present');
    if (dtiBreakdown.dtiPercent !== null && dtiBreakdown.dtiPercent > 50) scoreReasons.push('High debt-to-income ratio');
    if ((employmentTenureBreakdown.monthsInCurrentJob || 0) < 6) scoreReasons.push('Short employment tenure');

    // Persist to Supabase
    if (db && userId && userId !== 'anon-dev') {
      try {
        const loanEngineInsert = {
          user_id: userId, loan_application_id: loanApplicationId,
          engine_score: Number.isFinite(loanEngineScoreNormalized) ? Math.round(loanEngineScoreNormalized) : null,
          score_band: creditScoreData?.riskType || 'UNKNOWN',
          experian_score: Number.isFinite(creditScoreValue) ? creditScoreValue : null,
          experian_weight: creditScoreBreakdown?.weightPercent ?? null,
          engine_total_contribution: Number.isFinite(loanEngineScore) ? loanEngineScore : null,
          annual_income: Number.isFinite(Number(normalizedOverrides?.annual_income)) ? Number(normalizedOverrides.annual_income) : null,
          annual_expenses: Number.isFinite(Number(normalizedOverrides?.annual_expenses)) ? Number(normalizedOverrides.annual_expenses) : null,
          years_current_employer: Number.isFinite(Number(normalizedOverrides?.years_in_current_job)) ? Number(normalizedOverrides.years_in_current_job) : null,
          contract_type: normalizedOverrides?.contract_type || null,
          is_new_borrower: Boolean(normalizedOverrides?.algolend_is_new_borrower),
          employment_sector: normalizedOverrides?.employment_sector_type || null,
          employer_name: normalizedOverrides?.employment_employer_name || null,
          score_reasons: scoreReasons,
          engine_result: engineResultPayload,
          created_at: new Date().toISOString()
        };
        const { error: insertError } = await db.from('loan_engine_score').insert(loanEngineInsert);
        if (insertError) console.warn('Loan engine score insert failed:', insertError.message);
      } catch (dbError) {
        console.warn('Loan engine score insert exception:', dbError?.message);
      }
    }

    res.json({
      success: result?.success === true, ok: result?.success === true,
      applicationId, userId, creditScore: creditScoreValue,
      recommendation: result?.recommendation, riskFlags: result?.riskFlags,
      breakdown: engineResultPayload, loanEngineScore, loanEngineScoreMax, loanEngineScoreNormalized,
      creditExposure, scoreReasons, employmentHistory,
      cpaAccounts: result?.cpaAccounts || [], deviceFingerprint, raw: result,
      debug: {
        source: 'server/index',
        mockModeEnv,
        mockModeReturned: result?.mockMode,
        experianEndpoint: process.env.EXPERIAN_URL || 'https://apis.experian.co.za/NormalSearchService',
        hasPostalCode: Boolean(userPayload?.postal_code),
        postalCode: userPayload?.postal_code || null,
        hasAddress1: Boolean(userPayload?.address1),
        gender: userPayload?.gender || null,
        dob: userPayload?.date_of_birth || null,
        zipDataLength,
        retdataPreview,
        lastCreditCheck: lastCreditCheckDebug
      }
    });
  } catch (error) {
    console.error("Credit check error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/mock-mode", (req, res) => {
  const mockMode = process.env.EXPERIAN_MOCK === 'true';
  res.json({ mock: mockMode, mockMode });
});

app.get("/api/credit-check-debug", (req, res) => {
  res.json({
    mockMode: process.env.EXPERIAN_MOCK === 'true',
    endpoint: process.env.EXPERIAN_URL || 'https://apis.experian.co.za/NormalSearchService',
    lastCreditCheck: lastCreditCheckDebug
  });
});

app.post("/api/sessions/record", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    const token = authHeader.split(" ")[1];
    const db = supabaseAdmin || supabase;
    if (!db) {
      return res.status(500).json({ success: false, error: "Database not available" });
    }
    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: "Invalid token" });
    }
    if (!pgPool) {
      return res.status(500).json({ success: false, error: "Direct database not available" });
    }
    const { userAgent, browser, os, deviceType, sessionFingerprint } = req.body;
    const fingerprint = sessionFingerprint || user.id + "_" + Date.now();
    const client = await pgPool.connect();
    try {
      await client.query("DELETE FROM user_sessions WHERE user_id = $1 AND session_token = $2", [user.id, fingerprint]);
      const result = await client.query(
        `INSERT INTO user_sessions (user_id, session_token, user_agent, browser, os, device_type, ip_address, is_current, created_at, last_active_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, NOW(), NOW()) RETURNING id`,
        [user.id, fingerprint, userAgent || "", browser || "", os || "", deviceType || "desktop", req.headers["x-forwarded-for"] || req.socket.remoteAddress || ""]
      );
      res.json({ success: true, sessionId: result.rows[0]?.id });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Session record error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/sessions/list", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    const token = authHeader.split(" ")[1];
    const db = supabaseAdmin || supabase;
    if (!db) {
      return res.status(500).json({ success: false, error: "Database not available" });
    }
    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: "Invalid token" });
    }
    if (!pgPool) {
      return res.status(500).json({ success: false, error: "Direct database not available" });
    }
    const currentFingerprint = req.query.fingerprint || "";
    const client = await pgPool.connect();
    try {
      const result = await client.query(
        `SELECT id, user_id, browser, os, device_type, ip_address, created_at, last_active_at,
          CASE WHEN $2 != '' AND session_token = $2 THEN true ELSE false END AS is_current
         FROM user_sessions WHERE user_id = $1 ORDER BY last_active_at DESC`,
        [user.id, currentFingerprint]
      );
      res.json({ success: true, sessions: result.rows });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Session list error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/sessions/revoke", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    const token = authHeader.split(" ")[1];
    const db = supabaseAdmin || supabase;
    if (!db) {
      return res.status(500).json({ success: false, error: "Database not available" });
    }
    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: "Invalid token" });
    }
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ success: false, error: "sessionId required" });
    }
    if (!pgPool) {
      return res.status(500).json({ success: false, error: "Direct database not available" });
    }
    const client = await pgPool.connect();
    try {
      await client.query("DELETE FROM user_sessions WHERE id = $1 AND user_id = $2", [sessionId, user.id]);
      res.json({ success: true });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Session revoke error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/sessions/revoke-others", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    const token = authHeader.split(" ")[1];
    const db = supabaseAdmin || supabase;
    if (!db) {
      return res.status(500).json({ success: false, error: "Database not available" });
    }
    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: "Invalid token" });
    }
    const { currentSessionId } = req.body;
    if (!currentSessionId) {
      return res.status(400).json({ success: false, error: "currentSessionId required" });
    }
    if (!pgPool) {
      return res.status(500).json({ success: false, error: "Direct database not available" });
    }
    const client = await pgPool.connect();
    try {
      await client.query("DELETE FROM user_sessions WHERE user_id = $1 AND id != $2", [user.id, currentSessionId]);
      res.json({ success: true });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Session revoke-others error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/sessions/validate", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    const token = authHeader.split(" ")[1];
    const db = supabaseAdmin || supabase;
    if (!db) {
      return res.status(500).json({ success: false, error: "Database not available" });
    }
    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: "Invalid token" });
    }
    const fingerprint = req.query.fingerprint || "";
    if (!fingerprint) {
      return res.json({ success: true, valid: true });
    }
    if (!pgPool) {
      return res.json({ success: true, valid: true });
    }
    const client = await pgPool.connect();
    try {
      const result = await client.query(
        "SELECT id FROM user_sessions WHERE user_id = $1 AND session_token = $2 LIMIT 1",
        [user.id, fingerprint]
      );
      res.json({ success: true, valid: result.rows.length > 0 });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Session validate error:", error);
    res.json({ success: true, valid: true });
  }
});

app.post("/api/migrate/goal-columns", async (req, res) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.json({ error: "Missing Supabase credentials" });
    }
    const db = supabaseAdmin || supabase;
    if (!db) return res.json({ error: "no db" });

    const testResult = await db
      .from("investment_goals")
      .select("linked_strategy_id")
      .limit(1);

    if (testResult.error) {
      const sql = `
ALTER TABLE investment_goals ADD COLUMN IF NOT EXISTS linked_strategy_id text;
ALTER TABLE investment_goals ADD COLUMN IF NOT EXISTS linked_security_id text;
ALTER TABLE investment_goals ADD COLUMN IF NOT EXISTS invested_amount numeric DEFAULT 0;
ALTER TABLE investment_goals ADD COLUMN IF NOT EXISTS linked_asset_name text;
ALTER TABLE investment_goals ADD COLUMN IF NOT EXISTS target_date date;`;

      const response = await globalThis.fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ sql_query: sql }),
      });

      res.json({
        status: "columns_missing",
        column_test_error: testResult.error.message,
        sql_to_run: sql.trim(),
      });
    } else {
      res.json({ status: "columns_exist" });
    }
  } catch (e) {
    console.error("[migrate/goal-columns] Error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/migrate/onboarding-columns", async (req, res) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.json({ error: "Missing Supabase credentials" });
    }

    const db = supabaseAdmin || supabase;
    if (!db) return res.json({ error: "no db" });

    const testResult = await db
      .from("user_onboarding")
      .select("risk_disclosure_agreed")
      .limit(1);

    if (testResult.error) {
      const sql = `
ALTER TABLE user_onboarding ADD COLUMN IF NOT EXISTS risk_disclosure_agreed boolean DEFAULT false;
ALTER TABLE user_onboarding ADD COLUMN IF NOT EXISTS source_of_funds text;
ALTER TABLE user_onboarding ADD COLUMN IF NOT EXISTS source_of_funds_other text;
ALTER TABLE user_onboarding ADD COLUMN IF NOT EXISTS expected_monthly_investment text;
ALTER TABLE user_onboarding ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE user_onboarding ADD COLUMN IF NOT EXISTS bank_account_number text;
ALTER TABLE user_onboarding ADD COLUMN IF NOT EXISTS bank_branch_code text;`;

      // Try via Supabase SQL API  
      const response = await globalThis.fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ sql_query: sql }),
      });

      res.json({
        status: "columns_missing",
        column_test_error: testResult.error.message,
        sql_to_run: sql.trim(),
      });
    } else {
      res.json({ status: "columns_exist", data: testResult.data });
    }
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.get("/api/debug/onboarding/:userId", async (req, res) => {
  try {
    const db = supabaseAdmin || supabase;
    if (!db) return res.json({ error: "no db" });
    const { data: onboarding, error: e1 } = await db
      .from("user_onboarding")
      .select("*")
      .eq("user_id", req.params.userId)
      .order("created_at", { ascending: false })
      .limit(5);
    const { data: actions, error: e2 } = await db
      .from("required_actions")
      .select("*")
      .eq("user_id", req.params.userId)
      .limit(1);
    res.json({ onboarding, actions, errors: { onboarding: e1?.message, actions: e2?.message } });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// ============================================================
// Sumsub Sync - backfill missed applicants into user_onboarding
// ============================================================

app.post("/api/sumsub/sync", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");
    const db = supabaseAdmin || supabase;

    if (!db) return res.status(500).json({ error: "No database client" });

    let isAdmin = false;
    if (token) {
      try {
        const { data: { user } } = await db.auth.getUser(token);
        if (user) isAdmin = true;
      } catch (e) { }
    }

    const internalCall = req.headers["x-internal-key"] === SUMSUB_SECRET_KEY;
    if (!isAdmin && !internalCall) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!SUMSUB_APP_TOKEN || !SUMSUB_SECRET_KEY) {
      return res.status(500).json({ error: "Sumsub credentials not configured" });
    }

    const { data: { users } } = await db.auth.admin.listUsers();
    if (!users || users.length === 0) return res.json({ synced: 0, message: "No users found" });

    const { data: onboarded } = await db.from("user_onboarding").select("user_id");
    const onboardedIds = new Set((onboarded || []).map(o => o.user_id));

    const confirmedUsers = users.filter(u => u.email_confirmed_at && !onboardedIds.has(u.id));
    console.log(`[Sync] Checking ${confirmedUsers.length} users without onboarding records against Sumsub...`);

    let synced = 0;
    const results = [];

    for (const u of confirmedUsers) {
      try {
        const ts = Math.floor(Date.now() / 1000).toString();
        const path = `/resources/applicants/-;externalUserId=${u.id}/one`;
        const sig = createSumsubSignature(ts, "GET", path);

        const response = await fetch(`${SUMSUB_BASE_URL.startsWith("http") ? SUMSUB_BASE_URL : "https://" + SUMSUB_BASE_URL}${path}`, {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "X-App-Token": SUMSUB_APP_TOKEN,
            "X-App-Access-Ts": ts,
            "X-App-Access-Sig": sig,
          },
        });

        if (!response.ok) continue;

        const applicant = await response.json();
        if (!applicant || !applicant.id) continue;

        const review = applicant.review || {};
        const reviewAnswer = review.reviewResult?.reviewAnswer || null;
        const reviewStatus = review.reviewStatus || "init";

        let kycStatus = "pending";
        if (reviewStatus === "completed" && reviewAnswer === "GREEN") kycStatus = "verified";
        else if (reviewStatus === "completed" && reviewAnswer === "RED") kycStatus = "rejected";
        else if (reviewStatus === "onHold") kycStatus = "on_hold";

        const record = {
          user_id: u.id,
          employment_status: "not_provided",
          sumsub_external_user_id: u.id,
          sumsub_applicant_id: applicant.id,
          sumsub_review_status: reviewStatus,
          sumsub_review_answer: reviewAnswer,
          kyc_status: kycStatus,
          kyc_checked_at: new Date().toISOString(),
          annual_income_currency: "USD",
        };
        if (kycStatus === "verified") record.kyc_verified_at = new Date().toISOString();

        const { error: insErr } = await db.from("user_onboarding").insert(record);
        if (insErr) {
          console.error(`[Sync] Failed for ${u.email}:`, insErr.message);
          results.push({ userId: u.id, status: "error" });
        } else {
          synced++;
          results.push({ userId: u.id, status: "synced", kycStatus });
          console.log(`[Sync] Created onboarding for ${u.email} -> ${kycStatus}`);
        }
      } catch (fetchErr) {
        continue;
      }
    }

    console.log(`[Sync] Complete: ${synced} new records created`);
    res.json({ synced, total_checked: confirmedUsers.length, results });
  } catch (error) {
    console.error("[Sync] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// Onboarding Endpoints (server-side for RLS bypass)
// ============================================================

function hasMatchingPackIdNumber(value, idNumber) {
  if (value == null) return false;

  if (Array.isArray(value)) {
    return value.some((item) => hasMatchingPackIdNumber(item, idNumber));
  }

  if (typeof value === "object") {
    for (const [key, nestedValue] of Object.entries(value)) {
      if (key === "number" && String(nestedValue) === idNumber) {
        return true;
      }
      if (hasMatchingPackIdNumber(nestedValue, idNumber)) {
        return true;
      }
    }
  }

  return false;
}

function maskEmailAddress(email) {
  const normalized = String(email || "").trim();
  const atIndex = normalized.indexOf("@");
  if (!normalized || atIndex <= 0) return "";

  const localPart = normalized.slice(0, atIndex);
  const domainPart = normalized.slice(atIndex);
  const visiblePrefix = localPart.slice(0, 4);
  const maskedCount = Math.max(localPart.length - visiblePrefix.length, 5);
  return `${visiblePrefix}${"*".repeat(maskedCount)}${domainPart}`;
}

app.post("/api/onboarding/check-id-number", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, error: "Missing token" });

    const authClient = supabaseAdmin || supabase;
    const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ success: false, error: "Invalid session" });

    const idNumber = String(req.body?.id_number || "").replace(/\D/g, "");
    if (!/^\d{13}$/.test(idNumber)) {
      return res.status(400).json({ success: false, error: "A valid 13-digit id_number is required" });
    }

    let exists = false;
    let matchedUserId = null;
    let matchedEmail = null;

    if (pgPool) {
      const client = await pgPool.connect();
      try {
        const query = `
          SELECT user_id
          FROM user_onboarding_pack_details
          WHERE jsonb_path_exists(
            pack_details,
            '$.**.number ? (@ == $id)',
            jsonb_build_object('id', to_jsonb($1::text))
          )
          LIMIT 1
        `;
        const result = await client.query(query, [idNumber]);
        exists = result.rows.length > 0;
        if (exists) {
          matchedUserId = result.rows[0].user_id || null;
        }
      } finally {
        client.release();
      }
    }

    if (!exists) {
      const db = getAuthenticatedDb(token);
      const { data: rows, error } = await db
        .from("user_onboarding_pack_details")
        .select("user_id, pack_details");

      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }

      const matchedRow = (rows || []).find((row) => hasMatchingPackIdNumber(row?.pack_details, idNumber));
      exists = Boolean(matchedRow);
      if (matchedRow?.user_id) {
        matchedUserId = matchedRow.user_id;
      }
    }

    if (exists && matchedUserId) {
      const db = supabaseAdmin || getAuthenticatedDb(token);
      if (db) {
        const { data: profile } = await db
          .from("profiles")
          .select("email")
          .eq("id", matchedUserId)
          .maybeSingle();
        matchedEmail = profile?.email || null;
      }
    }

    return res.json({ success: true, exists, masked_email: maskEmailAddress(matchedEmail) || null });
  } catch (error) {
    console.error("[Onboarding] ID precheck error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/onboarding/save-employment", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, error: "Missing token" });

    const db = getAuthenticatedDb(token);
    const authClient = supabaseAdmin || supabase;
    const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ success: false, error: "Invalid session" });

    const {
      existing_onboarding_id,
      employment_status,
      employer_name,
      employer_industry,
      employment_type,
      institution_name,
      course_name,
      graduation_date,
      annual_income_amount,
      annual_income_currency,
    } = req.body || {};

    const payload = {
      user_id: user.id,
      employment_status: employment_status || "not_provided",
    };

    if (employer_name !== undefined) payload.employer_name = employer_name || null;
    if (employer_industry !== undefined) payload.employer_industry = employer_industry || null;
    if (employment_type !== undefined) payload.employment_type = employment_type || null;
    if (institution_name !== undefined) payload.institution_name = institution_name || null;
    if (course_name !== undefined) payload.course_name = course_name || null;
    if (graduation_date !== undefined) payload.graduation_date = graduation_date || null;
    if (annual_income_amount !== undefined) payload.annual_income_amount = annual_income_amount || null;
    if (annual_income_currency !== undefined) payload.annual_income_currency = annual_income_currency || "ZAR";

    let savedId = existing_onboarding_id;

    if (existing_onboarding_id) {
      const { data: updated, error } = await db
        .from("user_onboarding")
        .update(payload)
        .eq("id", existing_onboarding_id)
        .eq("user_id", user.id)
        .select("id");
      if (error) {
        console.error("[Onboarding] Update employment error:", error.message);
        return res.status(500).json({ success: false, error: error.message });
      }
      if (!updated || updated.length === 0) {
        return res.status(404).json({ success: false, error: "Onboarding record not found" });
      }
      savedId = updated[0].id;
    } else {
      const { data: existingRecord } = await db
        .from("user_onboarding")
        .select("id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingRecord) {
        const { error } = await db
          .from("user_onboarding")
          .update(payload)
          .eq("id", existingRecord.id)
          .eq("user_id", user.id);
        if (error) {
          console.error("[Onboarding] Update existing employment error:", error.message);
          return res.status(500).json({ success: false, error: error.message });
        }
        savedId = existingRecord.id;
      } else {
        const { data, error } = await db
          .from("user_onboarding")
          .insert(payload)
          .select("id")
          .maybeSingle();
        if (error) {
          console.error("[Onboarding] Insert employment error:", error.message);
          return res.status(500).json({ success: false, error: error.message });
        }
        savedId = data?.id;
      }
    }

    console.log(`[Onboarding] Employment saved for user ${user.id}, onboarding_id: ${savedId}`);
    res.json({ success: true, onboarding_id: savedId });
  } catch (error) {
    console.error("[Onboarding] Employment save error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/onboarding/save-mandate", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, error: "Missing token" });

    const db = getAuthenticatedDb(token);
    const authClient = supabaseAdmin || supabase;
    if (!authClient) {
      return res.status(500).json({ success: false, error: "Database not connected" });
    }
    const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ success: false, error: "Invalid session" });

    const { mandate_data, existing_onboarding_id } = req.body;

    if (!mandate_data) {
      return res.status(400).json({ success: false, error: "Missing mandate_data" });
    }

    const mandateJson = typeof mandate_data === "string" ? mandate_data : JSON.stringify(mandate_data);

    let onboardingId = existing_onboarding_id;
    if (!onboardingId) {
      const { data: latest } = await db
        .from("user_onboarding")
        .select("id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest?.id) onboardingId = latest.id;
    }

    const { data: currentRow } = onboardingId
      ? await db.from("user_onboarding").select("sumsub_raw").eq("id", onboardingId).eq("user_id", user.id).maybeSingle()
      : await db.from("user_onboarding").select("sumsub_raw").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();

    let existingRaw = {};
    if (currentRow?.sumsub_raw) {
      try { existingRaw = typeof currentRow.sumsub_raw === "string" ? JSON.parse(currentRow.sumsub_raw) : currentRow.sumsub_raw; } catch (e) { existingRaw = {}; }
    }
    existingRaw.mandate_data = JSON.parse(mandateJson);
    const mergedRaw = JSON.stringify(existingRaw);

    if (onboardingId) {
      const { error } = await db
        .from("user_onboarding")
        .update({ sumsub_raw: mergedRaw })
        .eq("id", onboardingId)
        .eq("user_id", user.id);
      if (error) {
        console.error("[Onboarding] Mandate save update error:", error.message);
        return res.status(500).json({ success: false, error: error.message });
      }
    } else {
      const { data, error } = await db
        .from("user_onboarding")
        .insert({ user_id: user.id, employment_status: "not_provided", sumsub_raw: mergedRaw })
        .select("id")
        .single();
      if (error) {
        console.error("[Onboarding] Mandate save insert error:", error.message);
        return res.status(500).json({ success: false, error: error.message });
      }
      onboardingId = data?.id;
    }

    console.log(`[Onboarding] Mandate saved for user ${user.id}, onboarding_id: ${onboardingId}`);
    res.json({ success: true, onboarding_id: onboardingId });
  } catch (error) {
    console.error("[Onboarding] Mandate save error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/onboarding/mandate", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, error: "Missing token" });

    const db = supabaseAdmin || supabase;
    const authClient = supabaseAdmin || supabase;
    if (!authClient) {
      return res.status(500).json({ success: false, error: "Database not configured" });
    }
    const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ success: false, error: "Invalid session" });

    const { data, error } = await db
      .from("user_onboarding")
      .select("sumsub_raw")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[Onboarding] Mandate load error:", error.message);
      return res.status(500).json({ success: false, error: error.message });
    }

    let mandateData = null;
    if (data?.sumsub_raw) {
      try {
        const parsed = typeof data.sumsub_raw === "string" ? JSON.parse(data.sumsub_raw) : data.sumsub_raw;
        mandateData = parsed?.mandate_data || null;
      } catch (e) {
        mandateData = null;
      }
    }

    res.json({ success: true, mandate_data: mandateData });
  } catch (error) {
    console.error("[Onboarding] Mandate load error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/onboarding/upload-agreement", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, error: "Missing token" });

    const authClient = supabaseAdmin || supabase;
    if (!authClient) {
      return res.status(500).json({ success: false, error: "Database not connected" });
    }
    const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ success: false, error: "Invalid session" });

    const { pdfBase64 } = req.body;
    if (!pdfBase64) return res.status(400).json({ success: false, error: "pdfBase64 required" });

    const db = supabaseAdmin || supabase;
    const fileName = `${user.id}/agreement-${Date.now()}.pdf`;
    const pdfBuffer = Buffer.from(pdfBase64, "base64");

    const { error: upErr } = await db.storage
      .from("signed-agreements")
      .upload(fileName, pdfBuffer, { contentType: "application/pdf", upsert: true });

    if (upErr) {
      console.warn("[Onboarding] PDF upload failed:", upErr.message);
      return res.json({ success: true, publicUrl: "" });
    }

    const { data: urlData } = db.storage.from("signed-agreements").getPublicUrl(fileName);
    return res.json({ success: true, publicUrl: urlData?.publicUrl || "" });
  } catch (error) {
    console.error("[Onboarding] Agreement upload error:", error);
    res.json({ success: true, publicUrl: "" });
  }
});

app.post("/api/onboarding/complete", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, error: "Missing token" });

    const db = getAuthenticatedDb(token);
    const authClient = supabaseAdmin || supabase;
    if (!authClient) {
      return res.status(500).json({ success: false, error: "Database not connected" });
    }
    const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ success: false, error: "Invalid session" });

    const {
      existing_onboarding_id,
      risk_disclosure_agreed,
      source_of_funds,
      source_of_funds_other,
      expected_monthly_investment,
      agreed_terms,
      agreed_privacy,
      bank_name,
      bank_account_number,
      bank_branch_code,
      signed_agreement_url,
      signed_at,
      downloaded_at,
    } = req.body;

    console.log(`[Onboarding] /complete called for user ${user.id}. Agreement URL present: ${!!signed_agreement_url}`);
    if (!signed_agreement_url) {
      console.log("[Onboarding] Warning: signed_agreement_url is missing in request body:", JSON.stringify(req.body));
    }

    const userId = user.id;

    try {
      const { data: existingAction } = await db
        .from("required_actions")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();

      if (existingAction) {
        await db.from("required_actions").update({ kyc_verified: true }).eq("user_id", userId);
      } else {
        await db.from("required_actions").insert({ user_id: userId, kyc_verified: true });
      }
    } catch (actionErr) {
      console.warn("[Onboarding] required_actions update failed (non-critical):", actionErr?.message);
    }

    let onboardingId = existing_onboarding_id;
    if (!onboardingId) {
      const { data: latest } = await db
        .from("user_onboarding")
        .select("id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest?.id) onboardingId = latest.id;
    }

    const bankDetails = (bank_name || bank_account_number || bank_branch_code) ? {
      bank_name: bank_name || null,
      bank_account_number: bank_account_number || null,
      bank_branch_code: bank_branch_code || null,
      savedAt: new Date().toISOString(),
    } : null;

    const updatePayload = {
      kyc_status: "onboarding_complete",
      updated_at: new Date().toISOString()
    };
    if (signed_agreement_url) updatePayload.signed_agreement_url = signed_agreement_url;
    if (signed_at) updatePayload.signed_at = signed_at;
    if (downloaded_at) updatePayload.downloaded_at = downloaded_at;

    const insertPayload = {
      user_id: userId,
      kyc_status: "onboarding_complete",
      employment_status: "not_provided",
      signed_agreement_url: signed_agreement_url || null,
      signed_at: signed_at || null,
      downloaded_at: downloaded_at || null,
    };

    if (bank_name) updatePayload.bank_name = bank_name;
    if (bank_account_number) updatePayload.bank_account_number = bank_account_number;
    if (bank_branch_code) updatePayload.bank_branch_code = bank_branch_code;
    if (bank_name) insertPayload.bank_name = bank_name;
    if (bank_account_number) insertPayload.bank_account_number = bank_account_number;
    if (bank_branch_code) insertPayload.bank_branch_code = bank_branch_code;

    let saved = false;

    if (onboardingId) {
      const { data: updated, error } = await db
        .from("user_onboarding")
        .update(updatePayload)
        .eq("id", onboardingId)
        .eq("user_id", userId)
        .select("id");

      if (error) {
        console.error("[Onboarding] Update failed:", error.message);
      } else if (updated && updated.length > 0) {
        saved = true;
      }
    }

    if (!saved) {
      const { data: inserted, error: insErr } = await db
        .from("user_onboarding")
        .insert(insertPayload)
        .select("id");
      if (insErr) {
        console.error("[Onboarding] Insert failed:", insErr.message);
        return res.status(500).json({ success: false, error: insErr.message });
      }
      saved = true;
      if (inserted?.[0]?.id) onboardingId = inserted[0].id;
    }

    if (bankDetails && onboardingId) {
      try {
        const { data: current } = await db
          .from("user_onboarding")
          .select("sumsub_raw")
          .eq("id", onboardingId)
          .maybeSingle();

        let rawData = {};
        if (current?.sumsub_raw) {
          rawData = typeof current.sumsub_raw === "string" ? JSON.parse(current.sumsub_raw) : current.sumsub_raw;
        }
        rawData.bank_details = bankDetails;

        await db
          .from("user_onboarding")
          .update({ sumsub_raw: JSON.stringify(rawData) })
          .eq("id", onboardingId);
      } catch (rawErr) {
        console.warn("[Onboarding] Failed to save bank details to sumsub_raw:", rawErr?.message);
      }
    }

    if (signed_agreement_url) {
      console.log(`[Onboarding] Saving agreement URL to pack details for user ${userId}`);
      try {
        const packDb = authClient;
        const { data: existingPack } = await packDb
          .from("user_onboarding_pack_details")
          .select("id, pack_details")
          .eq("user_id", userId)
          .maybeSingle();

        const agreementData = {
          url: signed_agreement_url,
          signed_at: signed_at || new Date().toISOString(),
          downloaded_at: downloaded_at || null,
          type: "account_agreement"
        };

        if (existingPack) {
          let packDetails = existingPack.pack_details;
          if (!packDetails || typeof packDetails !== "object") packDetails = {};

          const agreements = Array.isArray(packDetails.agreements) ? packDetails.agreements : [];
          agreements.push(agreementData);
          packDetails.agreements = agreements;

          await packDb
            .from("user_onboarding_pack_details")
            .update({
              pack_details: packDetails,
              updated_at: new Date().toISOString()
            })
            .eq("id", existingPack.id);
          console.log(`[Onboarding] Appended agreement to existing pack for user ${userId}`);
        } else {
          await packDb
            .from("user_onboarding_pack_details")
            .insert({
              user_id: userId,
              pack_details: { agreements: [agreementData] },
              updated_at: new Date().toISOString()
            });
          console.log(`[Onboarding] Created new pack with agreement for user ${userId}`);
        }
      } catch (packErr) {
        console.warn("[Onboarding] Failed to save agreement to pack details:", packErr.message);
      }
    }

    console.log(`[Onboarding] Completed for user ${userId}, onboarding_id: ${onboardingId}`);
    res.json({ success: true, onboarding_id: onboardingId });
  } catch (error) {
    console.error("[Onboarding] Complete error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/onboarding/status", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, error: "Missing token" });

    const db = getAuthenticatedDb(token);
    const authClient = supabaseAdmin || supabase;
    if (!authClient) {
      return res.status(500).json({ success: false, error: "Database not connected" });
    }
    const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ success: false, error: "Invalid session" });

    const { data, error } = await db
      .from("user_onboarding")
      .select("id, kyc_status, employment_status, sumsub_raw, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[Onboarding] Status fetch error:", error.message);
      return res.status(500).json({ success: false, error: error.message });
    }

    let is_fully_onboarded = false;
    if (data) {
      // "onboarding_complete" is only ever written by AccountAgreementStep.handleSign()
      // after the user physically signs — it is definitive proof of full completion.
      if (data.kyc_status === "onboarding_complete") {
        is_fully_onboarded = true;
      } else {
        const kycDone = data.kyc_status === "approved" || data.kyc_status === "verified" || data.kyc_status === "onboarding_complete";
        let taxDone = false, bankDone = false, mandateAgreed = false, riskDone = false, sofDone = false, termsDone = false;
        let raw = {};
        if (data.sumsub_raw) {
          try {
            raw = typeof data.sumsub_raw === "string" ? JSON.parse(data.sumsub_raw) : data.sumsub_raw;
            // Robust grandfathering: if they have a signed_at date, they've passed the essential hurdles
            const isGrandfathered = (kycDone && (!!raw?.signed_at || !!raw?.account_agreement_signed)) || (data.kyc_status === "onboarding_complete");

            if (isGrandfathered) {
              taxDone = true; bankDone = true; mandateAgreed = true;
              riskDone = true; sofDone = true; termsDone = true;
            } else {
              taxDone = !!raw?.tax_details_saved;
              bankDone = !!raw?.bank_details_saved;
              mandateAgreed = !!raw?.mandate_data?.agreedMandate || !!raw?.mandate_accepted;
              riskDone = !!raw?.risk_disclosure_accepted;
              sofDone = !!raw?.source_of_funds_accepted;
              termsDone = !!raw?.terms_accepted;
            }
          } catch { }
        }
        const agreementSigned = !!raw?.signed_at || !!raw?.account_agreement_signed;
        is_fully_onboarded = kycDone && taxDone && bankDone && mandateAgreed && riskDone && sofDone && termsDone && agreementSigned;
      }
    }

    res.json({
      success: true,
      onboarding: data || null,
      onboarding_id: data?.id || null,
      is_fully_onboarded,
    });
  } catch (error) {
    console.error("[Onboarding] Status error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// Settlement System Endpoints
// ============================================================

app.get("/api/settlement/config", (req, res) => {
  res.json({
    success: true,
    csdpEnabled: settlementConfig.csdpEnabled,
    brokerEnabled: settlementConfig.brokerEnabled,
    fullyIntegrated: settlementConfig.isFullyIntegrated,
    statuses: SETTLEMENT_STATUSES,
  });
});

app.post("/api/webhooks/csdp", async (req, res) => {
  console.log("[CSDP Webhook] Received:", JSON.stringify(req.body));

  if (!settlementConfig.csdpEnabled) {
    console.log("[CSDP Webhook] CSDP integration not configured - ignoring");
    return res.status(200).json({ received: true, processed: false, reason: "CSDP not configured" });
  }

  const { transactionId, holdingId, status, csdpReference } = req.body || {};

  if (!transactionId && !holdingId) {
    return res.status(400).json({ error: "transactionId or holdingId required" });
  }

  try {
    const db = supabaseAdmin || supabase;

    if (status === "approved" || status === "processed") {
      const newStatus = settlementConfig.brokerEnabled
        ? SETTLEMENT_STATUSES.PENDING_BROKER
        : SETTLEMENT_STATUSES.CONFIRMED;

      if (transactionId) {
        await db.from("transactions").update({ settlement_status: newStatus }).eq("id", transactionId);
      }
      if (holdingId) {
        await db.from("stock_holdings_c").update({ settlement_status: newStatus }).eq("id", holdingId);
      }

      console.log(`[CSDP Webhook] Updated settlement_status to ${newStatus} for tx:${transactionId} holding:${holdingId}`);

      if (newStatus === SETTLEMENT_STATUSES.CONFIRMED) {
        sendOrderFillEmail(db, { transactionId, holdingId }).catch(() => { });
      }
    } else if (status === "rejected" || status === "failed") {
      if (transactionId) {
        await db.from("transactions").update({ settlement_status: SETTLEMENT_STATUSES.FAILED }).eq("id", transactionId);
      }
      if (holdingId) {
        await db.from("stock_holdings_c").update({ settlement_status: SETTLEMENT_STATUSES.FAILED }).eq("id", holdingId);
      }
      console.log(`[CSDP Webhook] Settlement FAILED for tx:${transactionId} holding:${holdingId}`);
    }

    res.json({ received: true, processed: true });
  } catch (error) {
    console.error("[CSDP Webhook] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/webhooks/broker", async (req, res) => {
  console.log("[Broker Webhook] Received:", JSON.stringify(req.body));

  if (!settlementConfig.brokerEnabled) {
    console.log("[Broker Webhook] Broker integration not configured - ignoring");
    return res.status(200).json({ received: true, processed: false, reason: "Broker not configured" });
  }

  const { transactionId, holdingId, status, brokerReference, executionPrice, executionQuantity } = req.body || {};

  if (!transactionId && !holdingId) {
    return res.status(400).json({ error: "transactionId or holdingId required" });
  }

  try {
    const db = supabaseAdmin || supabase;

    if (status === "filled" || status === "executed" || status === "confirmed") {
      if (transactionId) {
        await db.from("transactions").update({ settlement_status: SETTLEMENT_STATUSES.CONFIRMED }).eq("id", transactionId);
      }
      if (holdingId && executionPrice) {
        const avgFillCents = Math.round(executionPrice * 100);
        const updateData = {
          settlement_status: SETTLEMENT_STATUSES.CONFIRMED,
          avg_fill: avgFillCents,
        };
        if (executionQuantity) {
          updateData.quantity = executionQuantity;
          updateData.market_value = Math.round(executionQuantity * executionPrice * 100);
        }
        await db.from("stock_holdings_c").update(updateData).eq("id", holdingId);
        console.log(`[Broker Webhook] Updated holding ${holdingId} with broker price: R${executionPrice}`);
      } else if (holdingId) {
        await db.from("stock_holdings_c").update({ settlement_status: SETTLEMENT_STATUSES.CONFIRMED }).eq("id", holdingId);
      }

      console.log(`[Broker Webhook] Settlement CONFIRMED for tx:${transactionId} holding:${holdingId}`);
      sendOrderFillEmail(db, { transactionId, holdingId }).catch(() => { });
    } else if (status === "rejected" || status === "failed") {
      if (transactionId) {
        await db.from("transactions").update({ settlement_status: SETTLEMENT_STATUSES.FAILED }).eq("id", transactionId);
      }
      if (holdingId) {
        await db.from("stock_holdings_c").update({ settlement_status: SETTLEMENT_STATUSES.FAILED }).eq("id", holdingId);
      }
      console.log(`[Broker Webhook] Settlement FAILED for tx:${transactionId} holding:${holdingId}`);
    }

    res.json({ received: true, processed: true });
  } catch (error) {
    console.error("[Broker Webhook] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/test-mint-mornings-single', async (req, res) => {
  try {
    const { email, titleSearch } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const db = supabaseAdmin || supabase;
    if (!db) return res.status(500).json({ error: 'No database connection' });
    const result = await sendTestEmail(db, email, titleSearch);
    res.json(result);
  } catch (error) {
    console.error('[MINT MORNINGS] Test single error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/test-mint-mornings', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.replace('Bearer ', '');
    const db = supabaseAdmin || supabase;
    if (!db) return res.status(500).json({ error: 'No database connection' });

    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).single();
    if (!profile || profile.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    console.log(`[MINT MORNINGS] Manual test trigger by admin ${user.email}`);
    const result = await sendTestEmail(db, user.email);
    res.json({ success: true, message: 'MINT MORNINGS test email sent to admin', result });
  } catch (error) {
    console.error('[MINT MORNINGS] Test trigger error:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.API_PORT || 3001;

const packageJson = require('../package.json');

// Health check endpoint
app.get("/api/health", async (req, res) => {
  try {
    const db = supabaseAdmin || supabase;
    const { error } = await db.from('profiles').select('id').limit(1);

    res.json({
      status: 'ok',
      database: error ? 'disconnected' : 'connected',
      version: packageJson.version,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      message: err.message
    });
  }
});

app.get("/api/version", (req, res) => {
  res.json({
    version: packageJson.version,
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// ── News_articles diagnostic endpoint ─────────────────────────────────────────
app.get('/api/diagnose/news-articles', async (req, res) => {
  const db = supabaseAdmin || supabase;
  const results = {
    supabase_connected: !!db,
    table_readable: false,
    table_writable: false,
    row_count: null,
    latest_article: null,
    latest_article_created_at: null,
    write_test: null,
    write_error: null,
    read_error: null,
    allbrf_count: null,
  };

  if (!db) {
    return res.status(500).json({ ...results, error: 'Supabase client not initialized — check VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY secrets.' });
  }

  // 1. Read test
  try {
    const { data, error, count } = await db
      .from('News_articles')
      .select('id, title, source, published_at, content_types, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      results.read_error = error.message;
    } else {
      results.table_readable = true;
      results.row_count = count;
      if (data && data.length > 0) {
        results.latest_article = data[0].title;
        results.latest_article_created_at = data[0].created_at;
      }
    }
  } catch (e) {
    results.read_error = e.message;
  }

  // 2. Count ALLBRF articles and get latest
  try {
    const { count: allbrfCount, error: allbrfErr } = await db
      .from('News_articles')
      .select('id', { count: 'exact', head: true })
      .filter('content_types', 'cs', '"ALLBRF"');
    if (!allbrfErr) results.allbrf_count = allbrfCount;

    const { data: recentAllbrf } = await db
      .from('News_articles')
      .select('title, published_at, source')
      .filter('content_types', 'cs', '"ALLBRF"')
      .order('published_at', { ascending: false })
      .limit(5);
    results.latest_allbrf_articles = (recentAllbrf || []).map(a => ({
      title: a.title,
      published_at: a.published_at,
      source: a.source,
    }));
  } catch (e) { }

  // 3. Write test — insert a clearly labelled test row then delete it
  const testDocId = Date.now(); // doc_id is bigint
  try {
    const { data: inserted, error: insertErr } = await db
      .from('News_articles')
      .insert({
        id: testDocId,
        doc_id: testDocId,
        title: '[DIAGNOSTIC TEST] News_articles write test',
        source: 'Mint Diagnostic',
        published_at: new Date().toISOString(),
        body_text: 'This is an automated diagnostic write test. It will be deleted immediately.',
        content_types: ['DIAG'],
      })
      .select('id')
      .single();

    if (insertErr) {
      results.write_test = 'FAILED';
      results.write_error = insertErr.message;
    } else {
      results.table_writable = true;
      results.write_test = 'SUCCESS';
      // Clean up the test row
      await db.from('News_articles').delete().eq('id', inserted.id);
      results.write_test = 'SUCCESS (test row deleted)';
    }
  } catch (e) {
    results.write_test = 'FAILED';
    results.write_error = e.message;
  }

  const status = results.table_readable && results.table_writable ? 200 : 500;
  return res.status(status).json(results);
});

// ─── Ozow Payment Routes ─────────────────────────────────────────────────────

app.post("/api/ozow/initiate", async (req, res) => {
  try {
    const { amount, strategyName, strategyId, userId, userEmail, successUrl, cancelUrl, errorUrl, notifyUrl } = req.body;

    const siteCode = process.env.OZOW_SITE_CODE;
    const privateKey = process.env.OZOW_PRIVATE_KEY;

    if (!siteCode || !privateKey) {
      return res.status(500).json({ success: false, error: "Ozow not configured. Please add OZOW_SITE_CODE and OZOW_PRIVATE_KEY." });
    }

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, error: "Invalid payment amount." });
    }

    const crypto = require("crypto");
    const countryCode = "ZA";
    const currencyCode = "ZAR";
    const amountStr = Number(amount).toFixed(2);
    const transactionRef = `MINT-${userId ? userId.substr(0, 8) : "USER"}-${Date.now()}`;
    const bankReference = "Mint Payment";
    const customer = userEmail || "";
    const optional1 = strategyId || "";
    const optional2 = userEmail || "";
    const optional3 = userId || "";
    const isTest = process.env.OZOW_IS_TEST === "true" ? "true" : "false";

    const baseUrl = process.env.APP_URL || "https://mymint.co.za";
    const resolvedSuccessUrl = successUrl || `${baseUrl}/?ozow=success`;
    const resolvedCancelUrl = cancelUrl || `${baseUrl}/?ozow=cancel`;
    const resolvedErrorUrl = errorUrl || `${baseUrl}/?ozow=error`;
    const resolvedNotifyUrl = notifyUrl || `${baseUrl}/api/ozow/notify`;

    // Hash order per Ozow spec:
    // SiteCode, CountryCode, CurrencyCode, Amount, TransactionReference, BankReference,
    // [Optional1-5 only if non-empty], Customer, CancelUrl, ErrorUrl, SuccessUrl, NotifyUrl, IsTest, PrivateKey
    const hashParts = [
      siteCode,
      countryCode,
      currencyCode,
      amountStr,
      transactionRef,
      bankReference,
    ];
    if (optional1) hashParts.push(optional1);
    if (optional2) hashParts.push(optional2);
    if (optional3) hashParts.push(optional3);
    hashParts.push(
      customer,
      resolvedCancelUrl,
      resolvedErrorUrl,
      resolvedSuccessUrl,
      resolvedNotifyUrl,
      isTest,
      privateKey,
    );

    const hashCheck = crypto.createHash("sha512").update(hashParts.join("").toLowerCase(), "utf8").digest("hex");

    console.log(`[ozow] Initiated payment: ref=${transactionRef} amount=${amountStr} strategy=${strategyName} userId=${userId}`);

    // Return form params — frontend must POST these as a hidden form to https://pay.ozow.com
    return res.json({
      success: true,
      action_url: "https://pay.ozow.com",
      SiteCode: siteCode,
      CountryCode: countryCode,
      CurrencyCode: currencyCode,
      Amount: amountStr,
      TransactionReference: transactionRef,
      BankReference: bankReference,
      Optional1: optional1,
      Optional2: optional2,
      Optional3: optional3,
      Customer: customer,
      CancelUrl: resolvedCancelUrl,
      ErrorUrl: resolvedErrorUrl,
      SuccessUrl: resolvedSuccessUrl,
      NotifyUrl: resolvedNotifyUrl,
      IsTest: isTest,
      HashCheck: hashCheck,
    });
  } catch (err) {
    console.error("[ozow] initiate error:", err);
    return res.status(500).json({ success: false, error: "Failed to initiate Ozow payment." });
  }
});

// Called from the success page to record the investment when the notify webhook hasn't fired yet
app.post("/api/ozow/record-success", async (req, res) => {
  try {
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const { transactionRef, strategyId, amount } = req.body;
    const userId = user.id;

    if (!transactionRef || !strategyId || !amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    // Only accept refs we generated
    if (!transactionRef.startsWith("MINT-")) {
      return res.status(400).json({ success: false, error: "Invalid transaction reference" });
    }

    const db = supabaseAdmin || supabase;
    if (!db) return res.status(500).json({ success: false, error: "DB unavailable" });

    // Deduplication
    const { data: existingTx } = await db
      .from("transactions")
      .select("id")
      .eq("store_reference", transactionRef)
      .maybeSingle();

    if (existingTx) {
      console.log(`[ozow/record-success] Already recorded ref=${transactionRef}`);
      return res.json({ success: true, alreadyRecorded: true });
    }

    const amountZAR = Number(amount);

    // Load strategy
    const { data: strategyData, error: stratError } = await db
      .from("strategies_c")
      .select("name, holdings")
      .eq("id", strategyId)
      .maybeSingle();

    if (stratError || !strategyData) {
      return res.status(404).json({ success: false, error: "Strategy not found" });
    }

    const strategyName = strategyData.name || "Strategy";
    const strategyHoldings = strategyData.holdings || [];

    if (strategyHoldings.length > 0) {
      const symbols = strategyHoldings.map(h => h.symbol).filter(Boolean);
      const { data: securitiesData } = await db
        .from("securities_c")
        .select("id, symbol, last_price")
        .in("symbol", symbols);

      const secBySymbol = {};
      (securitiesData || []).forEach(s => { secBySymbol[s.symbol] = s; });

      let totalBasketCostRands = 0;
      for (const holding of strategyHoldings) {
        const sec = secBySymbol[holding.symbol];
        if (!sec) continue;
        const qty = Number(holding.quantity || holding.shares || 0);
        const priceCents = Number(sec.last_price || 0);
        if (qty > 0 && priceCents > 0) totalBasketCostRands += (qty * priceCents) / 100;
      }

      const scalingRatio = totalBasketCostRands > 0 ? amountZAR / totalBasketCostRands : 1;
      const now = new Date().toISOString();
      const today = now.split("T")[0];

      for (const holding of strategyHoldings) {
        const sec = secBySymbol[holding.symbol];
        if (!sec) continue;
        const rawQty = Number(holding.quantity || holding.shares || 0);
        if (rawQty <= 0) continue;
        const priceCents = Number(sec.last_price || 0);
        if (priceCents <= 0) continue;

        const holdingQty = rawQty * scalingRatio;

        const { data: existing } = await db
          .from("stock_holdings_c")
          .select("id, quantity, avg_fill")
          .eq("user_id", userId)
          .eq("security_id", sec.id)
          .eq("strategy_id", strategyId)
          .maybeSingle();

        if (existing) {
          const oldQty = Number(existing.quantity || 0);
          const oldAvgFill = Number(existing.avg_fill || 0);
          const newQty = oldQty + holdingQty;
          const newAvgFill = newQty > 0 ? ((oldAvgFill * oldQty) + (priceCents * holdingQty)) / newQty : priceCents;
          await db.from("stock_holdings_c").update({
            quantity: newQty,
            avg_fill: Math.round(newAvgFill),
            market_value: Math.round(newQty * priceCents),
            as_of_date: today,
            updated_at: now,
          }).eq("id", existing.id);
        } else {
          await db.from("stock_holdings_c").insert({
            user_id: userId,
            security_id: sec.id,
            strategy_id: strategyId,
            quantity: holdingQty,
            avg_fill: priceCents,
            market_value: Math.round(holdingQty * priceCents),
            unrealized_pnl: 0,
            as_of_date: today,
            Status: "active",
          });
        }
      }
    }

    // Transaction record
    await db.from("transactions").insert({
      user_id: userId,
      direction: "debit",
      name: `Strategy Investment: ${strategyName}`,
      description: `Invested in strategy ${strategyName}`,
      amount: Math.round(amountZAR * 100),
      store_reference: transactionRef,
      currency: "ZAR",
      status: "posted",
      transaction_date: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    // Upsert user_strategies
    const { data: existingUS } = await db
      .from("user_strategies")
      .select("id, invested_amount")
      .eq("user_id", userId)
      .eq("strategy_id", strategyId)
      .maybeSingle();

    if (existingUS) {
      await db.from("user_strategies").update({
        invested_amount: (existingUS.invested_amount || 0) + Math.round(amountZAR * 100),
        updated_at: new Date().toISOString(),
      }).eq("id", existingUS.id);
    } else {
      await db.from("user_strategies").insert({
        user_id: userId,
        strategy_id: strategyId,
        invested_amount: Math.round(amountZAR * 100),
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    console.log(`[ozow/record-success] Investment recorded for user=${userId} strategy=${strategyId} amount=${amountZAR} ref=${transactionRef}`);
    return res.json({ success: true });
  } catch (err) {
    console.error("[ozow/record-success] error:", err);
    return res.status(500).json({ success: false, error: "Failed to record investment" });
  }
});

app.post("/api/ozow/notify", async (req, res) => {
  try {
    const crypto = require("crypto");
    const privateKey = process.env.OZOW_PRIVATE_KEY;
    const {
      SiteCode, TransactionId, TransactionReference, Amount, Status,
      Optional1, Optional2, Optional3, Optional4, Optional5,
      CurrencyCode, IsTest, StatusMessage, HashCheck,
    } = req.body;

    console.log("[ozow/notify] received:", req.body);

    if (privateKey && HashCheck) {
      // Notify hash order: SiteCode, TransactionId, TransactionReference, Amount, Status,
      // Optional1-5 (always include even if empty), CurrencyCode, IsTest, PrivateKey
      const hashParts = [
        SiteCode, TransactionId, TransactionReference, Amount, Status,
        Optional1 || "", Optional2 || "", Optional3 || "", Optional4 || "", Optional5 || "",
        CurrencyCode, IsTest, privateKey,
      ];
      const computed = crypto.createHash("sha512").update(hashParts.join("").toLowerCase(), "utf8").digest("hex");
      if (computed.toLowerCase() !== HashCheck.toLowerCase()) {
        console.warn("[ozow/notify] Hash mismatch — possible spoofed request");
        return res.status(200).send("OK");
      }
      console.log("[ozow/notify] Hash verified ✅");
    }

    console.log(`[ozow/notify] ref=${TransactionReference} status=${Status} amount=${Amount}`);

    if (Status === "Complete" || Status === "CompleteExternal") {
      console.log(`[ozow/notify] Payment complete ✅ ref=${TransactionReference}`);

      const strategyId = Optional1 || null;
      const userEmail = Optional2 || null;
      const userId = Optional3 || null;
      const amountZAR = Number(Amount) || 0;

      if (!userId || !strategyId || amountZAR <= 0) {
        console.warn(`[ozow/notify] Missing userId/strategyId/amount — cannot record investment. userId=${userId} strategyId=${strategyId} amount=${amountZAR}`);
        return res.status(200).send("OK");
      }

      const db = supabaseAdmin || supabase;
      if (!db) {
        console.error("[ozow/notify] No DB client available");
        return res.status(200).send("OK");
      }

      // Deduplication — skip if already processed
      const { data: existingTx } = await db
        .from("transactions")
        .select("id")
        .eq("store_reference", TransactionReference)
        .maybeSingle();

      if (existingTx) {
        console.log(`[ozow/notify] Duplicate — already recorded ref=${TransactionReference}`);
        return res.status(200).send("OK");
      }

      // Load strategy holdings
      const { data: strategyData, error: stratError } = await db
        .from("strategies_c")
        .select("name, holdings")
        .eq("id", strategyId)
        .maybeSingle();

      if (stratError || !strategyData) {
        console.error("[ozow/notify] Could not load strategy:", stratError?.message);
        return res.status(200).send("OK");
      }

      const strategyName = strategyData.name || "Strategy";
      const strategyHoldings = strategyData.holdings || [];

      if (strategyHoldings.length > 0) {
        const symbols = strategyHoldings.map(h => h.symbol).filter(Boolean);
        const { data: securitiesData } = await db
          .from("securities_c")
          .select("id, symbol, last_price")
          .in("symbol", symbols);

        const secBySymbol = {};
        (securitiesData || []).forEach(s => { secBySymbol[s.symbol] = s; });

        // Compute total basket cost to derive scaling ratio
        let totalBasketCostRands = 0;
        for (const holding of strategyHoldings) {
          const sec = secBySymbol[holding.symbol];
          if (!sec) continue;
          const qty = Number(holding.quantity || holding.shares || 0);
          const priceCents = Number(sec.last_price || 0);
          if (qty > 0 && priceCents > 0) totalBasketCostRands += (qty * priceCents) / 100;
        }

        const scalingRatio = totalBasketCostRands > 0 ? amountZAR / totalBasketCostRands : 1;
        const now = new Date().toISOString();
        const today = now.split("T")[0];

        for (const holding of strategyHoldings) {
          const sec = secBySymbol[holding.symbol];
          if (!sec) continue;
          const rawQty = Number(holding.quantity || holding.shares || 0);
          if (rawQty <= 0) continue;
          const priceCents = Number(sec.last_price || 0);
          if (priceCents <= 0) continue;

          const holdingQty = rawQty * scalingRatio;

          const { data: existing } = await db
            .from("stock_holdings_c")
            .select("id, quantity, avg_fill")
            .eq("user_id", userId)
            .eq("security_id", sec.id)
            .eq("strategy_id", strategyId)
            .maybeSingle();

          if (existing) {
            const oldQty = Number(existing.quantity || 0);
            const oldAvgFill = Number(existing.avg_fill || 0);
            const newQty = oldQty + holdingQty;
            const newAvgFill = newQty > 0 ? ((oldAvgFill * oldQty) + (priceCents * holdingQty)) / newQty : priceCents;
            await db.from("stock_holdings_c").update({
              quantity: newQty,
              avg_fill: Math.round(newAvgFill),
              market_value: Math.round(newQty * priceCents),
              as_of_date: today,
              updated_at: now,
            }).eq("id", existing.id);
            console.log(`[ozow/notify] Updated holding ${holding.symbol} qty=${newQty}`);
          } else {
            await db.from("stock_holdings_c").insert({
              user_id: userId,
              security_id: sec.id,
              strategy_id: strategyId,
              quantity: holdingQty,
              avg_fill: priceCents,
              market_value: Math.round(holdingQty * priceCents),
              unrealized_pnl: 0,
              as_of_date: today,
              Status: "active",
            });
            console.log(`[ozow/notify] Inserted holding ${holding.symbol} qty=${holdingQty}`);
          }
        }
      }

      // Record transaction
      await db.from("transactions").insert({
        user_id: userId,
        direction: "debit",
        name: `Strategy Investment: ${strategyName}`,
        description: `Invested in strategy ${strategyName}`,
        amount: Math.round(amountZAR * 100),
        store_reference: TransactionReference,
        currency: "ZAR",
        status: "posted",
        transaction_date: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
      console.log(`[ozow/notify] Transaction recorded for ref=${TransactionReference}`);

      // Upsert user_strategies
      const { data: existingUS } = await db
        .from("user_strategies")
        .select("id, invested_amount")
        .eq("user_id", userId)
        .eq("strategy_id", strategyId)
        .maybeSingle();

      if (existingUS) {
        const newInvested = (existingUS.invested_amount || 0) + Math.round(amountZAR * 100);
        await db.from("user_strategies").update({
          invested_amount: newInvested,
          updated_at: new Date().toISOString(),
        }).eq("id", existingUS.id);
        console.log(`[ozow/notify] user_strategies updated invested_amount=${newInvested}`);
      } else {
        await db.from("user_strategies").insert({
          user_id: userId,
          strategy_id: strategyId,
          invested_amount: Math.round(amountZAR * 100),
          status: "active",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        console.log(`[ozow/notify] user_strategies created for strategy=${strategyId}`);
      }

    } else if (Status === "Cancelled") {
      console.log(`[ozow/notify] Payment cancelled ref=${TransactionReference}`);
    } else if (Status === "Error") {
      console.log(`[ozow/notify] Payment error ref=${TransactionReference} msg=${StatusMessage}`);
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error("[ozow/notify] error:", err);
    return res.status(200).send("OK");
  }
});

// ─── Family Members ──────────────────────────────────────────────────────────

async function ensureFamilyMembersTable() {
  // Run migrations directly against Supabase via the service role key
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    const sql = `
      CREATE TABLE IF NOT EXISTS family_members (
        id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        primary_user_id UUID,
        relationship    TEXT,
        first_name      TEXT,
        last_name       TEXT DEFAULT '',
        date_of_birth   DATE,
        avatar_url      TEXT,
        mint_number     TEXT DEFAULT '',
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE family_members ADD COLUMN IF NOT EXISTS primary_user_id UUID;
      ALTER TABLE family_members ADD COLUMN IF NOT EXISTS relationship TEXT;
      ALTER TABLE family_members ADD COLUMN IF NOT EXISTS first_name TEXT;
      ALTER TABLE family_members ADD COLUMN IF NOT EXISTS last_name TEXT DEFAULT '';
      ALTER TABLE family_members ADD COLUMN IF NOT EXISTS date_of_birth DATE;
      ALTER TABLE family_members ADD COLUMN IF NOT EXISTS avatar_url TEXT;
      ALTER TABLE family_members ADD COLUMN IF NOT EXISTS mint_number TEXT DEFAULT '';
      ALTER TABLE family_members ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE family_members ADD COLUMN IF NOT EXISTS id_number TEXT;
      ALTER TABLE family_members ADD COLUMN IF NOT EXISTS certificate_url TEXT;
      ALTER TABLE family_members ADD COLUMN IF NOT EXISTS certificate_verification_status TEXT;
      ALTER TABLE family_members ADD COLUMN IF NOT EXISTS signed_agreement_url TEXT;
      ALTER TABLE family_members ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;
      ALTER TABLE family_members ADD COLUMN IF NOT EXISTS poa_declaration_url TEXT;
      ALTER TABLE family_members ADD COLUMN IF NOT EXISTS poa_declaration_signed_at TIMESTAMPTZ;
      ALTER TABLE family_members ADD COLUMN IF NOT EXISTS address TEXT;
      ALTER TABLE family_members ADD COLUMN IF NOT EXISTS lives_with_parent BOOLEAN;
      ALTER TABLE family_members ADD COLUMN IF NOT EXISTS spouse_email TEXT;
      ALTER TABLE family_members ADD COLUMN IF NOT EXISTS linked_user_id UUID;
      ALTER TABLE family_members ADD COLUMN IF NOT EXISTS pairing_code TEXT;
      ALTER TABLE family_members ADD COLUMN IF NOT EXISTS pairing_code_expires_at TIMESTAMPTZ;
      ALTER TABLE family_members ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
      CREATE INDEX IF NOT EXISTS idx_family_members_user ON family_members(primary_user_id);
    `;
    try {
      const resp = await globalThis.fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ sql_query: sql }),
      });
      if (resp.ok) {
        console.log('[family] family_members table ready (Supabase migration applied)');
      } else {
        const text = await resp.text();
        console.warn('[family] exec_sql RPC unavailable, falling back to pgPool:', text);
        await ensureFamilyMembersTablePg();
      }
    } catch (e) {
      console.warn('[family] exec_sql fetch failed, falling back to pgPool:', e.message);
      await ensureFamilyMembersTablePg();
    }
  } else {
    await ensureFamilyMembersTablePg();
  }
}

async function ensureFamilyMembersTablePg() {
  if (!pgPool) return;
  const client = await pgPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS family_members (
        id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        primary_user_id UUID,
        relationship    TEXT,
        first_name      TEXT,
        last_name       TEXT DEFAULT '',
        date_of_birth   DATE,
        avatar_url      TEXT,
        mint_number     TEXT DEFAULT '',
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    const cols = [
      `ALTER TABLE family_members ADD COLUMN IF NOT EXISTS primary_user_id UUID`,
      `ALTER TABLE family_members ADD COLUMN IF NOT EXISTS relationship TEXT`,
      `ALTER TABLE family_members ADD COLUMN IF NOT EXISTS first_name TEXT`,
      `ALTER TABLE family_members ADD COLUMN IF NOT EXISTS last_name TEXT DEFAULT ''`,
      `ALTER TABLE family_members ADD COLUMN IF NOT EXISTS date_of_birth DATE`,
      `ALTER TABLE family_members ADD COLUMN IF NOT EXISTS avatar_url TEXT`,
      `ALTER TABLE family_members ADD COLUMN IF NOT EXISTS mint_number TEXT DEFAULT ''`,
      `ALTER TABLE family_members ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
      `ALTER TABLE family_members ADD COLUMN IF NOT EXISTS id_number TEXT`,
      `ALTER TABLE family_members ADD COLUMN IF NOT EXISTS certificate_url TEXT`,
      `ALTER TABLE family_members ADD COLUMN IF NOT EXISTS certificate_verification_status TEXT`,
      `ALTER TABLE family_members ADD COLUMN IF NOT EXISTS signed_agreement_url TEXT`,
      `ALTER TABLE family_members ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ`,
      `ALTER TABLE family_members ADD COLUMN IF NOT EXISTS poa_declaration_url TEXT`,
      `ALTER TABLE family_members ADD COLUMN IF NOT EXISTS poa_declaration_signed_at TIMESTAMPTZ`,
      `ALTER TABLE family_members ADD COLUMN IF NOT EXISTS address TEXT`,
      `ALTER TABLE family_members ADD COLUMN IF NOT EXISTS lives_with_parent BOOLEAN`,
      `ALTER TABLE family_members ADD COLUMN IF NOT EXISTS spouse_email TEXT`,
      `ALTER TABLE family_members ADD COLUMN IF NOT EXISTS linked_user_id UUID`,
      `ALTER TABLE family_members ADD COLUMN IF NOT EXISTS pairing_code TEXT`,
      `ALTER TABLE family_members ADD COLUMN IF NOT EXISTS pairing_code_expires_at TIMESTAMPTZ`,
      `ALTER TABLE family_members ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`,
    ];
    for (const sql of cols) {
      try { await client.query(sql); } catch (_) { }
    }
    await client.query(`CREATE INDEX IF NOT EXISTS idx_family_members_user ON family_members(primary_user_id)`);
    console.log('[family] family_members table ready (pgPool migration applied)');
  } catch (e) {
    console.error('[family] pgPool migration failed:', e.message);
  } finally {
    client.release();
  }
}
ensureFamilyMembersTable();

// Helper: run a raw SQL query on the family_members table via pgPool (bypasses RLS)
async function fmQuery(sql, params = []) {
  if (!pgPool) throw new Error('pgPool unavailable');
  const client = await pgPool.connect();
  try {
    const r = await client.query(sql, params);
    return r.rows;
  } finally {
    client.release();
  }
}

app.get('/api/family-members', async (req, res) => {
  const userId = req.query.user_id;
  if (!userId) return res.status(400).json({ error: 'user_id required' });
  try {
    if (pgPool) {
      const rows = await fmQuery(
        'SELECT * FROM family_members WHERE primary_user_id = $1 ORDER BY created_at ASC',
        [userId]
      );
      return res.json({ members: rows });
    }
    const db = supabaseAdmin || supabase;
    const { data, error } = await db.from('family_members').select('*').eq('primary_user_id', userId).order('created_at', { ascending: true });
    if (error) throw error;
    return res.json({ members: data || [] });
  } catch (e) {
    console.error('[family] GET error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

app.post('/api/family-members', async (req, res) => {
  const { primary_user_id, relationship, first_name, last_name, date_of_birth, id_number, email, certificate_url, certificate_verification_status } = req.body || {};
  if (!primary_user_id || !relationship) {
    return res.status(400).json({ error: 'primary_user_id and relationship required' });
  }
  if (!['spouse', 'child'].includes(relationship)) {
    return res.status(400).json({ error: 'relationship must be spouse or child' });
  }
  try {
    const db = supabaseAdmin || supabase;

    /* ── SPOUSE ── */
    if (relationship === 'spouse') {
      const spouseMode = req.body.mode || 'link'; // 'link' | 'invite'
      const normalizedEmail = email?.toLowerCase().trim() || null;
      if (!normalizedEmail || !normalizedEmail.includes('@')) {
        return res.status(400).json({ error: 'An email address is required.' });
      }

      // Already have a spouse? (use pgPool to bypass RLS)
      let existingSpouse = null;
      if (pgPool) {
        const rows = await fmQuery(
          `SELECT id FROM family_members WHERE primary_user_id = $1 AND relationship = 'spouse' LIMIT 1`,
          [primary_user_id]
        );
        existingSpouse = rows[0] || null;
      } else {
        const { data } = await db.from('family_members')
          .select('id').eq('primary_user_id', primary_user_id).eq('relationship', 'spouse').maybeSingle();
        existingSpouse = data;
      }
      if (existingSpouse) return res.status(409).json({ error: 'A spouse is already linked to this account.' });

      const masked = normalizedEmail.includes('@')
        ? `${normalizedEmail[0]}***@${normalizedEmail.split('@')[1]}` : '***';

      // ── Helper: look up profile by email ──
      async function findProfileByEmail(em) {
        // pgPool bypasses RLS and can join auth.users — preferred path
        if (pgPool) {
          try {
            const rows = await fmQuery(
              `SELECT p.id, p.first_name, p.last_name, u.email
               FROM auth.users u
               LEFT JOIN profiles p ON p.id = u.id
               WHERE lower(u.email) = lower($1)
               LIMIT 1`,
              [em]
            );
            if (rows.length > 0 && rows[0].id) {
              console.log(`[family] findProfileByEmail via pgPool: found user ${rows[0].id} for ${em}`);
              return rows[0];
            }
          } catch (pgErr) {
            console.warn('[family] findProfileByEmail pgPool fallback:', pgErr.message);
          }
        }
        // Supabase fallback (may be limited by RLS)
        const { data: profileRow } = await db.from('profiles').select('id, first_name, last_name, email').eq('email', em).maybeSingle();
        if (profileRow) return profileRow;
        const { data: onboardingRow } = await db.from('user_onboarding').select('id, user_id, first_name, last_name, email').eq('email', em).maybeSingle();
        if (onboardingRow) {
          const linkedUserId = onboardingRow.user_id || onboardingRow.id || null;
          if (linkedUserId) {
            const { data: lp } = await db.from('profiles').select('id, first_name, last_name, email').eq('id', linkedUserId).maybeSingle();
            return { id: linkedUserId, first_name: lp?.first_name || onboardingRow.first_name || '', last_name: lp?.last_name || onboardingRow.last_name || '', email: em };
          }
        }
        return null;
      }

      /* ── MODE: link existing Mint member ── */
      if (spouseMode === 'link') {
        const matchedProfile = await findProfileByEmail(normalizedEmail);
        if (!matchedProfile) {
          return res.status(404).json({ error: 'No Mint account found with that email address. If your partner hasn\'t joined yet, use "Invite to Mint" instead.' });
        }
        if (matchedProfile.id === primary_user_id) {
          return res.status(400).json({ error: 'You cannot link yourself as a spouse.' });
        }

        // Generate 6-digit pairing code, expires in 1 hour
        const pairingCode = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

        // Create pending family_members record
        const insertPayload = {
          primary_user_id,
          relationship: 'spouse',
          first_name: matchedProfile.first_name || '',
          last_name: matchedProfile.last_name || '',
          spouse_email: normalizedEmail,
          status: 'pending_code',
          pairing_code: pairingCode,
          pairing_code_expires_at: expiresAt,
        };

        let member = null;
        if (pgPool) {
          const payload = { ...insertPayload, linked_user_id: matchedProfile.id };
          const keys = Object.keys(payload);
          const vals = Object.values(payload);
          const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
          const rows = await fmQuery(
            `INSERT INTO family_members (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
            vals
          );
          member = rows[0];
        } else {
          const { data: d1, error: e1 } = await db.from('family_members').insert({ ...insertPayload, linked_user_id: matchedProfile.id }).select().single();
          if (e1 && e1.message?.includes('linked_user_id')) {
            const { data: d2, error: e2 } = await db.from('family_members').insert(insertPayload).select().single();
            if (e2) throw e2;
            member = d2;
          } else if (e1) { throw e1; } else { member = d1; }
        }

        // Send pairing code email using branded Mint template
        const { data: inviterProfile } = await db.from('profiles').select('first_name, last_name').eq('id', primary_user_id).maybeSingle();
        const inviterName = [inviterProfile?.first_name, inviterProfile?.last_name].filter(Boolean).join(' ') || 'Your partner';
        const recipientName = matchedProfile.first_name || '';

        const resendKey = process.env.RESEND_API_KEY;
        let emailSent = false;

        if (!resendKey) {
          console.warn('[family] RESEND_API_KEY not set — pairing code email NOT sent. Code:', pairingCode);
        } else {
          try {
            const { Resend } = require('resend');
            const { buildSpousePairingHtml } = await import('../api/_lib/order-email-templates.js');
            const resend = new Resend(resendKey);
            const emailHtml = buildSpousePairingHtml({ recipientName, inviterName, pairingCode });
            const resp = await resend.emails.send({
              from: 'Mint <noreply@mymint.co.za>',
              to: [normalizedEmail],
              subject: `Your Mint pairing code from ${inviterName}`,
              html: emailHtml,
            });
            if (resp.error) {
              console.error('[family] Pairing code email send error:', resp.error);
            } else {
              emailSent = true;
              console.log(`[family] Pairing code email sent to ${normalizedEmail}, id: ${resp.data?.id}`);
            }
          } catch (emailErr) {
            console.error('[family] Pairing code email failed:', emailErr.message);
          }
        }

        // Return email_sent status so the frontend can warn the user if needed.
        // Include the raw code ONLY when email could not be sent (dev/no-key fallback).
        const responsePayload = {
          pairing_sent: true,
          email_sent: emailSent,
          member_id: member.id,
          masked_email: masked,
        };
        if (!emailSent) responsePayload.fallback_code = pairingCode;

        return res.status(200).json(responsePayload);
      }

      /* ── MODE: invite (not on Mint yet) ── */
      if (spouseMode === 'invite') {
        // Check if they're already on Mint — direct to link flow instead
        const existing = await findProfileByEmail(normalizedEmail);
        if (existing) {
          return res.status(409).json({ error: 'This email address already has a Mint account. Use "Link existing Mint member" to link them with a pairing code.' });
        }

        const { data: inviterProfile } = await db.from('profiles').select('first_name, last_name').eq('id', primary_user_id).maybeSingle();
        const inviterName = [inviterProfile?.first_name, inviterProfile?.last_name].filter(Boolean).join(' ') || 'Your partner';
        const inviteeName = [first_name, last_name].filter(Boolean).join(' ');
        const greeting = inviteeName ? `Hi ${inviteeName},` : 'Hi there,';

        let emailSent = false;
        const resendKey = process.env.RESEND_API_KEY;
        if (resendKey) {
          try {
            const { Resend } = require('resend');
            const resend = new Resend(resendKey);
            await resend.emails.send({
              from: 'Mint <noreply@mymint.co.za>',
              to: [normalizedEmail],
              subject: `${inviterName} has invited you to join Mint`,
              html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&family=Barlow+Condensed:wght@700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#EEEAF5;font-family:'Barlow',Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:40px 20px;">
    <div style="background:#3D1A6B;border-radius:16px 16px 0 0;padding:20px 32px;text-align:center;">
      <div style="font-family:'Barlow Condensed',Arial Narrow,Arial,sans-serif;font-size:36px;font-weight:800;color:white;letter-spacing:4px;text-transform:uppercase;">MINT</div>
      <div style="color:rgba(255,255,255,0.55);font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-top:3px;">Family Investment Platform</div>
    </div>
    <div style="height:3px;background:linear-gradient(90deg,#5B2D8E,#7B4DB0,#EDE8F8);"></div>
    <div style="background:white;border-radius:0 0 16px 16px;padding:36px 32px;">
      <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 16px;">${greeting}</p>
      <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 16px;">
        <strong style="color:#3D1A6B;">${inviterName}</strong> has invited you to join them on
        <strong style="color:#3D1A6B;">MINT</strong> — the smart investing and financial planning
        platform for South African families.
      </p>
      <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 28px;">
        Sign up to start investing together, plan for the future, and manage your family&rsquo;s wealth in one place.
      </p>
      <div style="text-align:center;margin-bottom:28px;">
        <a href="https://mymint.co.za" style="display:inline-block;background:linear-gradient(135deg,#3D1A6B,#5B2D8E);color:white;padding:14px 44px;border-radius:12px;text-decoration:none;font-family:'Barlow Condensed',Arial Narrow,Arial,sans-serif;font-weight:800;font-size:17px;letter-spacing:1px;text-transform:uppercase;">Join MINT</a>
      </div>
      <p style="color:#94a3b8;font-size:11px;text-align:center;margin:0;">If you weren&rsquo;t expecting this invitation, you can safely ignore this email.</p>
    </div>
    <p style="color:#a0aec0;font-size:10px;text-align:center;margin-top:16px;">Mint Financial Services (Pty) Ltd &nbsp;·&nbsp; FSP No. 55118</p>
  </div>
</body>
</html>`,
            });
            emailSent = true;
          } catch (emailErr) {
            console.error('[family] Invite email failed:', emailErr.message);
          }
        }

        // Record as invited (pending)
        try {
          if (pgPool) {
            await fmQuery(
              `INSERT INTO family_members (primary_user_id, relationship, first_name, last_name, spouse_email, status) VALUES ($1, $2, $3, $4, $5, $6)`,
              [primary_user_id, 'spouse', first_name?.trim() || '', last_name?.trim() || '', normalizedEmail, 'invited']
            );
          } else {
            await db.from('family_members').insert({
              primary_user_id, relationship: 'spouse',
              first_name: first_name?.trim() || '', last_name: last_name?.trim() || '',
              spouse_email: normalizedEmail, status: 'invited',
            });
          }
        } catch (_) { /* non-fatal */ }

        return res.status(200).json({
          invited: true,
          email_sent: emailSent,
          masked_email: masked,
          message: emailSent
            ? `Invitation sent to ${masked}. Once they sign up on Mint, you can link them as your spouse.`
            : `${masked} is not on Mint yet. Please ask them to sign up at mymint.co.za, then try linking again.`,
        });
      }

      return res.status(400).json({ error: 'Invalid spouse mode. Use "link" or "invite".' });
    }

    /* ── CHILD ── */
    if (relationship === 'child') {
      if (!first_name?.trim()) return res.status(400).json({ error: 'First name is required.' });
      if (!date_of_birth) return res.status(400).json({ error: 'Date of birth is required.' });

      const childIdClean = id_number ? String(id_number).replace(/\D/g, '') : null;
      const mint_number = generateChildMintNumber(first_name.trim(), childIdClean, date_of_birth);
      const verificationStatus = certificate_verification_status || 'pending_review';

      const basePayload = {
        primary_user_id,
        relationship: 'child',
        first_name: first_name.trim(),
        last_name: (last_name || '').trim(),
        date_of_birth,
        certificate_uploaded_at: new Date().toISOString(),
        mint_number,
        ...(childIdClean ? { id_number: childIdClean } : {}),
      };

      const fullPayload = {
        ...basePayload,
        certificate_url,
        certificate_verification_status: verificationStatus,
      };

      if (pgPool) {
        // Use pgPool directly to bypass RLS
        const keys = Object.keys(fullPayload);
        const vals = Object.values(fullPayload);
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
        const rows = await fmQuery(
          `INSERT INTO family_members (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
          vals
        );
        const member = rows[0];
        return res.status(201).json({ member: { ...member, id_number: childIdClean || member.id_number } });
      }

      const { data: d1, error: e1 } = await db.from('family_members').insert(fullPayload).select().single();
      if (e1) {
        const { data: d2, error: e2 } = await db.from('family_members').insert({ ...basePayload, certificate_url }).select().single();
        if (e2 && e2.message?.includes('certificate_url')) {
          const { data: d3, error: e3 } = await db.from('family_members').insert(basePayload).select().single();
          if (e3) throw e3;
          return res.status(201).json({ member: { ...d3, id_number: childIdClean || d3.id_number } });
        } else if (e2) { throw e2; }
        return res.status(201).json({ member: { ...d2, id_number: childIdClean || d2.id_number } });
      }
      return res.status(201).json({ member: { ...d1, id_number: childIdClean || d1.id_number } });
    }
  } catch (e) {
    console.error('[family] POST error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

app.post('/api/family-members/confirm-pairing', async (req, res) => {
  const { member_id, code } = req.body || {};
  if (!member_id || !code) return res.status(400).json({ error: 'member_id and code required' });

  try {
    const db = supabaseAdmin || supabase;

    let member;
    if (pgPool) {
      const rows = await fmQuery(
        `SELECT * FROM family_members WHERE id = $1 AND status = 'pending_code' LIMIT 1`,
        [member_id]
      );
      member = rows[0] || null;
    } else {
      const { data, error: fetchErr } = await db.from('family_members').select('*').eq('id', member_id).eq('status', 'pending_code').maybeSingle();
      if (fetchErr) throw fetchErr;
      member = data;
    }

    if (!member) return res.status(404).json({ error: 'Pairing request not found or already confirmed.' });

    // Check code
    if (member.pairing_code !== String(code).trim()) {
      return res.status(400).json({ error: 'Incorrect pairing code. Please check and try again.' });
    }

    // Check expiry
    if (member.pairing_code_expires_at && new Date(member.pairing_code_expires_at) < new Date()) {
      return res.status(400).json({ error: 'This pairing code has expired. Please go back and send a new one.' });
    }

    // Determine KYC status of linked user
    let kycPending = false;
    if (member.linked_user_id) {
      const { data: onboarding } = await db.from('user_onboarding').select('kyc_status').eq('user_id', member.linked_user_id).maybeSingle();
      const kycStatus = onboarding?.kyc_status || '';
      kycPending = !['approved', 'onboarding_complete', 'verified'].includes(kycStatus);
    }

    // Activate the member
    let updated;
    if (pgPool) {
      const rows = await fmQuery(
        `UPDATE family_members SET status = 'active', pairing_code = NULL, pairing_code_expires_at = NULL WHERE id = $1 RETURNING *`,
        [member_id]
      );
      updated = rows[0];
    } else {
      const { data, error: updateErr } = await db.from('family_members').update({ status: 'active', pairing_code: null, pairing_code_expires_at: null }).eq('id', member_id).select().single();
      if (updateErr) throw updateErr;
      updated = data;
    }

    return res.json({ linked: true, kyc_pending: kycPending, member: { ...updated, kyc_pending: kycPending } });
  } catch (e) {
    console.error('[family] confirm-pairing error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// Fetch a linked user's public profile fields (name, ID, address) — used for co-guardian display in POA PDF
app.get('/api/linked-user-profile/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    const db = supabaseAdmin || supabase;
    const { data, error } = await db
      .from('profiles')
      .select('id, first_name, last_name, id_number, address')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Profile not found' });
    return res.json({
      id: data.id,
      firstName: data.first_name,
      lastName: data.last_name,
      idNumber: data.id_number,
      address: data.address,
    });
  } catch (e) {
    console.error('[linked-profile]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

app.patch('/api/family-members/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'Member ID required' });

  const allowed = [
    'signed_agreement_url', 'signed_at',
    'poa_declaration_url', 'poa_declaration_signed_at',
    'id_number', 'certificate_url', 'certificate_verification_status',
    'address', 'lives_with_parent',
  ];
  const body = req.body || {};
  const patch = {};
  for (const k of allowed) {
    if (body[k] !== undefined) patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  try {
    let member;
    if (pgPool) {
      const keys = Object.keys(patch);
      const vals = Object.values(patch);
      const setClauses = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');
      vals.push(id);
      const rows = await fmQuery(
        `UPDATE family_members SET ${setClauses} WHERE id = $${vals.length} RETURNING *`,
        vals
      );
      member = rows[0] || null;
    } else {
      const db = supabaseAdmin || supabase;
      const { data, error } = await db.from('family_members').update(patch).eq('id', id).select().maybeSingle();
      if (error) throw error;
      member = data;
    }
    return res.json({ success: true, member });
  } catch (e) {
    console.error('[family] PATCH error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

app.delete('/api/family-members/:id', async (req, res) => {
  const id = req.params.id || req.body?.member_id;
  const userId = req.query.user_id || req.body?.primary_user_id;
  if (!id || !userId) return res.status(400).json({ error: 'member_id and primary_user_id required' });
  try {
    if (pgPool) {
      await fmQuery(`DELETE FROM family_members WHERE id = $1 AND primary_user_id = $2`, [id, userId]);
    } else {
      const db = supabaseAdmin || supabase;
      const { error } = await db.from('family_members').delete().eq('id', id).eq('primary_user_id', userId);
      if (error) throw error;
    }
    return res.json({ success: true });
  } catch (e) {
    console.error('[family] DELETE error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

app.delete('/api/family-members', async (req, res) => {
  const { member_id, primary_user_id } = req.body || {};
  if (!member_id || !primary_user_id) return res.status(400).json({ error: 'member_id and primary_user_id required' });
  try {
    if (pgPool) {
      await fmQuery(`DELETE FROM family_members WHERE id = $1 AND primary_user_id = $2`, [member_id, primary_user_id]);
    } else {
      const db = supabaseAdmin || supabase;
      const { error } = await db.from('family_members').delete().eq('id', member_id).eq('primary_user_id', primary_user_id);
      if (error) throw error;
    }
    return res.json({ success: true });
  } catch (e) {
    console.error('[family] DELETE error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ── Funeral Cover Policy Save ─────────────────────────────────────────────
app.post("/api/insurance/save-policy", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, error: "Missing token" });

    const authClient = supabaseAdmin || supabase;
    const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ success: false, error: "Invalid session" });

    const {
      policyNo, planType, planLabel, coverAmount, basePremium,
      totalMonthly, deductionDate, firstName, lastName, age,
      addonDetails = [], dependents = [], pdfBase64,
    } = req.body || {};

    if (!policyNo) return res.status(400).json({ success: false, error: "policyNo required" });

    const db = supabaseAdmin || supabase;

    // ── Ensure insurance_policies table exists ──────────────────────────────
    if (pgPool) {
      try {
        await pgPool.connect().then(async client => {
          try {
            await client.query(`
              CREATE TABLE IF NOT EXISTS insurance_policies (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                user_id UUID NOT NULL,
                policy_no TEXT NOT NULL,
                plan_type TEXT,
                plan_label TEXT,
                cover_amount NUMERIC,
                base_premium NUMERIC,
                total_monthly NUMERIC,
                deduction_date TEXT,
                status TEXT DEFAULT 'active',
                pdf_url TEXT,
                addon_details JSONB,
                dependents JSONB,
                first_name TEXT,
                last_name TEXT,
                age INTEGER,
                created_at TIMESTAMPTZ DEFAULT NOW()
              );
              CREATE INDEX IF NOT EXISTS idx_insurance_policies_user ON insurance_policies(user_id);
            `);
          } finally { client.release(); }
        });
      } catch (tblErr) {
        console.warn("[insurance] Table ensure failed (non-fatal):", tblErr.message);
      }
    }

    // ── Upload PDF if provided ──────────────────────────────────────────────
    let pdfUrl = null;
    if (pdfBase64) {
      try {
        const pdfBuffer = Buffer.from(pdfBase64, "base64");
        const fileName = `${user.id}/funeral-cover-${policyNo}.pdf`;
        const { error: upErr } = await db.storage
          .from("signed-agreements")
          .upload(fileName, pdfBuffer, { contentType: "application/pdf", upsert: true });
        if (!upErr) {
          const { data: urlData } = db.storage.from("signed-agreements").getPublicUrl(fileName);
          pdfUrl = urlData?.publicUrl || null;
        } else {
          console.warn("[insurance] PDF upload failed:", upErr.message);
        }
      } catch (uploadErr) {
        console.warn("[insurance] PDF upload error:", uploadErr.message);
      }
    }

    // ── Insert policy record ────────────────────────────────────────────────
    const record = {
      user_id: user.id,
      policy_no: policyNo,
      plan_type: planType || null,
      plan_label: planLabel || null,
      cover_amount: coverAmount || null,
      base_premium: basePremium || null,
      total_monthly: totalMonthly || null,
      deduction_date: deductionDate || null,
      first_name: firstName || null,
      last_name: lastName || null,
      age: age || null,
      pdf_url: pdfUrl,
      addon_details: JSON.stringify(addonDetails),
      dependents: JSON.stringify(dependents),
      status: "active",
      created_at: new Date().toISOString(),
    };

    if (pgPool) {
      const keys = Object.keys(record);
      const vals = Object.values(record);
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
      await fmQuery(
        `INSERT INTO insurance_policies (${keys.join(", ")}) VALUES (${placeholders})`,
        vals
      ).catch(e => console.warn("[insurance] Insert failed:", e.message));
    } else {
      const { error: insertErr } = await db.from("insurance_policies").insert(record);
      if (insertErr) console.warn("[insurance] Insert failed:", insertErr.message);
    }

    console.log(`[insurance] Policy ${policyNo} saved for user ${user.id}. PDF: ${pdfUrl ? "uploaded" : "none"}`);
    return res.json({ success: true, policyNo, pdfUrl });
  } catch (e) {
    console.error("[insurance] save-policy error:", e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ── Funeral Cover Policy Email ─────────────────────────────────────────────
app.post("/api/insurance/send-policy-email", async (req, res) => {
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser(
      req.headers.authorization?.replace("Bearer ", "")
    );
    if (userError || !userData?.user) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    const user = userData.user;

    const {
      policyNo, planLabel, coverAmount, basePremium,
      addonDetails = [], totalMonthly, deductionDate,
      firstName, lastName, dateStr,
    } = req.body;

    if (!policyNo || !planLabel || !coverAmount || !totalMonthly) {
      return res.status(400).json({ success: false, error: "Missing required policy fields" });
    }

    const { buildPolicySummaryHtml } = await import('../api/_lib/order-email-templates.js');
    const html = buildPolicySummaryHtml({
      firstName, lastName, policyNo, planLabel, coverAmount,
      basePremium, addonDetails, totalMonthly, deductionDate, dateStr,
    });

    if (!process.env.RESEND_API_KEY) {
      console.warn("[insurance/send-policy-email] RESEND_API_KEY not set — skipping email");
      return res.status(200).json({ success: true, email_sent: false, reason: "Email service not configured" });
    }

    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    const toEmail = user.email;
    const resp = await resend.emails.send({
      from: "Mint <noreply@mymint.co.za>",
      to: toEmail,
      subject: `Your Mint Funeral Cover Policy Schedule — ${policyNo}`,
      html,
    });

    if (resp.error) {
      console.error("[insurance/send-policy-email] Resend error:", resp.error.message);
      return res.status(500).json({ success: false, error: resp.error.message });
    }

    console.log(`[insurance/send-policy-email] Policy email sent to ${toEmail}, policy: ${policyNo}`);
    return res.status(200).json({ success: true, emailId: resp.data?.id });
  } catch (err) {
    console.error("[insurance/send-policy-email] Error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to send policy email" });
  }
});

// ── Admin: snapshot current prices as YTD start (run on Jan 1 each year) ──
app.post('/api/admin/set-ytd-prices', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorised' });
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorised' });

    const adminDb = supabaseAdmin || supabase;
    if (!adminDb) return res.status(503).json({ error: 'Database not available' });

    // Snapshot last_price → ytd_start_price for all securities that have a price
    const { error: updateErr } = await adminDb.rpc('exec_sql', {
      query: 'UPDATE securities SET ytd_start_price = last_price WHERE last_price IS NOT NULL AND last_price > 0'
    });
    if (updateErr) throw new Error(updateErr.message);
    console.log(`[admin] ytd_start_price snapshot applied by ${user.email}`);
    return res.json({ success: true, message: 'YTD start prices updated from current last_price values.' });
  } catch (err) {
    console.error('[admin] set-ytd-prices error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Catch-all 404 handler - MUST be after all route definitions
app.use((req, res) => {
  res.status(404).json({ error: "Not found", message: "This is the API server. The frontend is served separately." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`TruID API server running on port ${PORT}`);
});
