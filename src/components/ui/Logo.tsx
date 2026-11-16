/**
 * mixr-Logo: ein Strudel (Spirale) auf warmem Verlauf.
 * Wird sowohl im SSR-Fallback (statisch) als auch in der Topbar-Insel genutzt.
 */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      <defs>
        <linearGradient id="smx-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffb36b" />
          <stop offset="1" stopColor="#ff5f6d" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#smx-logo-g)" />
      <path
        d="M13.5 16a2.5 2.5 0 0 1 5 0a5 5 0 0 1-10 0a7.5 7.5 0 0 1 15 0"
        fill="none"
        stroke="#1b0c03"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LogoWordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="hidden text-[15px] font-semibold tracking-tight text-accent sm:inline">
        mixr
      </span>
    </span>
  );
}
