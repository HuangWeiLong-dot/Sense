import { useEffect, useRef, type RefObject } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';

type ChartInstance = ReturnType<typeof echarts.init>;

/**
 * 轻量 ECharts 封装：初始化、resize、销毁、option 更新。
 * option 需由调用方 useMemo 稳定引用。
 * 在缺少 canvas / ResizeObserver 的环境（jsdom、SSR、无 WebGL 的旧浏览器）里静默降级，
 * 保证图表失败不会让整页白屏。
 */
export function useECharts(option: EChartsOption): RefObject<HTMLDivElement | null> {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartInstance | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    try {
      chartRef.current = echarts.init(el, undefined, { renderer: 'canvas' });
    } catch {
      chartRef.current = null;
      return;
    }

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => chartRef.current?.resize());
      observer.observe(el);
    }

    return () => {
      observer?.disconnect();
      try {
        chartRef.current?.dispose();
      } catch {
        /* 图表销毁失败不影响页面卸载 */
      }
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    try {
      chartRef.current?.setOption(option, true);
    } catch {
      /* 图表渲染失败不影响其余内容 */
    }
  }, [option]);

  return containerRef;
}
