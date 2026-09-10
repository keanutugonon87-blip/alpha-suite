// =====================================================================
// Shared Supabase client bootstrap.
// Fill in your project's URL and anon (public) key — never the service
// role key, which only ever lives in the Edge Function's environment.
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export const SUPABASE_URL = 'https://gxwgkbplscsduscoeoph.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4d2drYnBsc2NzZHVzY29lb3BoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNDA1MjgsImV4cCI6MjEwMjkxNjUyOH0.OViRrNPgfYFOXVvc0R3Cup66KAtC1Pzfh6SETAIkUn0';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Convenience: call the qr-token Edge Function with the current
// session's access token attached, so it knows who's calling.
export async function callQrTokenFunction(action, payload = {}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error('Not signed in.');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/qr-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || `qr-token function failed (${res.status})`);
  }
  return json;
}
