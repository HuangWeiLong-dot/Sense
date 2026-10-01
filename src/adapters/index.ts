import type { Questions, Settings, Secrets } from '../types';
import {
  applyScoreMaps,
  coerceAnswers,
  extractJsonObject,
  findAnswers,
  renderQuestionsForPrompt,
  toTypeSafeWire,
} from './json';
import { withProxy } from './proxy';
import {
  AdapterError,
  joinUrl,
  postJson,
  type ChatAdapter,
  type ChatMessage,
  type ChatRequest,
  type JudgeAdapter,
  type JudgeRequest,
} from './types';

/* ------------------------------------------------------------------ */
/* TypeSafe（JEV 原生多问题接口）                                        */
/* ------------------------------------------------------------------ */

export interface TypeSafeOptions {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  /** 默认 /systemone */
  path?: string;
  timeoutMs?: number;
}

/**
 * TypeSafe（Jev）原生接口 —— 按官方文档实现：
 *   POST https://api.typesafe.ai/v1/systemone
 *   Authorization: Bearer <API_KEY>
 *   { "state": "<脱敏文本>", "model": "jev-latest", "questions": { ... } }
 * 响应：
 *   { "model": "jev-1.13.0",
 *     "answers": { "好感度": { "type": "score", "score": 6.2, "confidence": 0.9, ... },
 *                  "投入度": { "type": "choice", "choice": "被动敷衍", ... } },
 *     "usage": { ... } }
 */
export function createTypeSafeJudge(options: TypeSafeOptions): JudgeAdapter {
  const url = joinUrl(options.baseUrl, options.path || '/systemone');

  return {
    id: 'typesafe',
    label: 'TypeSafe (Jev)',
    async judge(req: JudgeRequest): Promise<Record<string, unknown>> {
      if (!options.baseUrl.trim()) {
        throw new AdapterError('未配置 TypeSafe Base URL，请到「设置」填写。');
      }
      const wire = toTypeSafeWire(req.questions);
      const body: Record<string, unknown> = {
        state: req.input,
        model: options.model?.trim() || 'jev-latest',
        questions: wire.questions,
      };

      const data = await postJson({
        url,
        apiKey: options.apiKey,
        body,
        signal: req.signal,
        timeoutMs: options.timeoutMs,
      });
      // TypeSafe 的 score 是 0..档位数-1，映射回内部的 0-10 刻度
      return applyScoreMaps(coerceAnswers(data, req.questions), wire.scoreMaps);
    },
  };
}

/* ------------------------------------------------------------------ */
/* OpenAI 兼容（DeepSeek / OpenAI / Ollama / 任意兼容网关）              */
/* ------------------------------------------------------------------ */

export interface OpenAICompatibleOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** 是否发送 response_format=json_object（Ollama 等可关掉） */
  jsonMode?: boolean;
  timeoutMs?: number;
}

function buildJudgeSystemPrompt(questions: Questions): string {
  return [
    '你是一个严格的对话情感标注员。你会收到一段对话，需要按给定问题输出标注结果。',
    '要求：',
    '1. 只输出一个 JSON 对象，键名必须与问题名完全一致。',
    '2. 不要输出任何解释、前后缀、Markdown 代码块。',
    '3. 评分问题输出 0-10 的数字；选择题必须原样输出给定选项中的一个。',
    '4. 只看这段对话中「对方」的表现，不要脑补对话之外的信息。',
    '',
    '问题定义：',
    renderQuestionsForPrompt(questions),
  ].join('\n');
}

function readChatContent(data: unknown): string {
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    const choices = o.choices;
    if (Array.isArray(choices) && choices.length) {
      const first = choices[0] as Record<string, unknown>;
      const message = first?.message as Record<string, unknown> | undefined;
      if (message && typeof message.content === 'string') return message.content;
      if (typeof first?.text === 'string') return first.text;
    }
    if (typeof o.content === 'string') return o.content;
    if (typeof o.response === 'string') return o.response;
    const message = o.message as Record<string, unknown> | undefined;
    if (message && typeof message.content === 'string') return message.content;
  }
  throw new AdapterError('无法从响应中读取模型输出');
}

export function createOpenAIJudge(options: OpenAICompatibleOptions): JudgeAdapter {
  const url = joinUrl(options.baseUrl, '/chat/completions');

  return {
    id: 'openai',
    label: `OpenAI 兼容 (${options.model || '未指定模型'})`,
    async judge(req: JudgeRequest): Promise<Record<string, unknown>> {
      if (!options.baseUrl.trim()) throw new AdapterError('未配置 Base URL。');
      if (!options.model.trim()) throw new AdapterError('未配置模型名。');

      const body: Record<string, unknown> = {
        model: options.model.trim(),
        temperature: 0,
        messages: [
          { role: 'system', content: buildJudgeSystemPrompt(req.questions) },
          { role: 'user', content: `待判断文本：\n${req.input}` },
        ] satisfies ChatMessage[],
      };
      if (options.jsonMode !== false) body.response_format = { type: 'json_object' };

      const data = await postJson({
        url,
        apiKey: options.apiKey,
        body,
        signal: req.signal,
        timeoutMs: options.timeoutMs,
      });
      const content = readChatContent(data);
      const parsed = extractJsonObject(content) ?? findAnswers(data, Object.keys(req.questions));
      return coerceAnswers(parsed, req.questions);
    },
  };
}

export function createOpenAIChat(options: OpenAICompatibleOptions): ChatAdapter {
  const url = joinUrl(options.baseUrl, '/chat/completions');

  return {
    id: 'openai-chat',
    label: `OpenAI 兼容 (${options.model || '未指定模型'})`,
    async chat(req: ChatRequest): Promise<string> {
      if (!options.baseUrl.trim()) throw new AdapterError('未配置 Base URL。');
      if (!options.model.trim()) throw new AdapterError('未配置模型名。');

      const body: Record<string, unknown> = {
        model: options.model.trim(),
        temperature: req.temperature ?? 0.6,
        messages: req.messages,
      };
      if (req.maxTokens) body.max_tokens = req.maxTokens;

      const data = await postJson({
        url,
        apiKey: options.apiKey,
        signal: req.signal,
        timeoutMs: options.timeoutMs ?? 120_000,
        body,
      });
      return readChatContent(data).trim();
    },
  };
}

/* ------------------------------------------------------------------ */
/* 工厂                                                                */
/* ------------------------------------------------------------------ */

export function createJudgeAdapter(settings: Settings, secrets: Secrets): JudgeAdapter {
  const { provider, model, path } = settings.judge;
  // 浏览器有 CORS 限制时，请求改从本机代理发出
  const baseUrl = withProxy(settings.proxy, settings.judge.baseUrl);
  if (provider === 'openai') {
    return createOpenAIJudge({
      baseUrl,
      apiKey: secrets.judgeApiKey,
      model: model || 'gpt-4o-mini',
      jsonMode: !/localhost|127\.0\.0\.1|:11434/i.test(baseUrl),
    });
  }
  return createTypeSafeJudge({ baseUrl, apiKey: secrets.judgeApiKey, model, path });
}

export function createChatAdapter(settings: Settings, secrets: Secrets): ChatAdapter {
  const { model, temperature } = settings.llm;
  const adapter = createOpenAIChat({
    baseUrl: withProxy(settings.proxy, settings.llm.baseUrl),
    apiKey: secrets.llmApiKey,
    model,
  });
  // 用配置里的温度覆盖默认值
  return {
    ...adapter,
    chat: (req) => adapter.chat({ ...req, temperature: temperature }),
  };
}
