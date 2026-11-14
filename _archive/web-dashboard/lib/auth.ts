import "server-only";
import { createClient as createJsClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/**
 * Checks a password without touching the caller's session. A throwaway client
 * is used so an aal2 (two-factor) session is not replaced by an aal1 one.
 */
export async function verifyPassword(email: string, password: string): Promise<boolean> {
  const env = publicEnv();
  const probe = createJsClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await probe.auth.signInWithPassword({ email, password });
  return !error;
}
