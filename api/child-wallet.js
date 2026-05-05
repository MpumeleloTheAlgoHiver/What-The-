import { supabase, supabaseAdmin, authenticateUser } from "./_lib/supabase.js";
import { Resend } from "resend";

function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

function buildTransferHtml(parentName, childName, amountRands, prevBalanceRands, newBalanceRands) {
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
      You've successfully transferred <strong style="color:#7c3aed;">${fmt(amountRands)}</strong> to <strong>${childName}</strong>'s wallet.
    </p>
    <div style="background:#f8fafc;border-radius:16px;padding:20px 24px;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="color:#64748b;font-size:13px;padding:6px 0;">Amount transferred</td>
          <td style="color:#1e1b4b;font-size:13px;font-weight:700;text-align:right;">${fmt(amountRands)}</td>
        </tr>
        <tr>
          <td style="color:#64748b;font-size:13px;padding:6px 0;">Previous balance</td>
          <td style="color:#475569;font-size:13px;text-align:right;">${fmt(prevBalanceRands)}</td>
        </tr>
        <tr style="border-top:1px solid #e2e8f0;">
          <td style="color:#1e1b4b;font-size:14px;font-weight:700;padding:10px 0 6px;">New balance</td>
          <td style="color:#059669;font-size:14px;font-weight:700;text-align:right;padding:10px 0 6px;">${fmt(newBalanceRands)}</td>
        </tr>
      </table>
    </div>
    <div style="background:#f0fdf4;border-left:4px solid #059669;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
      <p style="color:#065f46;font-size:14px;font-weight:700;margin:0 0 6px;">🎯 ${childName} is ready to invest!</p>
      <p style="color:#047857;font-size:13px;line-height:1.6;margin:0;">
        ${childName} now has ${fmt(newBalanceRands)} in their wallet. Browse child-friendly strategies on Mint and start growing their wealth today.
      </p>
    </div>
    <div style="text-align:center;">
      <a href="https://mymint.co.za" style="display:inline-block;background:linear-gradient(135deg,#1e1b4b,#312e81);color:white;padding:14px 40px;border-radius:14px;text-decoration:none;font-weight:700;font-size:15px;">Invest for ${childName}</a>
    </div>
    <p style="color:#94a3b8;font-size:11px;text-align:center;margin-top:24px;">Mint — Smart investing for South African families</p>
  </div>
</div></body></html>`;
}

/**
 * Child Wallet API
 *
 * GET  /api/child-wallet?family_member_id=xxx
 *   → { balance, mint_number }
 *
 * POST /api/child-wallet
 *   body: { action: "transfer", family_member_id, amount }
 *   → { success, child_balance, parent_balance, transaction_ref }
 */

export default async function handler(req, res) {
  const db = supabaseAdmin || supabase;
  if (!db) return res.status(500).json({ error: "Database not available." });

  // ── GET: read child balance ────────────────────────────────────────────
  if (req.method === "GET") {
    const { family_member_id } = req.query || {};
    if (!family_member_id) return res.status(400).json({ error: "family_member_id is required." });

    try {
      const { data, error } = await db
        .from("family_members")
        .select("id, available_balance, mint_number, first_name")
        .eq("id", family_member_id)
        .maybeSingle();

      if (error) throw error;
      if (!data) return res.status(404).json({ error: "Child account not found." });

      return res.json({
        balance: data.available_balance || 0,
        mint_number: data.mint_number,
        first_name: data.first_name,
      });
    } catch (e) {
      console.error("[child-wallet] GET error:", e.message);
      return res.status(500).json({ error: "Failed to fetch balance." });
    }
  }

  // ── POST: transfer funds from parent to child ─────────────────────────
  if (req.method === "POST") {
    const { action, family_member_id, amount } = req.body || {};

    if (action !== "transfer") {
      return res.status(400).json({ error: 'Only action "transfer" is supported.' });
    }
    if (!family_member_id) return res.status(400).json({ error: "family_member_id is required." });

    const amountCents = Number(amount);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return res.status(400).json({ error: "Amount must be a positive integer (in cents)." });
    }

    // Authenticate parent — authenticateUser returns { user, error }
    let parentUserId;
    try {
      const { user } = await authenticateUser(req);
      parentUserId = user?.id;
    } catch {}
    if (!parentUserId) {
      // Fallback: look up from family_member's primary_user_id
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

    // Keep original balances for rollback
    let originalParentBalance = null;
    let originalChildBalance = null;

    try {
      const transferRef = `CHILD-TRF-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // 1. Read child record and verify ownership
      const { data: child, error: childErr } = await db
        .from("family_members")
        .select("id, primary_user_id, available_balance, first_name, relationship")
        .eq("id", family_member_id)
        .maybeSingle();

      if (childErr) throw childErr;
      if (!child) return res.status(404).json({ error: "Child account not found." });
      if (child.relationship !== "child") {
        return res.status(400).json({ error: "Transfers are only supported for child accounts." });
      }
      if (child.primary_user_id !== parentUserId) {
        return res.status(403).json({ error: "You can only transfer to your own children." });
      }

      originalChildBalance = child.available_balance || 0;

      // 2. Read parent wallet (balance is in RANDS)
      const { data: wallet, error: walletErr } = await db
        .from("wallets")
        .select("balance")
        .eq("user_id", parentUserId)
        .maybeSingle();

      if (walletErr) throw walletErr;
      if (!wallet) return res.status(404).json({ error: "Parent wallet not found." });

      const parentBalanceCents = Math.round(Number(wallet.balance) * 100);
      originalParentBalance = Number(wallet.balance);

      if (parentBalanceCents < amountCents) {
        return res.status(400).json({ error: "Insufficient wallet balance." });
      }

      // 3. Deduct from parent wallet (convert cents → rands for wallets table)
      const newParentBalanceRands = (parentBalanceCents - amountCents) / 100;
      const { error: deductErr } = await db
        .from("wallets")
        .update({ balance: newParentBalanceRands, updated_at: new Date().toISOString() })
        .eq("user_id", parentUserId);

      if (deductErr) throw deductErr;

      // 4. Credit child's available_balance (in cents)
      const newChildBalanceCents = originalChildBalance + amountCents;
      const { error: creditErr } = await db
        .from("family_members")
        .update({ available_balance: newChildBalanceCents })
        .eq("id", family_member_id);

      if (creditErr) {
        // Rollback parent wallet
        await db.from("wallets").update({ balance: originalParentBalance }).eq("user_id", parentUserId);
        throw creditErr;
      }

      // 5. Record transactions (amounts in cents)
      const { error: txErr } = await db.from("transactions").insert([
        {
          user_id: parentUserId,
          family_member_id: family_member_id,
          type: "transfer_out",
          direction: "debit",
          amount: amountCents,
          description: `Transfer to ${child.first_name || "child"}'s account`,
          store_reference: transferRef,
          status: "completed",
        },
        {
          user_id: parentUserId,
          family_member_id: family_member_id,
          type: "transfer_in",
          direction: "credit",
          amount: amountCents,
          description: "Received from parent",
          store_reference: transferRef,
          status: "completed",
        },
      ]);

      if (txErr) {
        console.error("[child-wallet] Transaction insert failed (transfer still applied):", txErr.message);
        // Don't rollback — money moved, just log the missing records
      }

      // Send transfer notification email to parent
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
            const amountRands = amountCents / 100;
            const prevBalanceRands = originalChildBalance / 100;
            const newBalanceRands = newChildBalanceCents / 100;
            await resend.emails.send({
              from: "Mint <noreply@mymint.co.za>",
              to: [parentEmail],
              subject: `R${amountRands.toFixed(2)} transferred to ${child.first_name}'s Mint wallet`,
              html: buildTransferHtml(parentName, child.first_name, amountRands, prevBalanceRands, newBalanceRands),
            });
          }
        } catch (emailErr) {
          console.error("[child-wallet] Transfer email failed:", emailErr.message);
        }
      }

      return res.json({
        success: true,
        child_balance: newChildBalanceCents,
        parent_balance: Math.round(newParentBalanceRands * 100),
        transaction_ref: transferRef,
      });
    } catch (e) {
      console.error("[child-wallet] POST error:", e.message);
      return res.status(500).json({ error: "Transfer failed. Please try again." });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed." });
}
