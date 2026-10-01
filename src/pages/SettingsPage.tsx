import { useState } from 'react';
import type { JudgeProvider, LlmProvider } from '../types';
import { Badge, Button, Card, Field, Notice, Toggle } from '../components/ui';
import { IconLock, IconPlug, IconRefresh, IconTrash } from '../components/icons';
import { describeTarget } from '../adapters/proxy';
import { probeJudge, probeLlm, type ProbeResult } from '../core/pipeline/health';
import { useSettings } from '../store/SettingsContext';
import { useHealth } from '../store/HealthContext';
import { JUDGE_PRESETS, LLM_PRESETS, clearSettings, maskKey } from '../store/settings';
import { clearHistory } from '../store/history';

/** 连接测试的超时上限，避免按钮一直转 */
function probeSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(20_000)
    : undefined;
}

function ProbeFeedback({ result }: { result: ProbeResult | null }) {
  if (!result) return null;
  if (result.ok) {
    return (
      <Badge tone="good" dot>
        {result.ms > 0 ? `连接正常 · ${result.ms}ms` : '连接正常'}
      </Badge>
    );
  }
  return (
    <div className="space-y-2">
      <Badge tone="bad" dot>
        连接失败
      </Badge>
      <Notice tone="error">{result.error}</Notice>
    </div>
  );
}

