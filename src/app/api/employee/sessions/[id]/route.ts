import { employeeDetail } from "@/server/employee/service";
import { localDemoGuard, privateResponse } from "@/server/http/local-demo";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = localDemoGuard(request); if (denied) return denied;
  const data = await employeeDetail((await context.params).id);
  return data ? privateResponse({ ok: true, ...data }) : privateResponse({ ok: false, error: "Conversation not found." }, 404);
}
