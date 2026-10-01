import { describe, expect, it } from 'vitest';
import { DEFAULT_ANONYMIZE } from './anonymize';
import { buildRounds, parseChat, parseFileContent, swapSpeakers } from './parse';

const opts = { ...DEFAULT_ANONYMIZE };

describe('气泡分割与轮次合并', () => {
  it('把「我连发多条 + 对方回一条」合并成一轮', () => {
    const chat = [
      '我：今天有空吗？想约你吃饭',
      '对方：这周有点忙诶',
      '',
      '我：那下周呢',
      '我：我可以订位',
      '对方：下周再说吧',
    ].join('\n');

    const parsed = parseChat(chat, opts);
    const rounds = buildRounds(parsed.bubbles);

    expect(parsed.detectedLabels).toEqual(['我', '对方']);
    expect(rounds).toHaveLength(2);
    expect(rounds[0].input).toBe('我：今天有空吗？想约你吃饭\n对方：这周有点忙诶');
    expect(rounds[1].input).toBe('我：那下周呢\n我可以订位\n对方：下周再说吧');
    // 我方连发的两条合并成一条气泡（合并成一轮的「用户输入」）
    expect(rounds[1].mine).toHaveLength(1);
    expect(rounds[1].mine[0].clean).toBe('那下周呢\n我可以订位');
  });

  it('未回复的末轮被标记为 awaitingReply', () => {
    const parsed = parseChat('我：在吗\n对方：在\n我：睡了吗', opts);
    const rounds = buildRounds(parsed.bubbles);
    expect(rounds).toHaveLength(2);
    expect(rounds[1].awaitingReply).toBe(true);
    expect(rounds[1].theirs).toHaveLength(0);
  });

  it('对方先开口时形成独立的一轮（对方主动发起，同样可判断）', () => {
    const parsed = parseChat('对方：在吗\n我：在的\n对方：哦', opts);
    const rounds = buildRounds(parsed.bubbles);
    expect(rounds).toHaveLength(2);
    expect(rounds[0].input).toBe('对方：在吗');
    expect(rounds[0].mine).toHaveLength(0);
    expect(rounds[1].input).toBe('我：在的\n对方：哦');
  });
});

describe('发言人标注', () => {
  it('识别 A / B 并给出假设提示，可交换', () => {
    const parsed = parseChat('A：在吗\nB：在', opts);
    expect(parsed.warnings.join()).toContain('交换双方');
    const rounds = buildRounds(parsed.bubbles);
    expect(rounds[0].mine[0].clean).toBe('在吗');

    const swapped = buildRounds(swapSpeakers(parsed.bubbles));
    // 交换后原来的「我」变成对方：第一轮变成对方先开口
    expect(swapped[0].mine).toHaveLength(0);
    expect(swapped[0].theirs[0].clean).toBe('在吗');
    expect(swapped[1].mine[0].clean).toBe('在');
  });

  it('自动把检测到的昵称并入脱敏名单（昵称 → 对方）', () => {
    const parsed = parseChat('小鹿：在吗\n我：在的', opts);
    expect(parsed.detectedOtherNames).toContain('小鹿');
    const rounds = buildRounds(parsed.bubbles);
    expect(rounds[0].input).toBe('对方：在吗');
    expect(rounds[0].input).not.toContain('小鹿');
  });

  it('没有标签时按行交替推测', () => {
    const parsed = parseChat('在吗\n在的\n今天有空吗\n这周有点忙', opts);
    expect(parsed.warnings.join()).toContain('交替');
    const rounds = buildRounds(parsed.bubbles);
    expect(rounds).toHaveLength(2);
    expect(rounds[0].input).toBe('我：在吗\n对方：在的');
  });
});

describe('时间戳/媒体/系统消息', () => {
  it('时间戳被单独取出并从判断文本里消失', () => {
    const chat = ['我：在吗', '2024-05-11 20:14', '对方：在的'].join('\n');
    const parsed = parseChat(chat, opts);
    expect(parsed.stats.timestamps).toBe(1);
    const rounds = buildRounds(parsed.bubbles);
    expect(rounds[0].input).toBe('我：在吗\n对方：在的');
  });

  it('媒体与系统消息被识别，系统消息不参与判断', () => {
    const chat = ['我：[图片]', '对方：哈哈哈', '对方：撤回了一条消息'].join('\n');
    const parsed = parseChat(chat, opts);
    expect(parsed.stats.media).toBe(1);
    expect(parsed.stats.system).toBe(1);
    const rounds = buildRounds(parsed.bubbles);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].theirs).toHaveLength(1);
  });
});

describe('文件导入', () => {
  it('解析 JSON 数组', () => {
    const json = JSON.stringify([
      { sender: '我', text: 'hi' },
      { sender: '对方', text: 'yo' },
    ]);
    expect(parseFileContent('chat.json', json)).toBe('我：hi\n对方：yo');
  });

  it('解析 messages 字段包裹的 JSON', () => {
    const json = JSON.stringify({ messages: [{ name: '我', content: '你好' }] });
    expect(parseFileContent('chat.json', json)).toBe('我：你好');
  });

  it('解析 CSV', () => {
    const csv = ['sender,text', '我,hi', '对方,yo'].join('\n');
    expect(parseFileContent('chat.csv', csv)).toBe('我：hi\n对方：yo');
  });

  it('未知格式原样返回', () => {
    expect(parseFileContent('chat.txt', '我：hi')).toBe('我：hi');
  });
});
