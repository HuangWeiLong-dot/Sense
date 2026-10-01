import type { AnonymizeOptions, JudgeProvider, LlmProvider, Secrets, Settings } from '../types';

export const STORAGE_KEYS = {
  settings: 'sense.settings.v1',
  secrets: 'sense.secrets.v1',
  history: 'sense.history.v1',
} as const;

export interface JudgePreset {
  label: string;
  baseUrl: string;
  path: string;
  model: string;
  needsKey: boolean;
  hint: string;
}

export const JUDGE_PRESETS: Record<JudgeProvider, JudgePreset> = {
  typesafe: {
    label: 'TypeSafe（Jev 原生接口）',
    baseUrl: 'https://api.typesafe.ai/v1',
    path: '/systemone',
    model: 'jev-latest',
    needsKey: true,
    hint: '官方接口：POST https://api.typesafe.ai/v1/systemone，body 为 { state, model, questions }。',
  },
  openai: {
    label: 'OpenAI 兼容（自建网关 / Ollama）',
    baseUrl: 'https://api.openai.com/v1',
    path: '',
    model: 'gpt-4o-mini',
    needsKey: true,
    hint: '用 chat/completions + JSON 输出替代 JEV。Base URL 需包含版本段，例如 http://localhost:11434/v1。',
  },
};

export interface LlmPreset {
  label: string;
  baseUrl: string;
  model: string;
  needsKey: boolean;
}

export const LLM_PRESETS: Record<LlmProvider, LlmPreset> = {
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    needsKey: true,
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    needsKey: true,
  },
  ollama: {
    label: '本地 Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    needsKey: false,
  },
  custom: {
    label: '自定义（OpenAI 兼容）',
    baseUrl: '',
    model: '',
    needsKey: false,
  },
};

export const DEFAULT_ANONYMIZE_OPTIONS: AnonymizeOptions = {
  selfNames: ['我'],
  otherNames: [],
  removeTimestamps: true,
  maskPlaces: false,
  maskOrgs: false,
};

export const DEFAULT_SETTINGS: Settings = {
  judge: {
    provider: 'typesafe',
    baseUrl: JUDGE_PRESETS.typesafe.baseUrl,
    path: JUDGE_PRESETS.typesafe.path,
    model: JUDGE_PRESETS.typesafe.model,
    concurrency: 3,
  },
  llm: {
    provider: 'deepseek',
    baseUrl: LLM_PRESETS.deepseek.baseUrl,
    model: LLM_PRESETS.deepseek.model,
    temperature: 0.6,
  },
  proxy: {
    enabled: false,
    url: 'http://127.0.0.1:8787',
  },
  anonymize: { ...DEFAULT_ANONYMIZE_OPTIONS },
  rememberKeys: true,
  maxRounds: 60,
};

const EMPTY_SECRETS: Secrets = { judgeApiKey: '', llmApiKey: '' };

/* ------------------------------------------------------------------ */
/* 安全存储：localStorage 不可用时退回内存                              */
/* ------------------------------------------------------------------ */

const memory = new Map<string, string>();

function readRaw(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
  } catch {
    /* 隐私模式 / SSR：退回内存 */
  }
  return memory.get(key) ?? null;
}

function writeRaw(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return;
    }
  } catch {
    /* ignore */
  }
  memory.set(key, value);
}

function removeRaw(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  memory.delete(key);
}

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mergeSettings(base: Settings, parsed: Partial<Settings>): Settings {
  const judge = { ...base.judge, ...(parsed.judge ?? {}) };
  const llm = { ...base.llm, ...(parsed.llm ?? {}) };
  const proxy = { ...base.proxy, ...(parsed.proxy ?? {}) };
  const anonymize = { ...base.anonymize, ...(parsed.anonymize ?? {}) };

  if (!(judge.provider in JUDGE_PRESETS)) judge.provider = base.judge.provider;
  if (!(llm.provider in LLM_PRESETS)) llm.provider = base.llm.provider;
  judge.concurrency = Math.min(8, Math.max(1, Number(judge.concurrency) || 3));
  return {
    judge,
    llm,
    proxy: {
      enabled: Boolean(proxy.enabled),
      url: typeof proxy.url === 'string' && proxy.url.trim() ? proxy.url.trim() : base.proxy.url,
    },
    anonymize: {
      selfNames: Array.isArray(anonymize.selfNames) ? anonymize.selfNames : base.anonymize.selfNames,
      otherNames: Array.isArray(anonymize.otherNames)
        ? anonymize.otherNames
        : base.anonymize.otherNames,
      removeTimestamps: Boolean(anonymize.removeTimestamps),
      maskPlaces: Boolean(anonymize.maskPlaces),
      maskOrgs: Boolean(anonymize.maskOrgs),
    },
    rememberKeys: parsed.rememberKeys ?? base.rememberKeys,
    maxRounds: Math.min(200, Math.max(1, Number(parsed.maxRounds) || base.maxRounds)),
  };
}

