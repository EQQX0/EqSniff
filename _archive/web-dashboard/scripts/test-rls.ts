// Runs the migration in an in-process Postgres (PGlite) and proves the
// access rules: a second user gets nothing, clients cannot grant themselves
// entitlements, and the seat-switch function enforces its limit.
// Usage: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + detail}`);
  if (!ok) failed++;
}

async function as(uid: string | null) {
  await db.exec("reset role");
  if (uid) {
    await db.exec(`set request.jwt.claim.sub = '${uid}'`);
    await db.exec("set role authenticated");
  } else {
    await db.exec("reset request.jwt.claim.sub");
    await db.exec("set role anon");
  }
}

async function fails(sql: string, params: unknown[] = []) {
  try {
    await db.query(sql, params);
    return false;
  } catch {
    return true;
  }
}

async function main() {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid());
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `);

  const migration = readFileSync("supabase/migrations/0001_init.sql", "utf8").replace(
    "create extension if not exists pgcrypto;",
    "",
  );
  await db.exec(migration);

  await db.exec(readFileSync("supabase/migrations/0002_builtin_filters.sql", "utf8"));
  const a = (await db.query<{ id: string }>("insert into auth.users default values returning id")).rows[0].id;
  const b = (await db.query<{ id: string }>("insert into auth.users default values returning id")).rows[0].id;

  const profiles = (await db.query("select count(*)::int as n from profiles")).rows[0] as { n: number };
  check("signup trigger creates a profile per user", profiles.n === 2);

  // Seed as superuser
  await db.query("insert into licenses (owner_id, product, billing_type) values ($1,'base','one_time')", [a]);
  await db.query(
    "insert into device_seats (owner_id, device_name, device_fingerprint, is_active) values ($1,'A1','fp1',true),($1,'A2','fp2',false)",
    [a],
  );
  await db.query("insert into filter_rules (owner_id, name, protocol, direction, source) values (null,'Built-in','any','both','built_in')");
  await db.query("insert into filter_rules (owner_id, name, protocol, direction) values ($1,'Mine','tcp','both')", [a]);
  const dev = (
    await db.query<{ id: string }>(
      "insert into devices (owner_id, mac_address) values ($1,'aa:bb:cc:dd:ee:01') returning id",
      [a],
    )
  ).rows[0].id;

  // Second user sees nothing of A's
  await as(b);
  for (const t of ["licenses", "device_seats", "devices", "device_labels", "support_tickets"]) {
    const n = (await db.query(`select count(*)::int as n from ${t}`)).rows[0] as { n: number };
    check(`user B sees 0 rows in ${t}`, n.n === 0);
  }
  const fr = (await db.query("select name from filter_rules order by name")).rows as { name: string }[];
  check("user B sees the built-in filters but not A's custom one", fr.length === 6 && fr.some((x) => x.name === "Built-in") && !fr.some((x) => x.name === "Mine"));

  // A sees own
  await as(a);
  const own = (await db.query("select count(*)::int as n from device_seats")).rows[0] as { n: number };
  check("user A sees own seats", own.n === 2);

  // Clients cannot self-grant
  check("client cannot insert a license", await fails("insert into licenses (owner_id, product, billing_type) values ($1,'traffic_control','one_time')", [a]));
  check("client cannot reset switch counter directly", await fails("update device_seats set switches_used_this_period = 0"));
  check("client cannot read stripe_customer_id", await fails("select stripe_customer_id from profiles"));
  check("client cannot set stripe_customer_id", await fails("update profiles set stripe_customer_id = 'cus_x'"));
  check("client can update theme", !(await fails("update profiles set theme = 'light'")));
  check("client cannot read stripe event log", await fails("select * from processed_stripe_events"));
  check("client cannot read encrypted tokens", await fails("select access_token_enc from linked_accounts"));

  // Filters
  check("client cannot create a built-in filter", await fails("insert into filter_rules (owner_id, name, protocol, direction, source) values ($1,'x','any','both','built_in')", [a]));
  check("client cannot edit a built-in filter", (await db.query("update filter_rules set enabled=false where owner_id is null")).affectedRows === 0);
  check("client can create a custom filter", !(await fails("insert into filter_rules (owner_id, name, protocol, direction) values ($1,'new','udp','inbound')", [a])));

  // Labels only on own discovered device
  check("A can label own discovered device", !(await fails("insert into device_labels (device_id, owner_id, label) values ($1,$2,'Console')", [dev, a])));
  await as(b);
  check("B cannot label A's device", await fails("insert into device_labels (device_id, owner_id, label) values ($1,$2,'x')", [dev, b]));
  check("B cannot post on A's behalf", await fails("insert into device_labels (device_id, owner_id, label) values ($1,$2,'x')", [dev, a]));

  // Support messages
  await as(a);
  const t = (await db.query<{ id: string }>("insert into support_tickets (owner_id, subject) values ($1,'Help') returning id", [a])).rows[0].id;
  check("A can post a user message", !(await fails("insert into support_ticket_messages (ticket_id, author, body) values ($1,'user','hi')", [t])));
  check("A cannot post a staff message", await fails("insert into support_ticket_messages (ticket_id, author, body) values ($1,'staff','hi')", [t]));
  await as(b);
  check("B cannot post on A's ticket", await fails("insert into support_ticket_messages (ticket_id, author, body) values ($1,'user','hi')", [t]));

  // Anonymous
  await as(null);
  check("anon cannot read profiles", await fails("select * from profiles"));
  check("anon cannot call switch_device_seat", await fails("select switch_device_seat(gen_random_uuid())"));

  // Switch function: limit 3, one active seat
  await as(a);
  const seats = (await db.query<{ id: string; device_name: string }>("select id, device_name from device_seats order by device_name")).rows;
  await db.exec("reset role");
  await db.query("insert into device_seats (owner_id, device_name, device_fingerprint) values ($1,'A3','fp3')", [a]);
  await as(a);
  const all = (await db.query<{ id: string; device_name: string }>("select id, device_name from device_seats order by device_name")).rows;
  const [s1, s2] = [all[0].id, all[1].id];
  await db.query("select switch_device_seat($1)", [s2]); // 1
  await db.query("select switch_device_seat($1)", [s1]); // 2
  await db.query("select switch_device_seat($1)", [s2]); // 3
  const act = (await db.query("select count(*)::int as n from device_seats where is_active")).rows[0] as { n: number };
  check("exactly one active seat after switching", act.n === 1);
  check("fourth switch in the period is refused", await fails("select switch_device_seat($1)", [s1]));
  check("reset is refused once the allowance is spent", await fails("select reset_device_seat()"));
  await as(b);
  check("B cannot switch A's seat", await fails("select switch_device_seat($1)", [s1]));
  void seats;

  // Cascade on account deletion
  await db.exec("reset role");
  await db.query("delete from auth.users where id = $1", [a]);
  const left = (await db.query("select (select count(*) from profiles where id=$1)::int + (select count(*) from device_seats where owner_id=$1)::int + (select count(*) from filter_rules where owner_id=$1)::int as n", [a])).rows[0] as { n: number };
  check("deleting the auth user removes their data", left.n === 0);

  console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
