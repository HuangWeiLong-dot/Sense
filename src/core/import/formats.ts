/**
 * 聊天记录导出文件格式适配（P2）。
 *
 * 目标：把各种导出格式统一成「昵称：内容」文本，交给 parseChat 做气泡分割与脱敏。
 * 方向明确时（如 isSend 标记）直接标注为「我 / 对方」，否则保留真实昵称，
 * 由 parseChat 的发言人推断 + 界面上的「交换双方」兜底。
 */

export type ChatFormat =
  | 'labeled'
  | 'timestamped-txt'
  | 'json-directional'
  | 'json-generic'
  | 'csv'
  | 'plain';

export interface ConvertResult {
  format: ChatFormat;
  text: string;
  /** 给用户看的识别说明 */
  note: string;
}

/* ------------------------------------------------------------------ */
/* 时间与头行识别                                                       */
/* ------------------------------------------------------------------ */

const TIME_FULL = String.raw`\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?`;
const TIME_LOOSE = String.raw`\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?`;

const HEADER_RES: Array<{ re: RegExp; senderGroup: number; timeGroup: number }> = [
  // 2023-01-01 12:00:00 昵称
  { re: new RegExp(`^(${TIME_FULL})\\s+(.{1,32})$`), senderGroup: 2, timeGroup: 1 },
  // 昵称<邮箱> 2023-01-01 12:00:00
  // 注意：带后缀的模式必须排在通用「昵称 时间」之前，否则邮箱会被并进昵称
  { re: new RegExp(`^(.{1,32}?)\\s*<[^>]{1,64}>\\s+(${TIME_FULL})$`), senderGroup: 1, timeGroup: 2 },
  // 昵称(号码) 2023-01-01 12:00:00
  { re: new RegExp(`^(.{1,32}?)\\s*\\(\\d{4,12}\\)\\s+(${TIME_FULL})$`), senderGroup: 1, timeGroup: 2 },
  // 昵称 2023-01-01 12:00:00
  { re: new RegExp(`^(.{1,32})\\s+(${TIME_FULL})$`), senderGroup: 1, timeGroup: 2 },
];

const TIME_ONLY_RE = new RegExp(
  `^\\[?\\s*(?:${TIME_FULL}|${TIME_LOOSE}|\\d{4}[-/年]\\d{1,2}[-/月]\\d{1,2}日?(?:\\s+\\d{1,2}:\\d{2}(?::\\d{2})?)?)\\s*\\]?$`,
);

function isTimeOnly(line: string): boolean {
  return TIME_ONLY_RE.test(line.trim());
}

function matchHeader(line: string): { sender: string; time: string } | null {
  const t = line.trim();
  for (const { re, senderGroup, timeGroup } of HEADER_RES) {
    const m = re.exec(t);
    if (!m) continue;
    const sender = m[senderGroup].trim();
    if (!sender || sender.includes(':') || sender.includes('：')) continue;
    return { sender, time: m[timeGroup].trim() };
  }
  return null;
}

/** 单独成行的「昵称」：不含冒号、不是时间、长度合理、不像一句话。 */
function isBareName(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 32) return false;
  if (t.includes(':') || t.includes('：')) return false;
  if (isTimeOnly(t)) return false;
  if (/[。！？!?~～]$/.test(t)) return false;
  if (/^\[.+\]$/.test(t)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* 块解析：把「头行 + 若干正文行」拆成一条条消息                          */
/* ------------------------------------------------------------------ */

interface RawMessage {
  sender: string;
  time?: string;
  lines: string[];
}

/** 两行式（昵称 独占一行 + 时间 独占一行）在文件中出现 ≥2 次才认定。 */
function isTwoLineFormat(lines: string[]): boolean {
  let hits = 0;
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (isBareName(lines[i]) && isTimeOnly(lines[i + 1])) hits += 1;
  }
  return hits >= 2;
}

