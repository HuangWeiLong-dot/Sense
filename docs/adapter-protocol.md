# JEV / TypeSafe 适配协议

Sense 把「调用判断模型」抽象成一个 `JudgeAdapter`：输入是脱敏后的文本 + questions，输出是归一化后的答案。只要你的服务符合下面任一协议，就能直接接入。

这一层是 Sense 唯一会向外发送**判断请求**的地方，也是你审计「数据到底发出去了什么」的入口。

---

## 1. 通用数据结构

### questions（与 spec 完全一致）

```json
{
  "好感度": {
    "type": "score",
    "instructions": "判断对方在这轮对话中对用户的情感倾向，从冷漠到热情。",
    "legend": { "0": "明显反感", "2": "冷淡敷衍", "4": "中性礼貌", "6": "友好积极", "8": "明显好感", "10": "热烈喜欢" }
  },
  "投入度": {
    "type": "choice",
    "instructions": "判断对方在这轮对话中的投入程度。",
    "criteria": {
      "主动推进": "对方主动发起话题、提问、延伸对话",
      "配合回应": "对方正常回应但不主动延伸",
      "被动敷衍": "回复简短（嗯/哦/好）、延迟、不接话",
      "回避冷淡": "不回复关键内容、转移话题、明确回避"
    }
  },
  "风险信号": {
    "type": "choice",
    "instructions": "判断这轮对话中是否存在以下关系风险信号，选择最显著的一项。",
    "criteria": {
      "无明显信号": "对话正常，无风险特征",
      "冷暴力倾向": "持续不回应、故意忽视、惩罚性沉默",
      "情感操控倾向": "贬低、让用户自我怀疑、责任转移",
      "间歇性强化": "忽冷忽热、奖励惩罚交替",
      "暧昧不承诺": "亲密语言但回避关系定义"
    }
  }
}
```

- `type: "score"` → 期望返回 **0-10 的数字**（允许一位小数，会被裁剪到 `[0,10]`）。
- `type: "choice"` → 期望返回 **`criteria` 的某个 key 原文**。

汇总判断使用另一组 questions：`整体关系温度`（score）、`关系风险等级`（choice）、`关系阶段判断`（choice），定义见 `src/core/jev/questions.ts` 的 `SUMMARY_QUESTIONS`。

### 逐轮输入（`input`）

```
我：今天有空吗？想约你吃饭
对方：这周有点忙诶
```

- 我方连续多条消息合并成一段（`我：` 前缀一次），对方一次回复结束这一轮。
- 只包含**脱敏后**文本：昵称已替换为「对方」/「我」，时间戳按开关移除，手机号/邮箱/证件号/卡号/链接始终替换。
- 对方未回复的末轮不参与判断；对方先开口的那一轮会作为独立一轮（`mine` 为空）。

### 汇总输入（`input`）

汇总判断**不重新喂原始对话**，只喂结构化汇总：

```json
{
  "总轮数": 24,
  "好感度趋势": [6, 7, 7, 8, 6, 5, 4, 3],
  "好感度均值": 5.8,
  "投入度分布": { "主动推进": 3, "配合回应": 8, "被动敷衍": 10, "回避冷淡": 3 },
  "风险信号分布": { "无明显信号": 15, "冷暴力倾向": 4, "情感操控倾向": 2, "间歇性强化": 2, "暧昧不承诺": 1 },
  "派生指标": { "投入度得分": 5.1, "风险指数": 3.4, "判断失败轮数": 0 }
}
```

---

## 2. TypeSafe（Jev 原生接口）

`settings.judge.provider = "typesafe"`

