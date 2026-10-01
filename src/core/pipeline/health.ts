import type { Questions, Secrets, Settings } from '../../types';
import { createChatAdapter, createJudgeAdapter } from '../../adapters';

export interface ProbeResult {
  ok: boolean;
  /** 耗时（毫秒）；本地模式没有网络往返，为 0 */
  ms: number;
  /** 仅在失败时给出可读原因 */
  error?: string;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * 连通性探测用的最小问题：1 个 score 问题、2 个档位。
 * 用 score 而不是 noul，是为了顺带覆盖「分数归一化」这条路；
 * 但刻意不发送真实的三个问题，token 量大约只有完整一轮判断的 1/10。
 */
export const PROBE_QUESTIONS: Questions = {
  ok: {
    type: 'score',
    instructions: '有无文字',
    legend: { 0: '无', 1: '有' },
  },
};

/** 探测用的最小 state。 */
export const PROBE_STATE = 'hi';

export type ProbeTarget = 'judge' | 'llm';

/**
 * 探测结果的「有效性指纹」：配置一变，之前那次测试成功就不再作数。
 * 只记录 Key 的有无，不复制 Key 本身。
 */
export function probeFingerprint(
  target: ProbeTarget,
  settings: Settings,
  secrets: Secrets,
): string {
  const proxy = `${settings.proxy.enabled ? 'on' : 'off'}:${settings.proxy.url}`;

  if (target === 'judge') {
    const { provider, baseUrl, path, model } = settings.judge;
    return ['judge', provider, baseUrl, path, model, secrets.judgeApiKey ? 'k' : '-', proxy].join(
      '|',
    );
  }

  const { provider, baseUrl, model } = settings.llm;
  return ['llm', provider, baseUrl, model, secrets.llmApiKey ? 'k' : '-', proxy].join('|');
}

/**
 * 测试 JEV 判断引擎是否可用。
 * 只发最小请求，因此只覆盖「鉴权 → 连通 → 响应可解析 → 答案可归一化」。
 */
export async function probeJudge(
  settings: Settings,
  secrets: Secrets,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  const adapter = createJudgeAdapter(settings, secrets);

  const started = Date.now();
  try {
    await adapter.judge({
      questions: PROBE_QUESTIONS,
      input: PROBE_STATE,
      label: '连接测试',
      signal,
    });
    return { ok: true, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: errorMessage(err) };
  }
}

/** 测试建议生成用的 LLM 是否可用：一句 "hi" + 最多 1 个输出 token。 */
export async function probeLlm(
  settings: Settings,
  secrets: Secrets,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  const adapter = createChatAdapter(settings, secrets);

  const started = Date.now();
  try {
    await adapter.chat({
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0,
      maxTokens: 1,
      signal,
    });
    return { ok: true, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: errorMessage(err) };
  }
}
