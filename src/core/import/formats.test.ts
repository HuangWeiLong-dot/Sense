import { describe, expect, it } from 'vitest';
import { convertChatFile } from './formats';

describe('带时间戳的文本记录', () => {
  it('一行式「时间 昵称」', () => {
    const file = [
      '2023-05-11 20:14:03 小鹿',
      '这周有点忙诶，下周看看？',
      '2023-05-11 20:15:10 我',
      '好呀，那你先忙',
    ].join('\n');

    const result = convertChatFile('chat.txt', file);
    expect(result.format).toBe('timestamped-txt');
    expect(result.text).toBe('小鹿：这周有点忙诶，下周看看？\n我：好呀，那你先忙');
    expect(result.note).toContain('时间戳');
  });

  it('一行式「昵称 时间」', () => {
    const file = ['小鹿 2023-05-11 20:14:03', '在吗', '我 2023-05-11 20:14:20', '在的'].join('\n');
    const result = convertChatFile('chat.txt', file);
    expect(result.format).toBe('timestamped-txt');
    expect(result.text).toBe('小鹿：在吗\n我：在的');
  });

  it('两行式「昵称 单独一行 + 时间 单独一行」，短消息不会被误判成昵称', () => {
    const file = [
      '小鹿',
      '2023-05-11 20:14:03',
      '在吗',
      '我',
      '2023-05-11 20:15:10',
      '在的',
      '小鹿',
      '2023-05-11 20:16:00',
      '好',
    ].join('\n');

    const result = convertChatFile('chat.txt', file);
    expect(result.format).toBe('timestamped-txt');
    expect(result.note).toContain('昵称与时间分行');
    expect(result.text).toBe('小鹿：在吗\n我：在的\n小鹿：好');
  });

  it('多行消息合并为一条', () => {
    const file = [
      '2023-05-11 20:14:03 小鹿',
      '第一行',
      '第二行',
      '2023-05-11 20:15:10 我',
      '收到',
    ].join('\n');
    const result = convertChatFile('chat.txt', file);
    expect(result.text).toBe('小鹿：第一行 第二行\n我：收到');
  });
});

describe('昵称带后缀（邮箱 / 号码）', () => {
  it('识别 昵称<邮箱> 时间', () => {
    const file = [
      '小鹿<12345@example.com> 2023-05-11 20:14:03',
      '这周有点忙',
      '我<67890@example.com> 2023-05-11 20:15:10',
      '好',
    ].join('\n');
    const result = convertChatFile('chat.txt', file);
    expect(result.format).toBe('timestamped-txt');
    expect(result.text).toBe('小鹿：这周有点忙\n我：好');
  });

  it('识别 昵称(号码) 时间', () => {
    const file = ['小鹿(12345) 2023-05-11 20:14:03', '在吗'].join('\n');
    const result = convertChatFile('chat.txt', file);
    expect(result.format).toBe('timestamped-txt');
    expect(result.text).toBe('小鹿：在吗');
  });
});

describe('JSON 导出', () => {
  it('带 isSend 方向标记时直接判定我 / 对方', () => {
    const json = JSON.stringify([
      { talker: '小鹿', isSend: 0, content: '这周有点忙诶', CreateTime: 1683800000 },
      { talker: '小鹿', isSend: 1, content: '好呀', CreateTime: 1683800100 },
    ]);
    const result = convertChatFile('chat.json', json);
    expect(result.format).toBe('json-directional');
    expect(result.text).toBe('对方：这周有点忙诶\n我：好呀');
    expect(result.note).toContain('方向');
  });

  it('布尔 / 字符串形式的 isSend', () => {
    const json = JSON.stringify([
      { name: 'A', isSend: true, content: 'hi' },
      { name: 'A', isSend: '0', content: 'yo' },
    ]);
    const result = convertChatFile('chat.json', json);
    expect(result.text).toBe('我：hi\n对方：yo');
  });

  it('通用 sender / text 记录', () => {
    const json = JSON.stringify([
      { sender: '我', text: 'hi' },
      { sender: '对方', text: 'yo' },
    ]);
    const result = convertChatFile('chat.json', json);
    expect(result.format).toBe('json-generic');
    expect(result.text).toBe('我：hi\n对方：yo');
  });

  it('messages 字段包裹', () => {
    const json = JSON.stringify({ messages: [{ name: '我', content: '你好' }] });
    expect(convertChatFile('chat.json', json).text).toBe('我：你好');
  });

  it('无扩展名但内容是 JSON 数组也能识别', () => {
    const json = JSON.stringify([{ sender: '我', text: 'hi' }]);
    expect(convertChatFile('export', json).format).toBe('json-generic');
  });
});

describe('CSV 与纯文本', () => {
  it('标准 sender,text 表头', () => {
    const csv = ['sender,text', '我,hi', '对方,yo'].join('\n');
    const result = convertChatFile('chat.csv', csv);
    expect(result.format).toBe('csv');
    expect(result.text).toBe('我：hi\n对方：yo');
  });

  it('带 isSend 列的 CSV', () => {
    const csv = ['sender,text,isSend', '小鹿,hi,0', '小鹿,yo,1'].join('\n');
    expect(convertChatFile('chat.csv', csv).text).toBe('对方：hi\n我：yo');
  });

  it('消息里含逗号不会被误判为 CSV', () => {
    const text = '我：今天有空吗，想吃个饭\n对方：这周有点忙';
    const result = convertChatFile('chat.txt', text);
    expect(result.format).toBe('labeled');
    expect(result.text).toBe(text);
  });

  it('已是「昵称：内容」的文本原样通过', () => {
    const result = convertChatFile('chat.txt', '我：hi\n对方：yo');
    expect(result.format).toBe('labeled');
    expect(result.text).toBe('我：hi\n对方：yo');
  });

  it('普通文本按原样返回并提示', () => {
    const result = convertChatFile('chat.txt', '在吗\n在的\n今天有空吗');
    expect(result.format).toBe('plain');
    expect(result.note).toContain('纯文本');
  });

  it('空文件返回空文本', () => {
    const result = convertChatFile('chat.txt', '   \n  ');
    expect(result.text).toBe('');
  });
});
