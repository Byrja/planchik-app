// Cloudflare Pages Worker: static assets plus a fixed API proxy.
// The browser-facing worker never accepts a caller-controlled upstream target.

const DEFAULT_API_ORIGIN = "https://astro.burlab-api.site";
const DEFAULT_ALLOWED_ORIGINS = [
  "https://astro.burlab-api.site",
  "https://astro-natal.pages.dev",
  "https://planchik-app.pages.dev",
];

function allowedOrigins(env) {
  const configured = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set(configured.length ? configured : DEFAULT_ALLOWED_ORIGINS);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const headers = new Headers({ "Vary": "Origin" });
  if (origin && allowedOrigins(env).has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  return headers;
}

function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  for (const [key, value] of corsHeaders(request, env)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const headers = corsHeaders(request, env);
      if (request.method === "OPTIONS") {
        headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-Id");
        headers.set("Access-Control-Max-Age", "3600");
        return new Response(null, { status: 204, headers });
      }

      const apiOrigin = String(env.API_ORIGIN || DEFAULT_API_ORIGIN).replace(/\/$/, "");
      const target = `${apiOrigin}${url.pathname}${url.search}`;
      const upstreamHeaders = new Headers(request.headers);
      upstreamHeaders.delete("Host");

      try {
        const response = await fetch(target, {
          method: request.method,
          headers: upstreamHeaders,
          body: (request.method === "GET" || request.method === "HEAD")
            ? undefined
            : request.body,
          redirect: "follow",
        });
        return withCors(response, request, env);
      } catch (error) {
        return withCors(new Response(JSON.stringify({ ok: false, error: "upstream_unavailable" }), {
          status: 502,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        }), request, env);
      }
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not Found", { status: 404 });
  },
};
