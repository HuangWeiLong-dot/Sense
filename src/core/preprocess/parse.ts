import type { AnonymizeOptions, Bubble, BubbleKind, Round, Speaker } from '../../types';
import { uid } from '../../lib/utils';
import { createAnonymizer, mergeNames } from './anonymize';
import { convertChatFile } from '../import/formats';

/** 视为「我」的默认称呼。 */
export const SELF_ALIASES = ['我', '自己', '本人', 'me', 'Me', 'ME', 'myself', 'I'];

const LABEL_RE = /^([^:：]{1,24})[:：]\s*([\s\S]*)$/;

const TIME_ONLY_RES: RegExp[] = [
  /^\[?\s*\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?(\s+\d{1,2}[:：]\d{2}([:：]\d{2})?)?\s*\]?$/,
  /^\[?\s*(?:上午|下午|中午|晚上|凌晨|早上|傍晚)?\s*\d{1,2}[:：]\d{2}(?:[:：]\d{2})?\s*\]?$/,
  /^\[?\s*(?:昨天|今天|前天|明天)\s*(?:\d{1,2}[:：]\d{2})?\s*\]?$/,
  /^\[?\s*\d{1,2}[-/月]\d{1,2}日\s*\]?$/,
];

const MEDIA_RE =
  /^(?:<img[^>]*>|\[(?:图片|表情|动画表情|视频|语音|文件|链接|位置|名片|转账|红包|聊天记录|Photo|Sticker|Image|Video|Voice|File|Link)\])$/i;

const SYSTEM_HINTS = [
  '撤回了一条消息',
  '拍了拍',
  '加入了群聊',
  '以上是打招呼的内容',
  '你已添加了',
  '开启了朋友验证',
  '消息已发出，但被对方拒收了',
  '对方正在输入',
  '领取了你的红包',
  '邀请你加入了群聊',
];

export interface ParsedChat {
  bubbles: Bubble[];
  /** 解析出的发言人标签（按首次出现顺序） */
  detectedLabels: string[];
  /** 建议加入脱敏名单的对方昵称 */
  detectedOtherNames: string[];
  warnings: string[];
  stats: { bubbles: number; system: number; media: number; timestamps: number };
}

export interface BubbleDraft {
  label: string;
  text: string;
  time?: string;
}

/* ------------------------------------------------------------------ */
/* 分词                                                                */
/* ------------------------------------------------------------------ */

type Token =
  | { type: 'label'; label: string; text: string }
  | { type: 'time'; time: string }
  | { type: 'text'; text: string }
  | { type: 'blank' };

function stripBrackets(s: string): string {
  return s.replace(/^\[|\]$/g, '').trim();
}

function isTimeOnly(line: string): boolean {
  return TIME_ONLY_RES.some((re) => re.test(line));
}

function isTimeLikeLabel(label: string): boolean {
  const t = stripBrackets(label).trim();
  if (!t) return true;
  return /^[\d\s:：./年月日-]+$/.test(t);
}

function tokenize(lines: string[]): Token[] {
  const tokens: Token[] = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/[\u200b\ufeff]/g, '').trim();
    if (!line) {
      tokens.push({ type: 'blank' });
      continue;
    }
    if (isTimeOnly(line)) {
      tokens.push({ type: 'time', time: stripBrackets(line) });
      continue;
    }
    const m = LABEL_RE.exec(line);
    if (m && !isTimeLikeLabel(m[1])) {
      tokens.push({ type: 'label', label: stripBrackets(m[1]), text: m[2].trim() });
      continue;
    }
    tokens.push({ type: 'text', text: line });
  }
  return tokens;
}

/** 把 token 流合并成「同一发言人连续消息为一条气泡」。 */
function groupBubbles(tokens: Token[]): BubbleDraft[] {
  const out: BubbleDraft[] = [];
  // 用对象持有可变状态：闭包内的赋值不会被 TS 的控制流分析跟踪
  const state: { cur: BubbleDraft | null; label: string } = { cur: null, label: '' };

  const startNew = (label: string, text: string) => {
    state.cur = { label, text };
    state.label = label;
    out.push(state.cur);
  };

  const append = (text: string) => {
    // 系统消息 / 媒体消息不与正文混在一条气泡里，否则会互相污染
    if (state.cur && detectKind(state.cur.text) !== detectKind(text)) state.cur = null;
    if (!state.cur) startNew(state.label, text);
    else state.cur.text = state.cur.text ? `${state.cur.text}\n${text}` : text;
  };

  for (const t of tokens) {
    if (t.type === 'label') {
      if (state.cur && state.cur.label === t.label) {
        state.label = t.label;
        if (t.text) append(t.text);
      } else {
        startNew(t.label, t.text);
      }
      continue;
    }
    if (t.type === 'time') {
      if (state.cur) state.cur.time = t.time;
      continue;
    }
    if (t.type === 'text') {
      append(t.text);
      continue;
    }
    // blank：同一发言人的连续多条消息合并为一轮输入，这里直接忽略
  }
  return out.filter((b) => b.text.trim().length > 0 || Boolean(b.time));
}

