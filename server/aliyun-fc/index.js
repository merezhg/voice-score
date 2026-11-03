// 阿里云函数计算 FC 3.0 · Node.js 20 · 事件函数 + HTTP 触发器
// 由 server/build.js 生成，修改请改 server/src/core.js
// 环境变量：DASHSCOPE_API_KEY（必填）、DASHSCOPE_BASE_URL、MODEL、ALLOWED_ORIGINS、RATE_LIMIT_PER_HOUR、DAILY_CAP
"use strict";

// ===== 声音测评 API 中转：核心逻辑（阿里云函数计算 / Cloudflare Worker 共用） =====
// 作用：前端把录音发到这里，这里带上你的 API Key 去调用通义千问 Omni，
// 这样 API Key 只存在云函数的环境变量里，不会出现在网页代码中。

const TYPE_LIST = [
  ["qingleng_shaonian", "清冷少年音", "干净清澈、略带距离感的少年气，中音偏亮"],
  ["wenrun_gongzi", "温润公子音", "温和圆润、语速平稳的中低音，让人安心"],
  ["dipaopao", "低音炮", "低沉厚实，胸腔共鸣明显"],
  ["cixing_dashu", "磁性大叔音", "成熟稳重，带沙哑颗粒感的低音"],
  ["yansang", "烟嗓", "明显沙哑、气声多，松弛有味道"],
  ["yuanqi_shaonv", "元气少女音", "高而明亮、语调跳跃、活力十足"],
  ["yujie", "御姐音", "中低音女声，从容沉稳有气场"],
  ["tianruan", "奶糖甜软音", "高音偏软糯，尾音上扬，甜而不腻"],
  ["zhixing_zhubo", "知性主播音", "吐字清晰、字正腔圆、节奏稳定"],
  ["shenye_diantai", "深夜电台音", "语速慢、气息柔、音量轻，治愈感强"],
  ["kongling", "空灵仙气音", "音高偏高、轻盈通透、带气声"],
  ["yangguang_qingnian", "阳光青年音", "明亮有活力的中音男声，语调上扬"],
  ["lanyang_qipao", "慵懒气泡音", "低能量、松弛、带气泡音或懒洋洋的拖音"],
  ["linjia_qingtian", "邻家清甜音", "自然清甜、亲切不做作的中高音"]
];

const DIM_LIST = [
  ["timbre", "音色质感", "声音的干净度、圆润度与颗粒感"],
  ["resonance", "共鸣磁性", "胸腔与口腔共鸣带来的厚度和磁性"],
  ["clarity", "清晰明亮", "咬字清楚程度与声音亮度"],
  ["expressive", "情绪感染", "语调起伏、情绪传递与感染力"],
  ["rhythm", "节奏韵律", "语速、停顿与呼吸节奏是否舒服"],
  ["unique", "声音辨识", "是否有让人一听就记住的个人特点"]
];

function num(v, d = 1) { const n = Number(v); return Number.isFinite(n) ? +n.toFixed(d) : "未知"; }

