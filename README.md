# 你的声音值多少分 · AI 声音测评

读一段话（6–20 秒），AI 从 6 个维度给声音打分，测出专属声线，并生成可长按保存的分享卡。

- 前端：纯静态网页，部署在 GitHub Pages
- AI：阿里云百炼 · 通义千问 `qwen3.8-omni-flash`（能直接"听"音频的全模态模型）
- 中转：阿里云函数计算 FC（保管 API Key，网页里不出现任何密钥）
- 没接 AI 时自动进入**演示模式**：浏览器本地声学分析也能出完整报告

## 目录

```
index.html          页面与样式
app.js              录音、分析流程、结果页、分享卡
engine.js           声学分析（基频/音域/明亮度/气声/语速）+ 本地评分引擎
design.js           测评设计：6 个维度、14 种声线、段位、文案素材
config.js           ← 部署后只需要改这里的 apiEndpoint
fonts/ vendor/      自托管字体与二维码库（国内访问更稳）
server/
  src/core.js       中转核心逻辑与大模型提示词
  aliyun-fc/index.js        阿里云函数计算版（直接粘贴到控制台）
  cloudflare-worker/worker.js   Cloudflare Worker 版（备选）
  build.js          修改 core.js 后运行 node server/build.js 重新生成上面两个文件
```

## 部署步骤

### 1. 开通百炼，拿到 API Key
1. 用阿里云账号登录百炼控制台（需完成实名认证），地域选 **华北2（北京）**。
2. 在「API-KEY」页面创建一个 Key（`sk-` 开头）。**不要发到聊天里，也不要提交到 GitHub。**
3. 在「模型」里确认 `qwen3.8-omni-flash` 可用，记下业务空间对应的调用地址，形如
   `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。
4. 建议在「费用中心」设置消费预警。

### 2. 部署中转函数（阿里云函数计算 FC 3.0）
1. 打开函数计算控制台 → 创建函数 → **事件函数**，运行环境选 **Node.js 20**，地域选华北2（北京）。
2. 把 `server/aliyun-fc/index.js` 的全部内容粘贴到在线编辑器的 `index.js`，请求处理程序填 `index.handler`。
3. 配置：执行超时 **60 秒**，内存 512 MB 即可。
4. 环境变量：

| 变量 | 必填 | 说明 |
|---|---|---|
| `DASHSCOPE_API_KEY` | 是 | 第 1 步拿到的 Key |
| `DASHSCOPE_BASE_URL` | 建议 | 第 1 步记下的调用地址（不填用 `https://dashscope.aliyuncs.com/compatible-mode/v1`） |
| `MODEL` | 否 | 默认 `qwen3.8-omni-flash` |
| `ALLOWED_ORIGINS` | 建议 | 只允许你的网站调用，如 `https://你的用户名.github.io` |
| `RATE_LIMIT_PER_HOUR` | 否 | 每个 IP 每小时次数，默认 8 |
| `DAILY_CAP` | 否 | 每个实例每天总次数上限，默认 3000 |

5. 添加触发器 → **HTTP 触发器**，认证方式选「无需认证」，请求方法勾选 **POST** 和 **OPTIONS**。
6. 复制触发器的公网访问地址。

### 3. 把地址填进网站
打开 `config.js`，把地址填到 `apiEndpoint`，提交即可生效。

### 4. GitHub Pages
仓库 Settings → Pages → Source 选 `Deploy from a branch`，分支 `main`，目录 `/ (root)`。
几分钟后网站地址为 `https://你的用户名.github.io/仓库名/`。

## 修改测评内容
- 改声线、维度、文案：编辑 `design.js`
- 改大模型提示词：编辑 `server/src/core.js`，然后 `node server/build.js`，再把新的 `aliyun-fc/index.js` 粘贴回控制台
- 新增或改名声线时，`design.js` 的 `TYPES` 与 `server/src/core.js` 的 `TYPE_LIST` 要保持同样的 id

## 注意
- 录音只在内存中处理，中转函数不保存音频、只记录耗时与 token 用量。
- 本站是娱乐测评。若面向国内公众长期运营，需留意个人信息保护（声音属于个人信息，页面已加同意勾选）以及生成式 AI 服务的相关备案要求。
