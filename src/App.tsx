import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { SettingsProvider, useSettings } from './store/SettingsContext';
import { HealthProvider, useHealth } from './store/HealthContext';
import { ImportPage } from './pages/ImportPage';
import { ResultPage } from './pages/ResultPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { JUDGE_PRESETS, LLM_PRESETS } from './store/settings';
import type { ProbeResult } from './core/pipeline/health';
import { Badge, type Tone } from './components/ui';
import { IconClock, IconSliders, IconUpload } from './components/icons';
import { cn } from './lib/utils';

const NAV = [
  { to: '/', label: '导入', end: true, Icon: IconUpload },
  { to: '/history', label: '历史', end: false, Icon: IconClock },
  { to: '/settings', label: '设置', end: false, Icon: IconSliders },
];

/**
 * 右上角标记的配色：绿色 = 这一侧的连接**测试通过**（本次会话内有效）；
 * 红色 = 测过但失败；没测过是中性色 —— 不会拿「已配置」冒充「已验证」。
 */
export function probeBadgeTone(probe: ProbeResult | null): Tone {
  if (!probe) return 'neutral';
  return probe.ok ? 'good' : 'bad';
}

function probeTitle(probe: ProbeResult | null): string | undefined {
  if (!probe) return '尚未测试连接';
  if (!probe.ok) return `连接失败：${probe.error ?? '未知原因'}`;
  return probe.ms > 0 ? `连接正常 · ${probe.ms}ms` : '连接正常';
}

function Header() {
  const { settings } = useSettings();
  const { resultFor } = useHealth();
  const judge = JUDGE_PRESETS[settings.judge.provider];
  const llm = LLM_PRESETS[settings.llm.provider];
  const judgeProbe = resultFor('judge');
  const llmProbe = resultFor('llm');

  return (
    <header className="sticky top-0 z-30 border-b border-white/70 bg-white/55 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <NavLink
          to="/"
          className="bg-gradient-to-br from-accent-400 to-accent-600 bg-clip-text text-[17px] font-bold tracking-tight text-transparent"
        >
          Sense
        </NavLink>

        <nav className="flex items-center gap-1 rounded-full border border-white/80 bg-white/45 p-1 backdrop-blur-xl">
          {NAV.map(({ to, label, end, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all duration-200',
                  isActive
                    ? 'bg-white text-accent-600 shadow-sm ring-1 ring-accent-100'
                    : 'text-ink-500 hover:bg-white/60 hover:text-ink-900',
                )
              }
            >
              <Icon size={14} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Badge
            tone={probeBadgeTone(judgeProbe)}
            dot
            title={probeTitle(judgeProbe)}
          >
            {judge.label}
          </Badge>
          <Badge
            tone={probeBadgeTone(llmProbe)}
            dot
            title={probeTitle(llmProbe)}
          >
            {llm.label}
          </Badge>
        </div>
      </div>
    </header>
  );
}

function Shell() {
  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Routes>
          <Route path="/" element={<ImportPage />} />
          <Route path="/result/:id" element={<ResultPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<ImportPage />} />
        </Routes>
      </main>
      <footer className="px-4 py-6 text-center text-[12px] text-ink-400 sm:px-6">数据不出本机</footer>
    </div>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <HealthProvider>
        <HashRouter>
          <Shell />
        </HashRouter>
      </HealthProvider>
    </SettingsProvider>
  );
}
