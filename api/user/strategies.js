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

    // Fetch user's active holdings to determine which strategies they own
    const { data: userHoldings, error: holdingsError } = await db
      .from("stock_holdings_c")
      .select("id, security_id, strategy_id, quantity, avg_fill")
      .eq("user_id", userId)
      .eq("Status", "active")
      .not("strategy_id", "is", null);

    if (holdingsError) {
      console.error("[user/strategies] Error fetching user holdings:", holdingsError);
    }

    // If user has no holdings, return empty strategies list
    if (!userHoldings || userHoldings.length === 0) {
      return res.status(200).json({ success: true, strategies: [] });
    }

    const holdingsByStrategyId = {};
    for (const h of (userHoldings || [])) {
      if (!holdingsByStrategyId[h.strategy_id]) {
        holdingsByStrategyId[h.strategy_id] = [];
      }
      holdingsByStrategyId[h.strategy_id].push(h);
    }

    const strategyIdsFromHoldings = Array.from(
      new Set((userHoldings || []).map((h) => h.strategy_id).filter(Boolean))
    );

    const allSecurityIds = (userHoldings || []).map(h => h.security_id).filter(Boolean);
    let livePriceMap = {};
    let symbolMap = {};
    if (allSecurityIds.length > 0) {
      const { data: secs } = await db
        .from("securities_c")
        .select("id, symbol, last_price")
        .in("id", allSecurityIds);
      (secs || []).forEach(s => {
        // last_price stored in rands; avg_fill in cents — normalize price to cents
        livePriceMap[s.id] = Math.round(Number(s.last_price || 0) * 100);
        symbolMap[s.id] = s.symbol;
      });
    }

    const symbolPnlMap = {};
    for (const h of (userHoldings || [])) {
      const sym = symbolMap[h.security_id];
      if (!sym) continue;
      const qty = Number(h.quantity || 0);
      const avgFill = Number(h.avg_fill || 0);
      const livePrice = livePriceMap[h.security_id] || avgFill;
      symbolPnlMap[sym] = {
        pnlRands: ((livePrice - avgFill) * qty) / 100,
        pnlPct: avgFill > 0 ? ((livePrice - avgFill) / avgFill) * 100 : 0,
        currentValue: (livePrice * qty) / 100,
        costBasis: (avgFill * qty) / 100,
      };
    }

    let allStrategies = [];
    let stratErr = null;

    const strategiesCResult = await db
      .from("strategies_c")
      .select(`
        id, name, short_name, description, risk_level, sector, icon_url, image_url, holdings, status,
        strategy_metrics (
          *
        )
      `)
      .eq("status", "active");

    if (strategiesCResult.error) {
      const legacyStrategiesResult = await db
        .from("strategies")
        .select(`
          id, name, short_name, description, risk_level, sector, icon_url, image_url, holdings, status,
          strategy_metrics (
            *
          )
        `)
        .eq("status", "active");

      allStrategies = legacyStrategiesResult.data || [];
      stratErr = legacyStrategiesResult.error;
    } else {
      allStrategies = strategiesCResult.data || [];
    }

    if (stratErr) {
      console.error("[user/strategies] Error fetching strategies:", stratErr);
      return res.status(500).json({ success: false, error: stratErr.message });
    }

    // Sort each strategy's metrics by date descending and keep only the latest row
    for (const strategy of allStrategies) {
      if (Array.isArray(strategy.strategy_metrics) && strategy.strategy_metrics.length > 1) {
        strategy.strategy_metrics.sort((a, b) =>
          (b.as_of_date || "").localeCompare(a.as_of_date || "")
        );
        strategy.strategy_metrics = [strategy.strategy_metrics[0]];
      }
    }

    const allHoldingSymbols = new Set();
    for (const strategy of allStrategies) {
      const h = strategy.holdings || [];
      if (Array.isArray(h)) {
        h.forEach(item => { if (item.symbol) allHoldingSymbols.add(item.symbol); });
      }
    }

    let securitiesMap = {};
    if (allHoldingSymbols.size > 0) {
      const { data: secs } = await db
        .from("securities_c")
        .select("symbol, logo_url, name")
        .in("symbol", Array.from(allHoldingSymbols));
      if (secs) {
        secs.forEach(s => { securitiesMap[s.symbol] = s; });
      }
    }

    const matchedStrategies = [];
    for (const strategy of allStrategies) {
      const hasHoldingsForStrategy = (holdingsByStrategyId[strategy.id] || []).length > 0;
      const isLinkedFromHoldings = strategyIdsFromHoldings.includes(strategy.id);

      // Only include strategy if user has active holdings for it
      if (hasHoldingsForStrategy || isLinkedFromHoldings) {
        const metrics = strategy.strategy_metrics;
        const latestMetric = Array.isArray(metrics) ? metrics[0] : metrics;
        const enrichedHoldings = (strategy.holdings || []).map(h => {
          const pnlData = symbolPnlMap[h.symbol] || null;
          return {
            ...h,
            logo_url: h.logo_url || securitiesMap[h.symbol]?.logo_url || null,
            name: h.name || securitiesMap[h.symbol]?.name || h.symbol,
            pnlRands: pnlData ? pnlData.pnlRands : null,
            pnlPct: pnlData ? pnlData.pnlPct : null,
            currentValue: pnlData ? pnlData.currentValue : null,
            costBasis: pnlData ? pnlData.costBasis : null,
          };
        });

        const stratHoldings = holdingsByStrategyId[strategy.id] || [];
        let investedAmount = 0;
        let currentMarketValue = 0;

        for (const h of stratHoldings) {
          const qty = Number(h.quantity || 0);
          const avgFill = Number(h.avg_fill || 0);
          const livePrice = livePriceMap[h.security_id] || avgFill;
          investedAmount += (avgFill * qty) / 100;
          currentMarketValue += (livePrice * qty) / 100;
        }

        console.log(`[user/strategies] Strategy ${strategy.name}: investedAmount=${investedAmount.toFixed(2)}, currentMarketValue=${currentMarketValue.toFixed(2)}`);

        matchedStrategies.push({
          id: strategy.id,
          name: strategy.name,
          shortName: strategy.short_name || strategy.name,
          description: strategy.description || "",
          riskLevel: strategy.risk_level || "Moderate",
          sector: strategy.sector || "",
          iconUrl: strategy.icon_url,
          imageUrl: strategy.image_url,
          holdings: enrichedHoldings,
          investedAmount,
          currentMarketValue,
          currentValue: currentMarketValue,
          metrics: latestMetric || null,
          firstInvestedDate: null,
        });
      }
    }

    return res.status(200).json({ success: true, strategies: matchedStrategies });
  } catch (error) {
    console.error("[user/strategies] Error:", error);
    return res.status(500).json({ success: false, error: error.message || "Failed to fetch user strategies" });
  }
}
