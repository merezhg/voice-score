// =============================================================
//  声学分析 + 本地评分引擎（纯函数，无 DOM 依赖）
//  1) analyze() 从录音里测出基频、音域、明亮度、气声、语速等
//  2) localReport() 在没有大模型时也能生成完整报告
//  3) mergeReport() 把大模型返回的内容和本地测量合并、校验
// =============================================================
(function (root) {
  const SR = 16000;

  // ---------- 小工具 ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const band = (v, lo, hi) => clamp((v - lo) / (hi - lo), 0, 1);
  const median = (a) => percentile(a, 50);
  function percentile(arr, p) {
    if (!arr.length) return NaN;
    const s = Float64Array.from(arr).sort();
    const i = (s.length - 1) * p / 100, lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  function std(a) { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); }
  function hashNum(...xs) { // 确定性伪随机：同一段录音结果稳定
    let h = 2166136261;
    for (const x of xs) { h ^= Math.round((x || 0) * 1000); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 10000) / 10000;
  }

  // ---------- 重采样到 16k 单声道 ----------
  function resample(x, srIn, srOut = SR) {
    if (srIn === srOut) return Float32Array.from(x);
    const ratio = srIn / srOut;
    // 简单低通：按比例做滑动平均，避免混叠
    const k = Math.max(1, Math.round(ratio));
    let src = x;
    if (k > 1) {
      src = new Float32Array(x.length);
      let acc = 0;
      for (let i = 0; i < x.length; i++) {
        acc += x[i]; if (i >= k) acc -= x[i - k];
        src[i] = acc / Math.min(i + 1, k);
      }
    }
    const n = Math.floor(x.length / ratio), out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i * ratio, i0 = Math.floor(t), f = t - i0;
      out[i] = src[i0] * (1 - f) + (src[Math.min(i0 + 1, src.length - 1)]) * f;
    }
    return out;
  }

  // ---------- FFT（基 2，原地） ----------
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let j = 0; j < len / 2; j++) {
          const a = i + j, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  // ---------- YIN 基频检测 ----------
  const W = 512, MIN_LAG = Math.floor(SR / 500), MAX_LAG = Math.ceil(SR / 70);
  const dBuf = new Float64Array(MAX_LAG + 2);
  function yin(x, off) {
    dBuf[0] = 0;
    for (let tau = 1; tau <= MAX_LAG + 1; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) { const d = x[off + j] - x[off + j + tau]; s += d * d; }
      dBuf[tau] = s;
    }
    // 累积均值归一化
    let run = 0; const c = new Float64Array(MAX_LAG + 2); c[0] = 1;
    for (let tau = 1; tau <= MAX_LAG + 1; tau++) { run += dBuf[tau]; c[tau] = run > 0 ? dBuf[tau] * tau / run : 1; }
    let best = -1;
    for (let tau = MIN_LAG; tau <= MAX_LAG; tau++) {
      if (c[tau] < 0.15) { while (tau + 1 <= MAX_LAG && c[tau + 1] < c[tau]) tau++; best = tau; break; }
    }
    if (best < 0) {
      let m = Infinity;
      for (let tau = MIN_LAG; tau <= MAX_LAG; tau++) if (c[tau] < m) { m = c[tau]; best = tau; }
      if (m > 0.4) return { f0: 0, per: 1 - m };
    }
    // 抛物线插值
    const a = c[best - 1], b = c[best], d = c[best + 1];
    const den = a - 2 * b + d, shift = den ? 0.5 * (a - d) / den : 0;
    return { f0: SR / (best + clamp(shift, -1, 1)), per: clamp(1 - b, 0, 1) };
  }

  // ---------- 主分析 ----------
  // x: 16k 单声道 Float32Array；chars: 朗读文本字数（未知传 0）
  function analyze(x, chars = 0) {
    const N = 1024, HOP = 256;
    const frames = Math.max(0, Math.floor((x.length - N) / HOP));
    const db = new Float64Array(frames);
    for (let i = 0; i < frames; i++) {
      let s = 0; const o = i * HOP;
      for (let j = 0; j < N; j++) s += x[o + j] * x[o + j];
      db[i] = 10 * Math.log10(s / N + 1e-12);
    }
    const peakDb = frames ? Math.max(...db) : -120;
    const floor = percentile(Array.from(db), 10);
    const thr = Math.max(floor + 8, peakDb - 38, -58);
    const isSpeech = Array.from(db, v => v > thr);
    const speechIdx = []; isSpeech.forEach((s, i) => s && speechIdx.push(i));
    const speechSec = speechIdx.length * HOP / SR;

    // 归一化后做基频（只在说话帧上、每 2 帧一次）
    let peak = 0; for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
    const xn = peak > 0 ? x.map(v => v / peak) : x;
    const pitch = new Float64Array(frames), per = new Float64Array(frames);
    for (let i = 0; i < frames; i += 2) {
      if (!isSpeech[i] || i * HOP + W + MAX_LAG + 2 >= xn.length) continue;
      const r = yin(xn, i * HOP);
      pitch[i] = r.f0; per[i] = r.per;
    }
    // 去八度错误：离中位数超过 ±10 半音的点丢弃，再做 5 点中值滤波
    let voiced = []; for (let i = 0; i < frames; i += 2) if (pitch[i] > 0) voiced.push(pitch[i]);
    const med0 = median(voiced);
    for (let i = 0; i < frames; i += 2) {
      if (pitch[i] > 0 && Math.abs(12 * Math.log2(pitch[i] / med0)) > 10) pitch[i] = 0;
    }
    const track = [];
    for (let i = 0; i < frames; i += 2) track.push(pitch[i]);
    const smooth = track.map((v, i) => {
      if (!v) return 0;
      const w = track.slice(Math.max(0, i - 2), i + 3).filter(Boolean);
      return median(w);
    });
    voiced = smooth.filter(Boolean);
    const pers = []; for (let i = 0; i < frames; i += 2) if (pitch[i] > 0) pers.push(per[i]);

    const f0 = median(voiced);
    const p10 = percentile(voiced, 10), p90 = percentile(voiced, 90);
    const semis = voiced.map(v => 12 * Math.log2(v / f0));
    // 相邻音高变化（音分）：越小越稳
    const jumps = [];
    for (let i = 1; i < smooth.length; i++) if (smooth[i] && smooth[i - 1]) jumps.push(Math.abs(1200 * Math.log2(smooth[i] / smooth[i - 1])));

    // 频谱：明亮度（质心）与温暖度（低频占比），每 4 帧算一次
    const re = new Float64Array(N), im = new Float64Array(N);
    const hann = Float64Array.from({ length: N }, (_, j) => 0.5 - 0.5 * Math.cos(2 * Math.PI * j / (N - 1)));
    const cents = [], warms = [];
    for (let k = 0; k < speechIdx.length; k += 4) {
      const o = speechIdx[k] * HOP;
      for (let j = 0; j < N; j++) { re[j] = x[o + j] * hann[j]; im[j] = 0; }
      fft(re, im);
      let num = 0, den = 0, low = 0, mid = 0;
      for (let b = 1; b < N / 2; b++) {
        const hz = b * SR / N; if (hz < 80) continue;
        const m = Math.hypot(re[b], im[b]);
        num += hz * m; den += m;
        if (hz < 500) low += m * m; if (hz < 4000) mid += m * m;
      }
      if (den > 0) { cents.push(num / den); warms.push(low / (mid || 1)); }
    }

    // 停顿：说话中间 ≥300ms 的静音段
    let pauses = 0, run = 0, started = false;
    const minRun = Math.round(0.3 * SR / HOP);
    for (let i = 0; i < frames; i++) {
      if (isSpeech[i]) { if (started && run >= minRun) pauses++; run = 0; started = true; } else run++;
    }

    const speechDb = speechIdx.map(i => db[i]);
    // 用于画图的包络和音高轮廓（各 160 点）
    const P = 160, env = [], contour = [];
    for (let p = 0; p < P; p++) {
      const a = Math.floor(p * frames / P), b = Math.max(a + 1, Math.floor((p + 1) * frames / P));
      let m = -120; for (let i = a; i < b; i++) m = Math.max(m, db[i]);
      env.push(+band(m, thr - 6, peakDb).toFixed(3));
      const ta = Math.floor(a / 2), tb = Math.max(ta + 1, Math.floor(b / 2));
      const seg = smooth.slice(ta, tb).filter(Boolean);
      contour.push(seg.length && f0 ? +(12 * Math.log2(median(seg) / f0)).toFixed(2) : null);
    }

    const out = {
      duration: +(x.length / SR).toFixed(2),
      speechSec: +speechSec.toFixed(2),
      voicedFrames: voiced.length,
      f0: Math.round(f0) || 0,
      f0Low: Math.round(p10) || 0,
      f0High: Math.round(p90) || 0,
      rangeSemi: voiced.length ? +(12 * Math.log2(p90 / p10)).toFixed(1) : 0,
      pitchVar: semis.length ? +std(semis).toFixed(2) : 0,
      stability: jumps.length ? Math.round(median(jumps)) : 0,
      periodicity: pers.length ? +mean(pers).toFixed(3) : 0,
      centroid: cents.length ? Math.round(median(cents)) : 0,
      warmth: warms.length ? +median(warms).toFixed(3) : 0,
      dynRange: speechDb.length ? +(percentile(speechDb, 90) - percentile(speechDb, 10)).toFixed(1) : 0,
      snr: +(median(speechDb) - floor).toFixed(1),
      pauses,
      rate: chars && speechSec > 1 ? +(chars / speechSec).toFixed(1) : null,
      env, contour
    };
    out.valid = out.speechSec >= 2.5 && out.voicedFrames >= 25 && out.f0 >= 60;
    return out;
  }

  // ---------- WAV 编码（16-bit PCM） ----------
  function encodeWav(x, sr = SR) {
    const buf = new ArrayBuffer(44 + x.length * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, "RIFF"); v.setUint32(4, 36 + x.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, "data"); v.setUint32(40, x.length * 2, true);
    for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, clamp(x[i], -1, 1) * 0x7fff, true);
    return new Uint8Array(buf);
  }

  // ---------- 特征 → 0-1 画像 ----------
  function profile(f) {
    return {
      bright: band(f.centroid, 1000, 2400),
      breath: 1 - band(f.periodicity, 0.5, 0.9),
      expr: band(f.pitchVar, 1.5, 4.5) * 0.7 + band(f.dynRange, 6, 20) * 0.3,
      speed: f.rate ? band(f.rate, 3, 6) : 0.5
    };
  }

  function pickType(f, TYPES) {
    const pr = profile(f);
    let best = null, bestD = Infinity;
    for (const [id, t] of Object.entries(TYPES)) {
      const p = t.proto;
      const d = 1.6 * Math.abs(12 * Math.log2(f.f0 / p.f0)) / 4 +
        Math.abs(pr.bright - p.bright) + Math.abs(pr.breath - p.breath) +
        Math.abs(pr.expr - p.expr) + 0.7 * Math.abs(pr.speed - p.speed);
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  const tierOf = (score, TIERS) => TIERS.find(t => score >= t.min).name;

  // 分数拉开差距：最高最低至少差 10 分
  function spread(scores) {
    const vals = Object.values(scores), lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo >= 10) return scores;
    const m = mean(vals), k = 10 / Math.max(hi - lo, 1);
    const out = {};
    for (const [key, v] of Object.entries(scores)) out[key] = Math.round(clamp(m + (v - m) * k, 72, 98));
    return out;
  }

  function totalOf(scores, DIMS) {
    const t = DIMS.reduce((s, d) => s + d.w * scores[d.key], 0) + 2.4;
    return +clamp(t, 75, 99.2).toFixed(1);
  }

  // ---------- 本地报告 ----------
  function localReport(f, D, passage) {
    const pr = profile(f);
    const r = (i) => hashNum(f.f0, f.centroid, f.pitchVar, i);
    const typeId = pickType(f, D.TYPES), T = D.TYPES[typeId];
    const s = (v, i) => Math.round(72 + 24 * clamp(v, 0, 1) + (r(i) - 0.5) * 4);
    const rateFit = f.rate ? 1 - Math.min(Math.abs(f.rate - 4.5) / 2.5, 1) : 0.7;
    const zF0 = Math.abs(12 * Math.log2((f.f0 || 180) / 180)) / 10;
    let scores = {
      timbre: s(0.6 * band(f.periodicity, 0.5, 0.88) + 0.4 * (1 - Math.abs(pr.bright - 0.55)), 1),
      resonance: s(0.6 * band(f.warmth, 0.25, 0.75) + 0.4 * band(220 - f.f0, -80, 120), 2),
      clarity: s(0.4 * band(f.periodicity, 0.5, 0.9) + 0.3 * pr.bright + 0.3 * band(f.snr, 12, 35), 3),
      expressive: s(pr.expr, 4),
      rhythm: s(0.7 * rateFit + 0.3 * band(f.pauses, 1, 6), 5),
      unique: s(0.5 * band(zF0, 0, 0.8) + 0.3 * Math.abs(pr.breath - 0.35) * 2 + 0.2 * Math.abs(pr.bright - 0.5) * 2, 6)
    };
    scores = spread(scores);
    const lvl = (v) => v >= 88 ? 0 : v >= 80 ? 1 : 2;
    const dims = {};
    for (const d of D.DIMS) dims[d.key] = { score: scores[d.key], comment: D.DIM_COMMENTS[d.key][lvl(scores[d.key])] };

    const pick = (arr, n, salt) => {
      const a = arr.slice(), o = [];
      for (let i = 0; i < n && a.length; i++) o.push(a.splice(Math.floor(r(salt + i) * a.length), 1)[0]);
      return o;
    };
    const ordered = D.DIMS.map(d => d.key).sort((a, b) => scores[a] - scores[b]);
    const best = D.DIMS.find(d => d.key === ordered[ordered.length - 1]).name;
    const key = passage && passage.key;
    const highlight = key
      ? `读到「${key}」时，你的语调在 ${f.rangeSemi} 个半音之间自然起伏，${pr.breath > 0.5 ? "气息轻轻托着字尾" : "字尾收得干净利落"}，${best}是你最亮眼的一项。`
      : `你的平均音高在 ${f.f0} Hz 左右，语调有 ${f.rangeSemi} 个半音的起伏，${pr.breath > 0.5 ? "气息感很迷人" : "声音干净利落"}，${best}是你最亮眼的一项。`;

    const [a0, a1] = T.age;
    return {
      typeId,
      typeReason: T.desc,
      voiceAge: Math.round(a0 + (a1 - a0) * r(9)),
      dims,
      keywords: pick(T.keywords, 3, 20),
      highlight,
      careers: T.careers.map((name, i) => ({ name, match: 96 - i * 4 - Math.round(r(30 + i) * 3) })),
      scenes: T.scenes.slice(),
      song: T.song,
      tips: [D.TIPS[ordered[0]], D.TIPS[ordered[1]]],
      shareLine: T.share[Math.floor(r(40) * T.share.length)],
      source: "local"
    };
  }

  // ---------- 合并大模型结果（逐字段校验，缺失就用本地值） ----------
  function mergeReport(ai, local, D) {
    if (!ai || typeof ai !== "object") return local;
    const str = (v, max) => typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
    const arr = (v, n, max) => Array.isArray(v) ? v.map(x => str(x, max)).filter(Boolean).slice(0, n) : [];
    const out = Object.assign({}, local, { source: "ai" });
    if (D.TYPES[ai.voice_type_id]) out.typeId = ai.voice_type_id;
    out.typeReason = str(ai.type_reason, 60) || D.TYPES[out.typeId].desc;
    const age = parseInt(ai.voice_age, 10);
    if (age >= 14 && age <= 60) out.voiceAge = age;
    if (ai.dimensions && typeof ai.dimensions === "object") {
      const sc = {}, cm = {};
      for (const d of D.DIMS) {
        const it = ai.dimensions[d.key] || {};
        const v = parseInt(it.score, 10);
        sc[d.key] = Number.isFinite(v) ? clamp(v, 72, 98) : local.dims[d.key].score;
        cm[d.key] = str(it.comment, 32) || local.dims[d.key].comment;
      }
      const sp = spread(sc);
      out.dims = {};
      for (const d of D.DIMS) out.dims[d.key] = { score: sp[d.key], comment: cm[d.key] };
    }
    const kw = arr(ai.keywords, 3, 6); if (kw.length === 3) out.keywords = kw;
    out.highlight = str(ai.highlight, 90) || local.highlight;
    if (Array.isArray(ai.careers)) {
      const c = ai.careers.map(x => x && str(x.name, 12) ? { name: str(x.name, 12), match: clamp(parseInt(x.match, 10) || 88, 80, 99) } : null).filter(Boolean).slice(0, 3);
      if (c.length === 3) out.careers = c.sort((a, b) => b.match - a.match);
    }
    const sc2 = arr(ai.scenes, 3, 10); if (sc2.length === 3) out.scenes = sc2;
    out.song = str(ai.song_style, 16) || local.song;
    const tp = arr(ai.tips, 2, 40); if (tp.length) out.tips = tp;
    out.shareLine = str(ai.share_line, 20) || local.shareLine;
    return out;
  }

  function finalize(rep, f, D) {
    const scores = {}; for (const d of D.DIMS) scores[d.key] = rep.dims[d.key].score;
    rep.total = totalOf(scores, D.DIMS);
    rep.tier = tierOf(rep.total, D.TIERS);
    rep.features = f;
    rep.no = String(Math.floor(hashNum(f.f0, f.centroid, f.duration) * 9000) + 1000);
    const dt = new Date(); rep.date = dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
    return rep;
  }

  root.VOICE_ENGINE = { SR, resample, analyze, encodeWav, localReport, mergeReport, finalize, tierOf, profile, pickType };
})(typeof window !== "undefined" ? window : globalThis);
