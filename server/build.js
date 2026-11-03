// 把 src/core.js 和各平台入口拼成可以直接粘贴到控制台的单文件
// 用法：node server/build.js
const fs = require("fs"), path = require("path");
const core = fs.readFileSync(path.join(__dirname, "src/core.js"), "utf8");

const fc = `// 阿里云函数计算 FC 3.0 · Node.js 20 · 事件函数 + HTTP 触发器
// 由 server/build.js 生成，修改请改 server/src/core.js
// 环境变量：DASHSCOPE_API_KEY（必填）、DASHSCOPE_BASE_URL、MODEL、ALLOWED_ORIGINS、RATE_LIMIT_PER_HOUR、DAILY_CAP
"use strict";

${core}

exports.handler = async (event, context) => {
  let ev = event;
  if (Buffer.isBuffer(ev)) ev = ev.toString("utf8");
  if (typeof ev === "string") { try { ev = JSON.parse(ev); } catch (e) { ev = {}; } }
  const h = {};
  for (const [k, v] of Object.entries(ev.headers || {})) h[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  const http = (ev.requestContext && ev.requestContext.http) || {};
  let bodyText = ev.body || "";
  if (ev.isBase64Encoded && bodyText) bodyText = Buffer.from(bodyText, "base64").toString("utf8");
  const out = await handle({
    method: (http.method || ev.httpMethod || "POST").toUpperCase(),
    origin: h["origin"] || "",
    ip: http.sourceIp || h["x-forwarded-for"] || "unknown",
    bodyText
  }, process.env);
  return { statusCode: out.status, headers: out.headers, body: out.body, isBase64Encoded: false };
};

// 也可以当普通 Node 服务运行（FC "Web 函数"、自己的服务器等）：node index.js
if (require.main === module) {
  const port = Number(process.env.FC_SERVER_PORT || process.env.PORT || 9000);
  require("http").createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const out = await handle({
        method: req.method,
        origin: req.headers.origin || "",
        ip: (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim(),
        bodyText: Buffer.concat(chunks).toString("utf8")
      }, process.env);
      res.writeHead(out.status, out.headers); res.end(out.body);
    });
  }).listen(port, () => console.log("voice-score api on :" + port));
}
`;

const cf = `// Cloudflare Worker 版本（备选）
// 由 server/build.js 生成，修改请改 server/src/core.js
// 在 Worker 设置里添加变量：DASHSCOPE_API_KEY（加密）、DASHSCOPE_BASE_URL、MODEL、ALLOWED_ORIGINS

${core}

export default {
  async fetch(request, env) {
    const out = await handle({
      method: request.method,
      origin: request.headers.get("Origin") || "",
      ip: request.headers.get("CF-Connecting-IP") || "unknown",
      bodyText: request.method === "POST" ? await request.text() : ""
    }, env);
    return new Response(out.status === 204 ? null : out.body, { status: out.status, headers: out.headers });
  }
};
`;

fs.writeFileSync(path.join(__dirname, "aliyun-fc/index.js"), fc);
fs.writeFileSync(path.join(__dirname, "cloudflare-worker/worker.js"), cf);

// ESM 版本（控制台里文件名是 index.mjs 时用这个）
const fcEsm = `// 阿里云函数计算 FC 3.0 · Node.js 20 · 事件函数 + HTTP 触发器（index.mjs 版本）
// 由 server/build.js 生成，修改请改 server/src/core.js
// 环境变量：DASHSCOPE_API_KEY（必填）、DASHSCOPE_BASE_URL、MODEL、ALLOWED_ORIGINS、RATE_LIMIT_PER_HOUR、DAILY_CAP

${core}

export const handler = async (event, context) => {
  let ev = event;
  if (Buffer.isBuffer(ev)) ev = ev.toString("utf8");
  if (typeof ev === "string") { try { ev = JSON.parse(ev); } catch (e) { ev = {}; } }
  const h = {};
  for (const [k, v] of Object.entries(ev.headers || {})) h[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  const http = (ev.requestContext && ev.requestContext.http) || {};
  let bodyText = ev.body || "";
  if (ev.isBase64Encoded && bodyText) bodyText = Buffer.from(bodyText, "base64").toString("utf8");
  const out = await handle({
    method: (http.method || ev.httpMethod || "POST").toUpperCase(),
    origin: h["origin"] || "",
    ip: http.sourceIp || h["x-forwarded-for"] || "unknown",
    bodyText
  }, process.env);
  return { statusCode: out.status, headers: out.headers, body: out.body, isBase64Encoded: false };
};
`;
fs.writeFileSync(path.join(__dirname, "aliyun-fc/index.mjs"), fcEsm);
console.log("built server/aliyun-fc/index.js and server/cloudflare-worker/worker.js");
