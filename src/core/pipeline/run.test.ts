import { describe, expect, it, vi } from 'vitest';
import type { Secrets, Settings } from '../../types';
import { DEFAULT_SETTINGS } from '../../store/settings';
import { SAMPLE_BACKGROUND, SAMPLE_CHAT } from '../../data/sample';
import { parseChat } from '../preprocess/parse';
import { stubModelApi } from '../../test/stubModelApi';
import { runAnalysis, type Progress } from './run';

const secrets: Secrets = { judgeApiKey: 'test-key', llmApiKey: 'test-key' };

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    judge: {
      ...DEFAULT_SETTINGS.judge,
      provider: 'typesafe',
      baseUrl: 'https://judge.test',
      path: '/systemone',
      model: 'jev-latest',
    },
    ...overrides,
  };
}

describe('端到端流水线（逐轮 → 汇总）', () => {
  it('跑通 导入 → 逐轮 → 汇总，并留下未生成的建议', async () => {
    const fetchMock = stubModelApi();
    try {
      const config = settings();
      const parsed = parseChat(SAMPLE_CHAT, config.anonymize);
      const stages: Progress['stage'][] = [];

      const result = await runAnalysis({
        bubbles: parsed.bubbles,
        settings: config,
        secrets,
        background: SAMPLE_BACKGROUND,
        onProgress: (p) => stages.push(p.stage),
      });

      expect(result.rounds.length).toBeGreaterThan(8);
      expect(result.judgements.length).toBeGreaterThan(8);
      expect(result.aggregate.总轮数).toBe(result.judgements.length);
      expect(result.aggregate.好感度趋势).toHaveLength(result.judgements.length);
      expect(result.summary.temperature).toBeGreaterThanOrEqual(0);
      expect(result.summary.temperature).toBeLessThanOrEqual(10);
      expect(result.digest).toContain('好感度');
      expect(result.meta.judgeProvider).toBe('typesafe');

      // 建议不再随分析一起生成
      expect(result.advice).toBeNull();
      expect(stages).not.toContain('advice');
      expect(stages).toEqual(
        expect.arrayContaining(['prepare', 'judge', 'summarize', 'done']),
      );

      // 逐轮 + 汇总各 1 次请求，没有多余的 LLM 调用
      expect(fetchMock).toHaveBeenCalledTimes(result.judgements.length + 1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('发给 JEV 的文本里不含原始昵称', async () => {
    stubModelApi();
    try {
      const config = settings();
      const chat = '小鹿：你今天怎么没回我\n我：抱歉刚在忙\n小鹿：哦';
      const parsed = parseChat(chat, config.anonymize);

      const inputs: string[] = [];
      const result = await runAnalysis({ bubbles: parsed.bubbles, settings: config, secrets });
      for (const round of result.rounds) inputs.push(round.input);

      expect(inputs.join('\n')).not.toContain('小鹿');
      expect(inputs.join('\n')).toContain('对方：');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('单轮失败会降级，失败轮次被排除在统计外', async () => {
    stubModelApi({ failWhen: (state) => state.includes('对方：d') });
    try {
      const config = settings({ judge: { ...settings().judge, concurrency: 2 } });
      const parsed = parseChat('我：a\n对方：b\n我：c\n对方：d\n我：e\n对方：f', config.anonymize);

      const result = await runAnalysis({ bubbles: parsed.bubbles, settings: config, secrets });

      expect(result.aggregate.失败轮数).toBe(1);
      expect(result.judgements.filter((j) => j.degraded)).toHaveLength(1);
      // 3 轮里只有 2 轮进入统计
      expect(result.aggregate.好感度趋势).toHaveLength(2);
      expect(result.rounds).toHaveLength(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('汇总判断失败时直接报错，不再用本地规则推导', async () => {
    // 逐轮成功、汇总返回坏格式
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { questions: Record<string, unknown> };
        const isSummary = Object.keys(body.questions).some((k) => k.includes('温度'));
        if (isSummary) {
          return new Response(JSON.stringify({ answers: {} }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({
            answers: { 好感度: 3, 投入度: '配合回应', 风险信号: '无明显信号' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    try {
      const config = settings();
      const parsed = parseChat('我：在吗\n对方：在', config.anonymize);
      await expect(
        runAnalysis({ bubbles: parsed.bubbles, settings: config, secrets }),
      ).rejects.toThrow(/汇总判断失败/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('全部轮次失败时抛出可读错误', async () => {
    const config = settings({
      judge: { ...DEFAULT_SETTINGS.judge, provider: 'typesafe', baseUrl: '', concurrency: 2 },
    });
    const parsed = parseChat('我：在吗\n对方：在', config.anonymize);
    await expect(
      runAnalysis({ bubbles: parsed.bubbles, settings: config, secrets }),
    ).rejects.toThrow(/全部 \d+ 轮判断失败/);
  });

  it('没有可判断轮次时报错', async () => {
    const config = settings();
    await expect(
      runAnalysis({ bubbles: [], settings: config, secrets }),
    ).rejects.toThrow(/没有解析出可判断的轮次/);
  });

  it('maxRounds 只判断最近的轮次', async () => {
    stubModelApi();
    try {
      const config = settings({ maxRounds: 3 });
      const parsed = parseChat(SAMPLE_CHAT, config.anonymize);
      const result = await runAnalysis({ bubbles: parsed.bubbles, settings: config, secrets });
      expect(result.judgements).toHaveLength(3);
      expect(result.rounds.length).toBeGreaterThan(3);
      // 保留的是最后三轮
      const lastThree = result.rounds.slice(-3).map((r) => r.index);
      expect(result.judgements.map((j) => j.round)).toEqual(lastThree);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
