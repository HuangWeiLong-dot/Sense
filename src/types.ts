/**
 * Sense 领域模型。
 *
 * 隐私边界：`Bubble.raw` 只在当前页面内存中存在，永远不会被写入 localStorage，
 * 也永远不会被发送给任何 API。发送给 JEV / LLM 的只有 `Bubble.clean`（脱敏后文本）。
 */

export type Speaker = 'me' | 'other';

export type BubbleKind = 'text' | 'media' | 'system';

/** 一条消息气泡。 */
export interface Bubble {
  id: string;
  speaker: Speaker;
  /** 原始文本（仅内存） */
  raw: string;
  /** 脱敏后文本（可离开设备） */
  clean: string;
  /** 从行首解析出的时间戳（会被移除，不参与判断） */
  time?: string;
  kind: BubbleKind;
  /** 标注来源：解析标签 / 启发式推断 / 用户手动修改 */
  source: 'label' | 'heuristic' | 'manual';
}

/** 一轮 = 我方连续消息 + 对方一条回复。 */
export interface Round {
  index: number;
  mine: Bubble[];
  theirs: Bubble[];
  /** 待判断文本，形如「我：…\n对方：…」 */
  input: string;
  /** 对方未回复（不参与判断，仅在 UI 提示） */
  awaitingReply?: boolean;
}

/* ------------------------------------------------------------------ */
/* JEV questions                                                       */
/* ------------------------------------------------------------------ */

export type QuestionType = 'score' | 'choice';

export interface Question {
  type: QuestionType;
  instructions: string;
  legend?: Record<string, string>;
  criteria?: Record<string, string>;
}

export type Questions = Record<string, Question>;

/* ------------------------------------------------------------------ */
/* 判断结果                                                             */
/* ------------------------------------------------------------------ */

export interface RoundJudgement {
  round: number;
  /** 好感度 0-10 */
  score: number;
  /** 投入度（criteria key） */
  engagement: string;
  /** 风险信号（criteria key） */
  risk: string;
  raw: Record<string, unknown>;
  error?: string;
  /** 是否由降级/兜底值填充 */
  degraded?: boolean;
}

export type Distribution = Record<string, number>;

/** 4.2 汇总判断的输入结构（同时用于展示与发送） */
export interface Aggregate {
  总轮数: number;
  好感度趋势: number[];
  好感度均值: number;
  投入度分布: Distribution;
  风险信号分布: Distribution;
  /** 派生：投入度 0-10（用于雷达图） */
  投入度得分: number;
  /** 派生：风险指数 0-10，越高越危险（用于雷达图） */
  风险指数: number;
  /** 派生：判断失败的轮数 */
  失败轮数: number;
}

export interface SummaryJudgement {
  temperature: number;
  riskLevel: string;
  stage: string;
  raw: Record<string, unknown>;
}

export interface Advice {
  /** LLM 生成的建议正文 */
  text: string;
}

export interface AnonymizeOptions {
  /** 自己的称呼 / 别名 */
  selfNames: string[];
  /** 对方的昵称 / 备注名 */
  otherNames: string[];
  removeTimestamps: boolean;
  maskPlaces: boolean;
  maskOrgs: boolean;
}

export interface AnalysisMeta {
  judgeProvider: string;
  judgeModel: string;
  llmProvider: string;
  llmModel: string;
  anonymize: AnonymizeOptions;
  background?: string;
}

export interface AnalysisResult {
  id: string;
  createdAt: number;
  title: string;
  rounds: Round[];
  judgements: RoundJudgement[];
  aggregate: Aggregate;
  summary: SummaryJudgement;
  /** 建议按需生成（结果页点按钮），未生成时为 null */
  advice: Advice | null;
  /** 送给 LLM 的脱敏摘要（同时展示给用户，保证可审计） */
  digest: string;
  meta: AnalysisMeta;
}

/* ------------------------------------------------------------------ */
/* 设置                                                                 */
/* ------------------------------------------------------------------ */

export type JudgeProvider = 'typesafe' | 'openai';
export type LlmProvider = 'deepseek' | 'openai' | 'ollama' | 'custom';

export interface JudgeConfig {
  provider: JudgeProvider;
  baseUrl: string;
  /** TypeSafe 专用：question 判断路径 */
  path: string;
  model: string;
  /** 并行请求数 */
  concurrency: number;
}

export interface LlmConfig {
  provider: LlmProvider;
  baseUrl: string;
  model: string;
  temperature: number;
}

export interface ProxyConfig {
  /** 让请求走本机代理，绕开浏览器的 CORS 限制 */
  enabled: boolean;
  /** 代理地址 */
  url: string;
}

export interface Settings {
  judge: JudgeConfig;
  llm: LlmConfig;
  proxy: ProxyConfig;
  anonymize: AnonymizeOptions;
  /** 是否把 API Key 持久化到 localStorage */
  rememberKeys: boolean;
  /** 单次分析最多判断多少轮（成本保护） */
  maxRounds: number;
}

export interface Secrets {
  judgeApiKey: string;
  llmApiKey: string;
}
