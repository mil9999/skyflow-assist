/** The first voice milestone is a local demo, until application login is added. */
export function localVoiceGuard(request: Request): Response | null {
  const url = new URL(request.url);
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  // Next may reconstruct request.url using its bind hostname. The browser's
  // actual destination stays in Host; forwarded headers are deliberately ignored.
  let destination: URL;
  try {
    destination = new URL(`${url.protocol}//${request.headers.get("host") ?? url.host}`);
  } catch {
    return Response.json({ ok: false, error: "Invalid local voice host." }, { status: 403 });
  }
  if (process.env.NODE_ENV !== "development" || !localHosts.has(url.hostname) || !localHosts.has(destination.hostname)) {
    return Response.json({ ok: false, error: "Voice is available in the local development demo only." }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== destination.origin) {
    return Response.json({ ok: false, error: "Use the voice page on this app's origin." }, { status: 403 });
  }
  return null;
}

export const privateResponse = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "cache-control": "no-store" },
});
