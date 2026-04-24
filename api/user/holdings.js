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

    let holdings, holdingsError;
    const holdingsResult = await db
      .from("stock_holdings_c")
      .select("id, user_id, security_id, strategy_id, quantity, avg_fill, market_value, unrealized_pnl, as_of_date, created_at, updated_at, Status, settlement_status")
      .eq("user_id", userId)
      .eq("Status", "active");

    if (holdingsResult.error && holdingsResult.error.message && holdingsResult.error.message.includes("settlement_status")) {
      const fallback = await db
        .from("stock_holdings_c")
        .select("id, user_id, security_id, strategy_id, quantity, avg_fill, market_value, unrealized_pnl, as_of_date, created_at, updated_at, Status")
        .eq("user_id", userId)
        .eq("Status", "active");
      holdings = fallback.data;
      holdingsError = fallback.error;
    } else {
      holdings = holdingsResult.data;
      holdingsError = holdingsResult.error;
    }

    if (holdingsError) {
      console.error("Error fetching holdings:", holdingsError);
      return res.status(500).json({ success: false, error: holdingsError.message });
    }

    const rawHoldings = holdings || [];
    const securityIds = rawHoldings.map(h => h.security_id).filter(Boolean);
    let securitiesMap = {};
    let latestPricesMap = {};

    if (securityIds.length > 0) {
      const [secResult, pricesResult] = await Promise.all([
        db.from("securities_c")
          .select("id, symbol, name, logo_url, last_price, change_price, change_percent, sector, exchange")
          .in("id", securityIds),
        db.from("stock_returns_c")
          .select("security_id, current_price, as_of_date")
          .in("security_id", securityIds)
          .order("as_of_date", { ascending: false })
          .limit(securityIds.length * 2),
      ]);

      if (secResult.data) {
        secResult.data.forEach(s => { securitiesMap[s.id] = s; });
      }

      const pricesBySecId = {};
      (pricesResult.data || []).forEach(p => {
        if (!pricesBySecId[p.security_id]) pricesBySecId[p.security_id] = [];
        if (pricesBySecId[p.security_id].length < 2) {
          pricesBySecId[p.security_id].push(p.current_price);
        }
      });
      for (const [secId, prices] of Object.entries(pricesBySecId)) {
        latestPricesMap[secId] = {
          latestPrice: prices[0],
          prevPrice: prices.length > 1 ? prices[1] : prices[0],
        };
      }
    }

    const enrichedHoldings = rawHoldings
      .filter(h => securitiesMap[h.security_id])
      .map(h => {
        const sec = securitiesMap[h.security_id];
        const priceData = latestPricesMap[h.security_id];
        const livePriceRands = Number(sec?.last_price ?? priceData?.latestPrice ?? 0);
        const prevPriceRands = Number(priceData?.prevPrice ?? livePriceRands);
        const dailyChangeRands = sec?.change_price != null
          ? Number(sec.change_price)
          : (livePriceRands - prevPriceRands);
        const dailyChangePct = sec?.change_percent != null
          ? Number(sec.change_percent)
          : (prevPriceRands > 0 ? (dailyChangeRands / prevPriceRands) * 100 : 0);
        // avg_fill is stored in cents; last_price in rands — normalize price to cents
        const livePrice = Math.round(livePriceRands * 100);
        const dailyChange = Math.round(dailyChangeRands * 100);
        const quantity = h.quantity || 0;
        const avgFill = Number(h.avg_fill || 0);
        const isPending = !avgFill || avgFill === 0;

        if (isPending) {
          return {
            ...h,
            market_value: 0,
            unrealized_pnl: 0,
            settlement_status: "pending",
            symbol: sec?.symbol || "N/A",
            name: sec?.name || "Unknown",
            asset_class: sec?.sector || "Other",
            logo_url: sec?.logo_url || null,
            last_price: 0,
            change_price: 0,
            change_percent: 0,
            exchange: sec?.exchange || null,
          };
        }

        const costBasis = avgFill * quantity;
        const liveMarketValue = livePrice * quantity;
        const pnl = liveMarketValue - costBasis;

        return {
          ...h,
          market_value: liveMarketValue,
          unrealized_pnl: pnl,
          symbol: sec?.symbol || "N/A",
          name: sec?.name || "Unknown",
          asset_class: sec?.sector || "Other",
          logo_url: sec?.logo_url || null,
          last_price: livePrice,
          change_price: dailyChange,
          change_percent: Number(dailyChangePct.toFixed(2)),
          exchange: sec?.exchange || null,
        };
      });

    return res.status(200).json({ success: true, holdings: enrichedHoldings });
  } catch (error) {
    console.error("User holdings error:", error);
    return res.status(500).json({ success: false, error: error.message || "Failed to fetch holdings" });
  }
}
