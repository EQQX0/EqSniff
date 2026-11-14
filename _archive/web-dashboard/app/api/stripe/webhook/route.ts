import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyStripeEvent } from "@/lib/stripe-events";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing signature" }, { status: 400 });

  // The signature covers the exact bytes, so read the body as text, not JSON.
  const raw = await request.text();
  let event;
  try {
    event = stripe().webhooks.constructEvent(raw, signature, serverEnv().STRIPE_WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  // Stripe retries and can deliver an event twice. The primary key makes the second insert fail.
  const admin = createAdminClient();
  const { error: dupe } = await admin.from("processed_stripe_events").insert({ event_id: event.id });
  if (dupe) {
    if (dupe.code === "23505") return NextResponse.json({ received: true, duplicate: true });
    return NextResponse.json({ error: "storage error" }, { status: 500 });
  }

  try {
    await applyStripeEvent(event);
  } catch (err) {
    // Release the claim so Stripe's retry runs the handler again.
    await admin.from("processed_stripe_events").delete().eq("event_id", event.id);
    console.error("stripe webhook failed", event.type, event.id, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
