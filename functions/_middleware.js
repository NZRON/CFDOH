import {
  CORS_HEADERS,
  getConfig,
  handleDohQuery,
  DOHRequest,
  代理URL,
} from "../lib/doh-core.js";
import { nginxHtml } from "../lib/pages/nginx.js";

function isStaticAsset(pathname) {
  if (
    pathname.startsWith("/css/") ||
    pathname.startsWith("/js/") ||
    pathname.startsWith("/scripts/") ||
    pathname.startsWith("/lib/")
  ) {
    return true;
  }
  return /\.(css|js|mjs|html|json|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|map)$/i.test(
    pathname
  );
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const config = getConfig(env);

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (url.pathname === "/js/config.js") {
    return new Response(
      `window.DOH_CONFIG = {
        path: "${config.DoHPath}",
        upstream: "${config.DoH}"
      };`,
      {
        headers: {
          "Content-Type": "application/javascript; charset=UTF-8",
          "Cache-Control": "no-cache",
        },
      }
    );
  }

  if (url.pathname === `/${config.DoHPath}`) {
    return await DOHRequest(request, config);
  }

  if (url.searchParams.has("doh")) {
    return await handleDohQuery(url, config);
  }

  if (isStaticAsset(url.pathname)) {
    return next();
  }

  if (env.URL302) {
    return Response.redirect(env.URL302, 302);
  }

  if (env.URL) {
    const urlVal = env.URL.toString().trim();
    if (urlVal.toLowerCase() === "nginx") {
      return new Response(nginxHtml, {
        headers: { "Content-Type": "text/html; charset=UTF-8" },
      });
    }
    return await 代理URL(env.URL, url);
  }

  return next();
}
