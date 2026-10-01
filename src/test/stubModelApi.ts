import { vi } from 'vitest';
import {
  ROUND_ENGAGEMENT_KEY,
  ROUND_RISK_KEY,
  ROUND_SCORE_KEY,
  SUMMARY_RISK_KEY,
  SUMMARY_STAGE_KEY,
  SUMMARY_TEMPERATURE_KEY,
} from '../core/jev/questions';

interface StubOptions {
  /** 命中时返回 500，用来模拟单轮失败 */
  failWhen?: (state: string) => boolean;
  /** 模拟建议生成的回复内容 */
  adviceText?: string;
}

const DEFAULT_ANSWER: Record<string, { type: 'score' | 'choice'; value: string | number }> = {
  [ROUND_SCORE_KEY]: { type: 'score', value: 3 },
  [ROUND_ENGAGEMENT_KEY]: { type: 'choice', value: '配合回应' },
  [ROUND_RISK_KEY]: { type: 'choice', value: '无明显信号' },
  [SUMMARY_TEMPERATURE_KEY]: { type: 'score', value: 3 },
  [SUMMARY_RISK_KEY]: { type: 'choice', value: '健康' },
  [SUMMARY_STAGE_KEY]: { type: 'choice', value: '稳定' },
};

/**
 * 假的模型服务：同时充当 TypeSafe（/systemone）与 OpenAI 兼容（/chat/completions）。
 *
 * 演示模式已经删掉，测试必须走真实的适配器 + 归一化路径，所以这里伪造的是
 * **服务端**而不是适配器 —— 请求格式错了测试就会失败。
 */
export function stubModelApi(options: StubOptions = {}) {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      state?: string;
      questions?: Record<string, { type: string; criteria?: unknown }>;
      messages?: Array<{ content: string }>;
    };

    if (options.failWhen?.(body.state ?? '')) {
      return new Response('boom', { status: 500, statusText: 'Server Error' });
    }

    const json = (payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    if (body.messages) {
      return json({ choices: [{ message: { content: options.adviceText ?? '【建议】正文' } }] });
    }

    const answers: Record<string, unknown> = {};
    for (const [name, question] of Object.entries(body.questions ?? {})) {
      const known = DEFAULT_ANSWER[name];
      if (known) {
        answers[name] =
          known.type === 'score'
            ? { type: 'score', score: known.value }
            : { type: 'choice', choice: known.value };
        continue;
      }
      // 连接探测等临时问题：按类型造一个合法答案
      if (question.type === 'score') {
        answers[name] = { type: 'score', score: 0.3 };
      } else {
        const keys = Object.keys((question.criteria as Record<string, string>) ?? {});
        answers[name] = { type: 'choice', choice: keys[0] ?? 'ok' };
      }
    }

    return json({ model: 'jev-stub', answers });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
