import { supabase, supabaseAdmin } from "./_lib/supabase.js";
import { buildOrderConfirmationHtml } from "./_lib/order-email-templates.js";
import { Resend } from "resend";

function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

async function sendOrderConfirmationEmail(db, { userId, userEmail, assetName, assetSymbol, strategyName, amountCents, quantity, priceCents, reference, orderDate }) {
  try {
    const resend = getResend();
    if (!resend || !userEmail) return;
    const isStrategy = !!strategyName;
    const subject = isStrategy
      ? `Order Confirmed — ${strategyName}`
      : `Order Confirmed — ${assetName || assetSymbol || "Stock"}`;
    const html = buildOrderConfirmationHtml({
      assetName,
      assetSymbol,
      strategyName,
      amountCents,
      quantity,
      priceCents,
      reference,
      orderDate,
    });
    const resp = await resend.emails.send({
      from: "Mint <orders@mymint.co.za>",
      to: [userEmail],
      subject,
      html,
    });
    if (resp.error) {
      console.error("[confirm-eft] Email error:", resp.error.message);
    } else {
      console.log(`[confirm-eft] Order confirmation sent to ${userEmail}`);
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
      confirmation_resend_id: resp?.data?.id || null,
      confirmation_sent_at: new Date().toISOString(),
    }).then(() => {}).catch(() => {});
  } catch (err) {
    console.error("[confirm-eft] sendOrderConfirmationEmail error:", err.message);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });

  try {
    const adminSecret = process.env.ADMIN_SECRET || process.env.CONFIRM_EFT_SECRET;
    const { reference, adminSecret: providedSecret } = req.body;

    if (!adminSecret || providedSecret !== adminSecret) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    if (!reference) {
      return res.status(400).json({ success: false, error: "Missing reference" });
    }

    const db = supabaseAdmin || supabase;
    if (!db) return res.status(500).json({ success: false, error: "Database not connected" });

    const { data: tx, error: txLookupErr } = await db
      .from("transactions")
      .select("*")
      .eq("store_reference", reference)
      .maybeSingle();

    if (txLookupErr || !tx) {
      return res.status(404).json({ success: false, error: "EFT transaction not found" });
    }

    if (tx.status === "posted") {
      return res.status(200).json({ success: true, message: "Already confirmed", duplicate: true });
    }

    let intent = {};
    try {
      const parsed = JSON.parse(tx.description || "{}");
      if (parsed.type === "eft_intent") {
        intent = parsed;
      }
    } catch (_) {}

    const { securityId, symbol, name, strategyId, amount, baseAmount, shareCount } = intent;
    const userId = tx.user_id;
    const amountCents = tx.amount;
    const investAmount = baseAmount && baseAmount > 0 ? baseAmount : amount || amountCents / 100;

    const { data: userRecord } = await db.auth.admin
      ? db.auth.admin.getUserById(userId).then(r => r)
      : { data: null };
    const userEmail = userRecord?.user?.email || null;

    const isStrategyInvestment = !!strategyId;
    const now = new Date().toISOString();
    const today = now.split("T")[0];
    let quantity = null;
    let currentPriceCents = null;

    if (isStrategyInvestment && securityId) {
      const { data: strategyData } = await db
        .from("strategies_c")
        .select("holdings")
        .eq("id", strategyId)
        .maybeSingle();

      if (strategyData?.holdings?.length) {
        const strategyHoldings = strategyData.holdings;
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
        const scalingRatio = totalBasketCostRands > 0 ? investAmount / totalBasketCostRands : 1;

        for (const holding of strategyHoldings) {
          const sec = secBySymbol[holding.symbol];
          if (!sec) continue;
          const rawHoldingQty = Number(holding.quantity || holding.shares || 0);
          if (rawHoldingQty <= 0) continue;
          const holdingQty = rawHoldingQty * scalingRatio;
          const priceCentsVal = Number(sec.last_price || 0);
          if (priceCentsVal <= 0) continue;

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
            const newAvgFill = newQty > 0
              ? ((oldAvgFill * oldQty) + (priceCentsVal * holdingQty)) / newQty
              : priceCentsVal;
            await db.from("stock_holdings_c").update({
              quantity: newQty,
              avg_fill: Math.round(newAvgFill),
              market_value: Math.round(newQty * priceCentsVal),
              as_of_date: today,
              updated_at: now,
            }).eq("id", existing.id);
          } else {
            await db.from("stock_holdings_c").insert({
              user_id: userId,
              security_id: sec.id,
              strategy_id: strategyId,
              quantity: holdingQty,
              avg_fill: priceCentsVal,
              market_value: Math.round(holdingQty * priceCentsVal),
              unrealized_pnl: 0,
              as_of_date: today,
              Status: "active",
            });
          }
        }
      }
    } else if (securityId && !isStrategyInvestment) {
      const { data: securityData } = await db
        .from("securities_c")
        .select("last_price")
        .eq("id", securityId)
        .maybeSingle();

      currentPriceCents = securityData?.last_price ? Number(securityData.last_price) : null;

      if (!currentPriceCents) {
        const { data: priceData } = await db
          .from("stock_returns_c")
          .select("current_price")
          .eq("security_id", securityId)
          .order("as_of_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (priceData?.current_price) currentPriceCents = Number(priceData.current_price);
      }

      const currentPriceRands = currentPriceCents ? currentPriceCents / 100 : investAmount;
      quantity = currentPriceRands > 0 ? investAmount / currentPriceRands : 1;
      const avgFillCents = currentPriceCents || Math.round(investAmount * 100);
      const marketValueCents = Math.round(quantity * (currentPriceCents || investAmount * 100));

      const { data: existing } = await db
        .from("stock_holdings_c")
        .select("id, quantity, avg_fill, market_value")
        .eq("user_id", userId)
        .eq("security_id", securityId)
        .maybeSingle();

      if (existing) {
        const oldQty = Number(existing.quantity || 0);
        const oldAvgFill = Number(existing.avg_fill || 0);
        const newQty = oldQty + quantity;
        const newAvgFill = newQty > 0 ? ((oldAvgFill * oldQty) + (avgFillCents * quantity)) / newQty : avgFillCents;
        await db.from("stock_holdings_c").update({
          quantity: newQty,
          avg_fill: Math.round(newAvgFill),
          market_value: Math.round(newQty * (currentPriceCents || Math.round(newAvgFill))),
          as_of_date: today,
          updated_at: now,
        }).eq("id", existing.id);
      } else {
        await db.from("stock_holdings_c").insert({
          user_id: userId,
          security_id: securityId,
          quantity,
          avg_fill: avgFillCents,
          market_value: marketValueCents,
          unrealized_pnl: 0,
          as_of_date: today,
          Status: "active",
          strategy_id: strategyId || null,
        });
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
    }).then(() => {}).catch(() => {});

    await db
      .from("transactions")
      .update({ status: "posted" })
      .eq("store_reference", reference);

    try {
      const { data: wallet } = await db
        .from("wallets")
        .select("balance, pending_balance")
        .eq("user_id", userId)
        .maybeSingle();

      if (wallet !== null) {
        const newBalance = Number(wallet.balance || 0) + (amount || amountCents / 100);
        const newPending = Math.max(0, Number(wallet.pending_balance || 0) - (amount || amountCents / 100));
        await db.from("wallets").update({ balance: newBalance, pending_balance: newPending }).eq("user_id", userId);
      }
    } catch (walletErr) {
      console.warn("[confirm-eft] Could not update wallet balance:", walletErr?.message);
    }

    if (userEmail) {
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
      }).catch(() => {});
    }

    console.log(`[confirm-eft] EFT deposit confirmed for user ${userId}, ref: ${reference}, asset: ${name || symbol}`);
    return res.status(200).json({ success: true, reference });
  } catch (err) {
    console.error("[confirm-eft] Error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to confirm EFT deposit" });
  }
}
