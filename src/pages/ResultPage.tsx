import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, Notice, Stat, type Tone } from '../components/ui';
import { RadarChart, TimelineChart } from '../components/charts/Charts';
import {
  IconActivity,
  IconCopy,
  IconDownload,
  IconHash,
  IconInfo,
  IconLayers,
  IconLineChart,
  IconRefresh,
  IconShield,
  IconSparkles,
  IconTarget,
  IconTrash,
} from '../components/icons';
import { exportResultJson, getResult, removeResult, saveResult } from '../store/history';
import { useSettings } from '../store/SettingsContext';
import { generateAdvice } from '../core/pipeline/advice';
import { theirsText } from '../core/preprocess/parse';
import { SUMMARY_QUESTIONS, scoreBand } from '../core/jev/questions';
import { formatDateTime } from '../lib/utils';
import type { Advice } from '../types';

const RISK_TONE: Record<string, Tone> = {
  健康: 'good',
  需观察: 'warn',
  需警惕: 'warn',
  高风险: 'bad',
};

function riskTone(level: string): Tone {
  return RISK_TONE[level] ?? 'neutral';
}

function CardIcon({ children }: { children: ReactNode }) {
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-400">
      {children}
    </span>
  );
}

export function ResultPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { settings, secrets } = useSettings();
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [adviceError, setAdviceError] = useState<string | null>(null);
  const result = useMemo(() => getResult(id), [id]);
  // 建议按需生成：先读历史里已有的，生成后再写回
  const [advice, setAdvice] = useState<Advice | null>(result?.advice ?? null);

  if (!result) {
    return (
      <Card title="找不到这条记录">
        <p className="text-[13.5px] leading-relaxed text-ink-500">
          结果可能已被删除，或浏览器本地存储被清理过（无痕模式不会持久化）。
        </p>
        <div className="mt-4 flex gap-2">
          <Link className="btn btn-primary" to="/">
            返回导入
          </Link>
          <Link className="btn" to="/history">
            查看历史
          </Link>
        </div>
      </Card>
    );
  }

  const { summary, aggregate } = result;
  const temperatureBand = scoreBand(
    summary.temperature,
    SUMMARY_QUESTIONS.整体关系温度.legend ?? {},
  );

  function handleExport() {
    const blob = new Blob([exportResultJson(result!)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sense-${result!.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleGenerate() {
    if (!result) return;
    setGenerating(true);
    setAdviceError(null);
    try {
      const next = await generateAdvice({ result, settings, secrets });
      setAdvice(next);
      // 写回历史，刷新后仍然在
      saveResult({ ...result, advice: next });
    } catch (err) {
      setAdviceError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(advice?.text ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-snug tracking-tight text-ink-900">
            {result.title}
          </h1>
          <p className="mt-2 text-[12.5px] text-ink-400">{formatDateTime(result.createdAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleExport}>
            <IconDownload size={14} />
            导出 JSON
          </Button>
          <Button onClick={() => navigate('/')}>
            <IconRefresh size={14} />
            重新分析
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              removeResult(result.id);
              navigate('/history');
            }}
          >
            <IconTrash size={14} />
            删除
          </Button>
        </div>
      </div>

      {/* 7.1 标签 + 数字 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="整体关系温度"
          value={summary.temperature}
          unit="/ 10"
          tone="brand"
          icon={<IconActivity size={15} />}
          hint={temperatureBand}
        />
        <Stat
          label="关系风险等级"
          value={summary.riskLevel}
          tone={riskTone(summary.riskLevel)}
          icon={<IconShield size={15} />}
          hint={`风险指数 ${aggregate.风险指数}/10`}
        />
        <Stat
          label="关系阶段"
          value={summary.stage}
          tone="neutral"
          icon={<IconLayers size={15} />}
          hint={`投入度得分 ${aggregate.投入度得分}/10`}
        />
        <Stat
          label="判断规模"
          value={aggregate.总轮数}
          unit="轮"
          tone="neutral"
          icon={<IconHash size={15} />}
          hint={
            aggregate.失败轮数 > 0
              ? `其中 ${aggregate.失败轮数} 轮失败已排除`
              : `好感度均值 ${aggregate.好感度均值}/10`
          }
        />
      </div>

      {aggregate.失败轮数 > 0 && (
        <Notice tone="warn">
          有 {aggregate.失败轮数} 轮判断失败（网络或返回格式问题），这些轮次不计入统计，结论置信度会降低。
        </Notice>
      )}

      {/* 7.2 / 7.3 图表 */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card
          title="好感度时间线"
          right={
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone="neutral">均值 {aggregate.好感度均值} / 10</Badge>
              <CardIcon>
                <IconLineChart size={14} />
              </CardIcon>
            </div>
          }
        >
          {aggregate.好感度趋势.length ? (
            <TimelineChart trend={aggregate.好感度趋势} mean={aggregate.好感度均值} />
          ) : (
            <p className="text-[13.5px] text-ink-500">没有可用的逐轮分数。</p>
          )}
        </Card>
        <Card
          title="关系状态雷达"
          right={
            <CardIcon>
              <IconTarget size={14} />
            </CardIcon>
          }
        >
          <RadarChart
            score={summary.temperature}
            engagement={aggregate.投入度得分}
            risk={aggregate.风险指数}
          />
          <div className="mt-4 grid grid-cols-2 gap-2">
            {Object.entries(aggregate.投入度分布).map(([key, value]) => (
              <div
                key={key}
                className="flex items-baseline justify-between rounded-lg bg-surface-2 px-3 py-2"
              >
                <span className="text-[12px] text-ink-500">{key}</span>
                <span className="text-[13px] font-semibold tabular-nums text-ink-900">{value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* 7.4 建议（按需生成） */}
      <Card
        title="建议"
        right={
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {advice && (
              <Button onClick={() => void handleCopy()}>
                <IconCopy size={14} />
                {copied ? '已复制' : '复制'}
              </Button>
            )}
            <Button variant="primary" onClick={() => void handleGenerate()} disabled={generating}>
              <IconSparkles size={14} />
              {generating ? '生成中…' : advice ? '重新生成' : '生成建议'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {advice ? (
            <>
              <div className="whitespace-pre-wrap rounded-xl bg-surface-2 p-5 text-[14px] leading-[1.9] text-ink-700">
                {advice.text}
              </div>
              <p className="flex items-start gap-1.5 border-t border-line pt-3 text-[11.5px] leading-relaxed text-ink-400">
                <IconInfo size={13} className="mt-0.5 shrink-0" />
                <span>
                  以上内容由 AI 生成，仅供参考，不构成心理或医疗建议。请结合自己的真实感受判断。
                </span>
              </p>
            </>
          ) : (
            <p className="text-[13.5px] leading-relaxed text-ink-500">
              尚未生成 —— 点右上角「生成建议」按需调用你的 LLM。
            </p>
          )}
          {adviceError && <Notice tone="error">{adviceError}</Notice>}
        </div>
      </Card>

      {/* 逐轮明细 */}
      <Card title="逐轮判断明细">
        <div className="overflow-hidden rounded-xl border border-line">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[660px] border-collapse text-left">
              <thead className="bg-surface-2">
                <tr>
                  {['轮次', '好感度', '投入度', '风险信号', '对方（脱敏摘录）'].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rounds.map((round) => {
                  const judgement = result.judgements.find((j) => j.round === round.index);
                  const text = theirsText(round).replace(/\s+/g, ' ');
                  return (
                    <tr
                      key={round.index}
                      className={
                        judgement?.degraded
                          ? 'border-t border-line opacity-45'
                          : 'border-t border-line transition-colors hover:bg-surface-2/70'
                      }
                    >
                      <td className="px-4 py-2.5 text-[12px] tabular-nums text-ink-400">
                        {String(round.index).padStart(2, '0')}
                      </td>
                      <td className="px-4 py-2.5 text-[14px] font-semibold tabular-nums text-ink-900">
                        {judgement ? judgement.score : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-[13px] text-ink-700">
                        {judgement
                          ? judgement.engagement
                          : round.awaitingReply
                            ? '对方未回复'
                            : '未判断'}
                      </td>
                      <td className="px-4 py-2.5">
                        {judgement ? (
                          <Badge tone={judgement.risk === '无明显信号' ? 'neutral' : 'bad'}>
                            {judgement.risk}
                          </Badge>
                        ) : (
                          <span className="text-ink-300">—</span>
                        )}
                      </td>
                      <td className="max-w-[280px] px-4 py-2.5 text-[13px] leading-relaxed text-ink-500">
                        <span className="line-clamp-2">{text.slice(0, 60) || '（无）'}</span>
                        {judgement?.error && (
                          <span className="mt-1 block text-[11.5px] text-bad-700">
                            失败：{judgement.error}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      {/* 脱敏摘要 */}
      <Card title="脱敏摘要">
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-surface-2 p-4 font-mono text-[12px] leading-relaxed text-ink-700">
          {result.digest}
        </pre>
      </Card>
    </div>
  );
}