按 TypeSafe 官方文档实现（[API reference](https://docs.typesafe.ai/api)、[Models](https://docs.typesafe.ai/models)）。

### 请求

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <你的 TypeSafe API Key>
Content-Type: application/json
```

```json
{
  "state": "我：今天有空吗？想约你吃饭\n对方：这周有点忙诶",
  "model": "jev-latest",
  "questions": {
    "好感度": {
      "type": "score",
      "instructions": "判断对方在这轮对话中对用户的情感倾向，从冷漠到热情。",
      "criteria": ["明显反感", "冷淡敷衍", "中性礼貌", "友好积极", "明显好感", "热烈喜欢"]
    },
    "投入度": {
      "type": "choice",
      "instructions": "判断对方在这轮对话中的投入程度。",
      "criteria": { "主动推进": "…", "配合回应": "…", "被动敷衍": "…", "回避冷淡": "…" }
    }
  }
}
```

- Base URL 默认 `https://api.typesafe.ai/v1`，Path 默认 `/systemone`，都在设置页可改（例如换成代理网关）。
- 模型默认 `jev-latest`（官方别名，当前指向 `jev-1.13.0`）。
- 请求体字段是 **`state`**，不是 `input` —— 这是官方 schema。
- **`score` 与 `choice` 的 `criteria` 形态不同**：`choice` 是「取值 → 含义」的对象；`score` 是一个**标签数组**，返回分数连续落在 `0 .. criteria.length - 1`（官方示例里 3 档会返回 `1.04` 这种连续值）。
- **score 的档位上限是 10 档**，超了会直接报错：`HTTP 400 {"detail":"Too many score levels. Must have at most 10 levels."}`。Sense 内部用 `legend` 描述刻度上的锚点（好感度是 `0/2/4/6/8/10` 共 6 个），`toTypeSafeWire()` 直接拿这 6 个锚点标签当档位（6 ≤ 10），再由 `applyScoreMaps()` 把返回的 `0..5` 仿射映射回 `0..10` —— 所以内部分数刻度始终是 0-10。锚点若超过 10 个，会等距抽样并保留首尾端点。
- 顺带一提：**不要**为了凑 0-10 而把锚点之间补成 11 个整数档（「介于 A 与 B 之间」那种）—— 那正是触发上面 400 的写法。
- `GET /v1/models` 可以列出账号可用的模型名与别名。

### 响应

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "好感度": { "type": "score", "score": 6.2, "confidence": 0.91, "legend": { "0": "…" }, "probabilities": { "…": 0.1 } },
    "投入度": { "type": "choice", "choice": "被动敷衍", "confidence": 0.8, "probabilities": { "…": 0.8 } }
  },
  "usage": { "input_tokens": 426, "output_tokens": 73 }
}
```

归一化层同时兼容简写形式，因此自建网关只要返回下面任意一种包装也能用（会递归查找第一个包含 question 名的对象）：

```json
{ "answers": { ... } }
{ "result": { ... } }
{ "data": { "result": { ... } } }
{ "好感度": 6, "投入度": "...", "风险信号": "..." }
```

单个答案也允许写成对象：`{ "好感度": { "score": 6 } }`、`{ "投入度": { "answer": "被动敷衍" } }`。

> 语言说明：Jev 以英文为主要训练语言，官方明确表示 CJK 等其他语言「可用但不如英文准确」，建议在自己的语料上先试、并留意 `confidence`。

### ⚠️ 浏览器 CORS

`api.typesafe.ai` **不返回 `Access-Control-Allow-Origin`**，因此从网页里 `fetch` 会被浏览器直接拦下，表现为 `TypeError: Failed to fetch` —— **和 Key 是否正确无关**。实测：

| 方式 | 结果 |
| --- | --- |
| DNS 解析 | `api.typesafe.ai → 104.18.25.46`（Cloudflare）✅ |
| 非浏览器请求（带任意 Key） | `HTTP 401 Unauthorized` ✅ 端点真实存在 |
| 浏览器 CORS 预检（`OPTIONS`） | `HTTP 400`，无 `Access-Control-Allow-Origin` ❌ |

所以在纯网页版里能不能直连，取决于对方是否返回 `Access-Control-Allow-Origin`：**DeepSeek 可以直连**（实测预检 `200` + 回显来源），**TypeSafe 不行**（预检 `400`），需要时用 Sense 自带的本地代理：

```bash
npm run proxy                    # 只监听 127.0.0.1:8787
```

在「设置 → 网络代理」打开开关后，请求会被改写成 `<proxy>/__proxy/<host>/<path>`，
由本机进程转发到上游并把 CORS 头补上。实测：网页直连 TypeSafe 是 `Failed to fetch`，走代理后拿到真实的 `HTTP 401`。
详见仓库 README 的「本地 CORS 代理」。桌面壳（Tauri/Electron）不受 CORS 限制，也不需要代理。

### 错误处理

- 非 2xx → 抛出 `HTTP <code> <status> - <body 前 240 字>`（官方限流是 `429`，响应会带 `retry-after`）。
- 响应不是合法 JSON → 抛出可读错误。
- 缺少任一问题的可用答案 → 抛错（**绝不静默编造分数**）。
- 每轮失败后自动重试 1 次（间隔 400ms），仍失败则该轮标记为 `degraded`，用中性值填充并**排除在统计之外**；如果全部轮次都失败，整个分析会报错而不是给出假结论。
- 设置页的「测试连接」会发一轮真实的最小请求，可以直接确认 Base URL / Path / Key / 模型是否都对。

---

## 3. OpenAI 兼容

`settings.judge.provider = "openai"`

用于自建网关、DeepSeek、OpenAI、Ollama 等任何实现了 `/chat/completions` 的服务。

```http
POST {Base URL}/chat/completions
Authorization: Bearer <Key>（Ollama 可留空）
Content-Type: application/json
```

```json
{
  "model": "gpt-4o-mini",
  "temperature": 0,
  "response_format": { "type": "json_object" },
  "messages": [
    { "role": "system", "content": "<由 questions 自动生成的标注说明>" },
    { "role": "user", "content": "待判断文本：\n我：...\n对方：..." }
  ]
}
```

- Base URL **必须包含版本段**，例如 `https://api.openai.com/v1`、`https://api.deepseek.com/v1`、`http://localhost:11434/v1`。
- 当 Base URL 命中 `localhost` / `127.0.0.1` / `:11434` 时自动**不发送** `response_format`（Ollama 兼容性更好）。
- 模型输出会被容错解析：允许 ```json 代码块、允许前后有解释文字。

---

## 4. 归一化规则（所有适配器共用）

`src/adapters/json.ts`

| 情况 | 处理 |
| --- | --- |
| score 是 `11` / `-3` | 裁剪为 `10` / `0` |
| score 是 `"7.5 分"` | 提取数字 → `7.5` |
| score 是 `{ "score": 6 }` | 取内部字段 |
| choice 精确匹配 | 直接采用 |
| choice 带标点（`"被动敷衍。"`） | 去标点后匹配 |
| choice 是句子（`"我觉得是「回避冷淡」"`） | 包含匹配 |
| 无法解析 / 缺项 | **抛错**，由流水线降级 |

---

## 5. 建议生成（LLM）

与 JEV 分开配置，`settings.llm.provider` 支持 `deepseek` / `openai` / `ollama` / `custom`，都走 OpenAI 兼容 `/chat/completions`，prompt 模板见 `src/core/pipeline/prompts.ts`。

- **按需生成**：`runAnalysis` 不调用 LLM。结果页建议卡片右上角的「生成建议」才会调用（`generateAdvice()`），生成后写回历史记录。
- 发送内容 = 汇总判断（温度/风险等级/阶段）+ 脱敏摘要 + 用户填写的背景信息。
- **没有任何本地规则兜底**：调用失败就抛错并在卡片里显示原因，由用户决定是否重试；不会用模板顶上去冒充模型输出。
- 采样温度用 `settings.llm.temperature`（设置页标签是「生成随机性」），会被 `createChatAdapter` 强制覆盖到每次请求上。

---

## 6. 接入自己的 JEV：逐步

1. 在 `src/adapters/` 下新建 `myje.ts`，实现 `JudgeAdapter`：
   ```ts
   export function createMyJudge(opts: {...}): JudgeAdapter {
     return {
       id: 'my', label: 'My JEV',
       async judge(req) {
         const data = await postJson({ url, apiKey, body: { text: req.input, questions: req.questions } });
         return coerceAnswers(data, req.questions); // 复用归一化，保证行为一致
       },
     };
   }
   ```
2. 在 `src/adapters/index.ts` 的 `createJudgeAdapter` 里加一个分支。
3. 在 `src/store/settings.ts` 的 `JUDGE_PRESETS` 与 `src/types.ts` 的 `JudgeProvider` 里登记。
4. 补一个单测：断言成功路径 + 缺项抛错路径（可参考 `src/adapters/mock.test.ts`）。

只要最终走 `coerceAnswers`，你的适配器就会自动获得同样的裁剪、容错、降级与统计口径。
