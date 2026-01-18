export const runtime = "nodejs";

export async function GET() {
  const backend = process.env.BACKEND_URL; // e.g. http://localhost:8080
  if (!backend) return new Response("BACKEND_URL not set", { status: 500 });

  const upstream = await fetch(`${backend}/scad/stream`, {
    headers: { Accept: "text/event-stream" },
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    return new Response("Upstream SSE failed", { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
