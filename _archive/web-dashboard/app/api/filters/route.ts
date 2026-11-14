import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { filterInput, toRange } from "@/lib/filter-schema";

const COLUMNS = "id, name, protocol, direction, source, enabled, owner_id";

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase.from("filter_rules").select(COLUMNS).order("created_at");
  if (error) return NextResponse.json({ error: "could not load filters" }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = filterInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const f = parsed.data;

  const { data, error } = await supabase
    .from("filter_rules")
    .insert({
      owner_id: auth.user.id,
      name: f.name,
      protocol: f.protocol,
      direction: f.direction,
      port_range: toRange(f.portRange),
      length_range: toRange(f.lengthRange),
      hex_pattern: f.hexPattern || null,
      game_title_id: f.gameTitleId || null,
      source: "custom",
    })
    .select(COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: "could not create filter" }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
