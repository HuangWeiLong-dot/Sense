import type { Aggregate, SummaryJudgement } from '../../types';
import type { ChatMessage } from '../../adapters/types';
import { trendLabel } from './aggregate';

/**
 * 汇总判断的输入：spec 4.2 的结构化汇总。
 * 只发送逐轮判断结果，不发送原始对话。
 */
export function buildSummaryInput(aggregate: Aggregate): string {
  return JSON.stringify(
    {
      总轮数: aggregate.总轮数,
      好感度趋势: aggregate.好感度趋势,
      好感度均值: aggregate.好感度均值,
      投入度分布: aggregate.投入度分布,
      风险信号分布: aggregate.风险信号分布,
      派生指标: {
        投入度得分: aggregate.投入度得分,
        风险指数: aggregate.风险指数,
        判断失败轮数: aggregate.失败轮数,
      },
    },
    null,
    2,
  );
}

export interface AdviceContext {
  aggregate: Aggregate;
  summary: SummaryJudgement;
  digest: string;
  background?: string;
  totalRounds: number;
}

export const ADVICE_SYSTEM_PROMPT = [
  '你是一个务实、克制的关系顾问。',
  '用户提供了一段对话的 JEV 判断结果和脱敏摘要，你需要给出可执行的建议。',
  '原则：',
  '1. 不夸大也不淡化，避免「TA 一定喜欢你」这类断言；用概率和观察说话。',
  '2. 建议必须具体、可执行，包含时间范围、行为边界和话术示例。',
  '3. 不做心理疾病诊断，不评判用户，不鼓励操控对方。',
  '4. 如果出现操控、冷暴力等风险信号，要明确指出并建议寻求现实中的支持。',
  '5. 用中文输出，分三节，每节 3-5 句，不要输出 Markdown 表格。',
].join('\n');

export function buildAdviceUserPrompt(ctx: AdviceContext): string {
  const { aggregate, summary, digest, background, totalRounds } = ctx;
  const lines: string[] = [];

  lines.push('你是一个关系顾问。用户提供了一段对话的 JEV 判断结果，以及脱敏摘要。');
  lines.push('');
  lines.push('JEV 判断结果：');
  lines.push(`- 整体关系温度：${summary.temperature}/10`);
  lines.push(`- 关系风险等级：${summary.riskLevel}`);
  lines.push(`- 关系阶段：${summary.stage}`);
  lines.push(
    `- 逐轮规模：共判断 ${aggregate.总轮数} 轮（原始对话 ${totalRounds} 轮），好感度均值 ${aggregate.好感度均值}/10，趋势${trendLabel(aggregate.好感度趋势)}`,
  );
  lines.push(`- 投入度得分：${aggregate.投入度得分}/10，风险指数：${aggregate.风险指数}/10`);
  lines.push('');
  lines.push('脱敏摘要：');
  lines.push(digest);
  if (background?.trim()) {
    lines.push('');
    lines.push('用户补充的背景信息：');
    lines.push(background.trim());
  }
  lines.push('');
  lines.push('请给出：');
  lines.push('1. 对当前关系的客观解读（不要过度乐观或悲观）');
  lines.push('2. 接下来 1-2 周的具体行动建议');
  lines.push('3. 需要注意的信号');
  lines.push('');
  lines.push('请用「【当前关系的解读】」「【接下来 1-2 周的行动建议】」「【需要注意的信号】」三个小标题分段输出。');

  return lines.join('\n');
}

export function buildAdviceMessages(ctx: AdviceContext): ChatMessage[] {
  return [
    { role: 'system', content: ADVICE_SYSTEM_PROMPT },
    { role: 'user', content: buildAdviceUserPrompt(ctx) },
  ];
}
