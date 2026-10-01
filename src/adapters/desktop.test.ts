import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { AdapterError, postJson } from './types';
import type { Secrets, Settings } from '../types';
import { DEFAULT_SETTINGS } from '../store/settings';
import { createJudgeAdapter } from './index';

const require = createRequire(import.meta.url);
const { forwardRequest } = require('../../desktop/httpForward.cjs') as {
  forwardRequest: (
    options: { url: string; method?: string; headers?: Record<string, string>; body?: string },
    controller?: AbortController,
  ) => Promise<{ status: number; statusText: string; text: string }>;
};

interface StubBridge {
  request: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
}

function installBridge(handler?: (options: Record<string, unknown>) => unknown): StubBridge {
  const bridge: StubBridge = {
    request: vi.fn(async (options: Record<string, unknown>) =>
      handler ? handler(options) : { status: 200, statusText: 'OK', text: '{"ok":true}' },
    ),
    abort: vi.fn(),
  };
  (globalThis as { senseDesktop?: unknown }).senseDesktop = bridge;
  return bridge;
}

function removeBridge() {
  delete (globalThis as { senseDesktop?: unknown }).senseDesktop;
}

describe('桌面壳：渲染进程请求通道', () => {
  it('有桌面桥时走主进程，完全不碰 fetch', async () => {
    const bridge = installBridge();
    const fetchSpy = vi.fn(() => {
      throw new Error('不应该走到 fetch');
    });
    vi.stubGlobal('fetch', fetchSpy);

    try {
      const result = await postJson({
        url: 'https://api.typesafe.ai/v1/systemone',
        apiKey: 'secret-key',
        body: { state: 'hi' },
      });

      expect(result).toEqual({ ok: true });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(bridge.request).toHaveBeenCalledTimes(1);

      const sent = bridge.request.mock.calls[0][0] as Record<string, unknown>;
      expect(sent.url).toBe('https://api.typesafe.ai/v1/systemone');
      expect(sent.method).toBe('POST');
      expect(sent.body).toBe('{"state":"hi"}');
      expect((sent.headers as Record<string, string>).authorization).toBe('Bearer secret-key');
      expect(typeof sent.id).toBe('string');
    } finally {
      removeBridge();
      vi.unstubAllGlobals();
    }
  });

  it('非 2xx 仍然转成带状态码的 AdapterError', async () => {
    installBridge(() => ({ status: 401, statusText: 'Unauthorized', text: '{"detail":"bad key"}' }));
    try {
      await expect(
        postJson({ url: 'https://api.typesafe.ai/v1/systemone', body: {} }),
      ).rejects.toThrow(/HTTP 401 Unauthorized/);
    } finally {
      removeBridge();
    }
  });

  it('主进程报错会变成可读的 AdapterError', async () => {
    installBridge(() => {
      throw new Error('网络请求失败：getaddrinfo ENOTFOUND');
    });
    try {
      await expect(postJson({ url: 'https://nope.test/v1', body: {} })).rejects.toThrow(
        /网络请求失败/,
      );
    } finally {
      removeBridge();
    }
  });

  it('取消会把 abort 传到主进程', async () => {
    const controller = new AbortController();
    const bridge = installBridge(
      () =>
        new Promise((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('Aborted: 请求已取消')));
        }),
    );

    try {
      const pending = postJson({
        url: 'https://api.typesafe.ai/v1/systemone',
        body: {},
        signal: controller.signal,
      });
      await Promise.resolve();
      controller.abort();
      await expect(pending).rejects.toThrow(/取消或超时/);
      expect(bridge.abort).toHaveBeenCalledTimes(1);
      // abort 的 id 必须和 request 的 id 一致，否则主进程找不到要中断的请求
      expect(bridge.abort.mock.calls[0][0]).toBe(bridge.request.mock.calls[0][0].id);
    } finally {
      removeBridge();
    }
  });

  it('没有桌面桥时保持浏览器行为（走 fetch）', async () => {
    removeBridge();
    const fetchSpy = vi.fn(async () =>
      new Response('{"via":"fetch"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const result = await postJson({ url: 'https://example.test/v1', body: {} });
      expect(result).toEqual({ via: 'fetch' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('JEV 适配器整体也走桌面桥', async () => {
    const bridge = installBridge(() => ({
      status: 200,
      statusText: 'OK',
      text: JSON.stringify({ answers: { 好感度: 3, 投入度: '配合回应', 风险信号: '无明显信号' } }),
    }));
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      judge: {
        ...DEFAULT_SETTINGS.judge,
        provider: 'typesafe',
        baseUrl: 'https://api.typesafe.ai/v1',
        path: '/systemone',
        model: 'jev-latest',
      },
    };
    const secrets: Secrets = { judgeApiKey: 'k', llmApiKey: '' };

    try {
      const judge = createJudgeAdapter(settings, secrets);
      const answers = await judge.judge({
        questions: { 好感度: { type: 'score', instructions: 'x', legend: { 0: '无', 1: '有' } } },
        input: 'hi',
      });
      expect(bridge.request).toHaveBeenCalledTimes(1);
      expect((bridge.request.mock.calls[0][0] as { url: string }).url).toBe(
        'https://api.typesafe.ai/v1/systemone',
      );
      expect(answers).toBeTruthy();
    } finally {
      removeBridge();
    }
  });
});

describe('桌面壳：主进程转发', () => {
  it('原样带回状态码与响应体', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('{"answers":{}}', { status: 200, statusText: 'OK' }),
      ),
    );
    try {
      const result = await forwardRequest({
        url: 'https://api.typesafe.ai/v1/systemone',
        headers: { authorization: 'Bearer k' },
        body: '{}',
      });
      expect(result).toEqual({ status: 200, statusText: 'OK', text: '{"answers":{}}' });
      const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(init.method).toBe('POST');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('中途取消报成 Aborted（上层才能识别为取消）', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ),
    );
    try {
      const pending = forwardRequest({ url: 'https://x.test/v1' }, controller);
      controller.abort();
      await expect(pending).rejects.toThrow(/Aborted/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('网络错误带上可读前缀', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      }),
    );
    try {
      await expect(forwardRequest({ url: 'https://nope.test/v1' })).rejects.toThrow(
        /网络请求失败：getaddrinfo ENOTFOUND/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('桌面壳：错误类型', () => {
  it('AdapterError 是独立类型，便于上层判断', () => {
    expect(new AdapterError('x')).toBeInstanceOf(Error);
  });
});
