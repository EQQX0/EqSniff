// Creates one demo user with sample rows in a DEVELOPMENT Supabase project.
// Usage:  ALLOW_SEED=1 npm run seed
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
// All values are made up; no real people or devices.
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

if (process.env.ALLOW_SEED !== "1") {
  console.error("Refusing to seed. Set ALLOW_SEED=1 and point .env.local at a development project.");
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });
const email = "demo@example.test";
const password = randomBytes(12).toString("base64url");

async function main() {
  const { data: existing } = await admin.auth.admin.listUsers({ perPage: 200 });
  const old = existing?.users.find((u) => u.email === email);
  if (old) await admin.auth.admin.deleteUser(old.id);

  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("no user returned");
  const owner_id = data.user.id;

  const rows = [
    admin.from("licenses").insert({ owner_id, product: "base", billing_type: "one_time", status: "active" }),
    admin.from("device_seats").insert([
      { owner_id, device_name: "DEMO-DESKTOP", device_fingerprint: "demo-fp-1", is_active: true },
      { owner_id, device_name: "DEMO-LAPTOP", device_fingerprint: "demo-fp-2" },
    ]),
    admin.from("filter_rules").insert({
      owner_id, name: "My game server", protocol: "udp", direction: "both", port_range: "[27015,27016)",
    }),
    admin.from("devices").insert([
      { owner_id, mac_address: "02:00:00:00:00:01", last_ip: "192.168.1.1", vendor: "Example Networks", is_router: true },
      { owner_id, mac_address: "02:00:00:00:00:02", last_ip: "192.168.1.20", vendor: "Example Devices" },
    ]),
  ];
  for (const r of await Promise.all(rows)) if (r.error) throw r.error;

  const { data: dev } = await admin.from("devices").select("id").eq("owner_id", owner_id).eq("mac_address", "02:00:00:00:00:02").single();
  if (dev) await admin.from("device_labels").insert({ device_id: dev.id, owner_id, label: "Living room console" });

  console.log(`Seeded ${email}\nPassword (shown once): ${password}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
