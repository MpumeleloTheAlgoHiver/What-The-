import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      process.env[key] = value;
    }
  });
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixYieldBasketWeights() {
  console.log("Fixing Yield Basket weights...");

  // Fetch the Yield Basket strategy
  const { data: strategies, error: stratErr } = await supabase
    .from('strategies_c')
    .select('id, name, holdings, slug')
    .ilike('name', '%Yield Basket%');

  if (stratErr) {
    console.error("Error fetching strategies:", stratErr);
    return;
  }

  if (!strategies || strategies.length === 0) {
    console.log("No Yield Basket strategy found");
    return;
  }

  const strategy = strategies[0];
  console.log(`Found Strategy: ID=${strategy.id}, Name=${strategy.name}`);

  const holdings = strategy.holdings;
  if (!Array.isArray(holdings) || holdings.length === 0) {
    console.log("No holdings found");
    return;
  }

  console.log("\nCurrent holdings:");
  holdings.forEach(h => {
    console.log(`  ${h.symbol}: weight=${h.weight}, shares=${h.shares || h.quantity}`);
  });

  // Fetch securities with current prices
  const symbols = holdings.map(h => h.symbol);
  const { data: securities, error: secError } = await supabase
    .from('securities_c')
    .select('id, symbol, last_price')
    .in('symbol', symbols);

  if (secError) {
    console.error("Error fetching securities:", secError);
    return;
  }

  if (!securities || securities.length === 0) {
    console.log("No securities found");
    return;
  }

  // Create a map of symbol -> security
  const securitiesMap = {};
  securities.forEach(s => {
    securitiesMap[s.symbol] = s;
  });

  // Calculate market value for each holding
  const holdingsWithValue = holdings.map(holding => {
    const security = securitiesMap[holding.symbol];
    const shares = Number(holding.shares || holding.quantity || 1);
    const priceRands = security ? (Number(security.last_price) / 100) : 0;
    const marketValue = shares * priceRands;
    
    return {
      ...holding,
      marketValue,
      priceRands
    };
  });

  console.log("\nHoldings with market values:");
  holdingsWithValue.forEach(h => {
    console.log(`  ${h.symbol}: shares=${h.shares || h.quantity}, price=R${h.priceRands.toFixed(2)}, marketValue=R${h.marketValue.toFixed(2)}`);
  });

  // Calculate total market value
  const totalMarketValue = holdingsWithValue.reduce((sum, h) => sum + h.marketValue, 0);
  console.log(`\nTotal market value: R${totalMarketValue.toFixed(2)}`);

  if (totalMarketValue === 0) {
    console.log("Total market value is 0, cannot calculate weights");
    return;
  }

  // Calculate new weights as percentages
  const updatedHoldings = holdingsWithValue.map(holding => {
    const newWeight = (holding.marketValue / totalMarketValue) * 100;
    return {
      ...holding,
      weight: Number(newWeight.toFixed(2))
    };
  });

  console.log("\nUpdated holdings with new weights:");
  updatedHoldings.forEach(h => {
    console.log(`  ${h.symbol}: weight=${h.weight}% (was ${strategy.holdings.find(orig => orig.symbol === h.symbol)?.weight || 'N/A'})`);
  });

  // Verify weights add up to 100
  const totalWeight = updatedHoldings.reduce((sum, h) => sum + h.weight, 0);
  console.log(`\nTotal weight: ${totalWeight.toFixed(2)}%`);

  // Update the strategy in the database
  console.log("\nUpdating strategy in database...");
  const { error: updateError } = await supabase
    .from('strategies_c')
    .update({ holdings: updatedHoldings })
    .eq('id', strategy.id);

  if (updateError) {
    console.error("Error updating strategy:", updateError);
    return;
  }

  console.log("✅ Successfully updated Yield Basket weights");
}

fixYieldBasketWeights();
