import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";

type Admin = ReturnType<typeof createAdminClient>;
type LicenseStatus = "active" | "past_due" | "canceled";

function mapSubscriptionStatus(status: Stripe.Subscription.Status): LicenseStatus {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
    case "paused":
      return "past_due";
    default:
      return "canceled";
  }
}

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : v?.id ?? null);

async function onCheckoutCompleted(admin: Admin, session: Stripe.Checkout.Session) {
  const userId = session.client_reference_id ?? session.metadata?.user_id;
  const product = session.metadata?.product;
  if (!userId || (product !== "base" && product !== "traffic_control")) {
    throw new Error(`checkout session ${session.id} has no user or product`);
  }
  // A delayed payment method may complete the session before the money arrives.
  if (session.payment_status === "unpaid") return;

  const isSub = session.mode === "subscription";
  const { error } = await admin.from("licenses").upsert(
    {
      owner_id: userId,
      product,
      billing_type: isSub ? "subscription" : "one_time",
      status: "active",
      stripe_payment_intent_id: isSub ? null : idOf(session.payment_intent),
      stripe_subscription_id: isSub ? idOf(session.subscription) : null,
      purchased_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id,product" },
  );
  if (error) throw error;

  const customer = idOf(session.customer);
  if (customer) {
    await admin.from("profiles").update({ stripe_customer_id: customer }).eq("id", userId).is("stripe_customer_id", null);
  }
}

async function setStatusBySubscription(admin: Admin, subscriptionId: string, status: LicenseStatus) {
  const { error } = await admin
    .from("licenses")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", subscriptionId);
  if (error) throw error;
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  return idOf(invoice.parent?.subscription_details?.subscription);
}

async function onPaymentFailed(admin: Admin, invoice: Stripe.Invoice) {
  const subId = invoiceSubscriptionId(invoice);
  if (!subId) return;
  await setStatusBySubscription(admin, subId, "past_due");
  if (invoice.customer_email) {
    await sendEmail(
      invoice.customer_email,
      "Your payment did not go through",
      "We could not collect your latest payment. Open Billing in your account and choose Manage billing to update your card. Your access continues while Stripe retries.",
    );
  }
}

export async function applyStripeEvent(event: Stripe.Event) {
  const admin = createAdminClient();
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return onCheckoutCompleted(admin, event.data.object);
    case "customer.subscription.updated":
      return setStatusBySubscription(admin, event.data.object.id, mapSubscriptionStatus(event.data.object.status));
    case "customer.subscription.deleted":
      return setStatusBySubscription(admin, event.data.object.id, "canceled");
    case "invoice.paid": {
      const subId = invoiceSubscriptionId(event.data.object);
      if (subId) await setStatusBySubscription(admin, subId, "active");
      return;
    }
    case "invoice.payment_failed":
      return onPaymentFailed(admin, event.data.object);
    default:
      return;
  }
}
