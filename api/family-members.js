import { supabase, supabaseAdmin, authenticateUser, getClient } from "./_lib/supabase.js";
import { Resend } from "resend";

/* ── helpers ─────────────────────────────────────────────────────────────── */

function isValidUuid(str) {
  return typeof str === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function generateChildMintNumber(firstName, idNumber, dateOfBirth) {
  const normalized = (firstName || "CHD").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const namePart = normalized.toUpperCase().replace(/[^A-Z]/g, "").padEnd(3, "X").substring(0, 3);

  let idPart = "0000";
  const cleanId = String(idNumber || "").replace(/\D/g, "");
  if (cleanId.length >= 10) {
    idPart = cleanId.substring(6, 10);
  } else if (cleanId.length >= 4) {
    idPart = cleanId.slice(-4).padStart(4, "0");
  } else if (dateOfBirth) {
    const dob = new Date(dateOfBirth);
    if (!isNaN(dob.getTime())) {
      const mm = String(dob.getMonth() + 1).padStart(2, "0");
      const yy = String(dob.getFullYear()).slice(-2);
      idPart = mm + yy;
    }
  }

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);

  return namePart + idPart + dd + mm + yy;
}

function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

function maskEmail(email) {
  if (!email || !email.includes("@")) return "***";
  const [local, domain] = email.split("@");
  return `${local.length > 1 ? local[0] + "***" : "***"}@${domain}`;
}

function buildInviteHtml(inviterName) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:40px 24px;">
  <div style="background:white;border-radius:24px;padding:40px 32px;text-align:center;">
    <div style="font-size:28px;font-weight:800;color:#1e1b4b;margin-bottom:8px;">mint</div>
    <div style="color:#94a3b8;font-size:13px;margin-bottom:32px;">Family Investing</div>
    <p style="color:#334155;font-size:15px;line-height:1.6;margin-bottom:24px;">
      <strong>${inviterName}</strong> wants to link you as their spouse on Mint — the smart investing platform for South African families.
    </p>
    <p style="color:#334155;font-size:15px;line-height:1.6;margin-bottom:32px;">
      Sign up to start investing together and manage your family&rsquo;s wealth in one place.
    </p>
    <a href="https://mymint.co.za" style="display:inline-block;background:linear-gradient(135deg,#1e1b4b,#312e81);color:white;padding:14px 40px;border-radius:14px;text-decoration:none;font-weight:700;font-size:15px;">Join Mint</a>
    <p style="color:#94a3b8;font-size:11px;margin-top:24px;">If you weren&rsquo;t expecting this invite, you can safely ignore this email.</p>
  </div>
