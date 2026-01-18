import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "../../lib/auth";
import { ensureTables, getConnection } from "../../lib/db";

function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer (.+)$/i);
  return match ? match[1] : null;
}

export async function GET(req: NextRequest) {
  const token = getBearerToken(req);
  const payload = verifyToken(token);
  if (!payload) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  await ensureTables();
  const conn = await getConnection();
  try {
    const [rows] = await conn.query(
      "SELECT id, title, prompt, created_at FROM builds WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
      [payload.userId]
    );
    return NextResponse.json({ builds: rows });
  } catch (err) {
    console.error("List builds error", err);
    return NextResponse.json({ message: "Could not load builds." }, { status: 500 });
  } finally {
    conn.release();
  }
}

export async function DELETE(req: NextRequest) {
  const token = getBearerToken(req);
  const payload = verifyToken(token);
  if (!payload) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id");
  const buildId = Number(id);
  if (!buildId) {
    return NextResponse.json({ message: "Missing build id." }, { status: 400 });
  }

  await ensureTables();
  const conn = await getConnection();
  try {
    const [result] = await conn.query("DELETE FROM builds WHERE id = ? AND user_id = ?", [
      buildId,
      payload.userId,
    ]);
    const affected = (result as { affectedRows?: number }).affectedRows || 0;
    if (affected === 0) {
      return NextResponse.json({ message: "Build not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Delete build error", err);
    return NextResponse.json({ message: "Could not delete build." }, { status: 500 });
  } finally {
    conn.release();
  }
}

export async function POST(req: NextRequest) {
  const token = getBearerToken(req);
  const payload = verifyToken(token);
  if (!payload) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const title = (body?.title || "Untitled build").toString().slice(0, 255);
  const prompt = (body?.prompt || "").toString();

  await ensureTables();
  const conn = await getConnection();
  try {
    const [result] = await conn.query(
      "INSERT INTO builds (user_id, title, prompt) VALUES (?, ?, ?)",
      [payload.userId, title, prompt]
    );
    const insertId = (result as { insertId?: number }).insertId;
    return NextResponse.json({
      build: { id: insertId, title, prompt, created_at: new Date().toISOString() },
    });
  } catch (err) {
    console.error("Create build error", err);
    return NextResponse.json({ message: "Could not save build." }, { status: 500 });
  } finally {
    conn.release();
  }
}
