import { prove } from "@/lib/csp/prove";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const { source } = await request.json();
  if (typeof source !== "string" || source.length > 20000) {
    return Response.json({ ok: false, error: "send the contract source as a string", line: 0 }, { status: 400 });
  }
  return Response.json(await prove(source));
}
