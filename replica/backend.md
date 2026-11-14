# Backend

Written 2026-11-15. Stack: Supabase (Postgres, Auth, RLS), Stripe in test mode, Resend. Nothing here has run against a live Supabase or Stripe project yet, because no keys exist. What was tested locally is listed under "Verified".

## What exists

| Area | Files |
| --- | --- |
| Schema, RLS, functions, jobs | `supabase/migrations/0001_init.sql`, `0002_builtin_filters.sql` |
| Auth | `app/auth/actions.ts`, `app/auth/callback/route.ts`, `app/login`, `signup`, `forgot-password`, `reset-password`, `proxy.ts` |
| Two-factor (authenticator app) | `app/(dashboard)/settings/TwoFactorCard.tsx`, login code step |
| Account deletion, sign out everywhere | `app/api/account/route.ts`, `settings/AccountActions.tsx` |
| Payments | `app/api/checkout`, `app/api/billing/portal`, `app/api/stripe/webhook`, `lib/stripe-events.ts`, `lib/billing.ts` |
| Device seats | `app/api/device-seats/switch`, `reset` (SQL functions do the work) |
| Filters | `app/api/filters`, `app/api/filters/[id]`, `lib/filter-schema.ts` |
| Jobs | `app/api/cron/maintenance` |
| Email | `lib/email.ts` (payment-failed notice) |
| Data layer | `lib/data.ts` now reads Supabase and Stripe |
| Tests, seed | `scripts/test-rls.ts` (`npm run test:db`), `scripts/smoke.mjs`, `scripts/seed.ts` (`npm run seed`) |

## Decisions that differ from the architecture doc

- **Clients cannot write licences or seats.** Only the Stripe webhook (service role) writes `licenses`. Seats change only through `switch_device_seat` and `reset_device_seat`. The first schema draft let a user insert their own licence.
- **The switch allowance belongs to the owner, not the seat.** The first draft counted per seat, so the limit never added up. The test suite caught it.
- **Reset costs one switch.** Otherwise "reset, then sign in on another machine" is a free switch. This matches the copy on the Device Access screen.
- **Tokens and billing IDs are hidden from the browser** with column grants: `stripe_customer_id`, `access_token_enc`, `refresh_token_enc`.
- **Password checks use a throwaway client**, so confirming a password for reset or deletion cannot downgrade a two-factor session.
- **Built-in filters share one `enabled` flag.** The UI disables their switches. Per-user on/off for built-ins needs a new table.

## Verified

- Migrations run clean in an in-process Postgres (PGlite). 31 access checks pass: a second user sees nothing, clients cannot grant themselves licences or reset counters, cannot read billing IDs or tokens, cannot label another user's device, cannot post as staff, anonymous callers get nothing, the fourth switch in a month is refused, and deleting a user removes their rows.
- With dummy env values, the built app returns 401 for signed-out API calls, redirects signed-out pages to `/login`, rejects webhooks with a missing or bad signature, accepts a correctly signed one past verification, and rejects the cron route without the secret.
- `tsc` clean, `next build` passes, `npm audit` reports 0 vulnerabilities, no server secret is imported by client code.

## Not verified (needs your keys)

Sign up, email confirmation, sign in, two-factor enrolment and login, password reset, Stripe Checkout, the Customer Portal, webhook handlers after the signature check, live invoice reads, account deletion with a real subscription, the cron job, Resend delivery, and the seed script. The code is written; none of it has run against the real services.

## You need to do

1. Create a Supabase project. Run both migrations (`supabase db push`, or paste them into the SQL editor). Tell me if you want me to apply them with the Supabase connector instead.
2. Supabase dashboard: Auth > enable TOTP MFA; add `<site>/auth/callback` to the redirect allowlist; set custom SMTP to Resend with your domain; turn on daily backups (paid plan).
3. Create a Stripe test-mode account. Make two products and prices: base at $19.99 one-time, traffic control at $5.99 monthly. Turn on the Customer Portal with cancellation allowed.
4. Add a Stripe webhook endpoint `<site>/api/stripe/webhook` with these events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`.
5. Copy `.env.example` to `.env.local` and fill every value. Use test keys only.
6. Schedule `GET /api/cron/maintenance` daily with `Authorization: Bearer <CRON_SECRET>`.

## Not built

| Item | Why |
| --- | --- |
| PSN and Xbox account linking (OAuth) | Needs your developer apps and the providers' review. Sony offers no public OAuth for this use, so check the terms first. The settings UI shell stays. |
| `/api/downloads/:platform` signed installer URLs | No installer exists until the desktop app does. |
| Support ticket create and reply routes | The tables, policies and reads exist. The write routes are small and not done yet. |
| Device label route (`PUT /api/devices/:id/label`) | Same: policy exists, route does not. |
| Saving theme, accent and language | The profile columns and update policy exist. The settings form does not submit yet. |
| Per-user state for built-in filters | See decisions above. |
| Rate limits on our own routes | Supabase limits auth endpoints. Checkout, reset and delete need an edge limiter at deploy (Vercel firewall or Upstash). |
| Privacy policy listing Supabase, Stripe, Resend and the host | Written in `/replica-launch`. |
| Generated Supabase types | Needs a live project. Queries are untyped until then. |
| Desktop app API (device tokens for filter sync and licence checks) | Comes with the Tauri app. |

## Security checklist

- [x] Secrets only in env vars; `.env*` ignored; no server secret reachable from client code
- [x] Server-side validation with zod on every route that takes input
- [x] Authorisation tested with a second user (at the database level, via RLS)
- [ ] Rate limits on sign up, sign in and email-sending routes: only Supabase's built-in limits so far
- [x] Webhook signatures verified; duplicate events ignored; failed handlers release the claim so Stripe retries
- [x] Uploads: none exist
- [x] No user data in URLs; logs carry event IDs and error messages only
- [x] `npm audit` clean
- [ ] Privacy policy lists every processor
