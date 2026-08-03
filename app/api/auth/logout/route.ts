import { clearSessionCookie, ensureDatabase, getD1, getSessionFromRequest } from "../../../../db/runtime";

export async function POST(request: Request) {
  const db = getD1();
  await ensureDatabase(db);
  const session = await getSessionFromRequest(db, request);
  if (session) {
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(session.id).run();
  }
  return Response.json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
}
