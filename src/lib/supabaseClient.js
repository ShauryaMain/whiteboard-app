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
