import { supabase, supabaseAdmin, authenticateUser } from "../_lib/supabase.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

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
    const userId = user.id;
    const limit = parseInt(req.query.limit) || 50;

    const { data: transactions, error: txError } = await db
      .from("transactions")
      .select("id, user_id, direction, name, description, amount, store_reference, currency, status, transaction_date, created_at")
      .eq("user_id", userId)
      .order("transaction_date", { ascending: false })
      .limit(limit);

    if (txError) {
      console.error("Error fetching transactions:", txError);
      return res.status(500).json({ success: false, error: txError.message });
    }

    const txList = transactions || [];

    const extractedNames = new Map();
    for (const tx of txList) {
      const txName = (tx.name || "").trim();
      if (txName.startsWith("Strategy Investment: ")) {
        extractedNames.set(txName.replace("Strategy Investment: ", "").trim(), "strategy");
      } else if (txName.startsWith("Purchased ")) {
        extractedNames.set(txName.replace("Purchased ", "").trim(), "purchased");
      }
    }

    let strategyHoldingsMap = {};
    let securityLogoMap = {};

    if (extractedNames.size > 0) {
      const { data: allSecs } = await db
        .from("securities_c")
        .select("name, symbol, logo_url");
      if (allSecs) {
        for (const sec of allSecs) {
          if (sec.logo_url) {
            if (sec.name) securityLogoMap[sec.name.toLowerCase()] = sec.logo_url;
            if (sec.symbol) {
              securityLogoMap[sec.symbol.toLowerCase()] = sec.logo_url;
              const normalized = sec.symbol.split(".")[0].toUpperCase().toLowerCase();
              if (normalized !== sec.symbol.toLowerCase()) {
                securityLogoMap[normalized] = sec.logo_url;
              }
            }
          }
        }
      }

      const { data: strategies } = await db
        .from("strategies_c")
        .select("name, short_name, holdings")
        .eq("status", "active");

      if (strategies) {
        const findLogo = (sym) => {
          if (!sym) return null;
          const lower = sym.toLowerCase();
          const normalized = sym.split(".")[0].toLowerCase();
          return securityLogoMap[lower] || securityLogoMap[normalized] || securityLogoMap[lower + ".jo"] || securityLogoMap[normalized + ".jo"] || null;
        };
        for (const s of strategies) {
          const holdings = Array.isArray(s.holdings) ? s.holdings : [];
          const sorted = [...holdings].sort((a, b) => {
            return Number(b.weight || b.shares || b.quantity || 0) - Number(a.weight || a.shares || a.quantity || 0);
          });
          const top3 = [];
          for (const h of sorted) {
            if (top3.length >= 3) break;
            const sym = h.symbol || h.ticker || "";
            const logo = findLogo(sym);
            if (logo) {
              top3.push({ symbol: sym, logo_url: logo, name: h.name || sym });
            }
          }
          if (s.name) strategyHoldingsMap[s.name.toLowerCase()] = top3;
          if (s.short_name) strategyHoldingsMap[s.short_name.toLowerCase()] = top3;
        }
      }
    }

    const enrichedTx = txList.map(tx => {
      const txName = (tx.name || "").trim();
      let sName = null;
      if (txName.startsWith("Strategy Investment: ")) {
        sName = txName.replace("Strategy Investment: ", "").trim();
      } else if (txName.startsWith("Purchased ")) {
        sName = txName.replace("Purchased ", "").trim();
      }

      if (sName) {
        const holdingLogos = strategyHoldingsMap[sName.toLowerCase()] || [];
        if (holdingLogos.length > 0) {
          return { ...tx, holding_logos: holdingLogos, logo_url: null };
        }
        const lower = sName.toLowerCase();
        const logo_url = securityLogoMap[lower] || securityLogoMap[lower.split(".")[0]] || null;
        return { ...tx, holding_logos: [], logo_url };
      }
      return { ...tx, holding_logos: [], logo_url: null };
    });

    return res.status(200).json({ success: true, transactions: enrichedTx });
  } catch (error) {
    console.error("User transactions error:", error);
    return res.status(500).json({ success: false, error: error.message || "Failed to fetch transactions" });
  }
}
