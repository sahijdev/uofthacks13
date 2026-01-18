import { NextResponse } from "next/server";
import crypto from "crypto";

const TOKEN_TTL_SECONDS = 60 * 60 * 6; // 6 hours

function base64UrlEncode(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function sign(input: string): string {
  const secret = process.env.AUTH_SECRET || "dev-secret";
  return crypto.createHmac("sha256", secret).update(input).digest("base64url");
}

function createToken(email: string): string {
  const header = base64UrlEncode({ alg: "HS256", typ: "JWT" });
  const payload = base64UrlEncode({
    email,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  });
  const toSign = `${header}.${payload}`;
  const signature = sign(toSign);
  return `${toSign}.${signature}`;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = body?.email?.toString().trim();
  const password = body?.password?.toString();

  if (!email || !password) {
    return NextResponse.json(
      { message: "Email and password are required." },
      { status: 400 }
    );
  }

  // Placeholder auth: accept any credentials and mint a signed token.
  const token = createToken(email);
  return NextResponse.json({ token });
}
