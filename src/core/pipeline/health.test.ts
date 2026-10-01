import { describe, expect, it, vi } from 'vitest';
import type { Secrets, Settings } from '../../types';
import { DEFAULT_SETTINGS } from '../../store/settings';
import { PROBE_QUESTIONS, PROBE_STATE, probeFingerprint, probeJudge, probeLlm } from './health';

const noKeys: Secrets = { judgeApiKey: '', llmApiKey: '' };

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function typeSafeSettings(): Settings {
  return settings({
    judge: {
      ...DEFAULT_SETTINGS.judge,
      provider: 'typesafe',
      baseUrl: 'https://api.typesafe.ai/v1',
      path: '/systemone',
      model: 'jev-latest',
    },
  });
}

function llmSettings(): Settings {
  return settings({
    llm: {
      ...DEFAULT_SETTINGS.llm,
      provider: 'deepseek',
      baseUrl: 'https://api.test/v1',
      model: 'deepseek-chat',
    },
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const keys: Secrets = { judgeApiKey: 'k', llmApiKey: 'k' };

describe('连接测试：返回结构', () => {
  it('成功时不带 error，失败时才带可读原因', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ answers: { ok: { type: 'score', score: 0.4, confidence: 0.9 } } }),
      ),
    );
    try {
      const ok = await probeJudge(typeSafeSettings(), keys);
      expect(ok.ok).toBe(true);
      expect(ok.error).toBeUndefined();
      expect(ok.ms).toBeGreaterThanOrEqual(0);
    } finally {
      vi.unstubAllGlobals();
    }

    const failed = await probeJudge(
      settings({ judge: { ...DEFAULT_SETTINGS.judge, provider: 'typesafe', baseUrl: '' } }),
      noKeys,
    );
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain('Base URL');
  });
});

describe('连接测试：极限压缩请求', () => {
  it('JEV 只发 1 个问题、2 个档位，请求体很小', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ answers: { ok: { type: 'score', score: 0.4 } } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      await probeJudge(typeSafeSettings(), keys);
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      const raw = String(init.body);
      const body = JSON.parse(raw) as Record<string, any>;

      expect(body.state).toBe(PROBE_STATE);
      expect(Object.keys(body.questions)).toEqual(['ok']);
      expect(body.questions.ok.type).toBe('score');
      expect(body.questions.ok.criteria).toEqual(['无', '有']);
      // 完整一轮判断大概 400+ token，这里应当只有几十个 token 的量级
      expect(raw.length).toBeLessThan(300);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('探测问题本身只有 1 个、2 档', () => {
    expect(Object.keys(PROBE_QUESTIONS)).toHaveLength(1);
    expect(PROBE_QUESTIONS.ok.legend).toEqual({ 0: '无', 1: '有' });
  });

  it('LLM 只发一句 hi，并把输出限制为 1 个 token', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: '' } }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await probeLlm(llmSettings(), keys);
      expect(result.ok).toBe(true);

      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as Record<string, any>;
      expect(url).toBe('https://api.test/v1/chat/completions');
      expect(body.max_tokens).toBe(1);
      expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('连接测试：失败路径', () => {
  it('HTTP 错误如实报告', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500, statusText: 'Server Error' })),
    );
    try {
      const result = await probeJudge(typeSafeSettings(), keys);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('500');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('CORS 拦截给出可操作提示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    try {
      const result = await probeJudge(typeSafeSettings(), keys);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('CORS');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('LLM 未填 Base URL 时返回配置错误', async () => {
    const result = await probeLlm(
      settings({ llm: { ...DEFAULT_SETTINGS.llm, provider: 'custom', baseUrl: '', model: '' } }),
      noKeys,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Base URL');
  });

  it('LLM 网络异常时给出失败原因', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    try {
      const result = await probeLlm(llmSettings(), keys);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('探测指纹（决定「已验证」是否仍然作数）', () => {
  const withKey: Secrets = { judgeApiKey: 'k', llmApiKey: 'k' };

  it('配置不变时指纹稳定', () => {
    expect(probeFingerprint('judge', typeSafeSettings(), withKey)).toBe(
      probeFingerprint('judge', typeSafeSettings(), withKey),
    );
  });

  it('改地址 / 路径 / 模型都会让指纹失效', () => {
    const base = probeFingerprint('judge', typeSafeSettings(), withKey);
    const changed = (patch: Partial<Settings['judge']>) =>
      probeFingerprint(
        'judge',
        settings({ judge: { ...typeSafeSettings().judge, ...patch } }),
        withKey,
      );

    expect(changed({ baseUrl: 'https://other.test/v1' })).not.toBe(base);
    expect(changed({ path: '/v2/systemone' })).not.toBe(base);
    expect(changed({ model: 'jev-1.13.0' })).not.toBe(base);
  });

  it('换引擎会让指纹失效', () => {
    const typesafe = probeFingerprint('judge', typeSafeSettings(), withKey);
    const openai = probeFingerprint(
      'judge',
      settings({
        judge: {
          ...DEFAULT_SETTINGS.judge,
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
        },
      }),
      withKey,
    );
    expect(typesafe).not.toBe(openai);
  });

  it('Key 从无到有会让指纹失效', () => {
    const withoutKey = probeFingerprint('judge', typeSafeSettings(), noKeys);
    const withKeyPrint = probeFingerprint('judge', typeSafeSettings(), withKey);
    expect(withoutKey).not.toBe(withKeyPrint);
  });

  it('代理开关会同时影响两侧的指纹', () => {
    const base = probeFingerprint('judge', typeSafeSettings(), withKey);
    const proxied = probeFingerprint(
      'judge',
      settings({ proxy: { enabled: true, url: 'http://127.0.0.1:8787' } }),
      withKey,
    );
    expect(proxied).not.toBe(base);
  });

  it('两侧指纹互不干扰', () => {
    const judgePrint = probeFingerprint('judge', typeSafeSettings(), withKey);
    const llmPrint = probeFingerprint('llm', typeSafeSettings(), withKey);
    expect(judgePrint).not.toBe(llmPrint);

    // 只改 LLM，judge 的指纹不变
    const llmChanged = settings({
      judge: typeSafeSettings().judge,
      llm: {
        ...DEFAULT_SETTINGS.llm,
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
      },
    });
    expect(probeFingerprint('judge', llmChanged, withKey)).toBe(judgePrint);
    expect(probeFingerprint('llm', llmChanged, withKey)).not.toBe(llmPrint);
  });
});
