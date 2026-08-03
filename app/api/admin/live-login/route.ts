import { createSession, ensureDatabase, getD1 } from "../../../../db/runtime";

const adminAccount = {
  email: "d1_racing@yahoo.com",
  passwordHash: "fad4b78390b338486a88d8706127faa3fc30657b2889f960d194fe5afde98002",
};

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  try {
    const db = getD1();
    await ensureDatabase(db);

    const payload = (await request.json()) as { email?: string; password?: string };
    const email = payload.email?.trim().toLowerCase();
    const password = payload.password ?? "";

    if (!email || !password) {
      return json(request, { error: "Email and password are required." }, 400);
    }

    const user = await db
      .prepare(
        "SELECT id, email, role, employee_id FROM users WHERE email = ? AND role IN ('owner', 'hr') AND is_active = 1",
      )
      .bind(email)
      .first<{ id: string; email: string; role: "owner" | "hr"; employee_id: string | null }>();

    if (!user || email !== adminAccount.email || (await sha256Hex(password)) !== adminAccount.passwordHash) {
      return json(request, { error: "Admin email or password is incorrect." }, 401);
    }

    const session = await createSession(db, user);
    return json(request, {
      token: session.id,
      expiresAt: session.expiresAt,
      user: { role: user.role, name: user.role === "owner" ? "Owner/Admin" : "HR/Admin Staff" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json(request, { error: message }, 500);
  }
}

function json(request: Request, data: unknown, status = 200) {
  return Response.json(data, { status, headers: corsHeaders(request) });
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "*";
  const requestHeaders = request.headers.get("access-control-request-headers");
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": requestHeaders || "Content-Type, Authorization",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
