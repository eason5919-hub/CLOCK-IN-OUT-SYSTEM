import { createSession, ensureDatabase, getD1, sessionCookie } from "../../../../db/runtime";

const adminAccount = {
  email: "d1_racing@yahoo.com",
  passwordHash: "fad4b78390b338486a88d8706127faa3fc30657b2889f960d194fe5afde98002",
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

  if (!user || email !== adminAccount.email || (await sha256Hex(password)) !== adminAccount.passwordHash) {
    return Response.json({ error: "Admin email or password is incorrect." }, { status: 401 });
  }

  const session = await createSession(db, user);
  return Response.json(
    { user: { role: user.role, name: user.role === "owner" ? "Owner/Admin" : "HR/Admin Staff" } },
    { headers: { "set-cookie": sessionCookie(session.id, session.expiresAt) } },
  );
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
