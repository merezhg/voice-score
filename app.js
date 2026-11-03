// =============================================================
//  页面逻辑：录音 → 本地声学分析 →（可选）大模型 → 报告 → 分享卡
// =============================================================
(function () {
  "use strict";
  const C = Object.assign({ apiEndpoint: "", siteUrl: "", minSeconds: 6, maxSeconds: 20 }, window.VOICE_CONFIG || {});
  const D = window.VOICE_DESIGN, E = window.VOICE_ENGINE;
  const $ = (id) => document.getElementById(id);
  const CJK = '"PingFang SC","HarmonyOS Sans SC","MiSans","Noto Sans SC","Source Han Sans SC","Microsoft YaHei",sans-serif';
  const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 存不了就算了 */ } }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
  const charCount = (t) => (t || "").replace(/[^一-龥A-Za-z0-9]/g, "").length;
  const siteUrl = () => C.siteUrl || (location.origin + location.pathname);

  // ---------------- 视图切换 ----------------
  const VIEWS = ["home", "record", "analyzing", "result", "error"];
  let current = "home";
  function show(name) {
    if (current === "record" && name !== "record") stopRecording();
    VIEWS.forEach((v) => { $("v-" + v).hidden = v !== name; });
    current = name;
    window.scrollTo(0, 0);
    if (name === "record") drawMeter([]);
    if (name === "home") { applyType(D.TYPES.shenye_diantai); drawHomeSleeve(); }
  }
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-go]");
    if (g) show(g.dataset.go);
  });

  function toast(msg, ms = 2400) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }

  function applyType(T) {
    const r = document.documentElement.style;
    r.setProperty("--t-deep", T.deep); r.setProperty("--t-light", T.light);
  }

  // ---------------- 首页 ----------------
  $("listenGrid").replaceChildren(...D.DIMS.map((d) => {
    const div = document.createElement("div");
    const b = document.createElement("b"); b.textContent = d.name;
    const s = document.createElement("small"); s.textContent = d.hint;
    div.append(b, s); return div;
  }));

  function sampleFeatures() {
    const env = [], contour = [];
    for (let i = 0; i < 160; i++) {
      const syl = Math.abs(Math.sin(i * 0.42)) * (0.55 + 0.45 * Math.sin(i * 0.07));
      const gap = (i % 40) > 34;
      env.push(gap ? 0.02 : +(0.25 + 0.7 * syl).toFixed(3));
      contour.push(gap ? null : +(3.2 * Math.sin(i * 0.09) + 1.6 * Math.sin(i * 0.31 + 1)).toFixed(2));
    }
    return { duration: 14.2, speechSec: 11.6, voicedFrames: 260, f0: 168, f0Low: 138, f0High: 205, rangeSemi: 6.9, pitchVar: 2.4, stability: 38, periodicity: 0.71, centroid: 1180, warmth: 0.58, dynRange: 13.2, snr: 28, pauses: 4, rate: 4.1, env, contour, valid: true };
  }

  function drawHomeSleeve() {
    const T = D.TYPES.shenye_diantai;
    drawSleeve($("homeSleeve").querySelector("canvas"), sampleFeatures(), T);
  }

  $("btnStart").onclick = () => show("record");
  $("btnSample").onclick = () => {
    const f = sampleFeatures();
    const rep = E.localReport(f, D, D.PASSAGES[1]);
    Object.assign(rep, {
      typeId: "shenye_diantai", voiceAge: 26, sample: true,
      keywords: ["凌晨一点", "台灯", "治愈"],
      highlight: "读到「晚上好」时，你把“好”字的尾音轻轻往下放，气息托着字尾慢慢收，像真的在跟一个睡不着的人打招呼。",
      careers: [{ name: "情感电台主播", match: 96 }, { name: "助眠主播", match: 93 }, { name: "有声书主播", match: 90 }],
      scenes: D.TYPES.shenye_diantai.scenes.slice(), song: D.TYPES.shenye_diantai.song,
      shareLine: "适合在凌晨一点被听见", typeReason: D.TYPES.shenye_diantai.desc
    });
    const sc = { timbre: 93, resonance: 90, clarity: 84, expressive: 88, rhythm: 95, unique: 91 };
    for (const k in sc) rep.dims[k].score = sc[k];
    E.finalize(rep, f, D);
    rep.no = "0427";
    renderResult(rep);
  };
  const last = store.get("vs_last");
  if (last && last.typeId && D.TYPES[last.typeId]) {
    $("btnLast").hidden = false;
    $("btnLast").onclick = () => renderResult(last);
  }

  // ---------------- 朗读文本 ----------------
  let pIdx = Math.floor(Math.random() * D.PASSAGES.length);
  function setPassage() {
    const p = D.PASSAGES[pIdx];
    $("passage").textContent = p.text;
    $("passageLen").textContent = charCount(p.text) + " 字 · 约 12 秒";
  }
  $("btnSwap").onclick = () => { if (rec) return; pIdx = (pIdx + 1) % D.PASSAGES.length; setPassage(); };
  setPassage();
  $("timer").innerHTML = "00.0<small> / " + C.maxSeconds + " s</small>";

  // ---------------- 录音 ----------------
  let rec = null;
  const levels = [];

  function needConsent() {
    if ($("agree").checked) return false;
    const c = $("consent"); c.classList.remove("shake"); void c.offsetWidth; c.classList.add("shake");
    toast("请先勾选同意录音分析");
    return true;
  }
  function recError(msg) { const e = $("recErr"); e.textContent = msg; e.hidden = !msg; }

  async function startRecording() {
    if (needConsent()) return;
    recError("");
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      recError("这个浏览器不支持网页录音。可以用手机自带浏览器打开，或者上传一段录音。");
      return;
    }
    const ctx = new AC(); // 必须在点击事件里创建，iOS 才会放行
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
    } catch (err) {
      ctx.close && ctx.close();
      const denied = err && (err.name === "NotAllowedError" || err.name === "SecurityError");
      recError(denied ? "没有拿到麦克风权限。请在浏览器设置里允许使用麦克风，或者上传一段录音。" : "麦克风打不开。可以换个浏览器试试，或者上传一段录音。");
      return;
    }
    if (ctx.state === "suspended") { try { await ctx.resume(); } catch (e) { /* ignore */ } }
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser(); an.fftSize = 1024;
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const mute = ctx.createGain(); mute.gain.value = 0;
    const chunks = [];
    proc.onaudioprocess = (e) => { chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    src.connect(an); src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
    rec = { ctx, stream, src, an, proc, chunks, sr: ctx.sampleRate, t0: performance.now(), buf: new Float32Array(an.fftSize) };
    levels.length = 0;
    $("btnRec").classList.add("on"); $("btnRec").setAttribute("aria-label", "结束录音");
    $("btnSwap").disabled = true;
    tick();
  }

  function tick() {
    if (!rec) return;
    const t = (performance.now() - rec.t0) / 1000;
    $("timer").innerHTML = t.toFixed(1).padStart(4, "0") + "<small> / " + C.maxSeconds + " s</small>";
    $("recHint").textContent = t < C.minSeconds ? "正在录音，再读 " + Math.ceil(C.minSeconds - t) + " 秒以上…" : "读完了就点一下结束";
    rec.an.getFloatTimeDomainData(rec.buf);
    let s = 0; for (let i = 0; i < rec.buf.length; i++) s += rec.buf[i] * rec.buf[i];
    levels.push(Math.min(1, Math.sqrt(s / rec.buf.length) * 6));
    if (levels.length > 90) levels.shift();
    drawMeter(levels);
    if (t >= C.maxSeconds) { finishRecording(); return; }
    rec.raf = requestAnimationFrame(tick);
  }

  function stopRecording() {
    if (!rec) return null;
    const r = rec; rec = null;
    cancelAnimationFrame(r.raf);
    try { r.src.disconnect(); r.proc.disconnect(); } catch (e) { /* ignore */ }
    r.stream.getTracks().forEach((t) => t.stop());
    r.ctx.close && r.ctx.close();
    $("btnRec").classList.remove("on"); $("btnRec").setAttribute("aria-label", "开始录音");
    $("btnSwap").disabled = false;
    $("recHint").textContent = "点一下开始录音，至少读 " + C.minSeconds + " 秒";
    $("timer").innerHTML = "00.0<small> / " + C.maxSeconds + " s</small>";
    return r;
  }

  function finishRecording() {
    if (!rec) return;
    const t = (performance.now() - rec.t0) / 1000;
    if (t < C.minSeconds) { toast("再多读几秒，至少 " + C.minSeconds + " 秒哦"); return; }
    const r = stopRecording();
    let n = 0; r.chunks.forEach((c) => { n += c.length; });
    const raw = new Float32Array(n); let o = 0;
    r.chunks.forEach((c) => { raw.set(c, o); o += c.length; });
    runAnalysis(raw, r.sr, D.PASSAGES[pIdx]);
  }

  $("btnRec").onclick = () => { rec ? finishRecording() : startRecording(); };

  function drawMeter(lv) {
    const cv = $("meter"); const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext("2d"); g.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue("--ink").trim(), line = css.getPropertyValue("--line").trim(), red = css.getPropertyValue("--rec").trim();
    const N = 90, step = w / N;
    for (let i = 0; i < N; i++) {
      const v = lv[i - (N - lv.length)];
      const bh = v === undefined ? 2 : Math.max(2, v * h * 0.95);
      g.fillStyle = v === undefined ? line : (i === N - 1 ? red : ink);
      g.globalAlpha = v === undefined ? 1 : 0.35 + 0.65 * (i / N);
      g.fillRect(i * step + step * 0.2, (h - bh) / 2, Math.max(1, step * 0.6), bh);
    }
  }

  // ---------------- 上传录音 ----------------
  $("fileIn").onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (needConsent()) return;
    recError("");
    if (file.size > 30 * 1024 * 1024) { recError("文件太大了，请上传 20 秒以内的录音。"); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      const buf = await file.arrayBuffer();
      const audio = await new Promise((res, rej) => {
        const p = ctx.decodeAudioData(buf, res, rej);
        if (p && p.then) p.then(res, rej);
      });
      const len = Math.min(audio.length, Math.floor(audio.sampleRate * C.maxSeconds));
      const raw = new Float32Array(len);
      for (let ch = 0; ch < audio.numberOfChannels; ch++) {
        const d = audio.getChannelData(ch);
        for (let i = 0; i < len; i++) raw[i] += d[i] / audio.numberOfChannels;
      }
      ctx.close && ctx.close();
      runAnalysis(raw, audio.sampleRate, null);
    } catch (err) {
      recError("这个文件读不出来，换成 mp3、m4a 或 wav 格式试试。");
    }
  };

  // ---------------- 分析流程 ----------------
  function runStages() {
    const items = Array.from($("stages").children);
    let i = 0;
    items.forEach((li) => { li.className = ""; });
    items[0].className = "now";
    const id = setInterval(() => {
      if (i >= items.length - 1) return;
      items[i].className = "done"; i++; items[i].className = "now";
    }, 700);
    return () => { clearInterval(id); items.forEach((li) => { li.className = "done"; }); };
  }

  function showError(title, msg) {
    $("errTitle").textContent = title; $("errMsg").textContent = msg; show("error");
  }
  $("btnRetry").onclick = () => show("record");

  function toBase64(u8) {
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }

  async function callAI(x, f, passage) {
    const audio = toBase64(E.encodeWav(x.subarray(0, E.SR * C.maxSeconds)));
    const features = Object.assign({}, f); delete features.env; delete features.contour;
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 50000);
    try {
      const res = await fetch(C.apiEndpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal,
        body: JSON.stringify({ audio, features, passage: passage ? passage.text : "" })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { const e = new Error(data.error || "http_" + res.status); e.code = data.error || "upstream"; throw e; }
      return data.report;
    } finally { clearTimeout(to); }
  }

  async function runAnalysis(raw, sr, passage) {
    show("analyzing");
    const done = runStages();
    const minWait = sleep(reduceMotion ? 600 : 3400);
    await nextFrame();
    const x = E.resample(raw, sr);
    const f = E.analyze(x, passage ? charCount(passage.text) : 0);
    if (!f.valid) {
      done(); await sleep(300);
      showError("没太听清", "录音里没有检测到清晰的人声。找个安静的地方，手机离嘴 20 厘米左右，用平时说话的音量再读一次。");
      return;
    }
    const local = E.localReport(f, D, passage);
    let rep = local, note = C.apiEndpoint ? null : "demo";
    if (C.apiEndpoint) {
      try {
        const ai = await callAI(x, f, passage);
        rep = E.mergeReport(ai, local, D);
      } catch (err) {
        if (err.code === "no_voice") {
          done(); showError("没太听清", "AI 没有听到清晰的人声。找个安静的地方，用平时说话的音量再读一次。");
          return;
        }
        note = err.code === "rate_limited" ? "今天测试的人有点多，这份报告由本地声学引擎生成。" : "AI 暂时有点忙，这份报告由本地声学引擎生成。";
      }
    }
    await minWait; done(); await sleep(350);
    E.finalize(rep, f, D);
    rep.note = note;
    store.set("vs_last", rep);
    $("btnLast").hidden = false; $("btnLast").onclick = () => renderResult(store.get("vs_last") || rep);
    renderResult(rep);
  }

  // ---------------- 结果页 ----------------
  let currentRep = null;
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };

  function renderResult(rep) {
    currentRep = rep;
    const T = D.TYPES[rep.typeId] || D.TYPES.wenrun_gongzi, f = rep.features;
    applyType(T);
    const banner = $("resBanner");
    banner.textContent = rep.sample ? "这是一份示例报告。点下面的「再测一次」，测测你自己的声音。"
      : rep.note === "demo" ? "演示模式：网站还没接入大模型，这份报告由浏览器本地的声学分析生成。"
      : rep.note || "";
    banner.hidden = !banner.textContent;
    $("resSource").textContent = rep.source === "ai" ? "AI Report" : "Acoustic Report";
    $("resNo").textContent = "Voice Report · No." + rep.no;
    $("resDate").textContent = rep.date;
    $("resType").textContent = T.name;
    $("resTag").textContent = T.tagline;
    $("resTier").textContent = rep.tier;
    $("resAge").textContent = "声音年龄 " + rep.voiceAge + " 岁";
    $("resStars").textContent = "稀有度 " + "★".repeat(T.stars) + "☆".repeat(5 - T.stars);
    $("resReason").textContent = rep.typeReason;
    $("resKw").replaceChildren(...rep.keywords.map((k) => el("li", k)));
    $("resHighlight").textContent = rep.highlight;

    // 维度列表
    $("dimList").replaceChildren(...D.DIMS.map((d) => {
      const it = rep.dims[d.key];
      const li = el("li");
      const nm = el("span", d.name, "nm"); nm.append(el("small", d.en));
      const bar = el("div", null, "bar"); const fill = el("i"); fill.style.width = Math.round((it.score - 50) * 2) + "%"; bar.append(fill);
      li.append(nm, el("span", String(it.score), "sc"), bar, el("span", it.comment, "cm"));
      return li;
    }));
    drawRadar(rep);

    // 实测数据
    const pr = E.profile(f);
    const metrics = [
      ["平均音高", f.f0, "Hz"],
      ["音域跨度", f.rangeSemi, "半音"],
      ["语速", f.rate == null ? "—" : f.rate, f.rate == null ? "" : "字/秒"],
      ["明亮度", f.centroid, "Hz"],
      ["气声感", Math.round(pr.breath * 100), "%"],
      ["动态范围", f.dynRange, "dB"]
    ];
    $("metrics").replaceChildren(...metrics.map(([k, v, u]) => {
      const div = el("div"); const dd = el("dd", String(v)); if (u) dd.append(el("small", u));
      div.append(el("dt", k), dd); return div;
    }));

    $("careers").replaceChildren(...rep.careers.map((c, i) => {
      const li = el("li"); li.append(el("span", String(i + 1), "rk"), el("span", c.name, "nm"), el("span", c.match + "% 匹配", "mt")); return li;
    }));
    $("scenes").replaceChildren(...rep.scenes.map((s) => el("span", s)));
    $("song").replaceChildren(...rep.song.split(/\s*\/\s*/).map((s) => el("span", s)));
    $("tips").replaceChildren(...rep.tips.map((t) => el("li", t)));

    show("result");
    requestAnimationFrame(() => drawSleeve($("sleeveCanvas"), f, T));
    countUp($("resTotal"), rep.total);
  }

  function countUp(node, target) {
    if (reduceMotion) { node.textContent = target.toFixed(1); return; }
    const t0 = performance.now(), dur = 1100;
    (function step(now) {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      node.textContent = (target * e).toFixed(1);
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  function drawRadar(rep) {
    const svg = $("radar"), NS = "http://www.w3.org/2000/svg";
    const cx = 180, cy = 136, R = 88, n = D.DIMS.length;
    const pt = (i, r) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
    const rad = (s) => R * Math.max(0, (s - 60) / 40);
    const mk = (tag, attrs, style) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (style) e.setAttribute("style", style); return e; };
    const nodes = [];
    [70, 80, 90, 100].forEach((lv) => {
      nodes.push(mk("polygon", { points: D.DIMS.map((_, i) => pt(i, rad(lv)).join(",")).join(" ") }, "fill:none;stroke:var(--line);stroke-width:1"));
    });
    D.DIMS.forEach((_, i) => { const [x, y] = pt(i, R); nodes.push(mk("line", { x1: cx, y1: cy, x2: x, y2: y }, "stroke:var(--line);stroke-width:1")); });
    const pts = D.DIMS.map((d, i) => pt(i, rad(rep.dims[d.key].score)));
    nodes.push(mk("polygon", { points: pts.map((p) => p.join(",")).join(" ") }, "fill:var(--tone);fill-opacity:.18;stroke:var(--tone);stroke-width:2;stroke-linejoin:round"));
    pts.forEach(([x, y]) => nodes.push(mk("circle", { cx: x, cy: y, r: 3.5 }, "fill:var(--tone)")));
    D.DIMS.forEach((d, i) => {
      const [x, y] = pt(i, R + 22);
      const anchor = Math.abs(x - cx) < 4 ? "middle" : x > cx ? "start" : "end";
      const t = mk("text", { x, y: y + 4, "text-anchor": anchor }, "fill:var(--ink-2);font-size:12px;font-weight:600;font-family:inherit");
      t.textContent = d.name + " " + rep.dims[d.key].score;
      nodes.push(t);
    });
    svg.replaceChildren(...nodes);
  }

  // ---------------- 封套绘制（DOM 封面与分享卡共用） ----------------
  function paintWave(g, f, T, x0, y0, w, h, lineW) {
    // 振幅包络：上下对称的细条
    const N = f.env.length, step = w / N;
    g.fillStyle = T.light;
    for (let i = 0; i < N; i++) {
      const a = f.env[i] * h * 0.42;
      g.globalAlpha = 0.16;
      g.fillRect(x0 + i * step + step * 0.25, y0 + h / 2 - a, Math.max(1, step * 0.5), a * 2);
    }
    // 音高曲线：用户自己的语调起伏
    g.globalAlpha = 1; g.strokeStyle = T.light; g.lineWidth = lineW; g.lineJoin = "round"; g.lineCap = "round";
    g.shadowColor = T.light; g.shadowBlur = lineW * 4;
    const yOf = (v) => y0 + h / 2 - Math.max(-9, Math.min(9, v)) / 9 * h * 0.46;
    let open = false, lastPt = null;
    g.beginPath();
    for (let i = 0; i < N; i++) {
      const v = f.contour[i], x = x0 + (i + 0.5) * step;
      if (v == null) { open = false; continue; }
      const y = yOf(v);
      if (!open) { g.moveTo(x, y); open = true; } else g.lineTo(x, y);
      lastPt = [x, y];
    }
    g.stroke(); g.shadowBlur = 0;
    if (lastPt) { g.beginPath(); g.arc(lastPt[0], lastPt[1], lineW * 2.2, 0, Math.PI * 2); g.fillStyle = T.light; g.fill(); }
  }

  function paintGrooves(g, T, w, h, scale) {
    g.save(); g.strokeStyle = T.light; g.globalAlpha = 0.07; g.lineWidth = 1 * scale;
    const cx = w * 1.02, cy = h * 0.08;
    for (let r = 40 * scale; r < Math.max(w, h) * 1.2; r += 9 * scale) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); }
    g.restore();
  }

  function drawSleeve(cv, f, T) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext("2d"); g.scale(dpr, dpr);
    g.fillStyle = T.deep; g.fillRect(0, 0, w, h);
    paintGrooves(g, T, w, h, 1);
    paintWave(g, f, T, 0, h * 0.5, w, h * 0.26, 2.2);
  }

  let rz;
  window.addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      if (current === "home") drawHomeSleeve();
      if (current === "result" && currentRep) drawSleeve($("sleeveCanvas"), currentRep.features, D.TYPES[currentRep.typeId]);
    }, 150);
  });

  // ---------------- 分享卡（1080×1440） ----------------
  function wrapLines(g, text, maxW, maxLines) {
    const lines = []; let cur = "";
    for (const ch of text) {
      if (g.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; if (lines.length === maxLines) break; }
      else cur += ch;
    }
    if (lines.length < maxLines && cur) lines.push(cur);
    return lines;
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  async function makeCard(rep) {
    try { await Promise.all([document.fonts.load('200px "DM Serif Display"'), document.fonts.load('500 30px "JetBrains Mono"')]); } catch (e) { /* 用备用字体 */ }
    const T = D.TYPES[rep.typeId], f = rep.features;
    const W = 1080, H = 1440, M = 80;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    g.fillStyle = T.deep; g.fillRect(0, 0, W, H);
    paintGrooves(g, T, W, H, 2.4);

    // 顶部
    g.fillStyle = T.light; g.globalAlpha = 0.7; g.textBaseline = "alphabetic";
    g.font = '500 26px "JetBrains Mono", monospace';
    g.fillText("VOICE REPORT · No." + rep.no, M, 112);
    g.textAlign = "right"; g.fillText(rep.date, W - M, 112); g.textAlign = "left";

    // 声线名
    g.globalAlpha = 0.8; g.font = "500 36px " + CJK; g.fillText("你的声线是", M, 228);
    g.globalAlpha = 1; let fs = 128; g.font = "900 " + fs + "px " + CJK;
    while (g.measureText(T.name).width > W - 2 * M && fs > 70) { fs -= 6; g.font = "900 " + fs + "px " + CJK; }
    g.fillText(T.name, M - 4, 360);
    g.globalAlpha = 0.85; g.font = "400 38px " + CJK; g.fillText(T.tagline, M, 428);

    // 分数
    g.globalAlpha = 1; g.font = '220px "DM Serif Display", Georgia, serif';
    const sTxt = rep.total.toFixed(1); g.fillText(sTxt, M - 8, 660);
    const sw = g.measureText(sTxt).width;
    g.globalAlpha = 0.7; g.font = '500 32px "JetBrains Mono", monospace'; g.fillText("/100", M + sw + 8, 660);
    // 段位徽章
    g.globalAlpha = 1; g.font = "800 36px " + CJK;
    const tw = g.measureText(rep.tier).width + 56, tx = W - M - tw;
    roundRect(g, tx, 520, tw, 64, 32); g.fillStyle = T.light; g.fill();
    g.fillStyle = T.deep; g.textAlign = "center"; g.fillText(rep.tier, tx + tw / 2, 565);
    g.fillStyle = T.light; g.textAlign = "right"; g.globalAlpha = 0.85; g.font = "500 30px " + CJK;
    g.fillText("声音年龄 " + rep.voiceAge + " 岁", W - M, 640); g.textAlign = "left";

    // 我的音高曲线
    g.globalAlpha = 0.6; g.font = '500 22px "JetBrains Mono", monospace';
    g.fillText("MY PITCH CONTOUR · AVG " + f.f0 + " Hz", M, 724);
    paintWave(g, f, T, M, 742, W - 2 * M, 150, 5);

    // 关键词
    g.globalAlpha = 1; g.font = "700 32px " + CJK; let kx = M;
    rep.keywords.forEach((k) => {
      const t = "#" + k, w = g.measureText(t).width + 44;
      roundRect(g, kx, 912, w, 58, 29); g.strokeStyle = T.light; g.lineWidth = 2; g.globalAlpha = 0.6; g.stroke();
      g.globalAlpha = 1; g.fillStyle = T.light; g.fillText(t, kx + 22, 952); kx += w + 16;
    });

    // 金句
    g.font = "800 46px " + CJK;
    wrapLines(g, "「" + rep.shareLine + "」", W - 2 * M, 2).forEach((ln, i) => g.fillText(ln, M, 1046 + i * 58));

    // 六维小分：一行六列
    const colW = (W - 2 * M) / 6;
    D.DIMS.forEach((d, i) => {
      const x = M + i * colW;
      g.globalAlpha = 0.7; g.font = "500 24px " + CJK; g.fillText(d.name, x, 1168);
      g.globalAlpha = 1; g.font = '46px "DM Serif Display", Georgia, serif'; g.fillText(String(rep.dims[d.key].score), x, 1222);
    });

    // 底部：二维码
    g.globalAlpha = 1; g.fillStyle = T.light; g.fillRect(0, 1262, W, H - 1262);
    g.fillStyle = T.deep; g.font = "900 42px " + CJK; g.fillText("你的声音值多少分？", M, 1340);
    g.globalAlpha = 0.75; g.font = "500 28px " + CJK; g.fillText("扫码读一段话 · 15 秒出报告", M, 1388);
    g.globalAlpha = 1;
    try {
      const qr = window.qrcode(0, "M"); qr.addData(siteUrl()); qr.make();
      const n = qr.getModuleCount(), size = 136, cell = size / n, qx = W - M - size, qy = 1283;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(qx + c * cell, qy + r * cell, Math.ceil(cell), Math.ceil(cell));
    } catch (e) { /* 二维码失败时只保留文字 */ }
    return cv.toDataURL("image/png");
  }

  $("btnCard").onclick = async () => {
    if (!currentRep) return;
    const btn = $("btnCard"); btn.disabled = true; btn.textContent = "正在生成…";
    try {
      const url = await makeCard(currentRep);
      $("cardImg").src = url; $("cardDl").href = url;
      $("cardModal").hidden = false;
    } catch (e) { toast("分享卡生成失败，请截图分享"); }
    btn.disabled = false; btn.textContent = "生成分享卡";
  };
  $("cardClose").onclick = () => { $("cardModal").hidden = true; };
  $("cardModal").onclick = (e) => { if (e.target === $("cardModal")) $("cardModal").hidden = true; };

  $("btnInvite").onclick = async () => {
    if (!currentRep) return;
    const T = D.TYPES[currentRep.typeId];
    const text = "我的声音被 AI 打了 " + currentRep.total.toFixed(1) + " 分，测出来是「" + T.name + "」！你的声音值多少分？" + siteUrl();
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
      const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.append(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
      ta.remove();
    }
    toast(ok ? "邀请语已复制，去粘贴给朋友吧" : "复制没成功，可以直接把网址发给朋友：" + siteUrl(), 3200);
  };
  $("btnAgain").onclick = () => show("record");

  // ---------------- 启动 ----------------
  show("home");
  if (location.hash === "#sample") $("btnSample").click();
})();
