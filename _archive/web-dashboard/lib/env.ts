import "server-only";
import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  STRIPE_PRICE_BASE: z.string().startsWith("price_"),
  STRIPE_PRICE_TRAFFIC_CONTROL: z.string().startsWith("price_"),
  CRON_SECRET: z.string().min(16),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
});

function parse<T extends z.ZodTypeAny>(s: T, label: string): z.infer<T> {
  const r = s.safeParse(process.env);
  if (!r.success) {
    const names = r.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Missing or invalid ${label} environment variables: ${names}. See .env.example.`);
  }
  return r.data;
}

/** Public settings. Throws with the variable names if any are missing. */
export const publicEnv = () => parse(schema, "public");
/** Secrets used by the webhook, billing and cron routes. */
export const serverEnv = () => parse(serverSchema, "server");
