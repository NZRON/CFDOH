# scripts

本目录存放开发/调试脚本，不参与线上构建与运行。

## test_doh.js

测试任意 DoH 端点是否返回 JSON DNS 响应。

```bash
node scripts/test_doh.js [DoH_URL] [DOMAIN] [TYPE]
