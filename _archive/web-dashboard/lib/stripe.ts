import "server-only";
import Stripe from "stripe";
import { serverEnv } from "@/lib/env";

let client: Stripe | null = null;

export function stripe() {
  client ??= new Stripe(serverEnv().STRIPE_SECRET_KEY);
  return client;
}

export type Product = "base" | "traffic_control";

/** base is a one-time payment, traffic_control is a monthly subscription. */
export function productConfig(product: Product) {
  const env = serverEnv();
  return product === "base"
    ? { price: env.STRIPE_PRICE_BASE, mode: "payment" as const, billingType: "one_time" as const }
    : { price: env.STRIPE_PRICE_TRAFFIC_CONTROL, mode: "subscription" as const, billingType: "subscription" as const };
}
