import { getClient, authenticateUser } from "../_lib/supabase.js";

function isValidUuid(str) {
  return (
    typeof str === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
  );
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Require authentication
  const { user, error: authError } = await authenticateUser(req);
  if (!user) {
    return res.status(401).json({ error: authError || "Unauthorized" });
  }

  const { userId } = req.query;

  if (!isValidUuid(userId)) {
    return res.status(400).json({ error: "Invalid user ID" });
  }

  try {
    const db = getClient(req);

    const { data: profile, error } = await db
      .from("profiles")
      .select("first_name, last_name, id_number, address")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error("[linked-user-profile] query error:", error);
      return res.status(500).json({ error: "Failed to fetch profile" });
    }

    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    return res.status(200).json({
      firstName: profile.first_name || "",
      lastName: profile.last_name || "",
      idNumber: profile.id_number || null,
      address: profile.address || null,
    });
  } catch (e) {
    console.error("[linked-user-profile] unexpected error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}
