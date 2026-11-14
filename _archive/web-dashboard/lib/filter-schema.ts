import { z } from "zod";

const range = z
  .tuple([z.number().int().min(0).max(65535), z.number().int().min(0).max(65535)])
  .refine(([lo, hi]) => lo <= hi, "range start must not exceed its end");

export const filterInput = z.object({
  name: z.string().trim().min(1).max(80),
  protocol: z.enum(["tcp", "udp", "any"]),
  direction: z.enum(["inbound", "outbound", "both"]),
  portRange: range.nullish(),
  lengthRange: range.nullish(),
  hexPattern: z
    .string()
    .trim()
    .max(512)
    .regex(/^([0-9a-fA-F]{2}|\?\?)( ?([0-9a-fA-F]{2}|\?\?))*$/, "use hex bytes such as 4a 3f ?? 00")
    .nullish()
    .or(z.literal("")),
  gameTitleId: z.string().trim().max(32).nullish(),
});

export const filterPatch = filterInput.partial().extend({ enabled: z.boolean().optional() });

/** Postgres int4range text, inclusive on both ends. */
export const toRange = (r: [number, number] | null | undefined) => (r ? `[${r[0]},${r[1] + 1})` : null);
