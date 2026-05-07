import { supabase, supabaseAdmin, authenticateUser } from "../../_lib/supabase.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "PATCH") {
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

    const { id } = req.query;
    const { status } = req.body;

    if (!["active", "cancelled"].includes(status)) {
      return res.status(400).json({ success: false, error: "status must be 'active' or 'cancelled'" });
    }

    const db = supabaseAdmin || supabase;

    const { data, error } = await db
      .from("subscriptions")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id, status")
      .single();

    if (error) {
      console.error("[strategy-subscriptions] PATCH error:", error.message);
      return res.status(error.code === "PGRST116" ? 404 : 500).json({ success: false, error: error.message });
    }

    return res.status(200).json({ success: true, subscription: data });
  } catch (err) {
    console.error("[strategy-subscriptions] PATCH exception:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
