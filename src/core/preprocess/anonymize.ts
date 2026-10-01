import type { AnonymizeOptions } from '../../types';

export const DEFAULT_ANONYMIZE: AnonymizeOptions = {
  selfNames: ['我'],
  otherNames: [],
  removeTimestamps: false,
  maskPlaces: false,
  maskOrgs: false,
};

/** 无论开关如何都会做的隐私兜底：手机号 / 邮箱 / 证件号 / 银行卡。 */
const ALWAYS_ON_PII: Array<{ re: RegExp; to: string }> = [
  { re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, to: '[邮箱]' },
  { re: /(?<!\d)\d{17}[\dXx](?!\d)/g, to: '[证件号]' },
  { re: /(?<!\d)1[3-9]\d{9}(?!\d)/g, to: '[电话]' },
  { re: /(?<!\d)\d{16,19}(?!\d)/g, to: '[卡号]' },
  { re: /https?:\/\/\S+/g, to: '[链接]' },
];

const TIMESTAMP_RES: RegExp[] = [
  /\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?/g,
  /(?:上午|下午|中午|晚上|凌晨|早上|傍晚)\s*\d{1,2}[:：]\d{2}(?:[:：]\d{2})?/g,
  /\d{1,2}[-/月]\d{1,2}日/g,
  /\b\d{1,2}[:：]\d{2}(?:[:：]\d{2})?\b/g,
  /(?:昨天|今天|前天|明天)\s*\d{1,2}[:：]\d{2}/g,
  /星期[一二三四五六日天]/g,
];

/** 常见城市（地点脱敏开关打开时使用）。 */
const CITY_WORDS = [
  '北京', '上海', '广州', '深圳', '杭州', '成都', '重庆', '武汉', '南京', '西安',
  '苏州', '天津', '长沙', '郑州', '青岛', '厦门', '福州', '合肥', '济南', '大连',
  '宁波', '无锡', '昆明', '贵阳', '南宁', '哈尔滨', '沈阳', '长春', '石家庄', '太原',
  '兰州', '乌鲁木齐', '呼和浩特', '银川', '西宁', '拉萨', '海口', '三亚', '东莞', '佛山',
  '珠海', '中山', '惠州', '温州', '嘉兴', '绍兴', '台州', '南昌', '洛阳', '烟台',
  '香港', '澳门', '台北', '高雄', '台中',
];

const PLACE_RE =
  /[\u4e00-\u9fa5A-Za-z0-9]{2,8}(?:省|市|区|县|镇|乡|街道|路|街|号|大厦|广场|公园|机场|车站|高铁站|地铁站|酒店|宾馆|餐厅|咖啡|奶茶店|大学|学院|中学|小学|医院|小区|公寓)/g;

const ORG_RE =
  /[\u4e00-\u9fa5A-Za-z0-9]{2,12}(?:公司|集团|有限|科技|网络|银行|证券|保险|学校|大学|学院|研究院|研究所|工作室|部门|事业部|实验室|事业部)/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const t = n.trim();
    if (!t || t === '我' || t === '对方' || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  // 长名优先，避免「小明」先于「小明明」被替换
  return out.sort((a, b) => b.length - a.length);
}

export interface Anonymizer {
  apply(text: string): string;
  /** 实际命中的昵称，便于 UI 提示 */
  hits: string[];
}

/**
 * 按脱敏规则构造转换器：
 * 昵称 → 对方、自己 → 我、时间戳移除、（可选）地点/机构打码。
 * 口头禅等独特表达不做处理——它们影响判断准确度。
 */
export function createAnonymizer(opts: AnonymizeOptions): Anonymizer {
  const hits: string[] = [];
  const selfNames = uniqueNames(opts.selfNames.filter((n) => n !== '我'));
  const otherNames = uniqueNames(opts.otherNames);

  function apply(text: string): string {
    let out = text;

    if (opts.removeTimestamps) {
      for (const re of TIMESTAMP_RES) out = out.replace(re, ' ');
    }

    // 昵称 → 对方 / 我（用前后对比判断是否命中，避免 /g 正则的 lastIndex 状态污染）
    for (const name of otherNames) {
      const next = out.replace(new RegExp(escapeRe(name), 'g'), '对方');
      if (next !== out) {
        if (!hits.includes(name)) hits.push(name);
        out = next;
      }
    }
    for (const name of selfNames) {
      const next = out.replace(new RegExp(escapeRe(name), 'g'), '我');
      if (next !== out) out = next;
    }

    for (const { re, to } of ALWAYS_ON_PII) out = out.replace(re, to);

    if (opts.maskPlaces) {
      out = out.replace(PLACE_RE, '[地点]');
      for (const city of CITY_WORDS) {
        if (out.includes(city)) out = out.split(city).join('[地点]');
      }
    }
    if (opts.maskOrgs) out = out.replace(ORG_RE, '[机构]');

    return out.replace(/[ \t]{2,}/g, ' ').trim();
  }

  return { apply, hits };
}

/** 一次性脱敏工具函数（无状态场景）。 */
export function anonymizeText(text: string, opts: AnonymizeOptions): string {
  return createAnonymizer(opts).apply(text);
}

/** 合并用户手工填写的昵称与解析出的昵称，去重。 */
export function mergeNames(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b].map((s) => s.trim()).filter(Boolean)));
}
