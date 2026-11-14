import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { verifyPassword } from "@/lib/auth";
import { SWITCH_LIMIT } from "@/lib/limits";

const body = z.object({ password: z.string().min(1).max(128) });

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "password required" }, { status: 400 });

  if (!(await verifyPassword(auth.user.email, parsed.data.password))) {
    return NextResponse.json({ error: "wrong password" }, { status: 403 });
  }

  const { error } = await supabase.rpc("reset_device_seat", { p_limit: SWITCH_LIMIT });
  if (error) {
    if (error.code === "P0001") return NextResponse.json({ error: "monthly switch limit reached" }, { status: 409 });
    return NextResponse.json({ error: "could not reset" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
