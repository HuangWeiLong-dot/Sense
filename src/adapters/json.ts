import type { Question, Questions } from '../types';
import { clamp } from '../lib/utils';
import { AdapterError } from './types';

/** 从任意文本里提取第一个完整 JSON 对象（容忍 ```json 代码块与前后解释文字）。 */
export function extractJsonObject(text: string): unknown {
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const source = (fenced ? fenced[1] : text).trim();

  try {
    return JSON.parse(source) as unknown;
  } catch {
    /* 继续做括号配对扫描 */
  }

  const start = source.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, i + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** 在返回体里找到承载答案的对象（兼容 {answers} / {result} / {data} / 根对象）。 */
export function findAnswers(raw: unknown, keys: string[]): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};
  const score = (o: Record<string, unknown>) => keys.filter((k) => k in o).length;
  if (score(raw) > 0) return raw;

  for (const value of Object.values(raw)) {
    if (isPlainObject(value) && score(value) > 0) return value;
  }
  for (const value of Object.values(raw)) {
    if (isPlainObject(value)) {
      const found = findAnswers(value, keys);
      if (Object.keys(found).length) return found;
    }
  }
  return {};
}

/** 分数归一化到 0-10；无法解析返回 null（由调用方决定降级策略）。 */
export function coerceScore(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clamp(Math.round(value * 10) / 10, 0, 10);
  }
  if (typeof value === 'string') {
    const m = /-?\d+(?:\.\d+)?/.exec(value);
    if (m) return clamp(Math.round(Number(m[0]) * 10) / 10, 0, 10);
    return null;
  }
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    for (const k of ['score', 'value', 'rating', 'answer', '分数', '答案']) {
      if (k in o) return coerceScore(o[k]);
    }
  }
  return null;
}

