import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { stripe } from "@/lib/stripe";
import { getOrCreateCustomerId } from "@/lib/billing";

// Stripe's Customer Portal handles card changes, invoices and one-click cancelling.
export async function POST() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const customer = await getOrCreateCustomerId(auth.user.id, auth.user.email);
  const session = await stripe().billingPortal.sessions.create({
    customer,
    return_url: `${publicEnv().NEXT_PUBLIC_SITE_URL}/billing`,
  });
  return NextResponse.json({ url: session.url });
}
