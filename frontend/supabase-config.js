// Supabase project connection details.
//
// 1. Go to your Supabase project dashboard
// 2. Project Settings -> API
// 3. Copy "Project URL" and the "anon public" key (NOT service_role)
// 4. Paste them below, replacing the empty strings
//
// The anon key is a public, client-safe identifier protected by Row Level
// Security policies on the database side, not a secret -- same trust level
// as the Reown project ID. Never put the service_role key here or anywhere
// in frontend code; it bypasses RLS entirely and belongs only in the
// submit-mint Edge Function's server-side environment.
export const SUPABASE_URL = 'https://xzsirwtxjodnwcbitpzo.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_ZLL2xVjjBBC_R_5pQh2I8w_-KA4PQ16';