function parseBlocks(lines: string[], twoLine: boolean): RawMessage[] {
  const messages: RawMessage[] = [];
  // 用对象持有可变状态：闭包内的赋值不会被 TS 的控制流分析跟踪
  const state: { current: RawMessage | null } = { current: null };

  const push = (sender: string, time?: string) => {
    state.current = { sender, time, lines: [] };
    messages.push(state.current);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/[\u200b\ufeff]/g, '').trim();
    if (!line) {
      if (state.current && state.current.lines.length) state.current.lines.push('');
      continue;
    }

    const header = matchHeader(line);
    if (header) {
      push(header.sender, header.time);
      continue;
    }

    // 两行式：只有「下一行是时间」时，这一行才当作昵称，
    // 否则短消息会被误判成昵称
    if (twoLine && isBareName(line) && i + 1 < lines.length && isTimeOnly(lines[i + 1])) {
      push(line, lines[i + 1].trim());
      i += 1;
      continue;
    }

    if (!state.current) push('');
    state.current!.lines.push(line);
  }

  return messages
    .map((m) => ({ ...m, lines: trimBlankEdges(m.lines) }))
    .filter((m) => m.sender || m.lines.join('').trim());
}

function trimBlankEdges(lines: string[]): string[] {
  const out = [...lines];
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

function toLabeledText(messages: RawMessage[], directional = false): string {
  const lines: string[] = [];
  for (const m of messages) {
    const body = m.lines.join('\n').trim();
    if (!body) continue;
    const label = directional ? m.sender : m.sender || '未知';
    lines.push(`${label}：${body.replace(/\n/g, ' ')}`);
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* JSON / CSV                                                          */
/* ------------------------------------------------------------------ */

const SENDER_KEYS = [
  'sender', 'from', 'name', 'nickname', 'speaker', 'author', 'talker', 'senderName',
  'strTalker', '发送者', '发送方', '昵称', '发言人',
];
const TEXT_KEYS = [
  'text', 'content', 'message', 'msg', 'body', 'strContent', '发送内容', '内容', '消息', '正文',
];
const SEND_KEYS = ['isSend', 'is_send', 'isSelf', 'isself', 'self', 'direction'];

function pick(obj: Record<string, unknown>, keys: string[]): { key: string; value: unknown } | null {
  for (const k of keys) {
    if (k in obj && obj[k] !== null && obj[k] !== undefined && obj[k] !== '') {
      return { key: k, value: obj[k] };
    }
  }
  return null;
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function isSendTruthy(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'self', 'out', 'send'].includes(v)) return true;
    if (['0', 'false', 'no', 'other', 'in', 'recv'].includes(v)) return false;
  }
  return null;
}

interface RecordParse {
  records: Array<{ sender: string; text: string }>;
  directional: boolean;
}

function parseRecords(list: unknown[]): RecordParse | null {
  const records: Array<{ sender: string; text: string }> = [];
  let directional = false;
  let sawSendKey = false;

  for (const item of list) {
    if (typeof item === 'string') {
      const m = /^([^:：]{1,32})[:：]\s*([\s\S]*)$/.exec(item.trim());
      if (!m) return null;
      records.push({ sender: m[1].trim(), text: m[2].trim() });
      continue;
    }
    if (!item || typeof item !== 'object') return null;
    const o = item as Record<string, unknown>;

    const text = pick(o, TEXT_KEYS);
    if (!text) return null;

    const send = pick(o, SEND_KEYS);
    if (send) {
      sawSendKey = true;
      const me = isSendTruthy(send.value);
      if (me !== null) {
        directional = true;
        records.push({ sender: me ? '我' : '对方', text: asText(text.value) });
        continue;
      }
    }

    const sender = pick(o, SENDER_KEYS);
    if (!sender) {
      // 只有内容、没有发言人：当作无标签正文，交给 parseChat 逐行推断
      records.push({ sender: '', text: asText(text.value) });
      continue;
    }
    records.push({ sender: asText(sender.value).trim() || '未知', text: asText(text.value) });
  }

  if (!records.length) return null;
  return { records, directional: directional && sawSendKey && records.every((r) => r.sender) };
}

function parseCsv(content: string): string | null {
  const delim = content.includes('\t') ? '\t' : content.includes(',') ? ',' : null;
  if (!delim) return null;

  const rows = content
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => l.split(delim));
  if (rows.length < 2) return null;

  const header = rows[0].map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
  // 表头统一小写比较，键名表里有 camelCase（isSend / strContent…），也要一起小写
  const lowerSet = (keys: string[]) => new Set(keys.map((k) => k.toLowerCase()));
  const senderKeys = lowerSet(SENDER_KEYS);
  const textKeys = lowerSet(TEXT_KEYS);
  const sendKeys = lowerSet(SEND_KEYS);

  const senderIdx = header.findIndex((h) => senderKeys.has(h));
  const textIdx = header.findIndex((h) => textKeys.has(h));
  const sendIdx = header.findIndex((h) => sendKeys.has(h));
  // 表头必须真的像表格，否则把普通文本按逗号切开会产生垃圾
  if (senderIdx < 0 && textIdx < 0 && sendIdx < 0) return null;
  const s = senderIdx >= 0 ? senderIdx : 0;
  const t = textIdx >= 0 ? textIdx : 1;
  if (s === t) return null;

  const clean = (v: string | undefined) => (v ?? '').trim().replace(/^"|"$/g, '');
  const lines: string[] = [];
  for (const row of rows.slice(1)) {
    const body = clean(row[t]);
    if (!body) continue;
    if (sendIdx >= 0) {
      const me = isSendTruthy(clean(row[sendIdx]));
      if (me !== null) {
        lines.push(`${me ? '我' : '对方'}：${body}`);
        continue;
      }
    }
    lines.push(`${clean(row[s]) || '未知'}：${body}`);
  }
  return lines.length ? lines.join('\n') : null;
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

function looksLikeLabeled(lines: string[]): boolean {
  let hits = 0;
  for (const l of lines.slice(0, 40)) {
    if (/^\s*[^:：\n]{1,24}[:：]\s*\S/.test(l)) hits += 1;
  }
  return hits >= Math.min(2, lines.filter((l) => l.trim()).length);
}

/** 把任意导出文件内容转成「昵称：内容」文本。 */
export function convertChatFile(filename: string, content: string): ConvertResult {
  const ext = (filename.toLowerCase().split('.').pop() ?? '').trim();
  const trimmed = content.replace(/\r\n?/g, '\n').trim();

  /* ---------- JSON ---------- */
  if (ext === 'json' || /^[[{]/.test(trimmed)) {
    try {
      const data = JSON.parse(trimmed) as unknown;
      const list = Array.isArray(data)
        ? data
        : data && typeof data === 'object'
          ? ((data as Record<string, unknown>).messages ??
            (data as Record<string, unknown>).data ??
            (data as Record<string, unknown>).chat ??
            (data as Record<string, unknown>).list)
          : null;
      if (Array.isArray(list)) {
        const parsed = parseRecords(list);
        if (parsed) {
          const text = parsed.records
            .map((r) => `${r.sender || '未知'}：${r.text.replace(/\n/g, ' ')}`)
            .join('\n');
          return {
            format: parsed.directional ? 'json-directional' : 'json-generic',
            text,
            note: parsed.directional
              ? `已按导出标记（isSend 等）判定消息方向，共 ${parsed.records.length} 条。`
              : `按 sender / content 字段解析出 ${parsed.records.length} 条消息。`,
          };
        }
      }
    } catch {
      /* 落到文本解析 */
    }
  }

  /* ---------- CSV / TSV ---------- */
  if (ext === 'csv' || ext === 'tsv' || content.includes(',')) {
    const csv = parseCsv(content);
    if (csv) {
      return { format: 'csv', text: csv, note: '按表头识别出 sender / text 列。' };
    }
  }

  /* ---------- 文本类 ---------- */
  const lines = trimmed.split('\n');
  if (!trimmed) return { format: 'plain', text: '', note: '文件内容为空。' };

  const headerHits = lines.filter((l) => matchHeader(l)).length;
  const twoLine = isTwoLineFormat(lines);

  if (headerHits >= 1 || twoLine) {
    const messages = parseBlocks(lines, twoLine);
    if (messages.length) {
      return {
        format: 'timestamped-txt',
        text: toLabeledText(messages),
        note: `识别为带时间戳的消息记录${twoLine ? '（昵称与时间分行）' : ''}，共 ${messages.length} 条。发言人按昵称保留，若方向反了请点「交换双方」。`,
      };
    }
  }

  if (looksLikeLabeled(lines)) {
    return { format: 'labeled', text: trimmed, note: '已含「昵称：内容」标签，直接解析。' };
  }

  return {
    format: 'plain',
    text: trimmed,
    note: '未识别出特定导出格式，按纯文本逐行推断发言人。',
  };
}
