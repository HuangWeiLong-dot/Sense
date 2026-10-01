import type {
  AnalysisResult,
  Bubble,
  RoundJudgement,
  Secrets,
  Settings,
  SummaryJudgement,
} from '../../types';
import { createJudgeAdapter } from '../../adapters';
import { mapLimit, sleep, uid } from '../../lib/utils';
import {
  ROUND_ENGAGEMENT_KEY,
  ROUND_QUESTIONS,
  ROUND_RISK_KEY,
  ROUND_SCORE_KEY,
  SUMMARY_QUESTIONS,
  SUMMARY_RISK_KEY,
  SUMMARY_STAGE_KEY,
  SUMMARY_TEMPERATURE_KEY,
} from '../jev/questions';
import { buildRounds } from '../preprocess/parse';
import { aggregateJudgements } from './aggregate';
import { buildDigest, type RoundPair } from './digest';
import { buildSummaryInput } from './prompts';

export type Stage = 'prepare' | 'judge' | 'summarize' | 'done';

export interface Progress {
  stage: Stage;
  current: number;
  total: number;
  message: string;
}

export interface RunAnalysisOptions {
  bubbles: Bubble[];
  settings: Settings;
  secrets: Secrets;
  background?: string;
  onProgress?: (progress: Progress) => void;
  signal?: AbortSignal;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await sleep(400 * (i + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function makeTitle(bubbles: Bubble[], judged: number, totalRounds: number): string {
  const first = bubbles.find((b) => b.speaker === 'me' && b.kind === 'text')?.clean ?? '';
  const snippet = first.replace(/\s+/g, ' ').slice(0, 18);
  const suffix = judged < totalRounds ? `${totalRounds} 轮（判 ${judged}）` : `${totalRounds} 轮`;
  return snippet ? `${snippet}… · ${suffix}` : `对话分析 · ${suffix}`;
}

/**
 * 主流水线：本地预处理 → 逐轮 JEV 判断 → 汇总判断。
 *
 * 建议**不在这里生成** —— 结果页点「生成建议」时才调 LLM（见 pipeline/advice.ts），
 * 这样不想看建议就不会产生 token 消耗。
 * 单轮失败会标记 degraded 并排除统计；全部失败或汇总失败会直接报错，
 * 不再用本地规则推导出看似真实的结论。
 */
export async function runAnalysis(options: RunAnalysisOptions): Promise<AnalysisResult> {
  const { bubbles, settings, secrets, onProgress, signal } = options;
  const report = (progress: Progress) => onProgress?.(progress);

  /* 1. 轮次 */
  report({ stage: 'prepare', current: 0, total: 0, message: '本地预处理：切分轮次' });
  const allRounds = buildRounds(bubbles);
  if (!allRounds.length) {
    throw new Error('没有解析出可判断的轮次，请检查导入内容与双方标注。');
  }

  const judgeable = allRounds.filter((r) => !r.awaitingReply);
  if (!judgeable.length) {
    throw new Error('所有轮次都缺少对方的回复，无法判断。');
  }
  // 超出上限时保留最近的轮次（最近的状态更有参考价值）
  const target =
    judgeable.length > settings.maxRounds ? judgeable.slice(-settings.maxRounds) : judgeable;

  /* 2. 逐轮 JEV 判断 */
  const judge = createJudgeAdapter(settings, secrets);
  const judgeName = judge.label;
  const total = target.length;
  let finished = 0;
  report({ stage: 'judge', current: 0, total, message: `逐轮 JEV 判断 0/${total}（${judgeName}）` });

  const judgements: RoundJudgement[] = await mapLimit(
    target,
    Math.max(1, settings.judge.concurrency),
    async (round): Promise<RoundJudgement> => {
      try {
        const raw = await withRetry(
          () =>
            judge.judge({
              questions: ROUND_QUESTIONS,
              input: round.input,
              label: `第${round.index}轮`,
              signal,
            }),
          2,
        );
        return {
          round: round.index,
          score: Number(raw[ROUND_SCORE_KEY]),
          engagement: String(raw[ROUND_ENGAGEMENT_KEY]),
          risk: String(raw[ROUND_RISK_KEY]),
          raw,
        };
      } catch (err) {
        return {
          round: round.index,
          score: 5,
          engagement: '配合回应',
          risk: '无明显信号',
          raw: {},
          error: errorMessage(err),
          degraded: true,
        };
      } finally {
        finished += 1;
        report({
          stage: 'judge',
          current: finished,
          total,
          message: `逐轮 JEV 判断 ${finished}/${total}（${judgeName}）`,
        });
      }
    },
  );

  if (judgements.every((j) => j.degraded)) {
    const first = judgements.find((j) => j.error)?.error ?? '未知错误';
    throw new Error(`全部 ${judgements.length} 轮判断失败：${first}`);
  }

  /* 3. 汇总判断 */
  const aggregate = aggregateJudgements(judgements);
  const pairs: RoundPair[] = target.map((round, i) => ({ round, judgement: judgements[i] }));
  const digest = buildDigest(pairs, allRounds.length);

  report({ stage: 'summarize', current: 0, total: 1, message: '汇总判断' });
  let summary: SummaryJudgement;
  try {
    const raw = await withRetry(
      () =>
        judge.judge({
          questions: SUMMARY_QUESTIONS,
          input: buildSummaryInput(aggregate),
          label: '汇总判断',
          signal,
        }),
      2,
    );
    summary = {
      temperature: Number(raw[SUMMARY_TEMPERATURE_KEY]),
      riskLevel: String(raw[SUMMARY_RISK_KEY]),
      stage: String(raw[SUMMARY_STAGE_KEY]),
      raw,
    };
  } catch (err) {
    throw new Error(`汇总判断失败：${errorMessage(err)}`);
  }

  const result: AnalysisResult = {
    id: uid('res'),
    createdAt: Date.now(),
    title: makeTitle(bubbles, target.length, allRounds.length),
    rounds: allRounds,
    judgements,
    aggregate,
    summary,
    // 建议按需生成
    advice: null,
    digest,
    meta: {
      judgeProvider: settings.judge.provider,
      judgeModel: settings.judge.model || judgeName,
      llmProvider: settings.llm.provider,
      llmModel: settings.llm.model,
      anonymize: settings.anonymize,
      background: options.background,
    },
  };

  report({ stage: 'done', current: 1, total: 1, message: '分析完成' });
  return result;
}
