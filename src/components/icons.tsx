import type { ReactNode, SVGProps } from 'react';

/**
 * 内联图标集：24×24 视框、1.7px 描边、圆头圆角，跟随 currentColor。
 * 不引入图标库，保持零依赖与一致的视觉语言。
 */
export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

function Glyph({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconUpload = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 15.5V4" />
    <path d="m7.2 8.8 4.8-4.8 4.8 4.8" />
    <path d="M4.8 14.8v3.4A1.8 1.8 0 0 0 6.6 20h10.8a1.8 1.8 0 0 0 1.8-1.8v-3.4" />
  </Glyph>
);

export const IconClock = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 7.4V12l3 2" />
  </Glyph>
);

export const IconSliders = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M4 7.5h9M19 7.5h1M4 16.5h3M13 16.5h7" />
    <circle cx="16" cy="7.5" r="2.1" />
    <circle cx="10" cy="16.5" r="2.1" />
  </Glyph>
);

export const IconDownload = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 4v11" />
    <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
    <path d="M5 19.5h14" />
  </Glyph>
);

export const IconCopy = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2.2" />
    <path d="M15 6.4A2.4 2.4 0 0 0 12.6 4H6.4A2.4 2.4 0 0 0 4 6.4v6.2A2.4 2.4 0 0 0 6.4 15" />
  </Glyph>
);

export const IconRefresh = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M20 12a8 8 0 1 1-2.4-5.7" />
    <path d="M20 4.2V9h-4.8" />
  </Glyph>
);

export const IconTrash = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M4.5 7h15" />
    <path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
    <path d="m6.8 7 .8 11.4A1.6 1.6 0 0 0 9.2 20h5.6a1.6 1.6 0 0 0 1.6-1.6L17.2 7" />
    <path d="M10.4 11v5.4M13.6 11v5.4" />
  </Glyph>
);

export const IconSpark = (p: IconProps) => (
  <Glyph {...p}>
    <path d="m12 3.8 1.7 5.5 5.5 1.7-5.5 1.7L12 18.2l-1.7-5.5L4.8 11l5.5-1.7z" />
  </Glyph>
);

export const IconArrowRight = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M5 12h13" />
    <path d="m13 6.8 5.2 5.2-5.2 5.2" />
  </Glyph>
);

export const IconSwap = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M7 8h12.2" />
    <path d="M15.8 4.6 19.2 8l-3.4 3.4" />
    <path d="M17 16H4.8" />
    <path d="M8.2 12.6 4.8 16l3.4 3.4" />
  </Glyph>
);

export const IconCheck = (p: IconProps) => (
  <Glyph {...p}>
    <path d="m5.2 12.6 4.6 4.6L18.8 7" />
  </Glyph>
);

export const IconCheckCircle = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="m8.3 12.3 2.6 2.6 4.8-5.4" />
  </Glyph>
);

export const IconInfo = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 11.2v5.2" />
    <circle cx="12" cy="8" r="0.95" fill="currentColor" stroke="none" />
  </Glyph>
);

export const IconAlert = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 4.6 3.7 19h16.6z" />
    <path d="M12 10v4" />
    <circle cx="12" cy="16.6" r="0.9" fill="currentColor" stroke="none" />
  </Glyph>
);

export const IconXCircle = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="m9.4 9.4 5.2 5.2M14.6 9.4l-5.2 5.2" />
  </Glyph>
);

export const IconActivity = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M3.5 12.5h3.2L9.2 6.4l3.6 11.2 2-5.1h5.7" />
  </Glyph>
);

export const IconShield = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 3.6 5.6 6v5.6c0 4 2.6 7.2 6.4 8.4 3.8-1.2 6.4-4.4 6.4-8.4V6z" />
  </Glyph>
);

export const IconLayers = (p: IconProps) => (
  <Glyph {...p}>
    <path d="m12 3.8 8 4.2-8 4.2-8-4.2z" />
    <path d="m4.6 13.2 7.4 3.9 7.4-3.9" />
  </Glyph>
);

export const IconHash = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M9.2 4 7.6 20M16.4 4 14.8 20" />
    <path d="M4.6 9.2h15M4 14.8h15" />
  </Glyph>
);

export const IconLineChart = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M4 19.2h16" />
    <path d="m6.2 15.2 3.9-4.6 3.3 3.2 5-6" />
  </Glyph>
);

export const IconTarget = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="8.4" />
    <circle cx="12" cy="12" r="4.4" />
    <circle cx="12" cy="12" r="0.95" fill="currentColor" stroke="none" />
  </Glyph>
);

export const IconLock = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="5" y="10.4" width="14" height="9.6" rx="2.2" />
    <path d="M8.6 10.4V8a3.4 3.4 0 0 1 6.8 0v2.4" />
  </Glyph>
);

export const IconSparkles = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M11 3.5l1.5 4.2 4.2 1.5-4.2 1.5L11 14.9 9.5 10.7 5.3 9.2l4.2-1.5z" />
    <path d="M17.8 14.2l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" />
  </Glyph>
);

export const IconPlug = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M9 3.5v5M15 3.5v5" />
    <path d="M6.5 8.5h11V11a5.5 5.5 0 0 1-11 0z" />
    <path d="M12 16.5v4" />
  </Glyph>
);

export const IconList = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M9 6.5h10M9 12h10M9 17.5h10" />
    <circle cx="5" cy="6.5" r="0.95" fill="currentColor" stroke="none" />
    <circle cx="5" cy="12" r="0.95" fill="currentColor" stroke="none" />
    <circle cx="5" cy="17.5" r="0.95" fill="currentColor" stroke="none" />
  </Glyph>
);
