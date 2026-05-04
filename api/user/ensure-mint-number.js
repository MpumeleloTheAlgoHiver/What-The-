import { supabase, supabaseAdmin, authenticateUser } from "../_lib/supabase.js";

function generateMintNumber(firstName, idNumber, dateOfBirth) {
  const normalized = (firstName || "USER").normalize("NFD").replace(/[̀-ͯ]/g, "");
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
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

    const { data: wallet, error: walletErr } = await db
      .from("wallets")
      .select("mint_number")
      .eq("user_id", userId)
      .maybeSingle();

    if (walletErr && !walletErr.message?.includes("not found")) {
      console.error("[ensure-mint-number] Error fetching wallet:", walletErr);
      return res.status(500).json({ success: false, error: walletErr.message });
    }

    if (wallet?.mint_number) {
      return res.json({ success: true, mint_number: wallet.mint_number });
    }

    const { data: profile, error: profileErr } = await db
      .from("profiles")
      .select("first_name, id_number, date_of_birth")
      .eq("id", userId)
      .maybeSingle();

    if (profileErr) {
      console.error("[ensure-mint-number] Error fetching profile:", profileErr);
      return res.status(500).json({ success: false, error: profileErr.message });
    }

    const mintNumber = generateMintNumber(
      profile?.first_name,
      profile?.id_number,
      profile?.date_of_birth
    );

    if (wallet) {
      const { error: updateErr } = await db
        .from("wallets")
        .update({ mint_number: mintNumber })
        .eq("user_id", userId);

      if (updateErr) {
        console.error("[ensure-mint-number] Error updating wallet:", updateErr);
        return res.status(500).json({ success: false, error: updateErr.message });
      }
    } else {
      const { error: insertErr } = await db
        .from("wallets")
        .insert({ user_id: userId, mint_number: mintNumber, balance: 0 });

      if (insertErr) {
        console.error("[ensure-mint-number] Error creating wallet:", insertErr);
        return res.status(500).json({ success: false, error: insertErr.message });
      }
    }

    res.json({ success: true, mint_number: mintNumber });
  } catch (error) {
    console.error("[ensure-mint-number] Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}
