import { createClient } from "@supabase/supabase-js";
import { createDemoClient, isDemoPage } from "./demoBackend";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

//console.log("SUPABASE URL:", supabaseUrl);
// console.log("SUPABASE KEY LENGTH:", supabaseAnonKey ? supabaseAnonKey.length : "MISSING");

// The demo board (/demo) runs on an in-memory stand-in, so visitors can try
// the board without signing in and nothing they draw touches the real
// database. Every other page gets the real client, exactly as before. The
// choice is made once, when the page loads (AuthContext reloads the page if
// someone moves between the demo and the real app without a full load).
export const supabase = isDemoPage() ? createDemoClient() : createClient(supabaseUrl, supabaseAnonKey);

// The real client, even on the demo page: signing in from the demo (the
// sheet over the demo board) needs it, while the board itself keeps using
// the stand-in. Made only when it's first asked for. It keeps the session
// in the same place as the app's own client, so once someone has signed in
// here, the rest of the app finds them signed in.
let realClient = null;
export function getRealClient() {
  if (!supabase.__demo) return supabase;
  if (!realClient) realClient = createClient(supabaseUrl, supabaseAnonKey);
  return realClient;
}
