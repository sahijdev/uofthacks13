import { NextResponse } from "next/server";
import { hashPassword, signToken } from "../../../lib/auth";
import { ensureTables, getConnection } from "../../../lib/db";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = body?.email?.toString().trim().toLowerCase();
  const password = body?.password?.toString() || "";

  if (!email || !password) {
    return NextResponse.json({ message: "Email and password are required." }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ message: "Password must be at least 6 characters." }, { status: 400 });
  }

  await ensureTables();
  const conn = await getConnection();

  try {
    const [rows] = await conn.query("SELECT id, password_hash FROM users WHERE email = ? LIMIT 1", [email]);
    const existing = Array.isArray(rows) && rows[0];
    if (existing) {
      return NextResponse.json({ message: "User already exists. Please sign in." }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const [result] = await conn.query("INSERT INTO users (email, password_hash) VALUES (?, ?)", [
      email,
      passwordHash,
    ]);
    const insertId = (result as { insertId?: number }).insertId;
    const token = signToken({ userId: insertId, email });
    return NextResponse.json({ token });
  } catch (err) {
    console.error("Register error", err);
    return NextResponse.json({ message: "Unable to sign up right now." }, { status: 500 });
  } finally {
    conn.release();
  }
}
