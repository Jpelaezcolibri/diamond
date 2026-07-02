const config = require("../config");

let client = null;

if (config.supabaseUrl && config.supabaseServiceKey) {
  const { createClient } = require("@supabase/supabase-js");
  // Node 20 no trae WebSocket nativo (lo exige realtime-js); ws lo suple
  const { WebSocket } = require("ws");
  client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { persistSession: false },
    realtime: { transport: WebSocket },
  });
}

module.exports = client;
