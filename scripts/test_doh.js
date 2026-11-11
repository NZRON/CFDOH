const DoH_URL = process.argv[2] || "https://cloudflare-dns.com/dns-query";
const DOMAIN  = process.argv[3] || "www.google.com";
const TYPE    = process.argv[4] || "A";

async function main() {
  const url = new URL(DoH_URL);
  url.searchParams.set("name", DOMAIN);
  url.searchParams.set("type", TYPE);

  console.log(`查询: ${DOMAIN} (${TYPE})`);
  console.log(`DoH : ${DoH_URL}`);
  console.log("");

  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/dns-json" },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`HTTP 错误: ${response.status}`);
      console.error(text.substring(0, 500));
      process.exit(1);
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("json")) {
      console.log(JSON.stringify(await response.json(), null, 2));
    } else {
      const buf = await response.arrayBuffer();
      console.log(`非 JSON 响应（可能是 application/dns-message），字节长度: ${buf.byteLength}`);
    }
  } catch (err) {
    console.error("错误:", err.message);
    process.exit(1);
  }
}

main();
