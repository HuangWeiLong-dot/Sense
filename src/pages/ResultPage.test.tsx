// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// ECharts 在 jsdom 里没有真实 canvas，卸载后动画帧会打到 null 上下文并抛未捕获异常。
// 这个文件只验证内容与交互，图表本身用空组件顶掉。
vi.mock('../components/charts/Charts', () => ({
  TimelineChart: () => null,
  RadarChart: () => null,
}));

import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Settings } from '../types';
import { ResultPage } from './ResultPage';
import { parseChat } from '../core/preprocess/parse';
import { runAnalysis } from '../core/pipeline/run';
import { DEFAULT_SETTINGS } from '../store/settings';
import { getResult, saveResult } from '../store/history';
import { SAMPLE_CHAT } from '../data/sample';
import { stubModelApi } from '../test/stubModelApi';
import { SettingsProvider } from '../store/SettingsContext';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function settings(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    judge: {
      ...DEFAULT_SETTINGS.judge,
      provider: 'typesafe',
      baseUrl: 'https://judge.test',
      path: '/systemone',
      model: 'jev-latest',
    },
  };
}

async function seedResult(): Promise<string> {
  const config = settings();
  const parsed = parseChat(SAMPLE_CHAT, config.anonymize);
  const result = await runAnalysis({
    bubbles: parsed.bubbles,
    settings: config,
    secrets: { judgeApiKey: 'k', llmApiKey: 'k' },
  });
  saveResult(result);
  return result.id;
}

async function render(node: ReactElement): Promise<{ container: HTMLDivElement; root: ReturnType<typeof createRoot> }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return { container, root };
}

function pageFor(id: string): ReactElement {
  return (
    <SettingsProvider>
      <MemoryRouter initialEntries={[`/result/${id}`]}>
        <Routes>
          <Route path="/result/:id" element={<ResultPage />} />
        </Routes>
      </MemoryRouter>
    </SettingsProvider>
  );
}

async function clickButton(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').includes(label),
  );
  if (!button) throw new Error(`找不到按钮：${label}`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('结果页', () => {
  it('展示标签、数字与图表标题，建议等待按需生成', async () => {
    const stubModelApiHandle = stubModelApi();
    let id = '';
    try {
      id = await seedResult();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(stubModelApiHandle).toHaveBeenCalled();
    expect(getResult(id)).not.toBeNull();

    const { container, root } = await render(pageFor(id));

    const text = container.textContent ?? '';
    expect(text).toContain('整体关系温度');
    expect(text).toContain('关系风险等级');
    expect(text).toContain('关系阶段');
    expect(text).toContain('好感度时间线');
    expect(text).toContain('关系状态雷达');
    expect(text).toContain('逐轮判断明细');
    expect(text).toContain('脱敏摘要');
    // 分析阶段不再生成建议
    expect(text).toContain('生成建议');
    expect(text).toContain('尚未生成');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('点「生成建议」才调用 LLM，并把结果写回历史', async () => {
    let id = '';
    stubModelApi();
    try {
      id = await seedResult();
    } finally {
      vi.unstubAllGlobals();
    }

    const { container, root } = await render(pageFor(id));
    expect(container.textContent ?? '').not.toContain('【建议】正文');
    // 没有 AI 内容时不显示免责声明
    expect(container.textContent ?? '').not.toContain('由 AI 生成');

    const fetchMock = stubModelApi({ adviceText: '【建议】正文' });
    await clickButton(container, '生成建议');
    await act(async () => {
      await Promise.resolve();
    });

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.some(([, init]) => String(init.body).includes('"messages"'))).toBe(true);
    expect(container.textContent ?? '').toContain('【建议】正文');
    // 建议生成后必须带上 AI 免责声明
    expect(container.textContent ?? '').toContain('由 AI 生成');
    expect(container.textContent ?? '').toContain('仅供参考');
    expect(container.textContent ?? '').toContain('不构成心理或医疗建议');

    // 落盘：刷新后仍能读到
    expect(getResult(id)?.advice?.text).toBe('【建议】正文');

    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it('记录不存在时给出友好提示', async () => {
    const { container, root } = await render(pageFor('nope'));

    expect(container.textContent ?? '').toContain('找不到这条记录');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
