import "server-only";
import { serverEnv } from "@/lib/env";

/** Sends one transactional email through Resend. Returns false if Resend is not configured. */
export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const { RESEND_API_KEY, EMAIL_FROM } = serverEnv();
  if (!RESEND_API_KEY || !EMAIL_FROM) return false;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM, to, subject, text }),
  });
  return res.ok;
}
