"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";

export interface AuthState {
  error?: string;
  message?: string;
  factorId?: string;
}

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters.").max(128),
});

export async function signIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Email or password is wrong." };

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const totp = factors?.totp.find((f) => f.status === "verified");
    if (totp) return { factorId: totp.id };
  }
  redirect("/dashboard");
}

const code = z.object({ factorId: z.string().uuid(), code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code.") });

export async function verifyTwoFactor(_prev: AuthState, form: FormData): Promise<AuthState> {
  const parsed = code.safeParse({ factorId: form.get("factorId"), code: form.get("code") });
  if (!parsed.success) return { error: parsed.error.issues[0].message, factorId: String(form.get("factorId") ?? "") };

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify(parsed.data);
  if (error) return { error: "That code did not work. Try the next one.", factorId: parsed.data.factorId };
  redirect("/dashboard");
}

export async function signUp(_prev: AuthState, form: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/callback?next=/dashboard` },
  });
  if (error) return { error: "Could not create the account. Try a different email or a stronger password." };
  // Same message whether or not the email already exists, so the form does not reveal accounts.
  return { message: "Check your inbox for a link to confirm your email." };
}

export async function requestPasswordReset(_prev: AuthState, form: FormData): Promise<AuthState> {
  const parsed = z.string().trim().toLowerCase().email().safeParse(form.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/callback?next=/reset-password`,
  });
  return { message: "If that email has an account, a reset link is on its way." };
}

export async function updatePassword(_prev: AuthState, form: FormData): Promise<AuthState> {
  const parsed = credentials.shape.password.safeParse(form.get("password"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) return { error: "Could not update the password. Open the reset link again." };
  redirect("/dashboard");
}

/** Ends every session on every device. */
export async function signOutEverywhere() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
