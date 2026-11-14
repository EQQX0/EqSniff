import "server-only";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

/** Returns the Stripe customer for a user, creating it once. Safe to call concurrently. */
export async function getOrCreateCustomerId(userId: string, email: string | undefined): Promise<string> {
  const admin = createAdminClient();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .single();
  if (error) throw error;
  if (profile.stripe_customer_id) return profile.stripe_customer_id;

  // The idempotency key makes two simultaneous requests return the same customer.
  const customer = await stripe().customers.create(
    { email, metadata: { supabase_user_id: userId } },
    { idempotencyKey: `customer-${userId}` },
  );
  await admin.from("profiles").update({ stripe_customer_id: customer.id }).eq("id", userId).is("stripe_customer_id", null);
  return customer.id;
}
