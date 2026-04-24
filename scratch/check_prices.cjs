const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  console.log("--- Holdings ---");
  const { data: holdings, error } = await supabase
    .from('stock_holdings_c')
    .select('security_id, quantity, avg_fill, market_value')
    .limit(10);
  
  if (error) {
    console.error(error);
    return;
  }
  
  console.log(JSON.stringify(holdings, null, 2));
}

check();
