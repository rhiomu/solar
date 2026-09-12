export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // If BACKEND_URL environment variable is set in Cloudflare, proxy /api/* requests to it
    if (url.pathname.startsWith("/api/") && env.BACKEND_URL) {
      const backendBase = env.BACKEND_URL.replace(/\/+$/, "");
      const targetUrl = new URL(url.pathname + url.search, backendBase);
      const modifiedRequest = new Request(targetUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: "follow",
      });
      return fetch(modifiedRequest);
    }

    // Otherwise serve static frontend assets (HTML, CSS, JS) from ./static
    return env.ASSETS.fetch(request);
  },
};
