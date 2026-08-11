import Link from "next/link";

const ITEMS = [
  { href: "/discover", label: "Discover", icon: "🧭" },
  { href: "/bounties/new", label: "Bounties", icon: "🎖" },
  { href: "/truth-records", label: "Archives", icon: "📚" },
  { href: "/dashboard/reputation", label: "Reputation", icon: "🛡" },
];

export function SideNav({ active }: { active?: string }) {
  return (
    <aside
      className="bg-surface-container-lowest text-primary hidden lg:flex flex-col w-64 border-r border-border-subtle p-4 gap-4 sticky top-16 shrink-0"
      style={{ height: "calc(100vh - 64px)" }}
    >
      <nav className="flex flex-col gap-1 flex-1">
        {ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={
              active === item.href
                ? "flex items-center gap-3 p-3 bg-primary-container text-on-primary-container rounded-lg font-semibold text-sm"
                : "flex items-center gap-3 p-3 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors text-sm"
            }
          >
            <span aria-hidden>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className="mt-auto pt-4 border-t border-border-subtle flex flex-col gap-2">
        <Link
          href="/docs"
          className="flex items-center gap-3 p-2 text-on-surface-variant hover:text-on-surface font-mono text-[10px]"
        >
          <span aria-hidden>📖</span>
          <span>Docs</span>
        </Link>
        <Link
          href="/network-status"
          className="flex items-center gap-3 p-2 text-on-surface-variant hover:text-on-surface font-mono text-[10px]"
        >
          <span aria-hidden>📡</span>
          <span>Network Status</span>
        </Link>
      </div>
    </aside>
  );
}
