import type { ReactNode } from 'react';
import { cn } from '../lib/utils';
import { IconAlert, IconCheckCircle, IconInfo, IconXCircle } from './icons';

export type Tone = 'brand' | 'good' | 'warn' | 'bad' | 'neutral';

/* 粉白浅底上的深色文字/胶囊 */
const TONE_TEXT: Record<Tone, string> = {
  brand: 'text-accent-600',
  good: 'text-good-700',
  warn: 'text-warn-700',
  bad: 'text-bad-700',
  neutral: 'text-ink-900',
};

const TONE_CHIP: Record<Tone, string> = {
  brand: 'bg-accent-50 text-accent-600',
  good: 'bg-good-50 text-good-700',
  warn: 'bg-warn-50 text-warn-700',
  bad: 'bg-bad-50 text-bad-700',
  neutral: 'bg-surface-2 text-ink-500',
};

const TONE_BADGE: Record<Tone, string> = {
  brand: 'border-accent-100 bg-accent-50 text-accent-600',
  good: 'border-good-100 bg-good-50 text-good-700',
  warn: 'border-warn-100 bg-warn-50 text-warn-700',
  bad: 'border-bad-100 bg-bad-50 text-bad-700',
  neutral: 'border-line bg-surface-2 text-ink-500',
};

export function Card({
  step,
  title,
  subtitle,
  right,
  children,
  className,
  padded = true,
}: {
  step?: number;
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={cn('card', padded && 'p-5 sm:p-6', className)}>
      {(title || right) && (
        <header
          className={cn(
            'flex items-start justify-between gap-4',
            padded ? 'mb-5' : 'px-5 pt-5 sm:px-6 sm:pt-6',
          )}
        >
          <div className="min-w-0">
            {title && (
              <h2 className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight text-ink-900">
                {step === undefined ? (
                  <span
                    className="h-4 w-1 shrink-0 rounded-full bg-gradient-to-b from-accent-300 to-accent-500"
                    aria-hidden
                  />
                ) : (
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-accent-50 text-[11px] font-semibold text-accent-600 ring-1 ring-accent-100">
                    {step}
                  </span>
                )}
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-400">{subtitle}</p>
            )}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
  className,
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap backdrop-blur-md',
        TONE_BADGE[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  unit,
  hint,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="label">{label}</span>
        {icon && (
          <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg', TONE_CHIP[tone])}>
            {icon}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span
          className={cn(
            'text-[30px] font-semibold leading-none tracking-tight tabular-nums',
            TONE_TEXT[tone],
          )}
          style={tone === 'brand' ? { textShadow: '0 6px 24px rgba(236,72,153,0.28)' } : undefined}
        >
          {value}
        </span>
        {unit && <span className="text-xs font-medium text-ink-400">{unit}</span>}
      </div>
      {hint && <div className="mt-2 text-[12.5px] leading-relaxed text-ink-500">{hint}</div>}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'ghost',
  disabled,
  type = 'button',
  className,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  title?: string;
}) {
  const variantClass =
    variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : '';
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn('btn', variantClass, className)}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[12px] leading-relaxed text-ink-300">{hint}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-2"
    >
      <span
        className={cn(
          'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200',
          checked ? 'bg-accent-500' : 'bg-surface-2 ring-1 ring-line',
        )}
      >
        <span
          className={cn(
            'h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
            checked ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium leading-snug text-ink-900">{label}</span>
        {hint && <span className="mt-1 block text-[12px] leading-relaxed text-ink-400">{hint}</span>}
      </span>
    </button>
  );
}

export function ProgressBar({
  current,
  total,
  message,
}: {
  current: number;
  total: number;
  message: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 8;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[12px] text-ink-500">
        <span>{message}</span>
        <span className="font-medium tabular-nums text-ink-900">{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2 ring-1 ring-line">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent-500 to-accent-300 transition-all duration-300 ease-out"
          style={{ boxShadow: '0 0 16px rgba(236,72,153,0.55)' }}
        />
      </div>
    </div>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: 'info' | 'warn' | 'error' | 'success';
  children: ReactNode;
}) {
  const styles = {
    info: 'notice-info',
    warn: 'notice-warn',
    error: 'notice-error',
    success: 'notice-success',
  }[tone];
  const iconColor = {
    info: 'text-accent-500',
    warn: 'text-warn-500',
    error: 'text-bad-500',
    success: 'text-good-500',
  }[tone];
  const Icon = {
    info: IconInfo,
    warn: IconAlert,
    error: IconXCircle,
    success: IconCheckCircle,
  }[tone];

  return (
    <div className={cn('notice', styles)}>
      <Icon size={15} className={cn('mt-0.5 shrink-0', iconColor)} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