/** 无标签时：按空行分段交替；只有一段时按行交替。 */
function unlabeledDrafts(text: string): BubbleDraft[] {
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const drafts: BubbleDraft[] = [];
  const push = (label: string, content: string) => {
    const last = drafts[drafts.length - 1];
    if (last && last.label === label) last.text = `${last.text}\n${content}`;
    else drafts.push({ label, text: content });
  };

  if (blocks.length > 1) {
    blocks.forEach((block, i) => push(i % 2 === 0 ? '我' : '对方', block));
    return drafts;
  }

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  lines.forEach((line, i) => push(i % 2 === 0 ? '我' : '对方', line));
  return drafts;
}

/* ------------------------------------------------------------------ */
/* 发言人标注                                                          */
/* ------------------------------------------------------------------ */

function normalizeLabel(label: string): string {
  return label.trim();
}

function resolveSpeakerMap(
  drafts: BubbleDraft[],
  selfNames: string[],
  suppressSingleLabelWarning = false,
): { map: Map<string, Speaker>; labels: string[]; warnings: string[] } {
  const labels: string[] = [];
  for (const d of drafts) {
    const l = normalizeLabel(d.label);
    if (l && !labels.includes(l)) labels.push(l);
  }

  const map = new Map<string, Speaker>();
  const selfSet = new Set([...SELF_ALIASES, ...selfNames].map((s) => s.trim().toLowerCase()));
  const warnings: string[] = [];

  for (const label of labels) {
    if (selfSet.has(label.toLowerCase())) map.set(label, 'me');
  }

  let rest = labels.filter((l) => !map.has(l));
  if (rest.length === 1) {
    map.set(rest[0], 'other');
    if (!suppressSingleLabelWarning) {
      warnings.push(`对话中只有一位可识别的发言人「${rest[0]}」，已标注为「对方」。`);
    }
  } else if (rest.length >= 2) {
    map.set(rest[0], 'me');
    map.set(rest[1], 'other');
    for (const extra of rest.slice(2)) map.set(extra, 'other');
    warnings.push(
      `已按出现顺序假设「${rest[0]}」= 我、「${rest[1]}」= 对方（可能是群聊或导出顺序不同），如不正确请点「交换双方」或逐条修改。`,
    );
  }

  return { map, labels, warnings };
}

/* ------------------------------------------------------------------ */
/* 气泡与轮次                                                          */
/* ------------------------------------------------------------------ */

function detectKind(text: string): BubbleKind {
  if (MEDIA_RE.test(text.trim())) return 'media';
  if (SYSTEM_HINTS.some((h) => text.includes(h))) return 'system';
  return 'text';
}

function toBubbles(
  drafts: BubbleDraft[],
  map: Map<string, Speaker>,
  anonymize: AnonymizeOptions,
): { bubbles: Bubble[]; stats: ParsedChat['stats'] } {
  const anon = createAnonymizer(anonymize);
  const stats = { bubbles: 0, system: 0, media: 0, timestamps: 0 };

  const bubbles = drafts
    .filter((d) => d.text.trim())
    .map<Bubble>((d) => {
      const text = d.text.trim();
      const kind = detectKind(text);
      const speaker: Speaker = map.get(normalizeLabel(d.label)) ?? 'other';
      if (d.time) stats.timestamps += 1;
      stats.bubbles += 1;
      if (kind === 'system') stats.system += 1;
      if (kind === 'media') stats.media += 1;
      return {
        id: uid('b'),
        speaker,
        raw: text,
        clean:
          kind === 'media'
            ? '[媒体消息]'
            : kind === 'system'
              ? '[系统消息]'
              : anon.apply(text),
        time: d.time,
        kind,
        source: d.label ? 'label' : 'heuristic',
      };
    });

  return { bubbles, stats };
}

