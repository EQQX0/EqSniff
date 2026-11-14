import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { SWITCH_LIMIT } from "@/lib/limits";

const body = z.object({ seat_id: z.string().uuid() });

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid seat" }, { status: 400 });

  const { error } = await supabase.rpc("switch_device_seat", {
    p_seat_id: parsed.data.seat_id,
    p_limit: SWITCH_LIMIT,
  });
  if (error) {
    if (error.code === "P0001") return NextResponse.json({ error: "monthly switch limit reached" }, { status: 409 });
    if (error.code === "P0002") return NextResponse.json({ error: "seat not found" }, { status: 404 });
    return NextResponse.json({ error: "could not switch" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
