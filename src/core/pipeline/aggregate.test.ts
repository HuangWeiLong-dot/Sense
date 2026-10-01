import { describe, expect, it } from 'vitest';
import type { RoundJudgement } from '../../types';
import { aggregateJudgements, trendDelta, trendLabel } from './aggregate';

function judgement(partial: Partial<RoundJudgement>): RoundJudgement {
  return {
    round: 1,
    score: 5,
    engagement: '配合回应',
    risk: '无明显信号',
    raw: {},
    ...partial,
  };
}

describe('汇总判断：结构化统计', () => {
  const judgements: RoundJudgement[] = [
    judgement({ round: 1, score: 8, engagement: '主动推进' }),
    judgement({ round: 2, score: 4, engagement: '被动敷衍', risk: '冷暴力倾向' }),
    judgement({ round: 3, score: 5, degraded: true, error: 'boom' }),
  ];

  const agg = aggregateJudgements(judgements);

  it('统计轮数与趋势，排除降级轮次', () => {
    expect(agg.总轮数).toBe(3);
    expect(agg.好感度趋势).toEqual([8, 4]);
    expect(agg.好感度均值).toBe(6);
    expect(agg.失败轮数).toBe(1);
  });

  it('分布补齐所有选项（含 0）', () => {
    expect(agg.投入度分布).toEqual({
      主动推进: 1,
      配合回应: 0,
      被动敷衍: 1,
      回避冷淡: 0,
    });
    expect(agg.风险信号分布['冷暴力倾向']).toBe(1);
    expect(agg.风险信号分布['无明显信号']).toBe(1);
    expect(agg.风险信号分布['情感操控倾向']).toBe(0);
  });

  it('派生 0-10 的投入度得分与风险指数', () => {
    // (10 + 2.5) / 2 = 6.25 → 6.3
    expect(agg.投入度得分).toBe(6.3);
    // (0 + 8) / 2 = 4
    expect(agg.风险指数).toBe(4);
  });

  it('没有可用轮次时返回零值而不是 NaN', () => {
    const empty = aggregateJudgements([judgement({ degraded: true })]);
    expect(empty.好感度均值).toBe(0);
    expect(empty.投入度得分).toBe(0);
    expect(empty.风险指数).toBe(0);
  });
});

describe('趋势', () => {
  it('计算前后半段差值', () => {
    expect(trendDelta([8, 8, 4, 3])).toBe(-4.5);
    expect(trendDelta([5])).toBe(0);
  });

  it('给出中文趋势描述', () => {
    expect(trendLabel([8, 8, 3, 3])).toContain('降温');
    expect(trendLabel([3, 4, 7, 8])).toContain('升温');
    expect(trendLabel([6, 6, 6, 6])).toContain('平稳');
  });
});
