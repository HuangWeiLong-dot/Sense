import { describe, expect, it } from 'vitest';
import { ROUND_QUESTIONS, SUMMARY_QUESTIONS } from '../core/jev/questions';
import {
  coerceAnswers,
  coerceChoice,
  coerceScore,
  extractJsonObject,
  findAnswers,
  renderQuestionsForPrompt,
} from './json';

describe('extractJsonObject', () => {
  it('解析裸 JSON、代码块、夹带解释文字的 JSON', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('好的，结果是 {"a":{"b":2}} 完毕')).toEqual({ a: { b: 2 } });
  });

  it('非法内容返回 null', () => {
    expect(extractJsonObject('没有 JSON')).toBeNull();
    expect(extractJsonObject('')).toBeNull();
  });

  it('不误吞字符串里的花括号', () => {
    expect(extractJsonObject('{"t":"a{b}c"}')).toEqual({ t: 'a{b}c' });
  });
});

describe('findAnswers', () => {
  it('兼容 answers / result / data / 嵌套包装', () => {
    const keys = ['好感度'];
    expect(findAnswers({ answers: { 好感度: 6 } }, keys)).toEqual({ 好感度: 6 });
    expect(findAnswers({ data: { result: { 好感度: 7 } } }, keys)).toEqual({ 好感度: 7 });
    expect(findAnswers({ 好感度: 8 }, keys)).toEqual({ 好感度: 8 });
    expect(findAnswers({ nope: 1 }, keys)).toEqual({});
  });
});

describe('数值与选项归一化', () => {
  it('分数裁剪到 0-10 并保留一位小数', () => {
    expect(coerceScore(11)).toBe(10);
    expect(coerceScore(-3)).toBe(0);
    expect(coerceScore('7.5 分')).toBe(7.5);
    expect(coerceScore({ score: 6 })).toBe(6);
    expect(coerceScore('不知道')).toBeNull();
  });

  it('选项做精确 / 去标点 / 包含匹配', () => {
    const options = ['主动推进', '配合回应', '被动敷衍', '回避冷淡'];
    expect(coerceChoice('主动推进', options)).toBe('主动推进');
    expect(coerceChoice('被动敷衍。', options)).toBe('被动敷衍');
    expect(coerceChoice('我觉得是「回避冷淡」', options)).toBe('回避冷淡');
    expect(coerceChoice('不确定', options)).toBeNull();
  });
});

describe('coerceAnswers', () => {
  it('返回完整的逐轮答案', () => {
    const answers = coerceAnswers(
      { answers: { 好感度: 11, 投入度: '主动推进', 风险信号: '冷暴力倾向' } },
      ROUND_QUESTIONS,
    );
    expect(answers).toEqual({
      好感度: 10,
      投入度: '主动推进',
      风险信号: '冷暴力倾向',
    });
  });

  it('缺项时抛错，绝不静默编造', () => {
    expect(() => coerceAnswers({ answers: { 好感度: 6 } }, ROUND_QUESTIONS)).toThrow(/缺少可用答案/);
    expect(() => coerceAnswers({}, ROUND_QUESTIONS)).toThrow(/没有找到答案字段/);
  });

  it('支持汇总问题', () => {
    const answers = coerceAnswers(
      { 整体关系温度: 5.8, 关系风险等级: '需观察', 关系阶段判断: '冷淡' },
      SUMMARY_QUESTIONS,
    );
    expect(answers['整体关系温度']).toBe(5.8);
    expect(answers['关系阶段判断']).toBe('冷淡');
  });
});

describe('renderQuestionsForPrompt', () => {
  it('包含问题名、说明与选项原文', () => {
    const text = renderQuestionsForPrompt(ROUND_QUESTIONS);
    expect(text).toContain('好感度');
    expect(text).toContain('0-10 整数分数');
    expect(text).toContain('主动推进');
    expect(text).toContain('必须原样输出其中一个');
  });
});
