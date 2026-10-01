import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Bubble } from '../types';
import {
  applyAnonymizerToBubbles,
  buildRounds,
  parseChat,
  swapSpeakers,
} from '../core/preprocess/parse';
import { convertChatFile } from '../core/import/formats';
import { runAnalysis, type Progress } from '../core/pipeline/run';
import { saveResult } from '../store/history';
import { useSettings } from '../store/SettingsContext';
import { JUDGE_PRESETS, LLM_PRESETS } from '../store/settings';
import { SAMPLE_BACKGROUND, SAMPLE_CHAT } from '../data/sample';
import { Badge, Button, Card, Field, Notice, ProgressBar, Toggle } from '../components/ui';
import {
  IconArrowRight,
  IconRefresh,
  IconSliders,
  IconSpark,
  IconSwap,
  IconUpload,
} from '../components/icons';
import { cn } from '../lib/utils';

type Tab = 'paste' | 'file';

const MAX_PREVIEW_ROUNDS = 5;

const TABS: Array<[Tab, string]> = [
  ['paste', '粘贴文本'],
  ['file', '导入文件'],
];

export function ImportPage() {
  const navigate = useNavigate();
  const { settings, secrets, updateSettings } = useSettings();

  const [tab, setTab] = useState<Tab>('paste');
  const [rawText, setRawText] = useState('');
  const [bubbles, setBubbles] = useState<Bubble[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [stats, setStats] = useState<{ system: number; media: number; timestamps: number } | null>(
    null,
  );
  const [background, setBackground] = useState('');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileNote, setFileNote] = useState('');
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const rounds = useMemo(() => (bubbles ? buildRounds(bubbles) : []), [bubbles]);
  const judgeable = rounds.filter((r) => !r.awaitingReply);
  const judgedCount = Math.min(judgeable.length, settings.maxRounds);
  const parsed = Boolean(bubbles && bubbles.length);

  // 脱敏设置变化时，基于 raw 重新生成 clean
  useEffect(() => {
    setBubbles((prev) => (prev ? applyAnonymizerToBubbles(prev, settings.anonymize) : prev));
  }, [settings.anonymize]);

  function handleParse(textOverride?: string) {
    const source = textOverride ?? rawText;
    const parsedChat = parseChat(source, settings.anonymize);
    setBubbles(parsedChat.bubbles);
    setWarnings(parsedChat.warnings);
    setStats(parsedChat.stats);
    setError('');
    if (parsedChat.detectedOtherNames.length) {
      updateSettings({
        anonymize: { ...settings.anonymize, otherNames: parsedChat.detectedOtherNames },
      });
    }
  }

  async function handleFile(file: File) {
    try {
      const content = await file.text();
      const converted = convertChatFile(file.name, content);
      setRawText(converted.text);
      setFileName(file.name);
      setFileNote(converted.note);
      setTab('paste');
      setWarnings([]);
      setBubbles(null);
      setError('');
    } catch (err) {
      setError(`读取文件失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function toggleSpeaker(id: string) {
    setBubbles((prev) =>
      prev
        ? prev.map((b) =>
            b.id === id
              ? { ...b, speaker: b.speaker === 'me' ? 'other' : 'me', source: 'manual' }
              : b,
          )
        : prev,
    );
  }

  function resetAll() {
    setRawText('');
    setBubbles(null);
    setWarnings([]);
    setStats(null);
    setFileName('');
    setFileNote('');
    setError('');
    setProgress(null);
  }

  const preflight = useMemo(() => {
    if (settings.judge.provider === 'typesafe') {
      if (!settings.judge.baseUrl.trim()) return 'TypeSafe Base URL 未填写，请到「设置」补全。';
      if (!secrets.judgeApiKey.trim()) return 'TypeSafe API Key 未填写，请到「设置」补全。';
    }
    if (settings.judge.provider === 'openai' && !settings.judge.baseUrl.trim()) {
      return 'OpenAI 兼容 Base URL 未填写，请到「设置」补全。';
    }
    if (!settings.llm.baseUrl.trim()) {
      return 'LLM Base URL 未填写，请到「设置」补全。';
    }
    return '';
  }, [settings, secrets]);

  async function handleAnalyze() {
    if (!bubbles?.length) return;
    setRunning(true);
    setError('');
    setProgress({ stage: 'prepare', current: 0, total: 0, message: '准备中' });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await runAnalysis({
        bubbles,
        settings,
        secrets,
        background,
        onProgress: setProgress,
        signal: controller.signal,
      });
      saveResult(result);
      navigate(`/result/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  const judgePreset = JUDGE_PRESETS[settings.judge.provider];
  const llmPreset = LLM_PRESETS[settings.llm.provider];

  /* ---------------- 导入窗口（首页唯一内容 + 工作区第一步） ---------------- */
  const importWindow = (
    <Card
      step={1}
      title="导入聊天记录"
      right={
        <div className="flex shrink-0 items-center gap-1 rounded-full border border-white/80 bg-white/45 p-1">
          {TABS.map(([key, text]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-all duration-200',
                tab === key
                  ? 'bg-white text-accent-600 shadow-sm ring-1 ring-accent-100'
                  : 'text-ink-500 hover:bg-white/60 hover:text-ink-900',
              )}
            >
              {text}
            </button>
          ))}
        </div>
      }
    >
      {tab === 'paste' && (
        <div className="space-y-4">
          {fileNote && <Notice tone="success">{fileNote}</Notice>}
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={'形如：\n我：今天有空吗？想约你吃饭\n对方：这周有点忙诶'}
            className="field resize-y font-mono text-[12.5px]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => handleParse()} disabled={!rawText.trim()}>
              <IconArrowRight size={14} />
              解析对话
            </Button>
            <Button
              onClick={() => {
                setRawText(SAMPLE_CHAT);
                setBackground(SAMPLE_BACKGROUND);
                setBubbles(null);
                setWarnings([]);
                setFileName('');
                setFileNote('');
              }}
            >
              <IconSpark size={14} />
              载入示例
            </Button>
            <Button onClick={resetAll}>清空</Button>
            {fileName && <span className="text-[12px] text-ink-400">已导入：{fileName}</span>}
          </div>
        </div>
      )}

      {tab === 'file' && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          className={cn(
            'flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all duration-200',
            dragging
              ? 'border-accent-300 bg-accent-50'
              : 'border-line-strong bg-white/35 hover:bg-white/55',
          )}
        >
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/70 text-accent-500 ring-1 ring-accent-100">
            <IconUpload size={22} />
          </span>
          <p className="text-[14px] font-medium text-ink-900">把聊天记录文件拖到这里</p>
          <p className="text-[12px] leading-relaxed text-ink-400">
            支持 .txt / .json / .csv / .tsv
          </p>
          <label className="btn cursor-pointer">
            选择文件
            <input
              type="file"
              accept=".txt,.json,.csv,.tsv,.md,text/plain,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </label>
          {fileName && (
            <p className="text-[12px] font-medium text-good-700">
              已载入 {fileName}，请切换到「粘贴文本」查看与编辑。
            </p>
          )}
        </div>
      )}
    </Card>
  );

  /* ---------------- 首页：只有导入窗口 ---------------- */
  if (!parsed) {
    return (
      <div className="flex min-h-[calc(100vh-17rem)] flex-col items-center justify-center gap-10 py-4">
        <h1 className="bg-gradient-to-br from-accent-400 via-accent-500 to-accent-700 bg-clip-text text-[46px] font-bold leading-none tracking-tight text-transparent sm:text-[54px]">
          Sense
        </h1>

        <div className="w-full max-w-[780px]">{importWindow}</div>
      </div>
    );
  }

  /* ---------------- 工作区：核对 + 设置 + 开始分析 ---------------- */
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        {importWindow}

        <Card
          step={2}
          title="核对气泡与双方标注"
          subtitle="点击左侧标签即可切换「我 / 对方」"
          right={
            <div className="flex shrink-0 gap-2">
              <Button onClick={() => setBubbles((prev) => (prev ? swapSpeakers(prev) : prev))}>
                <IconSwap size={14} />
                交换双方
              </Button>
              <Button onClick={() => handleParse()}>
                <IconRefresh size={14} />
                重新解析
              </Button>
            </div>
          }
        >
          {warnings.length > 0 && (
            <div className="mb-4 space-y-2">
              {warnings.map((w) => (
                <Notice key={w} tone="warn">
                  {w}
                </Notice>
              ))}
            </div>
          )}

          {stats && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              <Badge tone="neutral">消息 {bubbles?.length ?? 0}</Badge>
              <Badge tone="brand">轮次 {rounds.length}</Badge>
              <Badge tone="warn">待判断 {judgedCount}</Badge>
              {stats.system > 0 && <Badge tone="neutral">系统消息 {stats.system}</Badge>}
              {stats.media > 0 && <Badge tone="neutral">媒体 {stats.media}</Badge>}
              {stats.timestamps > 0 && <Badge tone="neutral">时间戳 {stats.timestamps}</Badge>}
            </div>
          )}

          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {(bubbles ?? []).map((b) => (
              <div
                key={b.id}
                className={cn(
                  'flex gap-3 rounded-xl border px-3.5 py-2.5 transition-colors',
                  b.speaker === 'me'
                    ? 'border-accent-100 bg-accent-50'
                    : 'border-line bg-surface-2',
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleSpeaker(b.id)}
                  title="点击切换发言人"
                  className={cn(
                    'mt-0.5 h-6 shrink-0 rounded-full px-2.5 text-[11.5px] font-medium transition-all',
                    b.speaker === 'me'
                      ? 'bg-accent-500 text-white shadow-sm'
                      : 'bg-white/70 text-ink-700 ring-1 ring-line-strong',
                  )}
                >
                  {b.speaker === 'me' ? '我' : '对方'}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-[13.5px] leading-relaxed text-ink-900">{b.clean}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {b.clean !== b.raw && b.kind === 'text' && <Badge tone="good">已脱敏</Badge>}
                    {b.kind === 'media' && <Badge tone="neutral">媒体</Badge>}
                    {b.kind === 'system' && <Badge tone="neutral">系统消息（不参与判断）</Badge>}
                    {b.time && <Badge tone="neutral">{b.time}</Badge>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {rounds.length > 0 && (
          <Card
            step={3}
            title="将发送给 JEV 的内容（脱敏后）"
            subtitle={`共 ${rounds.length} 轮，前端只会把这些脱敏片段发出去；原始记录不离开设备。`}
          >
            <div className="space-y-2.5">
              {rounds.slice(0, MAX_PREVIEW_ROUNDS).map((r) => (
                <pre
                  key={r.index}
                  className="overflow-x-auto rounded-xl border border-line bg-surface-2 p-3.5 font-mono text-[11.5px] leading-relaxed text-ink-700"
                >
                  <span className="mb-1.5 block text-[11px] font-medium text-ink-300">
                    第 {r.index} 轮{r.awaitingReply ? '（对方未回复，不参与判断）' : ''}
                  </span>
                  {r.input}
                </pre>
              ))}
              {rounds.length > MAX_PREVIEW_ROUNDS && (
                <p className="text-[12px] text-ink-300">
                  … 以及后续 {rounds.length - MAX_PREVIEW_ROUNDS} 轮
                </p>
              )}
            </div>
          </Card>
        )}
      </div>

      <div className="space-y-6">
        <Card title="判断引擎" subtitle={judgePreset.label}>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="brand" dot>
                {judgePreset.label}
              </Badge>
              {settings.judge.model && <Badge tone="neutral">{settings.judge.model}</Badge>}
              <Badge tone="neutral">并发 {settings.judge.concurrency}</Badge>
              <Badge tone="neutral">上限 {settings.maxRounds} 轮</Badge>
            </div>
            <Button onClick={() => navigate('/settings')} className="w-full">
              <IconSliders size={14} />
              设置
            </Button>
          </div>
        </Card>

        <Card title="脱敏设置">
          <div className="space-y-3">
            <Field label="我的称呼（逗号分隔）">
              <input
                className="field"
                value={settings.anonymize.selfNames.join('，')}
                placeholder="例如：我，小明"
                onChange={(e) =>
                  updateSettings({
                    anonymize: {
                      ...settings.anonymize,
                      selfNames: e.target.value
                        .split(/[,，\s]+/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    },
                  })
                }
              />
            </Field>
            <Field label="对方的昵称（逗号分隔）">
              <input
                className="field"
                value={settings.anonymize.otherNames.join('，')}
                placeholder="例如：小鹿，阿哲"
                onChange={(e) =>
                  updateSettings({
                    anonymize: {
                      ...settings.anonymize,
                      otherNames: e.target.value
                        .split(/[,，\s]+/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    },
                  })
                }
              />
            </Field>
            <div className="space-y-0.5 pt-1">
              <Toggle
                label="移除时间戳"
                checked={settings.anonymize.removeTimestamps}
                onChange={(v) =>
                  updateSettings({ anonymize: { ...settings.anonymize, removeTimestamps: v } })
                }
              />
              <Toggle
                label="脱敏地点"
                checked={settings.anonymize.maskPlaces}
                onChange={(v) =>
                  updateSettings({ anonymize: { ...settings.anonymize, maskPlaces: v } })
                }
              />
              <Toggle
                label="脱敏机构"
                checked={settings.anonymize.maskOrgs}
                onChange={(v) => updateSettings({ anonymize: { ...settings.anonymize, maskOrgs: v } })}
              />
            </div>
          </div>
        </Card>

        <Card title="背景信息（可选）">
          <textarea
            value={background}
            onChange={(e) => setBackground(e.target.value)}
            rows={4}
            className="field resize-y"
            placeholder="例如：我们认识三个月了，见过三次面。"
          />
        </Card>

        <Card title="开始分析">
          <div className="space-y-4">
            {llmPreset.needsKey && !secrets.llmApiKey.trim() && (
              <Notice tone="warn">未填写 LLM Key，无法生成建议。</Notice>
            )}
            {preflight && <Notice tone="warn">{preflight}</Notice>}
            {error && <Notice tone="error">{error}</Notice>}

            {running && progress ? (
              <div className="space-y-4">
                <ProgressBar
                  current={progress.current}
                  total={progress.total}
                  message={progress.message}
                />
                <Button onClick={() => abortRef.current?.abort()} className="w-full">
                  取消
                </Button>
              </div>
            ) : (
              <Button
                variant="primary"
                className="w-full py-3 text-[14px]"
                disabled={!bubbles?.length || judgedCount === 0}
                onClick={() => void handleAnalyze()}
              >
                <IconArrowRight size={15} />
                {judgedCount > 0 ? `开始判断（${judgedCount} 轮）` : '请先解析对话'}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
