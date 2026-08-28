import { env } from "cloudflare:workers";
import { ensureDatabase, getD1, getSessionFromRequest } from "../../../db/runtime";

type LeavePayload = {
  action?: "create" | "cancel";
  requestId?: string;
  employeeId?: string;
  leaveType?: "leave" | "mc";
  leaveDate?: string;
  duration?: "half_day" | "full_day";
  reason?: string;
  notifyWhatsApp?: boolean;
  whatsappMessage?: string;
};

const DEFAULT_WHATSAPP_RECIPIENTS = ["60122159225", "60177395919"];

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as LeavePayload;
    if (payload.action === "cancel") return cancelLeaveRequest(request, payload);

    const validation = validatePayload(payload);
    if (validation) return json(request, { error: validation }, 400);

    const db = getD1();
    await ensureDatabase(db);
    const session = await getSessionFromRequest(db, request);
    if (session?.role !== "employee" || !session.employee_id) {
      return json(request, { error: "Employee login is required." }, 401);
    }
    if (payload.employeeId && payload.employeeId !== session.employee_id) {
      return json(request, { error: "Employees can only apply for their own leave." }, 403);
    }
    const reason = payload.reason?.trim() || "";

    const employee = await db
      .prepare("SELECT id, employee_code, full_name, phone FROM employees WHERE id = ? AND status = 'active'")
      .bind(session.employee_id)
      .first<{ id: string; employee_code: string; full_name: string; phone: string | null }>();
    if (!employee) return json(request, { error: "Employee account was deleted by HR." }, 401);

    const duplicate = await db
      .prepare(
        `SELECT id
         FROM leave_requests
         WHERE employee_id = ? AND leave_date = ? AND status IN ('pending', 'approved')
         LIMIT 1`,
      )
      .bind(session.employee_id, payload.leaveDate)
      .first<{ id: string }>();
    if (duplicate) {
      return json(request, { error: "Leave/MC request already exists for this date." }, 409);
    }

    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO leave_requests
         (id, employee_id, leave_type, leave_date, duration, reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        session.employee_id,
        payload.leaveType,
        payload.leaveDate,
        payload.duration,
        reason,
      )
      .run();

    const whatsapp =
      payload.notifyWhatsApp === false
        ? { attempted: false, configured: whatsappConfigured(), sent: 0, recipients: whatsappRecipients() }
        : await sendLeaveWhatsAppNotification({
            message: payload.whatsappMessage || leaveRequestMessage(employee, { ...payload, reason }),
          });

    return json(request, { ok: true, leaveRequestId: id, whatsapp }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json(request, { error: message }, 500);
  }
}

async function sendLeaveWhatsAppNotification({ message }: { message: string }) {
  const recipients = whatsappRecipients();
  const accessToken = stringEnv("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = stringEnv("WHATSAPP_PHONE_NUMBER_ID");
  const version = stringEnv("WHATSAPP_GRAPH_VERSION") || "v20.0";

  if (!accessToken || !phoneNumberId) {
    return { attempted: false, configured: false, sent: 0, recipients };
  }

  const endpoint = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
  const results = await Promise.allSettled(
    recipients.map(async (recipient) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: recipient,
          type: "text",
          text: {
            preview_url: false,
            body: message.slice(0, 4000),
          },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `WhatsApp failed for ${recipient}`);
      }
      return response.json();
    }),
  );

  return {
    attempted: true,
    configured: true,
    sent: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
    recipients,
  };
}

function leaveRequestMessage(
  employee: { employee_code: string; full_name: string; phone: string | null },
  payload: LeavePayload,
) {
  return [
    "Annual Leave/MC request",
    `Employee: ${employee.employee_code} - ${employee.full_name}`,
    `Type: ${payload.leaveType === "mc" ? "MC" : "Annual Leave"}`,
    `Date: ${payload.leaveDate} (${label(payload.duration)})`,
    `Reason: ${payload.reason}`,
    `Working days submitted: ${payload.duration === "half_day" ? "0.5" : "1"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function whatsappRecipients() {
  const configured = stringEnv("WHATSAPP_NOTIFY_NUMBERS");
  return (configured ? configured.split(",") : DEFAULT_WHATSAPP_RECIPIENTS)
    .map((value) => value.replace(/\D/g, ""))
    .filter(Boolean);
}

function whatsappConfigured() {
  return Boolean(stringEnv("WHATSAPP_ACCESS_TOKEN") && stringEnv("WHATSAPP_PHONE_NUMBER_ID"));
}

function stringEnv(key: string) {
  const value = (env as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function label(value?: string) {
  return String(value || "-")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function cancelLeaveRequest(request: Request, payload: LeavePayload) {
  if (!payload.requestId) return json(request, { error: "Leave/MC request is required." }, 400);

  const db = getD1();
  await ensureDatabase(db);
  const session = await getSessionFromRequest(db, request);
  if (session?.role !== "employee" || !session.employee_id) {
    return json(request, { error: "Employee login is required." }, 401);
  }

  const existing = await db
    .prepare(
      `SELECT id, employee_id, leave_type, leave_date, status
       FROM leave_requests
       WHERE id = ?`,
    )
    .bind(payload.requestId)
    .first<{ id: string; employee_id: string; leave_type: string; leave_date: string; status: string }>();

  if (!existing || existing.employee_id !== session.employee_id) {
    return json(request, { error: "Leave/MC request was not found." }, 404);
  }
  if (existing.status === "cancelled") return json(request, { ok: true });
  if (existing.status === "rejected") return json(request, { error: "Rejected Leave/MC cannot be cancelled." }, 409);
  const canCancelPastPendingMc = existing.leave_type === "mc" && existing.status === "pending";
  if (existing.leave_date < malaysiaTodayKey() && !canCancelPastPendingMc) {
    return json(request, { error: "Past Leave/MC cannot be cancelled." }, 409);
  }

  await db
    .prepare(
      `UPDATE leave_requests
       SET status = 'cancelled',
           admin_note = 'Cancelled by employee',
           reviewed_by_user_id = NULL,
           reviewed_at = NULL
       WHERE id = ?`,
    )
    .bind(existing.id)
    .run();

  return json(request, { ok: true });
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

function validatePayload(payload: LeavePayload) {
  if (payload.leaveType !== "leave" && payload.leaveType !== "mc") return "Select Leave or MC.";
  if (!payload.leaveDate || !/^\d{4}-\d{2}-\d{2}$/.test(payload.leaveDate)) return "Select leave date.";
  if (payload.duration !== "half_day" && payload.duration !== "full_day") return "Select half day or full day.";
  if (!payload.reason?.trim()) return "Reason is required for Annual Leave/MC.";
  if (payload.leaveDate < malaysiaTodayKey()) return "Past dates cannot be selected for Annual Leave/MC.";
  const day = dayOfWeek(payload.leaveDate);
  if (day === 0) return "Annual Leave/MC cannot be selected on Sunday.";
  if (day === 6 && payload.duration !== "half_day") return "Saturday Annual Leave/MC can only be half day.";
  return null;
}

function dayOfWeek(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function malaysiaTodayKey() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
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
