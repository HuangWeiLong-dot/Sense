import { describe, expect, it, vi } from 'vitest';
import { ROUND_QUESTIONS, SUMMARY_QUESTIONS } from '../core/jev/questions';
import { createTypeSafeJudge } from './index';
import { MAX_SCORE_LEVELS, applyScoreMaps, toTypeSafeWire } from './json';

/** 好感度有 6 个锚点（0/2/4/6/8/10）→ 发 6 档，返回 0..5，再映射回 0-10 */
const LEVELS = 6;
const OFFICIAL_RESPONSE = {
  model: 'jev-1.13.0',
  answers: {
    好感度: { type: 'score', score: 2.5, confidence: 0.91, legend: { 0: '明显反感' } },
    投入度: { type: 'choice', choice: '被动敷衍', confidence: 0.8, probabilities: {} },
    风险信号: { type: 'choice', choice: '冷暴力倾向', confidence: 0.7, probabilities: {} },
  },
  usage: { input_tokens: 120, output_tokens: 20 },
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('TypeSafe（Jev）请求格式', () => {
  it('打到官方端点，字段名与文档一致', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(OFFICIAL_RESPONSE));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const judge = createTypeSafeJudge({
        baseUrl: 'https://api.typesafe.ai/v1',
        path: '/systemone',
        model: 'jev-latest',
        apiKey: 'ts-key',
      });
      const answers = await judge.judge({
        questions: ROUND_QUESTIONS,
        input: '我：在吗\n对方：在',
      });

      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://api.typesafe.ai/v1/systemone');

      const body = JSON.parse(String(init.body)) as Record<string, any>;
      expect(body.model).toBe('jev-latest');
      // 官方字段是 state，不是 input
      expect(body.state).toBe('我：在吗\n对方：在');
      expect(body.input).toBeUndefined();

      // score：用 legend 锚点当档位，且不得超过官方上限
      expect(body.questions['好感度'].type).toBe('score');
      expect(body.questions['好感度'].criteria).toHaveLength(LEVELS);
      expect(body.questions['好感度'].criteria[0]).toBe('明显反感');
      expect(body.questions['好感度'].criteria[LEVELS - 1]).toBe('热烈喜欢');

      // choice 的 criteria 是对象，原样传递
      expect(Object.keys(body.questions['投入度'].criteria)).toContain('被动敷衍');

      // 分数被映射回 0-10：raw 2.5 → 5
      expect(answers['好感度']).toBe(5);
      expect(answers['投入度']).toBe('被动敷衍');
      expect(answers['风险信号']).toBe('冷暴力倾向');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('所有 score 问题的档位数都不超过官方上限（这就是 400 的原因）', () => {
    for (const questions of [ROUND_QUESTIONS, SUMMARY_QUESTIONS]) {
      const wire = toTypeSafeWire(questions);
      for (const [name, q] of Object.entries(wire.questions)) {
        const entry = q as { type: string; criteria?: unknown };
        if (entry.type !== 'score' || !Array.isArray(entry.criteria)) continue;
        expect(entry.criteria.length).toBeLessThanOrEqual(MAX_SCORE_LEVELS);
        expect(entry.criteria.length).toBeGreaterThanOrEqual(2);
        // 说明一下每个问题的实际档位数，便于回归时定位
        expect(
          `${name}:${entry.criteria.length}`,
          `${name} 的档位数应在 2..${MAX_SCORE_LEVELS}`,
        ).toBeTruthy();
      }
    }
  });

  it('没有配置 path 时默认走 /systemone', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(OFFICIAL_RESPONSE));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const judge = createTypeSafeJudge({ baseUrl: 'https://api.typesafe.ai/v1', apiKey: 'k' });
      await judge.judge({ questions: ROUND_QUESTIONS, input: 'x' });
      const [url] = fetchMock.mock.calls[0] as unknown as [string];
      expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Bearer 头带上 API Key', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(OFFICIAL_RESPONSE));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const judge = createTypeSafeJudge({ baseUrl: 'https://api.typesafe.ai/v1', apiKey: 'ts-key' });
      await judge.judge({ questions: ROUND_QUESTIONS, input: 'x' });
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers.authorization).toBe('Bearer ts-key');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('CORS 拦截时给出可操作的诊断，而不是裸的 Failed to fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    try {
      const judge = createTypeSafeJudge({ baseUrl: 'https://api.typesafe.ai/v1', apiKey: 'k' });
      await expect(judge.judge({ questions: ROUND_QUESTIONS, input: 'x' })).rejects.toThrow(/CORS/);
      await expect(judge.judge({ questions: ROUND_QUESTIONS, input: 'x' })).rejects.toThrow(
        /api\.typesafe\.ai/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('HTTP 错误（例如档位超限的 400）原样暴露', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{"detail":"Too many score levels. Must have at most 10 levels."}', {
            status: 400,
            statusText: 'Bad Request',
          }),
      ),
    );
    try {
      const judge = createTypeSafeJudge({ baseUrl: 'https://api.typesafe.ai/v1', apiKey: 'k' });
      await expect(judge.judge({ questions: ROUND_QUESTIONS, input: 'x' })).rejects.toThrow(
        /400/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('toTypeSafeWire', () => {
  it('用 legend 锚点当档位，并给出映射参数', () => {
    const wire = toTypeSafeWire({
      分: { type: 'score', instructions: '打个分', legend: { 0: '零', 2: '二', 4: '四' } },
    });
    const score = wire.questions['分'] as { criteria: string[] };
    expect(score.criteria).toEqual(['零', '二', '四']);
    // 0..2 → 0..4
    expect(wire.scoreMaps['分']).toEqual({ offset: 0, factor: 2 });
  });

  it('锚点不从 0 开始时也能正确映射', () => {
    const wire = toTypeSafeWire({
      分: { type: 'score', instructions: 'x', legend: { 2: '低', 4: '高' } },
    });
    expect(wire.scoreMaps['分']).toEqual({ offset: 2, factor: 2 });
  });

  it('choice 的 criteria 对象保持不变', () => {
    const wire = toTypeSafeWire({ 投入度: ROUND_QUESTIONS.投入度 });
    const choice = wire.questions['投入度'] as { criteria: Record<string, string> };
    expect(choice.criteria['主动推进']).toContain('主动');
  });

  it('档位超过上限时等距抽样，保留首尾', () => {
    const legend: Record<string, string> = {};
    for (let i = 0; i <= 20; i += 1) legend[String(i)] = `${i} 档`;
    const wire = toTypeSafeWire({ 分: { type: 'score', instructions: 'x', legend } });
    const criteria = (wire.questions['分'] as { criteria: string[] }).criteria;
    expect(criteria.length).toBeLessThanOrEqual(MAX_SCORE_LEVELS);
    expect(criteria[0]).toBe('0 档');
    expect(criteria[criteria.length - 1]).toBe('20 档');
  });
});

describe('applyScoreMaps', () => {
  it('把 0..N-1 映射回 legend 刻度并裁剪到 0-10', () => {
    const maps = { a: { offset: 0, factor: 2 }, b: { offset: 2, factor: 2 } };
    expect(applyScoreMaps({ a: 0, b: 0 }, maps)).toEqual({ a: 0, b: 2 });
    expect(applyScoreMaps({ a: 2.5, b: 1 }, maps)).toEqual({ a: 5, b: 4 });
    // 超出刻度会被裁剪，不会算出 12 分
    expect(applyScoreMaps({ a: 5 }, maps)['a']).toBe(10);
    expect(applyScoreMaps({ a: 9 }, maps)['a']).toBe(10);
  });

  it('非数字答案不受影响', () => {
    expect(applyScoreMaps({ x: '主动推进' }, { x: { offset: 0, factor: 2 } })).toEqual({
      x: '主动推进',
    });
  });
});
