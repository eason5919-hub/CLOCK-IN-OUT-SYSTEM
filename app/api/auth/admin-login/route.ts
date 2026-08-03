import { createSession, ensureDatabase, getD1, sessionCookie } from "../../../../db/runtime";

const demoPasswords: Record<string, string> = {
  "owner@example.com": "owner123",
  "hr@example.com": "hr123",
};

export async function POST(request: Request) {
  const db = getD1();
  await ensureDatabase(db);

  const payload = (await request.json()) as { email?: string; password?: string };
  const email = payload.email?.trim().toLowerCase();
  const password = payload.password ?? "";
  if (!email || !password) {
    return Response.json({ error: "Email and password are required." }, { status: 400 });
  }

  const user = await db
    .prepare("SELECT id, email, role, employee_id FROM users WHERE email = ? AND role IN ('owner', 'hr') AND is_active = 1")
    .bind(email)
    .first<{ id: string; email: string; role: "owner" | "hr"; employee_id: string | null }>();

  if (!user || demoPasswords[email] !== password) {
    return Response.json({ error: "Admin email or password is incorrect." }, { status: 401 });
  }

  const session = await createSession(db, user);
  return Response.json(
    { user: { role: user.role, name: user.role === "owner" ? "Owner/Admin" : "HR/Admin Staff" } },
    { headers: { "set-cookie": sessionCookie(session.id, session.expiresAt) } },
  );
}
