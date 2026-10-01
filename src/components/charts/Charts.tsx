import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { useECharts } from './useECharts';

/** 画布内配色（ECharts 读不到 CSS 变量，这里与 index.css 的粉白玻璃 token 保持同值）。 */
const SANS =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'PingFang SC', sans-serif";
const ACCENT = '#db2777';
const TEXT = '#2b1b2e';
const MUTED = 'rgba(122,100,128,0.85)';
const LINE = 'rgba(196,138,172,0.35)';
const GRID = 'rgba(196,138,172,0.22)';

const tooltipBase = {
  backgroundColor: 'rgba(255,255,255,0.9)',
  borderColor: 'rgba(236,72,153,0.28)',
  borderWidth: 1,
  borderRadius: 16,
  padding: [8, 12] as [number, number],
  textStyle: { color: TEXT, fontSize: 12, fontFamily: SANS },
  extraCssText:
    'box-shadow: 0 8px 32px rgba(196,120,160,0.3); border-radius: 16px; backdrop-filter: blur(20px);',
};

interface TimelineProps {
  trend: number[];
  mean: number;
  height?: number;
}

/** 7.2 时间线图：X 轴轮次，Y 轴好感度。平滑曲线 + 发光渐变面积。 */
export function TimelineChart({ trend, mean, height = 260 }: TimelineProps) {
  const option = useMemo<EChartsOption>(
    () => ({
      backgroundColor: 'transparent',
      textStyle: { fontFamily: SANS, color: MUTED },
      grid: { left: 36, right: 22, top: 26, bottom: 26 },
      tooltip: {
        ...tooltipBase,
        trigger: 'axis',
        axisPointer: {
          type: 'line',
          lineStyle: { color: 'rgba(219,39,119,0.45)', width: 1, type: 'dashed' },
        },
        formatter: (params: unknown) => {
          const arr = Array.isArray(params) ? params : [params];
          const first = arr[0] as { dataIndex: number; value: number } | undefined;
          if (!first) return '';
          return `<div style="font-size:11px;color:rgba(122,100,128,0.85)">第 ${first.dataIndex + 1} 轮</div><div style="font-weight:600;font-size:13px">好感度 ${first.value} <span style="color:rgba(122,100,128,0.85);font-weight:400">/ 10</span></div>`;
        },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: trend.map((_, i) => `${i + 1}`),
        axisLine: { lineStyle: { color: LINE } },
        axisTick: { show: false },
        axisLabel: { color: MUTED, fontSize: 11, fontFamily: SANS, margin: 12 },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 10,
        interval: 2,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: MUTED, fontSize: 11, fontFamily: SANS, margin: 12 },
        splitLine: { lineStyle: { color: GRID } },
      },
      series: [
        {
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 8,
          data: trend,
          lineStyle: {
            width: 2.6,
            color: ACCENT,
            shadowColor: 'rgba(236,72,153,0.45)',
            shadowBlur: 14,
            shadowOffsetY: 7,
          },
          itemStyle: { color: '#ffffff', borderColor: ACCENT, borderWidth: 2 },
          emphasis: { scale: 1.4 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(236,72,153,0.28)' },
                { offset: 1, color: 'rgba(236,72,153,0)' },
              ],
            },
          },
          markLine: {
            silent: true,
            symbol: 'none',
            data: [{ yAxis: mean }],
            lineStyle: { color: 'rgba(190,140,175,0.65)', type: 'dashed', width: 1 },
            // 标签改放在卡片头部（见 ResultPage），避免在绘图区右端被裁切
            label: { show: false },
          },
        },
      ],
    }),
    [trend, mean],
  );

  const ref = useECharts(option);
  return <div ref={ref} className="w-full" style={{ height }} />;
}

interface RadarProps {
  score: number;
  engagement: number;
  risk: number;
  height?: number;
}

/** 7.3 雷达图：好感度 / 投入度 / 风险指数。 */
export function RadarChart({ score, engagement, risk, height = 260 }: RadarProps) {
  const option = useMemo<EChartsOption>(
    () => ({
      backgroundColor: 'transparent',
      textStyle: { fontFamily: SANS, color: MUTED },
      tooltip: { ...tooltipBase },
      radar: {
        indicator: [
          { name: '好感度', max: 10 },
          { name: '投入度', max: 10 },
          { name: '风险指数', max: 10 },
        ],
        radius: '64%',
        center: ['50%', '54%'],
        axisName: { color: TEXT, fontSize: 11.5, fontFamily: SANS },
        splitLine: { lineStyle: { color: LINE } },
        splitArea: { areaStyle: { color: ['rgba(255,255,255,0.4)', 'rgba(236,72,153,0.05)'] } },
        axisLine: { lineStyle: { color: LINE } },
      },
      series: [
        {
          type: 'radar',
          symbol: 'circle',
          symbolSize: 5,
          data: [
            {
              value: [score, engagement, risk],
              name: '当前关系状态',
              lineStyle: {
                color: ACCENT,
                width: 2.2,
                shadowColor: 'rgba(236,72,153,0.45)',
                shadowBlur: 14,
              },
              itemStyle: { color: '#fff', borderColor: ACCENT, borderWidth: 1.5 },
              areaStyle: { color: 'rgba(236,72,153,0.18)' },
            },
          ],
        },
      ],
    }),
    [score, engagement, risk],
  );

  const ref = useECharts(option);
  return <div ref={ref} className="w-full" style={{ height }} />;
}
