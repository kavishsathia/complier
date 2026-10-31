import { availability, handle, type Action } from "../../../game/server";

// The landing page's game. GET says what's available (it never calls a model); POST starts a
// challenge, makes a transfer, sends a message, or ends a challenge.

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await availability());
}

export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > 4_096) return Response.json({ error: "request too large" }, { status: 413 });
  let body: Action;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return Response.json({ error: "bad request" }, { status: 400 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const out = await handle(body, ip);
  return Response.json(out.json, { status: out.status });
}
