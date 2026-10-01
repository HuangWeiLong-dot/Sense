import { describe, expect, it } from 'vitest';
import type { Settings } from '../types';
import { DEFAULT_SETTINGS, JUDGE_PRESETS, loadSettings, migrateSettings, saveSettings } from './settings';

function withJudge(patch: Partial<Settings['judge']>): Settings {
  return { ...DEFAULT_SETTINGS, judge: { ...DEFAULT_SETTINGS.judge, ...patch } };
}

describe('设置迁移', () => {
  it('把旧的 TypeSafe 占位地址换成官方地址', () => {
    const legacy = withJudge({
      provider: 'typesafe',
      baseUrl: 'https://api.typesafe.example',
      path: '/v1/judge',
      model: '',
    });

    const migrated = migrateSettings(legacy, 1);

    expect(migrated.judge.baseUrl).toBe('https://api.typesafe.ai/v1');
    expect(migrated.judge.path).toBe('/systemone');
    expect(migrated.judge.model).toBe('jev-latest');
  });

  it('不覆盖用户自己填过的地址', () => {
    const custom = withJudge({
      provider: 'typesafe',
      baseUrl: 'https://my-gateway.internal/v1',
      path: '/custom',
      model: 'my-model',
    });

    const migrated = migrateSettings(custom, 1);

    expect(migrated.judge.baseUrl).toBe('https://my-gateway.internal/v1');
    expect(migrated.judge.path).toBe('/custom');
    expect(migrated.judge.model).toBe('my-model');
  });

  it('空值会被补成当前默认', () => {
    const empty = withJudge({ provider: 'typesafe', baseUrl: '', path: '', model: '' });

    const migrated = migrateSettings(empty, 1);

    expect(migrated.judge.baseUrl).toBe(JUDGE_PRESETS.typesafe.baseUrl);
    expect(migrated.judge.path).toBe(JUDGE_PRESETS.typesafe.path);
    expect(migrated.judge.model).toBe(JUDGE_PRESETS.typesafe.model);
  });

  it('OpenAI 引擎允许留空模型，不会被塞成 jev-latest', () => {
    const openai = withJudge({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      path: '',
      model: '',
    });

    const migrated = migrateSettings(openai, 1);

    expect(migrated.judge.model).toBe('');
    expect(migrated.judge.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('已是当前版本时原样返回，不再改动', () => {
    const current = withJudge({ baseUrl: 'https://api.typesafe.example' });
    expect(migrateSettings(current, 2)).toBe(current);
  });

  it('迁移后的设置再次读写不会回退', () => {
    // 走一遍真实的存取路径（无 localStorage 时退回内存）
    saveSettings(withJudge({ provider: 'typesafe', baseUrl: 'https://api.typesafe.ai/v1', path: '/systemone', model: 'jev-latest' }));
    const reloaded = loadSettings();
    expect(reloaded.judge.baseUrl).toBe('https://api.typesafe.ai/v1');
    expect(reloaded.judge.path).toBe('/systemone');
    expect(reloaded.judge.model).toBe('jev-latest');
  });
});
