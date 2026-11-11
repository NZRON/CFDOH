export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  if (env.TOKEN) {
    const token = url.searchParams.get("token");
    if (token != env.TOKEN) {
      return new Response(
        JSON.stringify(
          {
            status: "error",
            message: "Token不正确",
            code: "AUTH_FAILED",
            timestamp: new Date().toISOString(),
          },
          null,
          4
        ),
        {
          status: 403,
          headers: {
            "content-type": "application/json; charset=UTF-8",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
  }

  const ip =
    url.searchParams.get("ip") || request.headers.get("CF-Connecting-IP");
  if (!ip) {
    return new Response(
      JSON.stringify(
        {
          status: "error",
          message: "IP参数未提供",
          code: "MISSING_PARAMETER",
          timestamp: new Date().toISOString(),
        },
        null,
        4
      ),
      {
        status: 400,
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  try {
    const response = await fetch(`http://ip-api.com/json/${ip}?lang=zh-CN`);
    if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
    const data = await response.json();
    data.timestamp = new Date().toISOString();
    return new Response(JSON.stringify(data, null, 4), {
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify(
        {
          status: "error",
          message: `IP查询失败: ${error.message}`,
          code: "API_REQUEST_FAILED",
          query: ip,
          timestamp: new Date().toISOString(),
          details: {
            errorType: error.name,
            stack: error.stack ? error.stack.split("\n")[0] : null,
          },
        },
        null,
        4
      ),
      {
        status: 500,
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}
