import { isDomainError } from "@/domain/errors";
import { employeeAction, employeeActionSchema } from "@/server/employee/service";
import { localDemoGuard, privateResponse } from "@/server/http/local-demo";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = localDemoGuard(request); if (denied) return denied;
  const parsed = employeeActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return privateResponse({ ok: false, error: "Invalid employee action." }, 400);
  try { return privateResponse({ ok: true, result: await employeeAction((await context.params).id, parsed.data) }); }
  catch (error) { return privateResponse({ ok: false, error: isDomainError(error) ? error.message : "This action could not be completed. Refresh the conversation.", code: isDomainError(error) ? error.code : "ACTION_FAILED" }, isDomainError(error) ? 409 : 404); }
}
