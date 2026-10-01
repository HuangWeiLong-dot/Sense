import type { Advice, AnalysisResult, Secrets, Settings } from '../../types';
import { createChatAdapter } from '../../adapters';
import { buildAdviceMessages, type AdviceContext } from './prompts';

/** 从已有结果里取出发建议所需的上下文。 */
export function adviceContextOf(result: AnalysisResult): AdviceContext {
  return {
    aggregate: result.aggregate,
    summary: result.summary,
    digest: result.digest,
    background: result.meta.background,
    totalRounds: result.rounds.length,
  };
}

/**
 * 按需生成建议（结果页的「生成建议」按钮）。
 * 不做任何本地规则兜底：拿不到模型输出就如实报错，由用户决定是否重试 ——
 * 用本地模板顶上去会让人误以为那是模型给出的判断。
 */
export async function generateAdvice(options: {
  result: AnalysisResult;
  settings: Settings;
  secrets: Secrets;
  signal?: AbortSignal;
}): Promise<Advice> {
  const { result, settings, secrets, signal } = options;

  const chat = createChatAdapter(settings, secrets);
  const text = await chat.chat({
    messages: buildAdviceMessages(adviceContextOf(result)),
    signal,
  });

  const trimmed = text.trim();
  if (!trimmed) throw new Error('模型返回了空建议，请重试或换一个模型。');
  return { text: trimmed };
}
