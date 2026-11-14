import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { productConfig } from "@/lib/stripe";
import { stripe } from "@/lib/stripe";
import { getOrCreateCustomerId } from "@/lib/billing";

const body = z.object({ product: z.enum(["base", "traffic_control"]) });

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid product" }, { status: 400 });
  const { product } = parsed.data;

  const { data: existing } = await supabase
    .from("licenses")
    .select("status")
    .eq("product", product)
    .maybeSingle();
  if (existing && existing.status !== "canceled") {
    return NextResponse.json({ error: "already owned" }, { status: 409 });
  }

  const cfg = productConfig(product);
  const site = publicEnv().NEXT_PUBLIC_SITE_URL;
  const customer = await getOrCreateCustomerId(auth.user.id, auth.user.email);
  const metadata = { user_id: auth.user.id, product };

  const session = await stripe().checkout.sessions.create({
    mode: cfg.mode,
    customer,
    client_reference_id: auth.user.id,
    line_items: [{ price: cfg.price, quantity: 1 }],
    metadata,
    ...(cfg.mode === "payment"
      ? { invoice_creation: { enabled: true, invoice_data: { metadata } }, payment_intent_data: { metadata } }
      : { subscription_data: { metadata } }),
    success_url: `${site}/products?checkout=success`,
    cancel_url: `${site}/store?checkout=cancelled`,
  });

  return NextResponse.json({ url: session.url });
}
