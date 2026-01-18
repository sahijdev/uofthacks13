import { NextRequest, NextResponse } from "next/server";
import { classifyPersonaLocal, PersonaKey } from "../../lib/persona";

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:8000";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const prompts: string[] = Array.isArray(body?.prompts) ? body.prompts : [];

  const localPersona = classifyPersonaLocal(prompts.slice(0, 25));

  if (!prompts.length) {
    return NextResponse.json({ persona: localPersona });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/persona`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompts: prompts.slice(0, 25) }),
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { persona: localPersona, note: `backend persona ${res.status}` },
        { status: 200 }
      );
    }
    const data = await res.json().catch(() => ({}));
    const key = (data?.persona || "").trim() as PersonaKey;
    if (key && ["cosmic", "mech", "architect", "eco", "whimsy"].includes(key)) {
      return NextResponse.json({ persona: key });
    }
    return NextResponse.json({ persona: localPersona });
  } catch (err) {
    console.error("persona proxy failed", err);
    return NextResponse.json(
      { persona: localPersona, note: "backend persona unavailable" },
      { status: 200 }
    );
  }
}
