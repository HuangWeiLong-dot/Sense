import type { Questions } from '../types';

export interface JudgeRequest {
  /** JEV questions，结构与 spec 一致 */
  questions: Questions;
  /** 待判断文本（已脱敏） */
  input: string;
  /** 便于日志与错误定位，例如「第 7 轮」 */
  label?: string;
  signal?: AbortSignal;
}

export interface JudgeAdapter {
  id: string;
  label: string;
  /** 返回已归一化的答案：{ 问题名: 分数 | 选项文字 } */
  judge(req: JudgeRequest): Promise<Record<string, unknown>>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatAdapter {
  id: string;
  label: string;
  chat(req: ChatRequest): Promise<string>;
}

export class AdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterError';
  }
}

export function joinUrl(base: string, path: string): string {
  const b = (base ?? '').trim().replace(/\/+$/, '');
  const p = (path ?? '').trim();
  if (!b) return p;
  if (!p) return b;
  return `${b}${p.startsWith('/') ? '' : '/'}${p}`;
}

export interface PostJsonOptions {
  url: string;
  apiKey?: string;
  body: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/** 桌面壳（Electron/Tauri）通过 preload 注入的受限通道。 */
interface DesktopBridge {
  request(options: {
    id: string;
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
    timeoutMs: number;
  }): Promise<{ status: number; statusText: string; text: string }>;
  abort(id: string): void;
}

function desktopBridge(): DesktopBridge | undefined {
  return (globalThis as { senseDesktop?: DesktopBridge }).senseDesktop;
}

interface RawResponse {
  status: number;
  statusText: string;
  text: string;
}

/**
 * 发一次请求。
 * 桌面壳里走主进程 —— Node 侧没有 CORS，所以不需要本机代理，也不用关掉 webSecurity。
 * 浏览器里退回普通 fetch（此时 CORS 由对方服务器的响应头决定）。
 */
async function sendRequest(request: {
  url: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
  timeoutMs: number;
}): Promise<RawResponse> {
  const bridge = desktopBridge();
  if (!bridge) {
    const res = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: request.signal,
    });
    return { status: res.status, statusText: res.statusText, text: await res.text() };
  }

  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const onAbort = () => bridge.abort(id);
  if (request.signal.aborted) throw new Error('Aborted: 请求已取消');
  request.signal.addEventListener('abort', onAbort, { once: true });

  try {
    return await bridge.request({
      id,
      url: request.url,
      method: 'POST',
      headers: request.headers,
      body: request.body,
      timeoutMs: request.timeoutMs,
    });
  } finally {
    request.signal.removeEventListener('abort', onAbort);
  }
}

/**
 * 浏览器在「请求被网络层拦下」时抛的 TypeError。
 * 最常见的原因是 CORS：第三方 API 通常不返回 Access-Control-Allow-Origin，
 * 浏览器会在发出请求前/后直接拦截，与 Key 是否正确无关。
 * 这里只匹配浏览器特有的措辞（Node 的 "fetch failed" 不算），避免误报。
 */
function isBrowserNetworkBlock(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  return /failed to fetch|networkerror when attempting to fetch|load failed/i.test(err.message);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** 统一的 JSON POST：带超时、外部取消、错误信息截断。 */
export async function postJson(options: PostJsonOptions): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('请求超时')), timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;

  try {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    };
    if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;

    const { status, statusText, text } = await sendRequest({
      url: options.url,
      headers,
      body: JSON.stringify(options.body),
      signal,
      timeoutMs,
    });

    if (status < 200 || status >= 300) {
      throw new AdapterError(`HTTP ${status} ${statusText} - ${text.slice(0, 240)}`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new AdapterError(`响应不是合法 JSON：${text.slice(0, 240)}`);
    }
  } catch (err) {
    if (err instanceof AdapterError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (/abort/i.test(msg)) throw new AdapterError('请求已取消或超时');
    if (isBrowserNetworkBlock(err)) {
      throw new AdapterError(
        `无法连接 ${hostOf(options.url)}：请求被浏览器拦下了（通常是 CORS —— 对方没有返回 Access-Control-Allow-Origin，和 Key 无关）。` +
          `在「设置 → 网络代理」打开本机代理（先运行 npm run proxy）即可绕开；也可以改用本地 Ollama，或使用桌面版。`,
      );
    }
    throw new AdapterError(`网络请求失败：${msg}`);
  } finally {
    clearTimeout(timer);
  }
}
