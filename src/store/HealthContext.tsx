import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ProbeResult, ProbeTarget } from '../core/pipeline/health';
import { probeFingerprint } from '../core/pipeline/health';
import { useSettings } from './SettingsContext';

interface ProbeRecord {
  fingerprint: string;
  result: ProbeResult;
}

interface HealthContextValue {
  /** 记下一次连接测试的结果 */
  record: (target: ProbeTarget, result: ProbeResult) => void;
  /** 取仍然有效的测试结果；相关配置改过之后返回 null */
  resultFor: (target: ProbeTarget) => ProbeResult | null;
}

const HealthContext = createContext<HealthContextValue | null>(null);

/**
 * 连接测试结果（仅本次会话，不持久化）。
 * 刷新页面就回到「未验证」——把一次测试通过永久记下来会误导人。
 */
export function HealthProvider({ children }: { children: ReactNode }) {
  const { settings, secrets } = useSettings();
  const [records, setRecords] = useState<Partial<Record<ProbeTarget, ProbeRecord>>>({});

  const value = useMemo<HealthContextValue>(
    () => ({
      record: (target, result) =>
        setRecords((prev) => ({
          ...prev,
          [target]: { fingerprint: probeFingerprint(target, settings, secrets), result },
        })),
      resultFor: (target) => {
        const record = records[target];
        if (!record) return null;
        return record.fingerprint === probeFingerprint(target, settings, secrets)
          ? record.result
          : null;
      },
    }),
    [records, settings, secrets],
  );

  return <HealthContext.Provider value={value}>{children}</HealthContext.Provider>;
}

export function useHealth(): HealthContextValue {
  const ctx = useContext(HealthContext);
  if (!ctx) throw new Error('useHealth 必须在 HealthProvider 内使用');
  return ctx;
}
