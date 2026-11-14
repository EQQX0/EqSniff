import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPassword } from "@/lib/auth";
import { stripe } from "@/lib/stripe";

const body = z.object({ password: z.string().min(1).max(128) });

// Deletes the account and everything it owns. Subscriptions are cancelled first
// so nobody is billed after deleting. Stripe keeps its own invoice records.
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "password required" }, { status: 400 });
  if (!(await verifyPassword(auth.user.email, parsed.data.password))) {
    return NextResponse.json({ error: "wrong password" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: subs } = await admin
    .from("licenses")
    .select("stripe_subscription_id")
    .eq("owner_id", auth.user.id)
    .not("stripe_subscription_id", "is", null);

  try {
    for (const s of subs ?? []) {
      await stripe().subscriptions.cancel(s.stripe_subscription_id!);
    }
  } catch (err) {
    console.error("could not cancel subscription during account deletion", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "could not cancel billing; nothing was deleted" }, { status: 502 });
  }

  const { error } = await admin.auth.admin.deleteUser(auth.user.id);
  if (error) return NextResponse.json({ error: "could not delete account" }, { status: 500 });

  await supabase.auth.signOut({ scope: "local" });
  return new NextResponse(null, { status: 204 });
}
