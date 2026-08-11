import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { WalletConnectButton } from "@/components/wallet/WalletConnectButton";

const NAV_LINKS = [
  { href: "/discover", label: "Discover" },
  { href: "/bounties/new", label: "Create Bounty" },
  { href: "/dashboard/testimonies", label: "My Testimonies" },
];

export function TopNav({ active }: { active?: string }) {
  return (
    <header className="flex justify-between items-center px-4 md:px-6 w-full h-16 sticky top-0 z-50 bg-surface/80 backdrop-blur-md border-b border-border-subtle">
      <div className="flex items-center gap-8">
        <Logo />
        <nav className="hidden md:flex items-center gap-2">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={
                active === link.href
                  ? "text-primary border-b-2 border-primary pb-1 px-2 py-1 font-mono text-xs tracking-wide"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors duration-200 px-2 py-1.5 rounded font-mono text-xs tracking-wide"
              }
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-4">
        <WalletConnectButton />
      </div>
    </header>
  );
}