</div></body></html>`;
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

async function findExistingUserByIdNumber(db, idNumber) {
  const { data: profileRow, error: profileErr } = await db
    .from("profiles")
    .select("id, first_name, last_name, email, id_number")
    .eq("id_number", idNumber)
    .maybeSingle();

  if (!profileErr && profileRow) {
    return { match: profileRow };
  }

  const { data: onboardingRow, error: onboardingErr } = await db
    .from("user_onboarding")
    .select("id, user_id, first_name, last_name, email, id_number")
    .eq("id_number", idNumber)
    .maybeSingle();

  if (!onboardingErr && onboardingRow) {
    const linkedUserId = onboardingRow.user_id || onboardingRow.id || null;
    if (!linkedUserId) return { match: null };

    const { data: linkedProfile } = await db
      .from("profiles")
      .select("id, first_name, last_name, email")
      .eq("id", linkedUserId)
      .maybeSingle();

    return {
      match: {
        id: linkedUserId,
        first_name: linkedProfile?.first_name || onboardingRow.first_name || "",
        last_name: linkedProfile?.last_name || onboardingRow.last_name || "",
        email: linkedProfile?.email || onboardingRow.email || null,
      },
    };
  }

  return { match: null };
}

async function checkKycComplete(db, userId) {
  const { data: onboarding } = await db
    .from("user_onboarding")
    .select("kyc_status")
    .eq("user_id", userId)
    .maybeSingle();

  if (!onboarding) return false;
  const status = onboarding.kyc_status || "";
  return status === "approved" || status === "onboarding_complete" || status === "verified";
}

/* ── handler ──────────────────────────────────────────────────────────────── */

export default async function handler(req, res) {
  const db = getClient(req);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (!db) return res.status(500).json({ error: "Database not connected" });

  // ── GET /api/family-members?user_id=xxx ──────────────────────────────────
  if (req.method === "GET") {
    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: "user_id required" });
    try {
      const { data, error } = await db
        .from("family_members")
        .select("*")
        .eq("primary_user_id", userId)
        .order("created_at", { ascending: true });
      if (error) throw error;

      const members = data || [];
      const spouseLinkedUserIds = members
        .filter((m) => m.relationship === "spouse" && isValidUuid(m.linked_user_id))
        .map((m) => m.linked_user_id);

      if (spouseLinkedUserIds.length > 0) {
        const { data: spouseWallets, error: spouseWalletErr } = await db
          .from("wallets")
          .select("user_id, mint_number")
          .in("user_id", spouseLinkedUserIds);

        if (!spouseWalletErr && spouseWallets?.length) {
          const spouseMintByUserId = new Map(
            spouseWallets
              .filter((w) => w?.user_id && w?.mint_number)
              .map((w) => [w.user_id, w.mint_number])
          );

          const enrichedMembers = members.map((member) => {
            if (member.relationship !== "spouse" || !member.linked_user_id) return member;
            const actualMint = spouseMintByUserId.get(member.linked_user_id);
            if (!actualMint) return member;
            return { ...member, mint_number: actualMint };
          });

          return res.json({ members: enrichedMembers });
        }
      }

      return res.json({ members });
    } catch (e) {
      console.error("[family] GET error:", e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST /api/family-members ─────────────────────────────────────────────
  if (req.method === "POST") {
    const {
      primary_user_id, relationship, first_name, last_name,
      date_of_birth, email, certificate_url,
    } = req.body || {};

    if (!primary_user_id || !relationship) {
      return res.status(400).json({ error: "primary_user_id and relationship required" });
    }
    if (!["spouse", "child"].includes(relationship)) {
      return res.status(400).json({ error: "relationship must be spouse or child" });
    }

    const { id_number, certificate_verification_status } = req.body || {};

    try {
      /* ──────────────── SPOUSE ──────────────── */
      if (relationship === "spouse") {

        if (!id_number?.trim()) {
          return res.status(400).json({ error: "A 13-digit South African ID number is required." });
        }
        const cleanId = String(id_number).replace(/\D/g, "");
        if (cleanId.length !== 13) {
          return res.status(400).json({ error: "ID number must be exactly 13 digits." });
        }
        if (email && !email.includes("@")) {
          return res.status(400).json({ error: "If provided, email must be valid." });
        }

        // Already have a spouse?
        const { data: existingSpouse } = await db
          .from("family_members")
          .select("id")
          .eq("primary_user_id", primary_user_id)
          .eq("relationship", "spouse")
          .maybeSingle();
        if (existingSpouse) {
          return res.status(409).json({ error: "A spouse is already linked to this account." });
        }

        // Look up by ID number
        const { match: matchedProfile } = await findExistingUserByIdNumber(db, cleanId);

        if (matchedProfile) {
          // Prevent self-linking
          if (matchedProfile.id === primary_user_id) {
            return res.status(400).json({ error: "You cannot add yourself as a spouse." });
          }

          // Check KYC status
          const kycComplete = await checkKycComplete(db, matchedProfile.id);

          // Fetch their real mint number from wallet
          let spouseMintNumber = null;
          const { data: walletRow } = await db
            .from("wallets")
            .select("mint_number")
            .eq("user_id", matchedProfile.id)
            .maybeSingle();
          spouseMintNumber = walletRow?.mint_number || null;

          if (!spouseMintNumber) {
            const rand = Math.floor(1000000 + Math.random() * 9000000);
            spouseMintNumber = `SPO${String(rand).padStart(10, "0")}`;
          }

          const normalizedEmail = email?.toLowerCase().trim() || null;
          const insertPayload = {
            primary_user_id,
            relationship: "spouse",
            first_name: matchedProfile.first_name || "",
            last_name: matchedProfile.last_name || "",
            spouse_email: normalizedEmail || matchedProfile.email || null,
            mint_number: spouseMintNumber,
          };

          // Try with linked_user_id + kyc_pending (columns may not exist yet)
          let member = null;
          const { data: d1, error: e1 } = await db
            .from("family_members")
            .insert({ ...insertPayload, linked_user_id: matchedProfile.id, kyc_pending: !kycComplete })
            .select()
            .single();

          if (e1 && (e1.message?.includes("linked_user_id") || e1.message?.includes("kyc_pending"))) {
            const { data: d2, error: e2 } = await db
              .from("family_members")
              .insert({ ...insertPayload, linked_user_id: matchedProfile.id })
              .select()
              .single();
            if (e2 && e2.message?.includes("linked_user_id")) {
              const { data: d3, error: e3 } = await db
                .from("family_members")
                .insert(insertPayload)
                .select()
                .single();
              if (e3) throw e3;
              member = d3;
            } else if (e2) {
              throw e2;
            } else {
              member = d2;
            }
          } else if (e1) {
            throw e1;
          } else {
            member = d1;
          }

          // Attach kyc_pending to response so UI can show pending icon
          const memberWithKyc = { ...member, kyc_pending: !kycComplete };
          return res.status(201).json({ member: memberWithKyc, linked: true, kyc_pending: !kycComplete });
        }

        /* ── user NOT found → send invite email ── */
        const normalizedEmail = email?.toLowerCase().trim() || null;
        if (!normalizedEmail) {
          return res.status(404).json({
            not_found: true,
            error: "No Mint account found for that ID number. Provide their email address to send them an invite.",
          });
        }

        const { data: inviterProfile } = await db
          .from("profiles")
          .select("first_name, last_name")
          .eq("id", primary_user_id)
          .maybeSingle();
        const inviterName =
          [inviterProfile?.first_name, inviterProfile?.last_name].filter(Boolean).join(" ") || "Your partner";

        let emailSent = false;
        const resend = getResend();
        if (resend) {
          try {
            await resend.emails.send({
              from: "Mint <noreply@mymint.co.za>",
              to: [normalizedEmail],
              subject: `${inviterName} has invited you to join Mint`,
              html: buildInviteHtml(inviterName),
            });
            emailSent = true;
          } catch (emailErr) {
            console.error("[family] Invite email failed:", emailErr.message);
          }
        } else {
          console.warn("[family] RESEND_API_KEY not set — cannot send spouse invite");
        }

        const masked = maskEmail(normalizedEmail);
        return res.status(200).json({
          invited: true,
          email_sent: emailSent,
          masked_email: masked,
          message: emailSent
            ? `Invitation sent to ${masked}. Once they sign up on Mint, you can link them as your spouse.`
            : `${masked} is not on Mint yet. Please ask them to sign up at mymint.co.za, then try linking again.`,
        });
      }

      /* ──────────────── CHILD ──────────────── */
      if (relationship === "child") {
        if (!first_name?.trim()) {
          return res.status(400).json({ error: "First name is required." });
        }
        if (!date_of_birth) {
          return res.status(400).json({ error: "Date of birth is required for a child." });
        }
        if (!certificate_url) {
          return res.status(400).json({ error: "Unabridged birth certificate is required." });
        }

        const cleanChildId = id_number ? String(id_number).replace(/\D/g, "") : null;
        const mint_number = generateChildMintNumber(first_name.trim(), cleanChildId, date_of_birth);
        const verificationStatus = certificate_verification_status || "pending_review";
        const { user: authUser } = await authenticateUser(req);
        const parentIdForChild = authUser?.id || primary_user_id;

        const basePayload = {
          primary_user_id,
          parent_id: parentIdForChild,
          relationship: "child",
          first_name: first_name.trim(),
          last_name: (last_name || "").trim(),
          date_of_birth,
          certificate_uploaded_at: new Date().toISOString(),
          mint_number,
        };

        // Try to insert with all optional columns, fall back gracefully
        const fullPayload = {
          ...basePayload,
          certificate_url,
          certificate_verification_status: verificationStatus,
          ...(cleanChildId ? { id_number: cleanChildId } : {}),
        };

        const { data: d1, error: e1 } = await db
          .from("family_members")
          .insert(fullPayload)
          .select()
          .single();

        if (e1) {
          // Graceful fallback: strip unknown columns one by one
          const { data: d2, error: e2 } = await db
            .from("family_members")
            .insert({ ...basePayload, certificate_url })
            .select()
            .single();
          if (e2 && e2.message?.includes("certificate_url")) {
            const { data: d3, error: e3 } = await db
              .from("family_members")
              .insert(basePayload)
              .select()
              .single();
            if (e3) throw e3;
            return res.status(201).json({ member: d3 });
          } else if (e2) { throw e2; }
          return res.status(201).json({ member: d2 });
        }

        return res.status(201).json({ member: d1 });
      }
    } catch (e) {
      console.error("[family] POST error:", e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── PATCH /api/family-members/{id} ────────────────────────────────────────
  if (req.method === "PATCH") {
    const { user: authUser } = await authenticateUser(req);
    if (!authUser) return res.status(401).json({ error: "Unauthorized" });

    const memberId = req.url.split("/").pop();
    if (!memberId || memberId === "family-members") {
      return res.status(400).json({ error: "member_id required in URL" });
    }

    const updatePayload = req.body || {};

    try {
      const { data: member, error: fetchErr } = await db
        .from("family_members")
        .select("primary_user_id")
        .eq("id", memberId)
        .maybeSingle();

      if (fetchErr || !member) {
        return res.status(404).json({ error: "Family member not found" });
      }

      if (member.primary_user_id !== authUser.id) {
        return res.status(403).json({ error: "Not authorized to update this member" });
      }

      const { data: updated, error: updateErr } = await db
        .from("family_members")
        .update(updatePayload)
        .eq("id", memberId)
        .select()
        .single();

      if (updateErr) throw updateErr;

      return res.json(updated);
    } catch (e) {
      console.error("[family] PATCH error:", e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── DELETE /api/family-members ────────────────────────────────────────────
  if (req.method === "DELETE") {
    const { member_id, primary_user_id } = req.body || {};
    if (!member_id || !primary_user_id) {
      return res.status(400).json({ error: "member_id and primary_user_id required" });
    }
    try {
      const { error } = await db
        .from("family_members")
        .delete()
        .eq("id", member_id)
        .eq("primary_user_id", primary_user_id);
      if (error) throw error;
      return res.json({ success: true });
    } catch (e) {
      console.error("[family] DELETE error:", e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
