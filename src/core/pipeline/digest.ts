import type { Round, RoundJudgement } from '../../types';
import { round1 } from '../../lib/utils';
import { theirsText } from '../preprocess/parse';
import { trendLabel } from './aggregate';

export interface RoundPair {
  round: Round;
  judgement: RoundJudgement;
}

function excerpt(text: string, max = 40): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function lengthsOf(pairs: RoundPair[]): number[] {
  return pairs.map((p) => theirsText(p.round).replace(/\s/g, '').length);
}

/**
 * 脱敏摘要：给 LLM 的「最近 N 轮对话概要」。
 * 只使用统计量与极短摘录，不发送完整对话。
 */
export function buildDigest(pairs: RoundPair[], totalRounds: number, recentN = 10): string {
  const usable = pairs.filter((p) => !p.judgement.degraded);
  if (!usable.length) return '本次分析没有可用的逐轮判断结果。';

  const recent = usable.slice(-recentN);
  const scores = usable.map((p) => p.judgement.score);
  const lengths = lengthsOf(usable);
  const half = Math.floor(lengths.length / 2);
  const firstHalfLen = half ? round1(lengths.slice(0, half).reduce((a, b) => a + b, 0) / half) : 0;
  const lastHalfLen = half
    ? round1(lengths.slice(-half).reduce((a, b) => a + b, 0) / half)
    : round1(lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length));

  const engagementCounts = new Map<string, number>();
  const riskCounts = new Map<string, number>();
  for (const p of usable) {
    engagementCounts.set(
      p.judgement.engagement,
      (engagementCounts.get(p.judgement.engagement) ?? 0) + 1,
    );
    riskCounts.set(p.judgement.risk, (riskCounts.get(p.judgement.risk) ?? 0) + 1);
  }

  const risky = usable
    .filter((p) => p.judgement.risk !== '无明显信号')
    .sort((a, b) => a.judgement.score - b.judgement.score)
    .slice(0, 3);

  const lines: string[] = [];
  lines.push(
    `最近 ${recent.length} 轮对话概要（本次共判断 ${usable.length}/${totalRounds} 轮，全部基于脱敏文本）：`,
  );
  lines.push(
    `- 好感度：均值 ${round1(scores.reduce((a, b) => a + b, 0) / scores.length)}/10，最低 ${Math.min(...scores)}，最高 ${Math.max(...scores)}；趋势：${trendLabel(scores)}`,
  );
  lines.push(`- 对方平均回复长度：${round1(lengths.reduce((a, b) => a + b, 0) / lengths.length)} 字`);
  if (half >= 1 && firstHalfLen !== lastHalfLen) {
    lines.push(
      `- 回复长度变化：前 ${half} 轮平均 ${firstHalfLen} 字 → 后 ${half} 轮平均 ${lastHalfLen} 字`,
    );
  }
  lines.push(
    `- 投入度分布：${[...engagementCounts.entries()].map(([k, v]) => `${k} ${v} 轮`).join('，')}`,
  );
  lines.push(
    `- 风险信号分布：${[...riskCounts.entries()].map(([k, v]) => `${k} ${v} 轮`).join('，')}`,
  );

  if (risky.length) {
    lines.push('- 值得注意的轮次（脱敏摘录）：');
    for (const p of risky) {
      lines.push(
        `  · 第 ${p.round.index} 轮（好感度 ${p.judgement.score}，${p.judgement.engagement}，${p.judgement.risk}）对方说：「${excerpt(theirsText(p.round))}」`,
      );
    }
  }

  const sorted = [...usable].sort((a, b) => b.judgement.score - a.judgement.score);
  const best = sorted[0];
  if (best && best.judgement.score >= 6) {
    lines.push(
      `- 最好的一轮：第 ${best.round.index} 轮（好感度 ${best.judgement.score}）对方说：「${excerpt(theirsText(best.round))}」`,
    );
  }

  return lines.join('\n');
}
