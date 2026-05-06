
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

async function checkYieldBasket() {
  console.log("Checking strategy: Yield Basket");
  const { data: strategies, error: stratErr } = await supabase
    .from('strategies_c')
    .select('id, name, holdings, slug')
    .ilike('name', '%Yield Basket%');

  if (stratErr) {
    console.error("Error fetching strategies:", stratErr);
    return;
  }

  if (!strategies || strategies.length === 0) {
    console.log("No Yield Basket strategy found in 'strategies' table.");
  } else {
    strategies.forEach(s => {
      console.log(`Found Strategy: ID=${s.id}, Name=${s.name}, Slug=${s.slug}`);
      console.log("Holdings:", JSON.stringify(s.holdings, null, 2));
      
      if (s.holdings && Array.isArray(s.holdings)) {
        s.holdings.forEach(async h => {
            const { data: security } = await supabase.from('securities').select('id, symbol, last_price').eq('symbol', h.symbol).maybeSingle();
            if (security) {
                console.log(`  Security found: Symbol=${security.symbol}, Last Price=${security.last_price} cents`);
            } else {
                console.log(`  Security NOT FOUND: Symbol=${h.symbol}`);
            }
        });
      }
    });
  }
}

checkYieldBasket();