/** 持久化格式版本。改过默认值就 +1，并在 migrateSettings 里补上迁移。 */
const SETTINGS_VERSION = 2;

/** 历史遗留的占位/旧默认值，需要被迁移掉。 */
const LEGACY_TYPESAFE = {
  baseUrl: 'https://api.typesafe.example',
  path: '/v1/judge',
};

type PersistedSettings = Partial<Settings> & { version?: number };

/**
 * 迁移已持久化的设置。
 * 只替换「还是旧默认值 / 空值」的项 —— 用户自己填过的地址一律不动。
 * 初始版本没有 version 字段，统一按 v1 处理。
 */
export function migrateSettings(settings: Settings, fromVersion: number): Settings {
  if (fromVersion >= SETTINGS_VERSION) return settings;

  const judge = { ...settings.judge };
  if (!judge.baseUrl.trim() || judge.baseUrl === LEGACY_TYPESAFE.baseUrl) {
    judge.baseUrl = JUDGE_PRESETS.typesafe.baseUrl;
  }
  if (!judge.path.trim() || judge.path === LEGACY_TYPESAFE.path) {
    judge.path = JUDGE_PRESETS.typesafe.path;
  }
  // 空模型只在 TypeSafe 下补默认值；OpenAI 兼容允许留空
  if (!judge.model.trim() && judge.provider === 'typesafe') {
    judge.model = JUDGE_PRESETS.typesafe.model;
  }

  return { ...settings, judge };
}

export function loadSettings(): Settings {
  const raw = readRaw(STORAGE_KEYS.settings);
  if (!raw) return clone(DEFAULT_SETTINGS);
  try {
    const parsed = JSON.parse(raw) as PersistedSettings;
    const merged = mergeSettings(DEFAULT_SETTINGS, parsed);
    return migrateSettings(merged, typeof parsed.version === 'number' ? parsed.version : 1);
  } catch {
    return clone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings: Settings): void {
  writeRaw(STORAGE_KEYS.settings, JSON.stringify({ ...settings, version: SETTINGS_VERSION }));
}

export function loadSecrets(): Secrets {
  const raw = readRaw(STORAGE_KEYS.secrets);
  if (!raw) return { ...EMPTY_SECRETS };
  try {
    const parsed = JSON.parse(raw) as Partial<Secrets>;
    return {
      judgeApiKey: typeof parsed.judgeApiKey === 'string' ? parsed.judgeApiKey : '',
      llmApiKey: typeof parsed.llmApiKey === 'string' ? parsed.llmApiKey : '',
    };
  } catch {
    return { ...EMPTY_SECRETS };
  }
}

/** remember=false 时不落盘，只在内存中保留到本次会话结束。 */
export function saveSecrets(secrets: Secrets, remember: boolean): void {
  if (remember) writeRaw(STORAGE_KEYS.secrets, JSON.stringify(secrets));
  else removeRaw(STORAGE_KEYS.secrets);
}

export function clearSettings(): void {
  removeRaw(STORAGE_KEYS.settings);
}

/** 只用于展示：a9f3****c21 */
export function maskKey(key: string): string {
  const k = key.trim();
  if (!k) return '未填写';
  if (k.length <= 8) return `${k.slice(0, 2)}****`;
  return `${k.slice(0, 4)}****${k.slice(-4)}`;
}
