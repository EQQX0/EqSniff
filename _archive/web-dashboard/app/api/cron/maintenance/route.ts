import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

function authorized(header: string | null) {
  const expected = Buffer.from(`Bearer ${serverEnv().CRON_SECRET}`);
  const got = Buffer.from(header ?? "");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// Daily job: zero expired switch allowances and drop stale unlabelled devices.
// The platform scheduler calls it with "Authorization: Bearer $CRON_SECRET".
export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const [resets, pruned] = await Promise.all([
    admin.rpc("reset_expired_switch_periods"),
    admin.rpc("prune_stale_devices"),
  ]);
  if (resets.error || pruned.error) {
    console.error("maintenance failed", resets.error?.message, pruned.error?.message);
    return NextResponse.json({ error: "job failed" }, { status: 500 });
  }
  return NextResponse.json({ seatPeriodsReset: resets.data, devicesPruned: pruned.data });
}
