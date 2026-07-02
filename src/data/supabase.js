const config = require("../config");

let client = null;

if (config.supabaseUrl && config.supabaseServiceKey) {
  const { createClient } = require("@supabase/supabase-js");
  client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { persistSession: false },
  });
}

module.exports = client;