function buildPrompt(f, passage) {
  const types = TYPE_LIST.map(([id, n, d]) => `${id} | ${n} | ${d}`).join("\n");
  const dims = DIM_LIST.map(([k, n, d]) => `${k}（${n}）：${d}`).join("\n");
  return `你是「声音实验室」的首席声音评测师，懂发声、配音和声乐，说话温暖、具体、会夸人，像一位懂行又真诚的配音导演。

【任务】
仔细聆听这段用户录音，结合下方的客观声学测量值，生成一份娱乐向、但听起来很专业的声音测评报告。

【评测原则】
1. 只评价声音本身：音色、共鸣、气息、咬字、语调、节奏。不评价朗读内容的文采，不推测用户的身份、外貌、健康状况。
2. 夸奖要具体：引用你在录音里真实听到的细节，比如某个字的尾音、某处停顿、气息的位置、语调的起伏。不要编造录音里没有的内容。
3. voice_type_id 必须从【声线类型列表】中选一个最贴切的 id。优先依据你听到的音色，其次参考测量值。
4. 六个维度都打 72 到 98 之间的整数分。分数要拉开差距、体现这个人的特点，最高分和最低分至少相差 10 分。
5. 建议要温和，用"如果想更进一步"的口吻，每条都能直接照着练。
6. 不要说用户的声音像某位真实存在的明星、主播或任何真实人物。
7. 如果录音里基本听不到清晰的人声（只有噪音、音乐或静音），只返回 {"error":"no_voice"}。
8. 全部使用简体中文。只输出一个 JSON 对象，不要输出任何其他文字。

【声线类型列表】（id | 名称 | 特点）
${types}

【六个评分维度】
${dims}

【输出格式】
返回如下结构的 JSON：
{"voice_type_id":"","type_reason":"","voice_age":0,"dimensions":{"timbre":{"score":0,"comment":""},"resonance":{"score":0,"comment":""},"clarity":{"score":0,"comment":""},"expressive":{"score":0,"comment":""},"rhythm":{"score":0,"comment":""},"unique":{"score":0,"comment":""}},"keywords":["","",""],"highlight":"","careers":[{"name":"","match":0},{"name":"","match":0},{"name":"","match":0}],"scenes":["","",""],"song_style":"","tips":["",""],"share_line":""}

字段要求：
- type_reason：为什么是这种声线，20 到 40 字，提到你听到的具体特征。
- voice_age：这个声音听起来像多少岁，整数。
- dimensions 每项 comment：12 到 24 字的点评。
- keywords：3 个有画面感的氛围词，每个 2 到 5 字，比如"凌晨一点""薄荷感"。
- highlight：录音里最打动你的一个瞬间，40 到 70 字，具体到某个字词或停顿。
- careers：3 个最适合的声音相关职业，match 为 80 到 99 的整数，从高到低排列。
- scenes：3 个适合的内容场景，每个 10 字以内。
- song_style：适合唱的曲风，12 字以内，多个用" / "隔开。
- tips：2 条发声建议，每条 30 字以内。
- share_line：印在分享卡上的金句，16 字以内，用第二人称"你"。

【客观声学测量值】（由网页在本地测量，仅供参考，以你听到的为准）
- 有效说话时长：${num(f.speechSec)} 秒
- 平均基频：${num(f.f0, 0)} Hz（10% 到 90% 区间 ${num(f.f0Low, 0)} 到 ${num(f.f0High, 0)} Hz，跨度 ${num(f.rangeSemi)} 个半音）
- 语调起伏（音高标准差）：${num(f.pitchVar, 2)} 个半音
- 频谱质心（越高越明亮）：${num(f.centroid, 0)} Hz
- 周期性（越接近 1 越清亮，越低气声越多）：${num(f.periodicity, 2)}
- 低频能量占比（越高越温暖厚实）：${num(f.warmth, 2)}
- 响度动态范围：${num(f.dynRange)} dB
- 语速：${f.rate ? num(f.rate) + " 字/秒" : "未知（用户上传的自由录音）"}
- 明显停顿次数：${num(f.pauses, 0)}

【朗读文本】
${passage ? passage : "（用户上传的自由录音，没有固定文本）"}`;
}

// 只保留数值型特征，防止前端塞入奇怪内容
const FEATURE_KEYS = ["speechSec", "f0", "f0Low", "f0High", "rangeSemi", "pitchVar", "centroid", "periodicity", "warmth", "dynRange", "rate", "pauses"];
function cleanFeatures(f) {
  const out = {};
  for (const k of FEATURE_KEYS) { const v = Number(f && f[k]); out[k] = Number.isFinite(v) ? v : null; }
  return out;
}

function parseJson(text) {
  if (!text) return null;
  let t = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(t); } catch (e) { /* 继续尝试截取 */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; } }
  return null;
}

