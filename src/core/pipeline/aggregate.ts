import type { Aggregate, Distribution, RoundJudgement } from '../../types';
import { countBy, mean, round1 } from '../../lib/utils';
import {
  ENGAGEMENT_LABELS,
  ENGAGEMENT_WEIGHTS,
  RISK_LABELS,
  RISK_WEIGHTS,
} from '../jev/questions';

function withZeros(counts: Record<string, number>, labels: string[]): Distribution {
  const out: Distribution = {};
  for (const label of labels) out[label] = counts[label] ?? 0;
  for (const [key, value] of Object.entries(counts)) if (!(key in out)) out[key] = value;
  return out;
}

/**
 * 4.2 汇总判断的输入构造：逐轮结果 → 结构化汇总。
 * 不重新喂原始对话。判断失败的轮次（degraded）不计入统计。
 */
export function aggregateJudgements(judgements: RoundJudgement[]): Aggregate {
  const ok = judgements.filter((j) => !j.degraded);
  const trend = ok.map((j) => j.score);
  const engagementCounts = countBy(ok.map((j) => j.engagement));
  const riskCounts = countBy(ok.map((j) => j.risk));

  const engagementScore = ok.length
    ? round1(ok.reduce((acc, j) => acc + (ENGAGEMENT_WEIGHTS[j.engagement] ?? 5), 0) / ok.length)
    : 0;
  const riskIndex = ok.length
    ? round1(ok.reduce((acc, j) => acc + (RISK_WEIGHTS[j.risk] ?? 3), 0) / ok.length)
    : 0;

  return {
    总轮数: judgements.length,
    好感度趋势: trend,
    好感度均值: round1(mean(trend)),
    投入度分布: withZeros(engagementCounts, ENGAGEMENT_LABELS),
    风险信号分布: withZeros(riskCounts, RISK_LABELS),
    投入度得分: engagementScore,
    风险指数: riskIndex,
    失败轮数: judgements.length - ok.length,
  };
}

/** 趋势斜率（后半段均值 - 前半段均值）。 */
export function trendDelta(trend: number[]): number {
  const half = Math.floor(trend.length / 2);
  if (half < 1) return 0;
  return round1(mean(trend.slice(-half)) - mean(trend.slice(0, half)));
}

export function trendLabel(trend: number[]): string {
  const delta = trendDelta(trend);
  if (trend.length < 3) return '样本较少，暂不判断趋势';
  if (delta >= 1.5) return `明显升温（后半段平均高出 ${delta} 分）`;
  if (delta >= 0.5) return `小幅升温（+${delta} 分）`;
  if (delta <= -1.5) return `明显降温（后半段平均低了 ${Math.abs(delta)} 分）`;
  if (delta <= -0.5) return `小幅降温（${delta} 分）`;
  return '基本平稳';
}
