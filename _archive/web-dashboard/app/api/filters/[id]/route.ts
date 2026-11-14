import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { filterPatch, toRange } from "@/lib/filter-schema";

type Ctx = { params: Promise<{ id: string }> };

const idSchema = z.string().uuid();

export async function PATCH(request: Request, { params }: Ctx) {
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = filterPatch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const p = parsed.data;

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.name !== undefined) update.name = p.name;
  if (p.protocol !== undefined) update.protocol = p.protocol;
  if (p.direction !== undefined) update.direction = p.direction;
  if (p.enabled !== undefined) update.enabled = p.enabled;
  if (p.portRange !== undefined) update.port_range = toRange(p.portRange);
  if (p.lengthRange !== undefined) update.length_range = toRange(p.lengthRange);
  if (p.hexPattern !== undefined) update.hex_pattern = p.hexPattern || null;
  if (p.gameTitleId !== undefined) update.game_title_id = p.gameTitleId || null;

  // Row level security limits this to the caller's own custom filters.
  const { data, error } = await supabase
    .from("filter_rules")
    .update(update)
    .eq("id", id.data)
    .select("id, name, protocol, direction, source, enabled")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "could not update filter" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase.from("filter_rules").delete().eq("id", id.data).select("id");
  if (error) return NextResponse.json({ error: "could not delete filter" }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
