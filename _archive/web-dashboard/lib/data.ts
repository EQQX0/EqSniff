/**
 * Data layer. Screens call these functions; each one reads the signed-in
 * user's rows through Supabase (row level security applies) or, for
 * invoices, live from Stripe.
 */
import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { SWITCH_LIMIT } from "@/lib/limits";

export type Theme = "ultra_dark" | "dark" | "light";
export type Language = "en" | "es" | "fr" | "it" | "pt" | "ru" | "ar";

export interface Profile {
  id: string;
  email: string;
  displayName: string;
  theme: Theme;
  accentColor: string;
  language: Language;
  twoFactorEnabled: boolean;
  discordPresenceEnabled: boolean;
}

export interface License {
  id: string;
  product: "base" | "traffic_control";
  billingType: "one_time" | "subscription";
  status: "active" | "past_due" | "canceled";
  purchasedAt: string;
}

export interface DeviceSeat {
  id: string;
  deviceName: string;
  isActive: boolean;
  lastUsedAt: string;
  switchesUsedThisPeriod: number;
  switchLimit: number;
}

export interface FilterRule {
  id: string;
  name: string;
  protocol: "tcp" | "udp" | "any";
  direction: "inbound" | "outbound" | "both";
  source: "built_in" | "custom";
  enabled: boolean;
}

export interface NetworkDevice {
  id: string;
  macAddress: string;
  lastIp: string;
  vendor: string;
  isRouter: boolean;
  lastSeenAt: string;
  label: string | null;
}

export interface LinkedAccount {
  id: string;
  platform: "psn" | "xbox";
  displayName: string;
  status: "linked" | "not_linked" | "token_expired";
}

export interface Invoice {
  id: string;
  productLabel: string;
  status: "open" | "paid";
  total: number;
  paid: number;
  dueDate: string;
}

export interface SupportTicket {
  id: string;
  subject: string;
  status: "open" | "pending" | "closed";
  updatedAt: string;
}

const currentUser = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("not signed in");
  return { supabase, user: data.user };
});

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const day = (iso: string) => iso.slice(0, 10);

export async function getProfile(): Promise<Profile> {
  const { supabase, user } = await currentUser();
  const [{ data: row, error }, { data: factors }] = await Promise.all([
    supabase
      .from("profiles")
      .select("theme, accent_color, language, discord_presence_enabled")
      .eq("id", user.id)
      .single(),
    supabase.auth.mfa.listFactors(),
  ]);
  if (error) throw error;
  const email = user.email ?? "";
  return {
    id: user.id,
    email,
    displayName: email.split("@")[0] || "you",
    theme: row.theme as Theme,
    accentColor: row.accent_color,
    language: row.language as Language,
    twoFactorEnabled: Boolean(factors?.totp.some((f) => f.status === "verified")),
    discordPresenceEnabled: row.discord_presence_enabled,
  };
}

export async function getLicenses(): Promise<License[]> {
  const { supabase } = await currentUser();
  const { data, error } = await supabase
    .from("licenses")
    .select("id, product, billing_type, status, purchased_at")
    .order("purchased_at");
  if (error) throw error;
  return data.map((l) => ({
    id: l.id,
    product: l.product as License["product"],
    billingType: l.billing_type as License["billingType"],
    status: l.status as License["status"],
    purchasedAt: day(l.purchased_at),
  }));
}

export async function getDeviceSeats(): Promise<DeviceSeat[]> {
  const { supabase } = await currentUser();
  const { data, error } = await supabase
    .from("device_seats")
    .select("id, device_name, is_active, last_used_at, switches_used_this_period, period_reset_at")
    .order("created_at");
  if (error) throw error;
  // The allowance belongs to the owner, so every seat shows the same used count.
  const used = data
    .filter((s) => new Date(s.period_reset_at) > new Date())
    .reduce((n, s) => n + s.switches_used_this_period, 0);
  return data.map((s) => ({
    id: s.id,
    deviceName: s.device_name,
    isActive: s.is_active,
    lastUsedAt: ago(s.last_used_at),
    switchesUsedThisPeriod: used,
    switchLimit: SWITCH_LIMIT,
  }));
}

