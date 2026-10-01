// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import App, { probeBadgeTone } from './App';
import type { ProbeResult } from './core/pipeline/health';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function clickButton(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').includes(label),
  );
  if (!button) throw new Error(`找不到按钮：${label}`);
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

async function renderApp() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<App />);
  });
  return { container, root };
}

describe('App 冒烟测试', () => {
  it('首页只有「导入聊天记录」窗口，其余卡片不出现', async () => {
    const { container, root } = await renderApp();
    const text = container.textContent ?? '';

    expect(text).toContain('Sense');
    expect(text).toContain('导入聊天记录');
    expect(text).toContain('载入示例');

    // 首页只保留导入窗口：核对、判断引擎、脱敏设置、背景信息、开始分析都不该出现
    expect(text).not.toContain('核对气泡与双方标注');
    expect(text).not.toContain('判断引擎');
    expect(text).not.toContain('脱敏设置');
    expect(text).not.toContain('背景信息');
    expect(text).not.toContain('开始判断');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('解析后进入工作区，出现核对与分析控件', async () => {
    const { container, root } = await renderApp();

    await act(async () => {
      clickButton(container, '载入示例');
    });
    await act(async () => {
      clickButton(container, '解析对话');
    });

    const text = container.textContent ?? '';
    expect(text).toContain('核对气泡与双方标注');
    expect(text).toContain('判断引擎');
    expect(text).toContain('脱敏设置');
    expect(text).toContain('开始判断');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe('右上角标记配色', () => {
  const ok: ProbeResult = { ok: true, ms: 320 };
  const failed: ProbeResult = { ok: false, ms: 1200, error: 'HTTP 401' };

  it('测试通过才变绿', () => {
    expect(probeBadgeTone(ok)).toBe('good');
  });

  it('测过但失败变红', () => {
    expect(probeBadgeTone(failed)).toBe('bad');
  });

  it('没测过是中性色，不会拿「已配置」冒充「已验证」', () => {
    expect(probeBadgeTone(null)).toBe('neutral');
  });
});