async function callModel(env, audioB64, prompt) {
  const base = (env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/+$/, "");
  const model = env.MODEL || "qwen3.8-omni-flash";
  const isNew = /^qwen3\.8/.test(model);          // 3.8 支持非流式 + reasoning_effort
  const stream = env.FORCE_STREAM === "1" || !isNew; // 旧版 Omni 只支持流式
  const body = {
    model,
    messages: [{
      role: "user",
      content: [
        { type: "input_audio", input_audio: { data: "data:audio/wav;base64," + audioB64, format: "wav" } },
        { type: "text", text: prompt }
      ]
    }],
    modalities: ["text"],
    temperature: 0.7,
    stream
  };
  if (isNew) { body.reasoning_effort = "none"; body.response_format = { type: "json_object" }; }
  else body.enable_thinking = false;
  if (stream) body.stream_options = { include_usage: true };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Number(env.TIMEOUT_MS || 45000));
  try {
    const res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.DASHSCOPE_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal
    });
    const raw = await res.text();
    if (!res.ok) throw new Error("upstream " + res.status + ": " + raw.slice(0, 300));
    if (!stream) {
      const j = JSON.parse(raw);
      return { text: j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content, usage: j.usage };
    }
    // 流式：把每个 data: 块里的 content 拼起来
    let text = "", usage = null;
    for (const line of raw.split("\n")) {
      const s = line.trim(); if (!s.startsWith("data:")) continue;
      const d = s.slice(5).trim(); if (!d || d === "[DONE]") continue;
      try {
        const j = JSON.parse(d);
        if (j.usage) usage = j.usage;
        const c = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
        if (c) text += c;
      } catch (e) { /* 跳过坏块 */ }
    }
    return { text, usage };
  } finally { clearTimeout(timer); }
}

// 简单限流（按实例内存计数，防止有人刷接口；多实例时是近似值）
const hits = new Map();
let dayKey = "", dayCount = 0;
function rateLimited(ip, env) {
  const perHour = Number(env.RATE_LIMIT_PER_HOUR || 8);
  const perDay = Number(env.DAILY_CAP || 3000);
  const now = Date.now(), today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) { dayKey = today; dayCount = 0; }
  if (dayCount >= perDay) return true;
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (list.length >= perHour) { hits.set(ip, list); return true; }
  list.push(now); hits.set(ip, list); dayCount++;
  if (hits.size > 5000) hits.clear();
  return false;
}

async function handle(req, env) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.origin || "";
  const originOk = !allowed.length || allowed.includes(origin);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": allowed.length ? (originOk ? origin : allowed[0]) : "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  const reply = (status, obj) => ({ status, headers, body: JSON.stringify(obj) });

  if (req.method === "OPTIONS") return { status: 204, headers, body: "" };
  if (req.method !== "POST") return reply(405, { ok: false, error: "method_not_allowed" });
  if (!originOk) return reply(403, { ok: false, error: "forbidden_origin" });
  if (!env.DASHSCOPE_API_KEY) return reply(500, { ok: false, error: "missing_api_key" });
  if (rateLimited(req.ip || "unknown", env)) return reply(429, { ok: false, error: "rate_limited" });

  let payload;
  try { payload = JSON.parse(req.bodyText || "{}"); } catch (e) { return reply(400, { ok: false, error: "bad_json" }); }
  const audio = payload.audio;
  if (typeof audio !== "string" || audio.length < 1000 || audio.length > 4_000_000 || !/^[A-Za-z0-9+/=]+$/.test(audio.slice(0, 200))) {
    return reply(400, { ok: false, error: "bad_audio" });
  }
  const passage = typeof payload.passage === "string" ? payload.passage.slice(0, 200) : "";
  const prompt = buildPrompt(cleanFeatures(payload.features), passage);

  const t0 = Date.now();
  try {
    const { text, usage } = await callModel(env, audio, prompt);
    const report = parseJson(text);
    console.log(JSON.stringify({ ms: Date.now() - t0, usage, parsed: !!report })); // 不记录录音内容
    if (!report) return reply(502, { ok: false, error: "bad_model_output" });
    if (report.error === "no_voice") return reply(200, { ok: false, error: "no_voice" });
    return reply(200, { ok: true, report });
  } catch (e) {
    console.log("model_error", String(e && e.message || e).slice(0, 300));
    return reply(502, { ok: false, error: "upstream" });
  }
}


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
