export function localDemoGuard(request: Request): Response | null {
  const url = new URL(request.url);
  const hosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  let destination: URL;
  try { destination = new URL(`${url.protocol}//${request.headers.get("host") ?? url.host}`); }
  catch { return privateResponse({ ok: false, error: "Invalid local demo host." }, 403); }
  if (process.env.NODE_ENV !== "development" || !hosts.has(url.hostname) || !hosts.has(destination.hostname)) {
    return privateResponse({ ok: false, error: "This feature is available in the local development demo only." }, 403);
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== destination.origin) return privateResponse({ ok: false, error: "Use this app's own origin." }, 403);
  if (request.headers.get("sec-fetch-site") === "cross-site") return privateResponse({ ok: false, error: "Cross-site requests are not allowed." }, 403);
  return null;
}

export const privateResponse = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
