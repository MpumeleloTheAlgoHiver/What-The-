import { supabase, supabaseAdmin, authenticateUser } from "./_lib/supabase.js";
import { buildOrderConfirmationHtml } from "./_lib/order-email-templates.js";
import { Resend } from "resend";

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

async function verifyPaystackPayment(reference) {
  if (!PAYSTACK_SECRET_KEY) {
    return { verified: false, error: "Paystack secret key not configured" };
  }
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    },
  });
  const result = await response.json();
  if (!result.status || result.data?.status !== "success") {
    return { verified: false, error: "Payment not successful", data: result.data };
  }
  return { verified: true, data: result.data };
}

async function sendOrderConfirmationEmail(db, { userId, userEmail, assetName, assetSymbol, strategyName, amountCents, quantity, priceCents, reference, orderDate, paymentMethod }) {
  try {
    const resend = getResend();
    if (!resend) {
      console.log("[order-email] RESEND_API_KEY not set — skipping confirmation email");
      return;
    }

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
    }).then(() => {}).catch((err) => {
      console.warn("[order-email] Failed to log email:", err?.message);
    });

    console.log(`[order-email] Confirmation sent to ${userEmail} for ${displayNameFor(assetName, assetSymbol, strategyName)}`);
  } catch (err) {
    console.error("[order-email] Failed to send confirmation:", err.message);
  }
}