export function SettingsPage() {
  const { settings, secrets, updateSettings, updateSecrets, resetSettings } = useSettings();
  const { record, resultFor } = useHealth();
  const [judgeTesting, setJudgeTesting] = useState(false);
  const [llmTesting, setLlmTesting] = useState(false);
  // 测试结果存在会话级 context 里，右上角标记读同一份数据
  const judgeProbe = resultFor('judge');
  const llmProbe = resultFor('llm');

  const judgePreset = JUDGE_PRESETS[settings.judge.provider];

  function changeJudgeProvider(provider: JudgeProvider) {
    const preset = JUDGE_PRESETS[provider];
    updateSettings({
      judge: {
        ...settings.judge,
        provider,
        baseUrl: preset.baseUrl || settings.judge.baseUrl,
        path: preset.path || settings.judge.path,
        model: preset.model || settings.judge.model,
      },
    });
  }

  function changeLlmProvider(provider: LlmProvider) {
    const preset = LLM_PRESETS[provider];
    updateSettings({
      llm: {
        ...settings.llm,
        provider,
        baseUrl: preset.baseUrl,
        model: preset.model,
      },
    });
  }

  async function testJudge() {
    setJudgeTesting(true);
    try {
      record('judge', await probeJudge(settings, secrets, probeSignal()));
    } finally {
      setJudgeTesting(false);
    }
  }

  async function testLlm() {
    setLlmTesting(true);
    try {
      record('llm', await probeLlm(settings, secrets, probeSignal()));
    } finally {
      setLlmTesting(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* JEV */}
      <Card title="JEV 判断引擎" subtitle={judgePreset.label}>
        <div className="space-y-4">
          <Field label="引擎">
            <select
              className="field"
              value={settings.judge.provider}
              onChange={(e) => changeJudgeProvider(e.target.value as JudgeProvider)}
            >
              {Object.entries(JUDGE_PRESETS).map(([key, preset]) => (
                <option key={key} value={key}>
                  {preset.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Base URL">
                <input
                  className="field"
                  value={settings.judge.baseUrl}
                  onChange={(e) =>
                    updateSettings({ judge: { ...settings.judge, baseUrl: e.target.value } })
                  }
                  placeholder="https://..."
                />
              </Field>

              {settings.judge.provider === 'typesafe' && (
                <Field label="Path" hint="默认 /systemone">
                  <input
                    className="field"
                    value={settings.judge.path}
                    onChange={(e) =>
                      updateSettings({ judge: { ...settings.judge, path: e.target.value } })
                    }
                  />
                </Field>
              )}

              <Field label="模型">
                <input
                  className="field"
                  value={settings.judge.model}
                  onChange={(e) =>
                    updateSettings({ judge: { ...settings.judge, model: e.target.value } })
                  }
                  placeholder={settings.judge.provider === 'openai' ? 'gpt-4o-mini' : '可留空'}
                />
              </Field>

              <Field label="API Key" hint={`当前：${maskKey(secrets.judgeApiKey)}`}>
                <input
                  className="field"
                  type="password"
                  value={secrets.judgeApiKey}
                  onChange={(e) => updateSecrets({ judgeApiKey: e.target.value })}
                  placeholder="sk-..."
                  autoComplete="off"
                />
              </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="并发请求数">
              <input
                className="field"
                type="number"
                min={1}
                max={8}
                value={settings.judge.concurrency}
                onChange={(e) =>
                  updateSettings({
                    judge: { ...settings.judge, concurrency: Number(e.target.value) || 1 },
                  })
                }
              />
            </Field>
            <Field label="最多判断轮数">
              <input
                className="field"
                type="number"
                min={1}
                max={200}
                value={settings.maxRounds}
                onChange={(e) => updateSettings({ maxRounds: Number(e.target.value) || 1 })}
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void testJudge()} disabled={judgeTesting}>
              <IconPlug size={14} />
              {judgeTesting ? '测试中…' : '测试连接'}
            </Button>
          </div>
          <ProbeFeedback result={judgeProbe} />
        </div>
      </Card>

      {/* LLM */}
      <Card title="建议生成（LLM）">
        <div className="space-y-4">
          <Field label="服务">
            <select
              className="field"
              value={settings.llm.provider}
              onChange={(e) => changeLlmProvider(e.target.value as LlmProvider)}
            >
              {Object.entries(LLM_PRESETS).map(([key, preset]) => (
                <option key={key} value={key}>
                  {preset.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Base URL">
                <input
                  className="field"
                  value={settings.llm.baseUrl}
                  onChange={(e) =>
                    updateSettings({ llm: { ...settings.llm, baseUrl: e.target.value } })
                  }
                  placeholder="https://api.deepseek.com/v1"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="模型">
                  <input
                    className="field"
                    value={settings.llm.model}
                    onChange={(e) =>
                      updateSettings({ llm: { ...settings.llm, model: e.target.value } })
                    }
                    placeholder="deepseek-chat"
                  />
                </Field>
                <Field label="生成随机性" hint="越高措辞越多变，0 最稳定">
                  <input
                    className="field"
                    type="number"
                    min={0}
                    max={1.5}
                    step={0.1}
                    value={settings.llm.temperature}
                    onChange={(e) =>
                      updateSettings({
                        llm: { ...settings.llm, temperature: Number(e.target.value) },
                      })
                    }
                  />
                </Field>
              </div>
              <Field label="API Key" hint={`当前：${maskKey(secrets.llmApiKey)}`}>
                <input
                  className="field"
                  type="password"
                  value={secrets.llmApiKey}
                  onChange={(e) => updateSecrets({ llmApiKey: e.target.value })}
                  placeholder="sk-..."
                  autoComplete="off"
                />
              </Field>

          <Toggle
            label="在本机记住 API Key"
            checked={settings.rememberKeys}
            onChange={(v) => updateSettings({ rememberKeys: v })}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void testLlm()} disabled={llmTesting}>
              <IconPlug size={14} />
              {llmTesting ? '测试中…' : '测试连接'}
            </Button>
          </div>
          <ProbeFeedback result={llmProbe} />
        </div>
      </Card>

      {/* 网络代理 */}
      <Card title="网络代理">
        <div className="space-y-4">
          <Toggle
            label="通过本机代理发送请求"
            checked={settings.proxy.enabled}
            onChange={(v) => updateSettings({ proxy: { ...settings.proxy, enabled: v } })}
          />
          {settings.proxy.enabled && (
            <>
              <Field label="代理地址" hint="先在另一个终端运行 npm run proxy">
                <input
                  className="field"
                  value={settings.proxy.url}
                  placeholder="http://127.0.0.1:8787"
                  onChange={(e) =>
                    updateSettings({ proxy: { ...settings.proxy, url: e.target.value } })
                  }
                />
              </Field>
              <p className="break-all text-[11.5px] leading-relaxed text-ink-400">
                JEV 实际请求：{describeTarget(settings.proxy, settings.judge.baseUrl)}
              </p>
            </>
          )}
          <Notice tone="info">浏览器不允许网页直连不支持 CORS 的接口；代理跑在你自己机器上，数据不经过第三方。</Notice>
        </div>
      </Card>

      {/* 本地数据 */}
      <Card title="本地数据" subtitle="清除后无法恢复">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                resetSettings();
              }}
            >
              <IconRefresh size={14} />
              恢复默认设置
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirm('清除全部本地数据（设置、Key、历史记录）？')) {
                  clearHistory();
                  clearSettings();
                  updateSecrets({ judgeApiKey: '', llmApiKey: '' });
                  resetSettings();
                }
              }}
            >
              <IconTrash size={14} />
              清除全部本地数据
            </Button>
          </div>
          <Notice tone="info">
            <span className="flex items-center gap-2">
              <IconLock size={14} className="shrink-0" />
              所有数据只保存在这台设备上。
            </span>
          </Notice>
        </div>
      </Card>
    </div>
  );
}
