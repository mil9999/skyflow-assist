import { listEmployeeSessions } from "@/server/employee/service";
import { localDemoGuard, privateResponse } from "@/server/http/local-demo";
import { holdExpiryWorkerStatus } from "@/server/services/hold-expiry-worker";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const denied = localDemoGuard(request); if (denied) return denied;
  return privateResponse({ ok: true, sessions: await listEmployeeSessions(), expiryWorker: holdExpiryWorkerStatus() });
}