/** 选项归一化：精确 → 去标点 → 包含匹配。 */
export function coerceChoice(value: unknown, options: string[]): string | null {
  if (!options.length) return null;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    for (const k of ['answer', 'value', 'choice', 'label', '选择', '答案']) {
      if (k in o) return coerceChoice(o[k], options);
    }
    return null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null;

  const s = String(value).trim();
  if (!s) return null;
  if (options.includes(s)) return s;

  const norm = (x: string) => x.replace(/[\s。，,．.、"'「」（）()]/g, '');
  const n = norm(s);
  const exact = options.find((o) => norm(o) === n);
  if (exact) return exact;
  const contained = options.find((o) => n.includes(norm(o)));
  if (contained) return contained;
  const reversed = options.find((o) => norm(o).includes(n));
  return reversed ?? null;
}

/**
 * 把模型返回体归一化成 { 问题名: 答案 }，缺项直接抛错，
 * 由流水线把该轮标记为降级 —— 不静默编造数据。
 */
export function coerceAnswers(raw: unknown, questions: Questions): Record<string, unknown> {
  const keys = Object.keys(questions);
  const source = findAnswers(raw, keys);
  if (!Object.keys(source).length) {
    throw new AdapterError(`返回体中没有找到答案字段（期望：${keys.join(' / ')}）`);
  }

  const out: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const key of keys) {
    const q = questions[key];
    const value = source[key];
    if (q.type === 'score') {
      const score = coerceScore(value);
      if (score === null) missing.push(key);
      else out[key] = score;
    } else {
      const choice = coerceChoice(value, Object.keys(q.criteria ?? {}));
      if (choice === null) missing.push(key);
      else out[key] = choice;
    }
  }
  if (missing.length) {
    throw new AdapterError(`返回体缺少可用答案：${missing.join('、')}`);
  }
  return out;
}

/** 把 questions 渲染成给通用 LLM 的说明文本（OpenAI 兼容适配器用）。 */
export function renderQuestionsForPrompt(questions: Questions): string {
  const lines: string[] = [];
  for (const [name, q] of Object.entries(questions)) {
    lines.push(`- ${name}（${q.type === 'score' ? '0-10 整数分数' : '单选'}）：${q.instructions}`);
    if (q.legend) {
      const legend = Object.entries(q.legend)
        .map(([k, v]) => `${k}=${v}`)
        .join('，');
      lines.push(`  分值参考：${legend}`);
    }
    if (q.criteria) {
      lines.push(`  可选项（必须原样输出其中一个）：${Object.keys(q.criteria).join(' / ')}`);
    }
  }
  return lines.join('\n');
}

/** TypeSafe 对 score 档位数的硬上限（官服返回：Too many score levels. Must have at most 10 levels.） */
export const MAX_SCORE_LEVELS = 10;

export interface TypeSafeWire {
  questions: Record<string, unknown>;
  /** score 问题：TypeSafe 返回 0..N-1，用这个仿射映射还原到 legend 的刻度 */
  scoreMaps: Record<string, { offset: number; factor: number }>;
}

/**
 * 把内部 question 的描述还原成 score 的档位标签与对应的锚点值。
 *
 * 内部用 `legend` 描述 0-10 刻度上的锚点（例如 0/2/4/6/8/10 共 6 个），
 * 而 TypeSafe 的 score 需要一个**标签数组**且**最多 10 档**。
 * 所以这里直接用锚点标签当档位（6 ≤ 10），再把返回的 0..5 映射回 0..10。
 */
function scorePresentation(q: Question): { labels: string[]; anchors: number[] } | null {
  const legend = q.legend ?? {};
  const anchorKeys = Object.keys(legend)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  if (anchorKeys.length >= 2) {
    let keys = anchorKeys;
    if (keys.length > MAX_SCORE_LEVELS) {
      // 等距抽样，保留首尾端点
      const step = (keys.length - 1) / (MAX_SCORE_LEVELS - 1);
      keys = Array.from(
        new Set(Array.from({ length: MAX_SCORE_LEVELS }, (_, i) => anchorKeys[Math.round(i * step)])),
      );
    }
    return { labels: keys.map((k) => legend[String(k)]), anchors: keys };
  }

  // 兜底：score 直接给了 criteria 对象时，用它自己的键当档位
  if (q.criteria) {
    const keys = Object.keys(q.criteria);
    if (keys.length >= 2) return { labels: keys, anchors: keys.map((_, i) => i) };
  }

  return null;
}

/**
 * 转成 TypeSafe（Jev）的 wire 格式。
 *
 * 官方 schema：每个条目是 `{ type, instructions, criteria }`。
 * - `choice` 的 criteria 是「取值 → 含义」的对象，原样传递；
 * - `score` 的 criteria 是标签数组，分数落在 `0 .. length-1`，且 **level 数 ≤ 10**。
 */
export function toTypeSafeWire(questions: Questions): TypeSafeWire {
  const out: Record<string, unknown> = {};
  const scoreMaps: Record<string, { offset: number; factor: number }> = {};

  for (const [name, q] of Object.entries(questions)) {
    if (q.type === 'score') {
      const presentation = scorePresentation(q);
      if (presentation) {
        const { labels, anchors } = presentation;
        out[name] = { type: 'score', instructions: q.instructions, criteria: labels };
        const min = anchors[0];
        const max = anchors[anchors.length - 1];
        scoreMaps[name] = {
          offset: min,
          factor: labels.length > 1 ? (max - min) / (labels.length - 1) : 0,
        };
        continue;
      }
    }

    out[name] = {
      type: q.type,
      instructions: q.instructions,
      ...(q.criteria ? { criteria: q.criteria } : {}),
    };
  }

  return { questions: out, scoreMaps };
}

/** 把 TypeSafe 返回的 0..N-1 分数还原到内部刻度（0-10）。 */
export function applyScoreMaps(
  answers: Record<string, unknown>,
  scoreMaps: TypeSafeWire['scoreMaps'],
): Record<string, unknown> {
  const out = { ...answers };
  for (const [name, map] of Object.entries(scoreMaps)) {
    const raw = out[name];
    if (typeof raw !== 'number') continue;
    out[name] = clamp(Math.round((map.offset + raw * map.factor) * 10) / 10, 0, 10);
  }
  return out;
}
