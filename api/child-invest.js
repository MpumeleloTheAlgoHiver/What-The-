import { supabase, supabaseAdmin, authenticateUser } from "./_lib/supabase.js";
import { Resend } from "resend";

function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

function buildInvestmentHtml(parentName, childName, strategyName, amountRands, newBalanceRands) {
  const fmt = (v) => `R${Number(v).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:40px 24px;">
  <div style="background:white;border-radius:24px;padding:40px 32px;">
    <div style="text-align:center;margin-bottom:32px;">
      <div style="font-size:28px;font-weight:800;color:#1e1b4b;margin-bottom:4px;">mint</div>
      <div style="color:#94a3b8;font-size:13px;">Family Investing</div>
    </div>
    <p style="color:#334155;font-size:15px;line-height:1.6;margin-bottom:8px;">Hi ${parentName},</p>
    <p style="color:#334155;font-size:15px;line-height:1.6;margin-bottom:24px;">
      You've successfully invested <strong style="color:#7c3aed;">${fmt(amountRands)}</strong> into <strong>${strategyName}</strong> on behalf of <strong>${childName}</strong>.
    </p>
    <div style="background:#f8fafc;border-radius:16px;padding:20px 24px;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="color:#64748b;font-size:13px;padding:6px 0;">Amount invested</td>
          <td style="color:#1e1b4b;font-size:13px;font-weight:700;text-align:right;">${fmt(amountRands)}</td>
        </tr>
        <tr>
          <td style="color:#64748b;font-size:13px;padding:6px 0;">Strategy</td>
          <td style="color:#475569;font-size:13px;text-align:right;">${strategyName}</td>
        </tr>
        <tr style="border-top:1px solid #e2e8f0;">
          <td style="color:#1e1b4b;font-size:14px;font-weight:700;padding:10px 0 6px;">Remaining wallet balance</td>
          <td style="color:#059669;font-size:14px;font-weight:700;text-align:right;padding:10px 0 6px;">${fmt(newBalanceRands)}</td>
        </tr>
      </table>
    </div>
    <div style="background:#ede9fe;border-left:4px solid #7c3aed;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
      <p style="color:#4c1d95;font-size:14px;font-weight:700;margin:0 0 6px;">📈 ${childName}'s portfolio is growing!</p>
      <p style="color:#5b21b6;font-size:13px;line-height:1.6;margin:0;">
        ${childName} is now invested in ${strategyName}. Track their portfolio performance on Mint anytime.
      </p>
    </div>
    <div style="text-align:center;">
      <a href="https://mymint.co.za" style="display:inline-block;background:linear-gradient(135deg,#1e1b4b,#312e81);color:white;padding:14px 40px;border-radius:14px;text-decoration:none;font-weight:700;font-size:15px;">View ${childName}'s Portfolio</a>
    </div>
    <p style="color:#94a3b8;font-size:11px;text-align:center;margin-top:24px;">Mint — Smart investing for South African families</p>
  </div>
</div></body></html>`;
}

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
      .select("id, name, holdings, min_investment, status, is_kid_strategy")
      .eq("id", strategy_id)
      .maybeSingle();

    if (stratErr) throw stratErr;
    if (!strategy) return res.status(404).json({ error: "Strategy not found." });
    if (strategy.status !== "active") return res.status(400).json({ error: "This strategy is no longer active." });
    if (!strategy.is_kid_strategy) return res.status(400).json({ error: "This strategy is not available for child accounts." });
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
    const strategyHoldings = strategy.holdings || [];
    let holdingsCreated = 0;

    if (strategyHoldings.length > 0) {
      // Fetch security prices (include logo_url, symbol, name for display)
      const symbols = strategyHoldings.map(h => h.symbol).filter(Boolean);
      const { data: securities } = await db
        .from("securities_c")
        .select("id, symbol, name, last_price, logo_url")
        .in("symbol", symbols);

      const secMap = {};
      (securities || []).forEach(s => { secMap[s.symbol] = s; });

      // Calculate total basket cost for proportional allocation
      let totalBasketCostRands = 0;
      for (const h of strategyHoldings) {
        const sec = secMap[h.symbol];
        if (sec?.last_price) {
          totalBasketCostRands += sec.last_price * (h.weight || 1);
        }
      }

      if (totalBasketCostRands > 0) {
        const scale = investAmountRands / totalBasketCostRands;

        for (const h of strategyHoldings) {
          const sec = secMap[h.symbol];
          if (!sec?.last_price) continue;

          const qty = Math.floor((h.weight || 1) * scale);
          if (qty <= 0) continue;

          // All monetary values stored in CENTS
          const avgFillCents = Math.round(sec.last_price * 100);
          const marketValueCents = Math.round(qty * sec.last_price * 100);

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
              const oldAvgFillCents = Number(existing.avg_fill || 0);
              const newQty = oldQty + qty;
              const newAvgFillCents = newQty > 0
                ? Math.round((oldAvgFillCents * oldQty + avgFillCents * qty) / newQty)
                : avgFillCents;

              await db
                .from("stock_holdings_c")
                .update({
                  quantity: newQty,
                  avg_fill: newAvgFillCents,
                  market_value: Math.round(newQty * sec.last_price * 100),
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
                  symbol: sec.symbol,
                  name: sec.name,
                  logo_url: sec.logo_url || null,
                  quantity: qty,
                  avg_fill: avgFillCents,
                  market_value: marketValueCents,
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

    // Fallback: if no individual holdings were created, insert a single strategy-level placeholder
    // so the strategy card still appears on the child dashboard
    if (holdingsCreated === 0) {
      try {
        await db.from("stock_holdings_c").insert({
          user_id: parentUserId,
          family_member_id: family_member_id,
          security_id: null,
          symbol: strategy.name,
          name: strategy.name,
          logo_url: null,
          quantity: 1,
          avg_fill: amount,
          market_value: amount,
          unrealized_pnl: 0,
          as_of_date: new Date().toISOString().split("T")[0],
          strategy_id: strategy_id,
          Status: "active",
        });
        holdingsCreated = 1;
      } catch (e) {
        console.warn("[child-invest] fallback holding insert failed:", e.message);
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

    // 7. Send investment confirmation email to parent
    const resend = getResend();
    if (resend) {
      try {
        const { data: parentProfile } = await db
          .from("profiles")
          .select("first_name, last_name, email")
          .eq("id", parentUserId)
          .maybeSingle();

        const parentEmail = parentProfile?.email;
        if (parentEmail) {
          const parentName = [parentProfile.first_name, parentProfile.last_name].filter(Boolean).join(" ") || "there";
          const amountRands = amount / 100;
          const newBalanceRands = newChildBalance / 100;
          await resend.emails.send({
            from: "Mint <noreply@mymint.co.za>",
            to: [parentEmail],
            subject: `R${amountRands.toFixed(2)} invested in ${strategy.name} for ${child.first_name}`,
            html: buildInvestmentHtml(parentName, child.first_name, strategy.name, amountRands, newBalanceRands),
          });
        }
      } catch (emailErr) {
        console.error("[child-invest] Investment email failed:", emailErr.message);
      }
    }

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
