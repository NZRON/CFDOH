import {
  CORS_HEADERS,
  getConfig,
  handleDohQuery,
  DOHRequest,
  代理URL,
} from "./lib/doh-core.js";
import { nginxHtml } from "./lib/pages/nginx.js";
import { onRequest as ipInfoHandler } from "./functions/ip-info.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const config = getConfig(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === `/${config.DoHPath}`) {
      return await DOHRequest(request, config);
    }

    if (url.pathname === "/ip-info") {
      return await ipInfoHandler({ request, env });
    }

    if (url.searchParams.has("doh")) {
      return await handleDohQuery(url, config);
    }

    if (env.URL302) return Response.redirect(env.URL302, 302);
    if (env.URL) {
      if (env.URL.toString().toLowerCase() === "nginx") {
        return new Response(nginxHtml, {
          headers: { "Content-Type": "text/html; charset=UTF-8" },
        });
      }
      return await 代理URL(env.URL, url);
    }

    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },
};