function displayNameFor(assetName, assetSymbol, strategyName) {
  return strategyName || assetName || assetSymbol || "Unknown";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

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
    const { securityId, symbol, name, amount, baseAmount, strategyId, paymentReference, paymentMethod, shareCount } = req.body;
    // baseAmount = investment amount excluding fees (used for holdings/quantity calculations)
    // amount = total charged including fees (used for transaction records)
    const investAmount = (baseAmount && baseAmount > 0) ? baseAmount : amount;

    if ((!securityId && !strategyId) || !amount || Number(amount) <= 0 || !paymentReference) {
      return res.status(400).json({ success: false, error: "Missing required fields: securityId or strategyId, amount, paymentReference" });
    }

    let payData = { amount: Math.round(amount * 100) };
    const skipVerification = paymentMethod === "wallet" || paymentMethod === "direct_eft" || paymentMethod === "ozow";

    if (!skipVerification) {
      const { verified, error: payError, data: vPayData } = await verifyPaystackPayment(paymentReference);
      if (!verified) {
        return res.status(400).json({ success: false, error: payError || "Payment verification failed" });
      }
      payData = vPayData;
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
        return res.status(400).json({ success: false, error: "Wallet not found" });
      }

      originalWalletBalance = Number(wallet.balance);
      if (originalWalletBalance < amount) {
        return res.status(400).json({ success: false, error: "Insufficient funds" });
      }

      newWalletBalance = originalWalletBalance - amount;
      const { data: updatedWallet, error: deductError } = await db
        .from("wallets")
        .update({ balance: newWalletBalance })
        .eq("user_id", userId)
        .eq("balance", originalWalletBalance)
        .select("balance")
        .maybeSingle();

      if (deductError || !updatedWallet) {
        console.error("[record-investment] WALLET DEDUCTION ERROR:", deductError?.message || "balance changed concurrently");
        return res.status(409).json({ success: false, error: deductError ? "Failed to deduct wallet balance" : "Wallet balance changed — please retry" });
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
      return res.status(200).json({ success: true, message: "Already recorded", duplicate: true });
    }

    const paidAmount = payData.amount / 100;
    if (!skipVerification && Math.abs(paidAmount - amount) > 1) {
      return res.status(400).json({ success: false, error: `Amount mismatch: paid ${paidAmount}, expected ${amount}` });
    }

    const isStrategyInvestment = !!strategyId;

    const { data: securityCheck } = await db
      .from("securities_c")
      .select("id")
      .eq("id", securityId)
      .maybeSingle();

    let holdingResult = { data: null, error: null };
    let currentPriceCents = null;
    let quantity = null;

    if (isStrategyInvestment) {
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

        // Scale shares proportionally to what the user actually invested (ENFORCE INTEGER)
        const holdingQty = Math.floor(rawHoldingQty * scalingRatio);

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
          const oldAvgFill = Number(existing.avg_fill || 0);
          const newQty = Math.floor(oldQty + holdingQty);
          const newAvgFill = newQty > 0
            ? ((oldAvgFill * oldQty) + (priceCents * holdingQty)) / newQty
            : priceCents;

          const { error: updateErr } = await db.from("stock_holdings_c").update({
            quantity: newQty,
            avg_fill: Math.round(newAvgFill),
            market_value: Math.round(newQty * priceCents),
            as_of_date: today,
            updated_at: now,
          }).eq("id", existing.id);

          if (updateErr) {
            console.error("[record-investment] Failed to update holding for", holding.symbol, updateErr.message);
            return res.status(500).json({ success: false, error: `Failed to update holding for ${holding.symbol}` });
          }
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
        }

        insertedHoldings.push({ symbol: holding.symbol, quantity: holdingQty, priceCents });
      }

      if (skippedSymbols.length > 0) {
        console.warn("[record-investment] Skipped symbols (no security/price):", skippedSymbols.join(", "));
      }

      // --- ADDED: user_strategies update for investment ---
      console.log(`[record-investment] Updating user_strategies for strategy: ${strategyId}`);
      const { data: existingUS } = await db
        .from("user_strategies")
        .select("id, invested_amount")
        .eq("user_id", userId)
        .eq("strategy_id", strategyId)
        .maybeSingle();

      const investmentAmountCents = Math.round(amount * 100);
      const nowTs = new Date().toISOString();

      if (existingUS) {
        const newInvested = (existingUS.invested_amount || 0) + investmentAmountCents;
        const { error: usUpdateErr } = await db
          .from("user_strategies")
          .update({ invested_amount: newInvested, updated_at: nowTs })
          .eq("id", existingUS.id);
        if (usUpdateErr) console.warn("[record-investment] user_strategies update failed:", usUpdateErr.message);
      } else {
        const { error: usInsertErr } = await db
          .from("user_strategies")
          .insert({
            user_id: userId,
            strategy_id: strategyId,
            invested_amount: investmentAmountCents,
            status: "active",
            created_at: nowTs,
            updated_at: nowTs,
          });
        if (usInsertErr) console.warn("[record-investment] user_strategies insert failed:", usInsertErr.message);
      }

      holdingResult = { data: { strategyHoldingsRecorded: insertedHoldings.length, skipped: skippedSymbols }, error: null };
    }

    if (securityCheck && !isStrategyInvestment) {
      const { data: securityData, error: secError } = await db
        .from("securities_c")
        .select("last_price")
        .eq("id", securityId)
        .maybeSingle();

      if (!secError && securityData?.last_price) {
        currentPriceCents = Number(securityData.last_price);
      } else {
        const { data: priceData, error: priceError } = await db
          .from("stock_returns_c")
          .select("current_price")
          .eq("security_id", securityId)
          .order("as_of_date", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!priceError && priceData?.current_price) {
          currentPriceCents = Number(priceData.current_price);
        }
      }

      const currentPriceRands = currentPriceCents ? currentPriceCents / 100 : (shareCount > 0 ? investAmount / shareCount : 0);
      
      // Prioritize shareCount from frontend if available, otherwise calculate from price
      if (shareCount && Number(shareCount) > 0) {
        quantity = Math.floor(Number(shareCount));
      } else {
        quantity = currentPriceRands > 0 ? Math.floor(investAmount / currentPriceRands) : 1;
      }
      if (quantity <= 0) quantity = 1; 

      const avgFillCents = currentPriceCents || Math.round((investAmount / quantity) * 100);
      const marketValueCents = Math.round(quantity * (currentPriceCents || (avgFillCents)));


      const { data: existing, error: fetchError } = await db
        .from("stock_holdings_c")
        .select("id, quantity, avg_fill, market_value")
        .eq("user_id", userId)
        .eq("security_id", securityId)
        .maybeSingle();

      if (fetchError) {
        return res.status(500).json({ success: false, error: fetchError.message });
      }

      if (existing) {
        const oldQty = Number(existing.quantity || 0);
        const oldAvgFill = Number(existing.avg_fill || 0);
        const newQty = Math.floor(oldQty + quantity);
        const newAvgFill = newQty > 0 ? ((oldAvgFill * oldQty) + (avgFillCents * quantity)) / newQty : avgFillCents;
        const newMarketValue = Math.round(newQty * (currentPriceCents || newAvgFill));
        const { data, error } = await db
          .from("stock_holdings_c")
          .update({
            quantity: newQty,
            avg_fill: Math.round(newAvgFill),
            market_value: newMarketValue,
            as_of_date: new Date().toISOString().split("T")[0],
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .select();
        holdingResult = { data, error };
      } else {
        const { data, error } = await db
          .from("stock_holdings_c")
          .insert({
            user_id: userId,
            security_id: securityId,
            quantity: quantity,
            avg_fill: avgFillCents,
            market_value: marketValueCents,
            unrealized_pnl: 0,
            as_of_date: new Date().toISOString().split("T")[0],
            Status: "active",
            strategy_id: strategyId || null,
          })
          .select();
        holdingResult = { data, error };
      }

      if (holdingResult.error) {
        return res.status(500).json({ success: false, error: holdingResult.error.message });
      }
    }

    const descriptionText = isStrategyInvestment
      ? `Invested in strategy ${name || "Strategy"}`
      : `Purchased ${(holdingResult.data ? "shares" : "units")} of ${name || symbol || "Unknown"}`;

    const orderDate = new Date().toISOString();

    const { error: txError } = await db
      .from("transactions")
      .insert({
        user_id: userId,
        direction: "debit",
        name: isStrategyInvestment ? `Strategy Investment: ${name || symbol || "Strategy"}` : `Purchased ${name || symbol || "Stock"}`,
        description: descriptionText,
        amount: Math.round(amount * 100),
        store_reference: paymentReference || null,
        currency: "ZAR",
        status: "posted",
        transaction_date: orderDate,
        created_at: orderDate,
      })
      .select();

    if (txError) {
      console.error("[record-investment] Transaction insert error:", txError);
      return res.status(500).json({ success: false, error: "Failed to record transaction" });
    }

    sendOrderConfirmationEmail(db, {
      userId,
      userEmail: user.email,
      assetName: name || null,
      assetSymbol: symbol || null,
      strategyName: isStrategyInvestment ? (name || symbol || "Strategy") : null,
      amountCents: Math.round(amount * 100),
      quantity: quantity ? Math.floor(quantity) : null,
      priceCents: currentPriceCents,
      reference: paymentReference,
      orderDate,
      paymentMethod,
    }).catch(() => {});

    return res.status(200).json({ 
      success: true, 
      holding: holdingResult.data,
      newWalletBalance: paymentMethod === "wallet" ? newWalletBalance : null
    });
  } catch (error) {
    console.error("[record-investment] Error:", error);

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

    return res.status(500).json({ success: false, error: error.message || "Failed to record investment" });
  }
}
