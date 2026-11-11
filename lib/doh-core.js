export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

export function getConfig(env) {
  let DoH = "one.one.one.one";
  if (env.DOH) {
    DoH = env.DOH;
    const match = DoH.match(/:\/\/([^\/]+)/);
    if (match) DoH = match[1];
  }
  let DoHPath = env.PATH || env.TOKEN || "dns-query";
  if (DoHPath.includes("/")) DoHPath = DoHPath.split("/")[1];
  return {
    DoH,
    jsonDoH: `https://${DoH}/resolve`,
    dnsDoH: `https://${DoH}/dns-query`,
    DoHPath,
  };
}

async function queryDns(dohServer, domain, type) {
  const dohUrl = new URL(dohServer);
  dohUrl.searchParams.set("name", domain);
  dohUrl.searchParams.set("type", type);

  const variants = [
    { headers: { Accept: "application/dns-json" } },
    { headers: {} },
    { headers: { Accept: "application/json" } },
    {
      headers: {
        Accept: "application/dns-json",
        "User-Agent": "Mozilla/5.0 DNS Client",
      },
    },
  ];

  let lastError = null;
  for (const options of variants) {
    try {
      const response = await fetch(dohUrl.toString(), options);
      if (response.ok) {
        const ct = response.headers.get("content-type") || "";
        if (ct.includes("json") || ct.includes("dns-json")) {
          return await response.json();
        }
        const text = await response.text();
        try {
          return JSON.parse(text);
        } catch (e) {
          throw new Error(
            `无法解析响应为JSON: ${e.message}, 内容: ${text.substring(0, 100)}`
          );
        }
      }
      const errText = await response.text();
      lastError = new Error(
        `DoH 返回错误 (${response.status}): ${errText.substring(0, 200)}`
      );
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("无法完成 DNS 查询");
}

export async function handleDohQuery(url, config) {
  const domain =
    url.searchParams.get("domain") ||
    url.searchParams.get("name") ||
    "www.google.com";
  const doh = url.searchParams.get("doh") || config.dnsDoH;
  const type = url.searchParams.get("type") || "all";

  let isLocal = false;
  try {
    isLocal = new URL(doh).host === url.host;
  } catch {
    isLocal = true;
  }
  const targetDoh = isLocal ? config.dnsDoH : doh;

  try {
    if (type === "all") {
      const [ipv4Result, ipv6Result, nsResult] = await Promise.all([
        queryDns(targetDoh, domain, "A"),
        queryDns(targetDoh, domain, "AAAA"),
        queryDns(targetDoh, domain, "NS"),
      ]);

      const nsRecords = [];
      if (nsResult.Answer?.length) {
        nsRecords.push(...nsResult.Answer.filter((r) => r.type === 2));
      }
      if (nsResult.Authority?.length) {
        nsRecords.push(
          ...nsResult.Authority.filter((r) => r.type === 2 || r.type === 6)
        );
      }

      const combined = {
        Status: ipv4Result.Status || ipv6Result.Status || nsResult.Status,
        TC: ipv4Result.TC || ipv6Result.TC || nsResult.TC,
        RD: ipv4Result.RD || ipv6Result.RD || nsResult.RD,
        RA: ipv4Result.RA || ipv6Result.RA || nsResult.RA,
        AD: ipv4Result.AD || ipv6Result.AD || nsResult.AD,
        CD: ipv4Result.CD || ipv6Result.CD || nsResult.CD,
        Question: [
          ...(ipv4Result.Question || []),
          ...(ipv6Result.Question || []),
          ...(nsResult.Question || []),
        ],
        Answer: [
          ...(ipv4Result.Answer || []),
          ...(ipv6Result.Answer || []),
          ...nsRecords,
        ],
        ipv4: { records: ipv4Result.Answer || [] },
        ipv6: { records: ipv6Result.Answer || [] },
        ns: { records: nsRecords },
      };

      return new Response(JSON.stringify(combined, null, 2), {
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    const result = await queryDns(targetDoh, domain, type);
    return new Response(JSON.stringify(result, null, 2), {
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify(
        {
          error: `DNS 查询失败: ${err.message}`,
          doh: targetDoh,
          domain,
          stack: err.stack,
        },
        null,
        2
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

export async function DOHRequest(request, config) {
  const { method, headers, body } = request;
  const UA = headers.get("User-Agent") || "DoH Client";
  const url = new URL(request.url);
  const { searchParams } = url;
  const { dnsDoH, jsonDoH } = config;

  try {
    if (method === "GET" && !url.search) {
      return new Response("Bad Request", {
        status: 400,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    let response;
    if (method === "GET" && searchParams.has("name")) {
      const searchDoH = searchParams.has("type")
        ? url.search
        : url.search + "&type=A";
      response = await fetch(dnsDoH + searchDoH, {
        headers: { Accept: "application/dns-json", "User-Agent": UA },
      });
      if (!response.ok) {
        response = await fetch(jsonDoH + searchDoH, {
          headers: { Accept: "application/dns-json", "User-Agent": UA },
        });
      }
    } else if (method === "GET") {
      response = await fetch(dnsDoH + url.search, {
        headers: { Accept: "application/dns-message", "User-Agent": UA },
      });
    } else if (method === "POST") {
      response = await fetch(dnsDoH, {
        method: "POST",
        headers: {
          Accept: "application/dns-message",
          "Content-Type": "application/dns-message",
          "User-Agent": UA,
        },
        body,
      });
    } else {
      return new Response(
        "不支持的请求格式: DoH请求需要包含name或dns参数，或使用POST方法",
        {
          status: 400,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `DoH 返回错误 (${response.status}): ${errorText.substring(0, 200)}`
      );
    }

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    responseHeaders.set("Access-Control-Allow-Headers", "*");
    if (method === "GET" && searchParams.has("name")) {
      responseHeaders.set("Content-Type", "application/json");
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return new Response(
      JSON.stringify(
        { error: `DoH 请求处理错误: ${error.message}`, stack: error.stack },
        null,
        4
      ),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}

export async function 代理URL(代理网址, 目标网址) {
  const 网址列表 = await 整理(代理网址);
  const 完整网址 = 网址列表[Math.floor(Math.random() * 网址列表.length)];
  const 解析后的网址 = new URL(完整网址);
  const 协议 = 解析后的网址.protocol.slice(0, -1) || "https";
  const 主机名 = 解析后的网址.hostname;
  let 路径名 = 解析后的网址.pathname;
  const 查询参数 = 解析后的网址.search;
  if (路径名.charAt(路径名.length - 1) === "/") 路径名 = 路径名.slice(0, -1);
  路径名 += 目标网址.pathname;
  const 新网址 = `${协议}://${主机名}${路径名}${查询参数}`;
  const 响应 = await fetch(新网址);
  const 新响应 = new Response(响应.body, {
    status: 响应.status,
    statusText: 响应.statusText,
    headers: 响应.headers,
  });
  新响应.headers.set("X-New-URL", 新网址);
  return 新响应;
}

async function 整理(内容) {
  let 替换后的内容 = 内容.replace(/[	|"'\r\n]+/g, ",").replace(/,+/g, ",");
  if (替换后的内容.charAt(0) === ",") 替换后的内容 = 替换后的内容.slice(1);
  if (替换后的内容.charAt(替换后的内容.length - 1) === ",") {
    替换后的内容 = 替换后的内容.slice(0, 替换后的内容.length - 1);
  }
  return 替换后的内容.split(",");
}
