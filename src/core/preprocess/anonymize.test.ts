import { describe, expect, it } from 'vitest';
import { DEFAULT_ANONYMIZE, anonymizeText, createAnonymizer } from './anonymize';

const base = { ...DEFAULT_ANONYMIZE };

describe('脱敏：昵称与自称', () => {
  it('把对方昵称替换为「对方」，自己的称呼替换为「我」', () => {
    const out = anonymizeText('小鹿：今天小明说要一起吃饭', {
      ...base,
      selfNames: ['小明'],
      otherNames: ['小鹿'],
    });
    expect(out).toBe('对方：今天我说要一起吃饭');
    expect(out).not.toContain('小鹿');
    expect(out).not.toContain('小明');
  });

  it('记录命中的昵称', () => {
    const anon = createAnonymizer({ ...base, otherNames: ['阿哲'] });
    anon.apply('阿哲说他明天到');
    expect(anon.hits).toContain('阿哲');
  });
});

describe('脱敏：PII 兜底（不受开关影响）', () => {
  it('手机号 / 邮箱 / 证件号 / 银行卡 / 链接', () => {
    expect(anonymizeText('我的电话是13812345678', base)).toContain('[电话]');
    expect(anonymizeText('邮箱 a.b-c@example.com 谢谢', base)).toContain('[邮箱]');
    expect(anonymizeText('身份证11010119900307123X', base)).toContain('[证件号]');
    expect(anonymizeText('卡号6222021234567890123', base)).toContain('[卡号]');
    expect(anonymizeText('看这个 https://example.com/a?b=1 吧', base)).toContain('[链接]');
  });

  it('不会把普通数字当成手机号', () => {
    const out = anonymizeText('一共 12345 元', base);
    expect(out).toBe('一共 12345 元');
  });
});

describe('脱敏：开关', () => {
  it('时间戳按开关移除', () => {
    const withTs = anonymizeText('2024-05-11 20:14 你好', { ...base, removeTimestamps: true });
    expect(withTs).toBe('你好');
    const keep = anonymizeText('2024-05-11 20:14 你好', { ...base, removeTimestamps: false });
    expect(keep).toContain('2024');
  });

  it('地点/机构默认不动，打开后打码', () => {
    const text = '我去了北京大学，然后去字节跳动科技有限公司';
    expect(anonymizeText(text, base)).toContain('北京大学');
    const masked = anonymizeText(text, { ...base, maskPlaces: true, maskOrgs: true });
    expect(masked).not.toContain('北京大学');
    expect(masked).toContain('[地点]');
    expect(masked).not.toContain('字节跳动科技有限公司');
    expect(masked).toContain('[机构]');
  });

  it('保留独特口头禅（影响判断准确度）', () => {
    expect(anonymizeText('笑不活了，你怎么这么牛哇', base)).toBe('笑不活了，你怎么这么牛哇');
  });
});
