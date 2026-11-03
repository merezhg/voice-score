// 网站配置：部署好 API 中转函数后，只需要改这里
window.VOICE_CONFIG = {
  // 阿里云函数计算（或 Cloudflare Worker）的 HTTP 触发器地址。
  // 留空 = 演示模式：结果由浏览器本地声学分析生成，不调用大模型。
  apiEndpoint: "https://voice-score-api-pqzyoykzmh.cn-beijing.fcapp.run",

  // 分享卡二维码指向的网址。留空则自动使用当前页面地址。
  siteUrl: "https://merezhg.github.io/voice-score/",

  minSeconds: 6,   // 最短录音秒数
  maxSeconds: 20   // 最长录音秒数（到时自动结束）
};
