import Stripe from "stripe";
const base = "http://localhost:3199";
const secret = "whsec_" + "a".repeat(32);
const show = async (name, p) => { const r = await p; console.log(String(r.status).padEnd(4), name); return r; };
const payload = JSON.stringify({ id: "evt_test_1", object: "event", type: "customer.created", data: { object: {} } });
const stripe = new Stripe("sk_test_dummy");
const goodSig = stripe.webhooks.generateTestHeaderString({ payload, secret });

await show("GET /dashboard signed out -> redirect to login", fetch(base + "/dashboard", { redirect: "manual" }));
await show("POST /api/checkout signed out -> 401", fetch(base + "/api/checkout", { method: "POST", body: "{}" }));
await show("POST /api/account signed out -> 401", fetch(base + "/api/account", { method: "DELETE" }));
await show("GET /api/filters signed out -> 401", fetch(base + "/api/filters"));
await show("webhook without signature -> 400", fetch(base + "/api/stripe/webhook", { method: "POST", body: payload }));
await show("webhook bad signature -> 400", fetch(base + "/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": "t=1,v1=deadbeef" } }));
await show("webhook valid signature passes verification (500 = db unreachable here)", fetch(base + "/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": goodSig } }));
await show("cron without secret -> 401", fetch(base + "/api/cron/maintenance"));
await show("cron wrong secret -> 401", fetch(base + "/api/cron/maintenance", { headers: { authorization: "Bearer nope" } }));
await show("GET /login public -> 200", fetch(base + "/login"));
