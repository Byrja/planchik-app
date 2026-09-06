// CF Pages Worker — astro-natal.pages.dev
// Serves static + proxies /api/* to origin Caddy

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Proxy API path to the origin
    if (url.pathname.startsWith("/api/")) {
      const target = `https://astro.burlab-api.site${url.pathname}${url.search}`;
      const init = {
        method: request.method,
        headers: {
          ...Object.fromEntries(request.headers),
          "Host": "astro.burlab-api.site",
        },
        body: (request.method === "GET" || request.method === "HEAD")
          ? undefined
          : await request.arrayBuffer(),
        redirect: "follow",
      };
      try {
        const resp = await fetch(target, init);
        const headers = new Headers(resp.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("X-Target", target);
        return new Response(resp.body, { status: resp.status, headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
    }

    // Serve static assets (index.html, /css/*, /js/*, /img/*)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },
};
