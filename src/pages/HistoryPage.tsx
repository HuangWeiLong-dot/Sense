import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, Notice } from '../components/ui';
import { IconArrowRight, IconClock, IconTrash, IconUpload } from '../components/icons';
import { clearHistory, listHistory, removeResult, type HistoryEntry } from '../store/history';
import { formatDateTime } from '../lib/utils';

export function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  const refresh = useCallback(() => setEntries(listHistory()), []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-6">
      <Card
        title="历史记录"
        right={
          entries.length ? (
            <Button
              variant="danger"
              onClick={() => {
                if (confirm('确定清空全部历史记录？此操作不可撤销。')) {
                  clearHistory();
                  refresh();
                }
              }}
            >
              <IconTrash size={14} />
              清空全部
            </Button>
          ) : undefined
        }
      >
        {entries.length === 0 ? (
          <div className="space-y-4">
            <Notice tone="info">还没有分析记录。</Notice>
            <Link className="btn btn-primary" to="/">
              <IconUpload size={14} />
              去导入一段对话
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="group flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 transition-all duration-200 hover:border-accent-100 hover:shadow-sm"
              >
                <div className="min-w-0">
                  <Link
                    to={`/result/${entry.id}`}
                    className="block truncate text-[14.5px] font-medium text-ink-900 transition-colors hover:text-accent-600"
                  >
                    {entry.title}
                  </Link>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-ink-400">
                    <span className="inline-flex items-center gap-1">
                      <IconClock size={12} />
                      {formatDateTime(entry.createdAt)}
                    </span>
                    <span className="text-line-strong">/</span>
                    <span>
                      {entry.judged}/{entry.rounds} 轮
                    </span>
                    <Badge tone="brand">温度 {entry.temperature}</Badge>
                    <Badge tone={entry.riskLevel === '健康' ? 'good' : 'warn'}>
                      {entry.riskLevel}
                    </Badge>
                    <Badge tone="neutral">{entry.stage}</Badge>
                    <Badge tone="neutral">{entry.judgeProvider}</Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link className="btn" to={`/result/${entry.id}`}>
                    查看
                    <IconArrowRight size={13} />
                  </Link>
                  <Button
                    variant="danger"
                    onClick={() => {
                      removeResult(entry.id);
                      refresh();
                    }}
                  >
                    <IconTrash size={14} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