export async function getFilters(): Promise<FilterRule[]> {
  const { supabase } = await currentUser();
  const { data, error } = await supabase
    .from("filter_rules")
    .select("id, name, protocol, direction, source, enabled")
    .order("created_at");
  if (error) throw error;
  return data as FilterRule[];
}

export async function getDevices(): Promise<NetworkDevice[]> {
  const { supabase } = await currentUser();
  const { data, error } = await supabase
    .from("devices")
    .select("id, mac_address, last_ip, vendor, is_router, last_seen_at, device_labels(label)")
    .order("last_seen_at", { ascending: false });
  if (error) throw error;
  return data.map((d) => {
    const labels = d.device_labels as { label: string }[] | { label: string } | null;
    const label = Array.isArray(labels) ? labels[0]?.label : labels?.label;
    return {
      id: d.id,
      macAddress: d.mac_address,
      lastIp: d.last_ip ?? "",
      vendor: d.vendor ?? "Unknown",
      isRouter: d.is_router,
      lastSeenAt: ago(d.last_seen_at),
      label: label ?? null,
    };
  });
}

export async function getLinkedAccounts(): Promise<LinkedAccount[]> {
  const { supabase } = await currentUser();
  const { data, error } = await supabase
    .from("linked_accounts")
    .select("id, platform, display_name, expires_at");
  if (error) throw error;
  return (["psn", "xbox"] as const).map((platform) => {
    const row = data.find((r) => r.platform === platform);
    if (!row) return { id: platform, platform, displayName: "", status: "not_linked" as const };
    const expired = new Date(row.expires_at) < new Date();
    return {
      id: row.id,
      platform,
      displayName: row.display_name ?? "",
      status: expired ? ("token_expired" as const) : ("linked" as const),
    };
  });
}

/** Read live from Stripe. There is no invoices table to drift out of sync. */
export async function getInvoices(): Promise<Invoice[]> {
  const { user } = await currentUser();
  const { data: profile } = await createAdminClient()
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .single();
  if (!profile?.stripe_customer_id) return [];

  const list = await stripe().invoices.list({ customer: profile.stripe_customer_id, limit: 50 });
  return list.data.map((i) => ({
    id: i.id ?? "",
    productLabel: i.lines.data[0]?.description ?? "Invoice",
    status: i.status === "paid" ? ("paid" as const) : ("open" as const),
    total: i.total,
    paid: i.amount_paid,
    dueDate: day(new Date((i.due_date ?? i.created) * 1000).toISOString()),
  }));
}

export async function getSupportTickets(): Promise<SupportTicket[]> {
  const { supabase } = await currentUser();
  const { data, error } = await supabase
    .from("support_tickets")
    .select("id, subject, status, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data.map((t) => ({
    id: t.id,
    subject: t.subject,
    status: t.status as SupportTicket["status"],
    updatedAt: ago(t.updated_at),
  }));
}

export const FAQ = [
  {
    q: "What does this tool do?",
    a: "It captures and filters traffic on your own network, from devices you discover with your own scan, so you can see what is on your LAN and shape your own device's traffic for testing.",
  },
  {
    q: "Does it work on someone else's network?",
    a: "No. Discovery, capture, and traffic shaping are built to work against devices and interfaces you control. There is no lookup feature for identifying people you haven't discovered on your own network.",
  },
  {
    q: "What happened to the username/IP resolver some tools like this have?",
    a: "We don't build that. Resolving a stranger's IP from an in-game name is a feature built for finding people without their consent, not for understanding your own network, so it's out of scope for this product. See the project notes if you want the full reasoning.",
  },
  {
    q: "How do device switches work?",
    a: "Your license is tied to one active device at a time. You get a limited number of switches per month to move it to a different machine; switching doesn't cost you anything beyond that monthly count.",
  },
];
