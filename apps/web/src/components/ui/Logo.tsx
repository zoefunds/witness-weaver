import Link from "next/link";

/** The woven-W mark, matching app/icon.tsx, used inline in the nav/footer. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded bg-primary-container shrink-0"
      style={{ width: size, height: size }}
    >
      <svg width={size * 0.68} height={size * 0.68} viewBox="0 0 24 24" fill="none">
        <path
          d="M3 6 L8 18 L12 9 L16 18 L21 6"
          stroke="#dad7ff"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <circle cx="12" cy="9" r="1.6" fill="#4edea3" />
      </svg>
    </div>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 group">
      <LogoMark />
      <span className="font-[family-name:var(--font-geist-sans)] text-[22px] font-bold tracking-tighter text-primary group-hover:opacity-90 transition-opacity">
        WitnessWeave
      </span>
    </Link>
  );
}
