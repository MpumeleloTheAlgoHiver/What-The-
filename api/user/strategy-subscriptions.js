import { supabase, supabaseAdmin, authenticateUser } from "../_lib/supabase.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
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

    const { data: subscriptions, error } = await db
      .from("subscriptions")
      .select("id, user_id, plan, amount, currency, current_period_end, status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[strategy-subscriptions] GET error:", error.message);
      return res.status(500).json({ success: false, error: error.message });
    }

    return res.status(200).json({ success: true, subscriptions: subscriptions || [] });
  } catch (err) {
    console.error("[strategy-subscriptions] GET exception:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
