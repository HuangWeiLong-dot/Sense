import { describe, expect, it, vi } from 'vitest';
import type { ProxyConfig, Secrets, Settings } from '../types';
import { DEFAULT_SETTINGS } from '../store/settings';
import { createChatAdapter, createJudgeAdapter } from './index';
import { PROXY_PREFIX, describeTarget, withProxy } from './proxy';
import { ROUND_QUESTIONS } from '../core/jev/questions';

const OFF: ProxyConfig = { enabled: false, url: 'http://127.0.0.1:8787' };
const ON: ProxyConfig = { enabled: true, url: 'http://127.0.0.1:8787' };
const noKeys: Secrets = { judgeApiKey: 'k', llmApiKey: 'k' };

function settings(patch: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...patch };
}

describe('withProxy', () => {
  it('关闭时原样返回', () => {
    expect(withProxy(OFF, 'https://api.typesafe.ai/v1')).toBe('https://api.typesafe.ai/v1');
  });

  it('开启时改写成代理前缀形式', () => {
    expect(withProxy(ON, 'https://api.typesafe.ai/v1')).toBe(
      `http://127.0.0.1:8787${PROXY_PREFIX}api.typesafe.ai/v1`,
    );
  });

  it('容忍结尾斜杠与首尾空白', () => {
    expect(withProxy({ enabled: true, url: ' http://127.0.0.1:8787/ ' }, 'https://a.b/v1')).toBe(
      `http://127.0.0.1:8787${PROXY_PREFIX}a.b/v1`,
    );
  });

  it('代理地址为空时退回直连，不会拼出坏 URL', () => {
    expect(withProxy({ enabled: true, url: '   ' }, 'https://a.b/v1')).toBe('https://a.b/v1');
    expect(withProxy(ON, '   ')).toBe('   ');
  });
});

describe('适配器走代理', () => {
  it('JEV 请求打到本机代理而不是上游', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          answers: {
            好感度: { type: 'score', score: 3 },
            投入度: { type: 'choice', choice: '配合回应' },
            风险信号: { type: 'choice', choice: '无明显信号' },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const judge = createJudgeAdapter(
        settings({
          proxy: ON,
          judge: {
            ...DEFAULT_SETTINGS.judge,
            provider: 'typesafe',
            baseUrl: 'https://api.typesafe.ai/v1',
            path: '/systemone',
            model: 'jev-latest',
          },
        }),
        noKeys,
      );
      await judge.judge({ questions: ROUND_QUESTIONS, input: 'x' });

      const [url] = fetchMock.mock.calls[0] as unknown as [string];
      expect(url).toBe('http://127.0.0.1:8787/__proxy/api.typesafe.ai/v1/systemone');
      // 直连时就不该出现上游域名
      expect(url.startsWith('https://api.typesafe.ai')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('关闭代理时仍然直连上游', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const judge = createJudgeAdapter(
        settings({
          proxy: OFF,
          judge: {
            ...DEFAULT_SETTINGS.judge,
            provider: 'typesafe',
            baseUrl: 'https://api.typesafe.ai/v1',
            path: '/systemone',
          },
        }),
        noKeys,
      );
      await judge.judge({ questions: ROUND_QUESTIONS, input: 'x' }).catch(() => undefined);
      const [url] = fetchMock.mock.calls[0] as unknown as [string];
      expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('LLM 请求同样走代理', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const chat = createChatAdapter(
        settings({
          proxy: ON,
          llm: {
            ...DEFAULT_SETTINGS.llm,
            provider: 'deepseek',
            baseUrl: 'https://api.deepseek.com/v1',
            model: 'deepseek-chat',
          },
        }),
        noKeys,
      );
      await chat?.chat({ messages: [{ role: 'user', content: 'hi' }] });
      const [url] = fetchMock.mock.calls[0] as unknown as [string];
      expect(url).toBe('http://127.0.0.1:8787/__proxy/api.deepseek.com/v1/chat/completions');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('默认配置（TypeSafe）也会走代理', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          answers: { 好感度: 3, 投入度: '配合回应', 风险信号: '无明显信号' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const judge = createJudgeAdapter(settings({ proxy: ON }), noKeys);
      expect(judge.id).toBe('typesafe');
      await judge.judge({ questions: ROUND_QUESTIONS, input: 'x' });
      const [url] = fetchMock.mock.calls[0] as unknown as [string];
      expect(url).toBe('http://127.0.0.1:8787/__proxy/api.typesafe.ai/v1/systemone');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('describeTarget', () => {
  it('展示实际请求地址，便于排查', () => {
    expect(describeTarget(ON, 'https://api.typesafe.ai/v1')).toBe(
      'http://127.0.0.1:8787/__proxy/api.typesafe.ai/v1',
    );
    expect(describeTarget(OFF, 'https://api.typesafe.ai/v1')).toBe('https://api.typesafe.ai/v1');
  });
});
