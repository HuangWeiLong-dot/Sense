import type { Questions } from '../../types';

/**
 * 4.1 逐轮判断（三个 question 一次性问，JEV 一次返回）。
 * 字段名与 JSON 结构严格对齐 spec，可直接作为 `questions` 参数发给 TypeSafe API。
 */
export const ROUND_QUESTIONS: Questions = {
  好感度: {
    type: 'score',
    instructions: '判断对方在这轮对话中对用户的情感倾向，从冷漠到热情。',
    legend: {
      '0': '明显反感',
      '2': '冷淡敷衍',
      '4': '中性礼貌',
      '6': '友好积极',
      '8': '明显好感',
      '10': '热烈喜欢',
    },
  },
  投入度: {
    type: 'choice',
    instructions: '判断对方在这轮对话中的投入程度。',
    criteria: {
      主动推进: '对方主动发起话题、提问、延伸对话',
      配合回应: '对方正常回应但不主动延伸',
      被动敷衍: '回复简短（嗯/哦/好）、延迟、不接话',
      回避冷淡: '不回复关键内容、转移话题、明确回避',
    },
  },
  风险信号: {
    type: 'choice',
    instructions: '判断这轮对话中是否存在以下关系风险信号，选择最显著的一项。',
    criteria: {
      无明显信号: '对话正常，无风险特征',
      冷暴力倾向: '持续不回应、故意忽视、惩罚性沉默',
      情感操控倾向: '贬低、让用户自我怀疑、责任转移',
      间歇性强化: '忽冷忽热、奖励惩罚交替',
      暧昧不承诺: '亲密语言但回避关系定义',
    },
  },
};

/** 4.2 汇总判断的 questions。 */
export const SUMMARY_QUESTIONS: Questions = {
  整体关系温度: {
    type: 'score',
    instructions: '基于逐轮判断结果，给出这段对话中对方对用户的整体情感温度。',
    legend: {
      '0': '明显排斥',
      '2': '疏远冷淡',
      '4': '中性',
      '6': '友好',
      '8': '明显好感',
      '10': '深度喜欢',
    },
  },
  关系风险等级: {
    type: 'choice',
    instructions: '基于逐轮判断结果，评估这段关系的整体风险等级。',
    criteria: {
      健康: '整体积极，无明显风险',
      需观察: '存在轻微风险信号，需要关注',
      需警惕: '风险信号频繁出现，建议认真对待',
      高风险: '存在明显不健康模式，建议寻求支持',
    },
  },
  关系阶段判断: {
    type: 'choice',
    instructions: '基于对话内容，判断当前关系处于哪个阶段。',
    criteria: {
      初识: '刚认识，还在互相了解',
      升温: '关系正在变好，互动频率和深度增加',
      稳定: '关系进入平稳期',
      冷淡: '互动减少，热度下降',
      疏远: '明显在拉开距离',
    },
  },
};

export const ROUND_SCORE_KEY = '好感度';
export const ROUND_ENGAGEMENT_KEY = '投入度';
export const ROUND_RISK_KEY = '风险信号';

export const SUMMARY_TEMPERATURE_KEY = '整体关系温度';
export const SUMMARY_RISK_KEY = '关系风险等级';
export const SUMMARY_STAGE_KEY = '关系阶段判断';

export const ENGAGEMENT_LABELS = Object.keys(ROUND_QUESTIONS.投入度.criteria ?? {});
export const RISK_LABELS = Object.keys(ROUND_QUESTIONS.风险信号.criteria ?? {});
export const RISK_LEVEL_LABELS = Object.keys(SUMMARY_QUESTIONS.关系风险等级.criteria ?? {});
export const STAGE_LABELS = Object.keys(SUMMARY_QUESTIONS.关系阶段判断.criteria ?? {});

/**
 * 投入度 → 0-10 分（雷达图维度）。
 * 「无明显信号」以外的风险按严重程度折算风险指数。
 */
export const ENGAGEMENT_WEIGHTS: Record<string, number> = {
  主动推进: 10,
  配合回应: 6.5,
  被动敷衍: 2.5,
  回避冷淡: 0,
};

export const RISK_WEIGHTS: Record<string, number> = {
  无明显信号: 0,
  冷暴力倾向: 8,
  情感操控倾向: 10,
  间歇性强化: 8,
  暧昧不承诺: 5.5,
};

/** 分数 → 中文档位标签。 */
export function scoreBand(score: number, legend: Record<string, string>): string {
  const keys = Object.keys(legend)
    .map(Number)
    .sort((a, b) => a - b);
  if (!keys.length) return '';
  let best = keys[0];
  for (const k of keys) if (score >= k) best = k;
  return legend[String(best)] ?? '';
}
