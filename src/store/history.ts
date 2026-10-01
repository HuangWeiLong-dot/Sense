import type { AnalysisResult, Bubble } from '../types';
import { STORAGE_KEYS } from './settings';

export interface HistoryEntry {
  id: string;
  createdAt: number;
  title: string;
  temperature: number;
  riskLevel: string;
  stage: string;
  rounds: number;
  judged: number;
  judgeProvider: string;
}

interface HistoryFile {
  version: 1;
  entries: Array<{ entry: HistoryEntry; result: AnalysisResult }>;
}

const MAX_ENTRIES = 50;

const memory = new Map<string, string>();

function readRaw(): string | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(STORAGE_KEYS.history);
  } catch {
    /* ignore */
  }
  return memory.get(STORAGE_KEYS.history) ?? null;
}

function writeRaw(value: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.history, value);
      return;
    }
  } catch {
    /* ignore */
  }
  memory.set(STORAGE_KEYS.history, value);
}

export function clearHistory(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEYS.history);
  } catch {
    /* ignore */
  }
  memory.delete(STORAGE_KEYS.history);
}

/**
 * 入库前剥离原始聊天文本：历史记录里只保留脱敏后的 clean 文本。
 * `raw` 永远不落盘，这是 Sense 的核心隐私承诺。
 */
export function sanitizeForStorage(result: AnalysisResult): AnalysisResult {
  const strip = (b: Bubble): Bubble => ({ ...b, raw: '' });
  return {
    ...result,
    rounds: result.rounds.map((r) => ({
      ...r,
      mine: r.mine.map(strip),
      theirs: r.theirs.map(strip),
    })),
  };
}

function readFile(): HistoryFile {
  const raw = readRaw();
  if (!raw) return { version: 1, entries: [] };
  try {
    const parsed = JSON.parse(raw) as HistoryFile;
    if (!parsed || !Array.isArray(parsed.entries)) return { version: 1, entries: [] };
    return { version: 1, entries: parsed.entries };
  } catch {
    return { version: 1, entries: [] };
  }
}

function writeFile(file: HistoryFile): void {
  writeRaw(JSON.stringify(file));
}

function toEntry(result: AnalysisResult): HistoryEntry {
  return {
    id: result.id,
    createdAt: result.createdAt,
    title: result.title,
    temperature: result.summary.temperature,
    riskLevel: result.summary.riskLevel,
    stage: result.summary.stage,
    rounds: result.rounds.length,
    judged: result.judgements.length,
    judgeProvider: result.meta.judgeProvider,
  };
}

export function listHistory(): HistoryEntry[] {
  return readFile()
    .entries.map((e) => e.entry)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function getResult(id: string): AnalysisResult | null {
  const found = readFile().entries.find((e) => e.entry.id === id);
  return found ? found.result : null;
}

export function saveResult(result: AnalysisResult): void {
  const file = readFile();
  const sanitized = sanitizeForStorage(result);
  const entries = [
    { entry: toEntry(sanitized), result: sanitized },
    ...file.entries.filter((e) => e.entry.id !== sanitized.id),
  ].slice(0, MAX_ENTRIES);
  writeFile({ version: 1, entries });
}

export function removeResult(id: string): void {
  const file = readFile();
  writeFile({ version: 1, entries: file.entries.filter((e) => e.entry.id !== id) });
}

/** 导出为 JSON 文件内容（默认已脱敏，用户主动导出才会离开设备）。 */
export function exportResultJson(result: AnalysisResult): string {
  return JSON.stringify(
    {
      app: 'Sense',
      version: 1,
      exportedAt: new Date().toISOString(),
      privacy: '导出内容仅包含脱敏后的文本与判断结果，不含原始聊天记录与 API Key。',
      result: sanitizeForStorage(result),
    },
    null,
    2,
  );
}
