import { supabase, supabaseAdmin, authenticateUser } from "./_lib/supabase.js";

/**
 * Child Investment API
 *
 * POST /api/child-invest
 * body: { family_member_id, strategy_id, amount }
 *   → amount is in cents
 *   → deducts from child's available_balance
 *   → places strategy investment creating stock_holdings_c with family_member_id
 */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const db = supabaseAdmin || supabase;
  if (!db) return res.status(500).json({ error: "Database not available." });

  const { family_member_id, strategy_id, amount } = req.body || {};

  if (!family_member_id) return res.status(400).json({ error: "family_member_id is required." });
  if (!strategy_id) return res.status(400).json({ error: "strategy_id is required." });
  if (!amount || typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({ error: "Amount must be a positive number (in cents)." });
  }

  // Authenticate parent — authenticateUser returns { user, error }
  let parentUserId;
  try {
    const { user } = await authenticateUser(req);
    parentUserId = user?.id;
  } catch {}
  if (!parentUserId) {
    try {
      const { data: fm } = await db
        .from("family_members")
        .select("primary_user_id")
        .eq("id", family_member_id)
        .maybeSingle();
      parentUserId = fm?.primary_user_id;
    } catch {}
  }
  if (!parentUserId) return res.status(401).json({ error: "Could not identify parent." });

  let originalChildBalance = null;

  try {
    // 1. Verify child belongs to parent
    const { data: child, error: childErr } = await db
      .from("family_members")
      .select("id, primary_user_id, available_balance, first_name, relationship")
      .eq("id", family_member_id)
      .maybeSingle();

    if (childErr) throw childErr;
    if (!child) return res.status(404).json({ error: "Child account not found." });
    if (child.relationship !== "child") return res.status(400).json({ error: "Investments only supported for child accounts." });
    if (child.primary_user_id !== parentUserId) {
      return res.status(403).json({ error: "You can only invest for your own children." });
    }

    // 2. Check child balance
    originalChildBalance = child.available_balance || 0;
    if (originalChildBalance < amount) {
      return res.status(400).json({ error: "Insufficient funds in child's wallet. Transfer funds first." });
    }

    // 3. Fetch strategy + holdings
    const { data: strategy, error: stratErr } = await db
      .from("strategies_c")
      .select("id, name, holdings, min_investment, is_active")
      .eq("id", strategy_id)
      .maybeSingle();

    if (stratErr) throw stratErr;
    if (!strategy) return res.status(404).json({ error: "Strategy not found." });
    if (!strategy.is_active) return res.status(400).json({ error: "This strategy is no longer active." });
    if (strategy.min_investment && amount < strategy.min_investment) {
      return res.status(400).json({ error: `Minimum investment is R${(strategy.min_investment / 100).toFixed(2)}.` });
    }

    // 4. Deduct from child balance
    const newChildBalance = originalChildBalance - amount;
    const { error: deductErr } = await db
      .from("family_members")
      .update({ available_balance: newChildBalance })
      .eq("id", family_member_id);
    if (deductErr) throw deductErr;

    // 5. Build holdings from strategy basket
    const investAmountRands = amount / 100;
    const holdings = strategy.holdings || [];
    let holdingsCreated = 0;

    if (holdings.length > 0) {
      // Fetch security prices
      const symbols = holdings.map(h => h.symbol).filter(Boolean);
      const { data: securities } = await db
        .from("securities_c")
        .select("id, symbol, name, last_price")
        .in("symbol", symbols);

      const secMap = {};
      (securities || []).forEach(s => { secMap[s.symbol] = s; });

      // Calculate total basket cost for proportional allocation
      let totalBasketCostRands = 0;
      for (const h of holdings) {
        const sec = secMap[h.symbol];
        if (sec?.last_price) {
          totalBasketCostRands += sec.last_price * (h.weight || 1);
        }
      }

      if (totalBasketCostRands > 0) {
        const scale = investAmountRands / totalBasketCostRands;

        for (const h of holdings) {
          const sec = secMap[h.symbol];
          if (!sec?.last_price) continue;

          const qty = Math.floor((h.weight || 1) * scale);
          const marketValue = Math.round(qty * sec.last_price); // cents
          if (qty <= 0) continue;

          // Upsert stock_holding for child
          try {
            const { data: existing } = await db
              .from("stock_holdings_c")
              .select("id, quantity, avg_fill")
              .eq("family_member_id", family_member_id)
              .eq("security_id", sec.id)
              .eq("strategy_id", strategy_id)
              .maybeSingle();

            if (existing) {
              const oldQty = Number(existing.quantity || 0);
              const oldAvgFill = Number(existing.avg_fill || 0);
              const newQty = Math.floor(oldQty + qty);
              const newAvgFill = newQty > 0
                ? ((oldAvgFill * oldQty) + (sec.last_price * qty)) / newQty
                : sec.last_price;

              await db
                .from("stock_holdings_c")
                .update({
                  quantity: newQty,
                  avg_fill: Math.round(newAvgFill),
                  market_value: newQty * sec.last_price,
                  unrealized_pnl: 0,
                  as_of_date: new Date().toISOString().split("T")[0],
                  updated_at: new Date().toISOString(),
                })
                .eq("id", existing.id);
            } else {
              await db
                .from("stock_holdings_c")
                .insert({
                  user_id: parentUserId,
                  family_member_id: family_member_id,
                  security_id: sec.id,
                  quantity: qty,
                  avg_fill: sec.last_price,
                  market_value: marketValue,
                  unrealized_pnl: 0,
                  as_of_date: new Date().toISOString().split("T")[0],
                  strategy_id: strategy_id,
                  Status: "active",
                });
            }
            holdingsCreated++;
          } catch (e) {
            console.warn(`[child-invest] holding upsert for ${h.symbol}:`, e.message);
          }
        }
      }
    }

    // 6. Record transaction
    const ref = `CHILD-INV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await db.from("transactions").insert({
        user_id: parentUserId,
        family_member_id: family_member_id,
        type: "investment",
        direction: "debit",
        amount: amount,
        description: `${strategy.name} investment for ${child.first_name}`,
        store_reference: ref,
        status: "completed",
      });
    } catch (e) { console.warn("[child-invest] tx insert:", e.message); }

    return res.json({
      success: true,
      child_balance: newChildBalance,
      holdings_created: holdingsCreated,
      strategy_name: strategy.name,
      transaction_ref: ref,
    });
  } catch (e) {
    console.error("[child-invest] error:", e.message);

    // Rollback child balance if we deducted
    if (originalChildBalance !== null) {
      try {
        await db
          .from("family_members")
          .update({ available_balance: originalChildBalance })
          .eq("id", family_member_id);
      } catch (rb) { console.error("[child-invest] rollback failed:", rb.message); }
    }

    return res.status(500).json({ error: "Investment failed. Please try again." });
  }
}
