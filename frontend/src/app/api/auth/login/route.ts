import { NextResponse } from "next/server";
import { comparePassword, signToken } from "../../../lib/auth";
import { ensureTables, getConnection } from "../../../lib/db";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = body?.email?.toString().trim().toLowerCase();
  const password = body?.password?.toString() || "";

  if (!email || !password) {
    return NextResponse.json({ message: "Email and password are required." }, { status: 400 });
  }

  await ensureTables();
  const conn = await getConnection();

  try {
    const [rows] = await conn.query("SELECT id, password_hash FROM users WHERE email = ? LIMIT 1", [email]);
    const user = Array.isArray(rows) && rows[0] as { id: number; password_hash: string };
    if (!user) {
      return NextResponse.json({ message: "User not found. Please sign up." }, { status: 404 });
    }

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ message: "Invalid credentials." }, { status: 401 });
    }

    const token = signToken({ userId: user.id, email });
    return NextResponse.json({ token });
  } catch (err) {
    console.error("Login error", err);
    return NextResponse.json({ message: "Unable to login right now." }, { status: 500 });
  } finally {
    conn.release();
  }
}