/** 按当前气泡（含 speaker 修正）重新计算轮次。 */
export function buildRounds(bubbles: Bubble[]): Round[] {
  const usable = bubbles.filter((b) => b.kind !== 'system');
  const rounds: Round[] = [];

  let mine: Bubble[] = [];
  let theirs: Bubble[] = [];
  let pendingTheirs: Bubble[] = [];

  const closeRound = (m: Bubble[], t: Bubble[]) => {
    if (!m.length && !t.length) return;
    const round: Round = {
      index: rounds.length + 1,
      mine: m,
      theirs: t,
      input: buildRoundInput({ mine: m, theirs: t }),
    };
    if (m.length && !t.length) round.awaitingReply = true;
    rounds.push(round);
  };

  for (const b of usable) {
    if (b.speaker === 'me') {
      // 我方重新开口 → 上一轮结束
      if (mine.length && theirs.length) {
        closeRound(mine, theirs);
        mine = [];
        theirs = [];
      }
      if (!mine.length && pendingTheirs.length) {
        closeRound([], pendingTheirs);
        pendingTheirs = [];
      }
      mine.push(b);
    } else if (mine.length) {
      theirs.push(b);
    } else {
      // 对方先开口：挂起，等我方发言后归入同一轮
      pendingTheirs.push(b);
    }
  }

  closeRound(mine, theirs);
  if (pendingTheirs.length) closeRound([], pendingTheirs);

  return rounds.map((r, i) => ({ ...r, index: i + 1 }));
}

/** 「我：…\n对方：…」——逐轮 JEV 的输入。 */
export function buildRoundInput(round: Pick<Round, 'mine' | 'theirs'>): string {
  const parts: string[] = [];
  if (round.mine.length) {
    parts.push(`我：${round.mine.map((b) => b.clean || b.raw).join('\n')}`);
  }
  if (round.theirs.length) {
    parts.push(`对方：${round.theirs.map((b) => b.clean || b.raw).join('\n')}`);
  }
  return parts.join('\n');
}

/** 轮次中用于展示的对方文本。 */
export function theirsText(round: Round): string {
  return round.theirs.map((b) => b.clean || b.raw).join('\n');
}

export function mineText(round: Round): string {
  return round.mine.map((b) => b.clean || b.raw).join('\n');
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

export function parseChat(raw: string, options: AnonymizeOptions): ParsedChat {
  const text = raw.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const tokens = tokenize(lines);
  const hasLabels = tokens.some((t) => t.type === 'label');

  const drafts = hasLabels ? groupBubbles(tokens) : unlabeledDrafts(text);
  const warnings: string[] = [];

  if (!hasLabels) {
    warnings.push('未检测到「昵称：内容」格式的发言人标签，已按空行/行交替推测双方，请核对气泡归属。');
  }

  const { map, labels, warnings: labelWarnings } = resolveSpeakerMap(
    drafts,
    options.selfNames,
    !hasLabels,
  );
  warnings.push(...labelWarnings);

  const detectedOtherNames = mergeNames(
    options.otherNames,
    labels.filter((l) => map.get(normalizeLabel(l)) === 'other'),
  );

  // 把检测到的昵称并入脱敏名单，保证「昵称 → 对方」在文本里也生效
  const effective: AnonymizeOptions = {
    ...options,
    otherNames: detectedOtherNames,
  };

  const { bubbles, stats } = toBubbles(drafts, map, effective);

  if (stats.timestamps > 0 && !options.removeTimestamps) {
    warnings.push(`检测到 ${stats.timestamps} 处时间戳；如需移除请打开「移除时间戳」。`);
  }
  if (stats.system > 0) {
    warnings.push(`已自动排除 ${stats.system} 条系统消息（撤回/拍一拍等），不参与判断。`);
  }
  if (!bubbles.length) {
    warnings.push('没有解析出任何消息，请检查输入内容。');
  }

  return { bubbles, detectedLabels: labels, detectedOtherNames, warnings, stats };
}

/** 修改脱敏设置后，基于 raw 重新生成 clean。 */
export function applyAnonymizerToBubbles(bubbles: Bubble[], options: AnonymizeOptions): Bubble[] {
  const anon = createAnonymizer(options);
  return bubbles.map((b) => {
    if (b.kind === 'media') return { ...b, clean: '[媒体消息]' };
    if (b.kind === 'system') return { ...b, clean: '[系统消息]' };
    return { ...b, clean: anon.apply(b.raw) };
  });
}

/** 交换双方标注。 */
export function swapSpeakers(bubbles: Bubble[]): Bubble[] {
  return bubbles.map((b) => ({
    ...b,
    speaker: b.speaker === 'me' ? 'other' : 'me',
    source: 'manual',
  }));
}

/* ------------------------------------------------------------------ */
/* 文件导入                                                            */
/* ------------------------------------------------------------------ */

export { convertChatFile };

/**
 * 把导入文件的内容统一转成「昵称：内容」文本。
 * 具体格式识别（带时间戳的文本 / JSON / CSV）见 core/import/formats.ts。
 */
export function parseFileContent(filename: string, content: string): string {
  return convertChatFile(filename, content).text;
}

