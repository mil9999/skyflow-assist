import { clearConversations } from "@/agent/conversation-store";
import { resetDemoScenario } from "@/server/demo/scenario";

export const runtime = "nodejs";

/**
 * Restores the fictional airline after a rebooking has changed it.
 *
 * Two guards: development only, and only when explicitly switched on. The
 * request body is ignored entirely — no table names, paths or targets are ever
 * accepted from the browser.
 */
export async function POST(): Promise<Response> {
  const isDevelopment = process.env.NODE_ENV === "development";
  const isAllowed = process.env.ALLOW_DEMO_RESET === "true";

  if (!isDevelopment || !isAllowed) {
    return Response.json(
      {
        ok: false,
        error:
          "Demo reset is disabled. It requires NODE_ENV=development and ALLOW_DEMO_RESET=true.",
      },
      { status: 403 },
    );
  }

  const summary = await resetDemoScenario();
  clearConversations();

  return Response.json({ ok: true, summary });
}
