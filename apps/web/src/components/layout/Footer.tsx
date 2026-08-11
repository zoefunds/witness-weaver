import Link from "next/link";
import { LogoMark } from "@/components/ui/Logo";

const LINKS = [
  { href: "/docs", label: "Documentation" },
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/network-status", label: "Network Status" },
  { href: "/legal/terms", label: "Legal" },
];

export function Footer() {
  return (
    <footer className="w-full py-8 px-4 md:px-6 flex flex-col md:flex-row justify-between items-center gap-4 bg-surface-container-lowest border-t border-border-subtle mt-auto">
      <div className="flex items-center gap-2">
        <LogoMark size={20} />
        <span className="font-mono text-xs font-bold text-on-surface">WitnessWeave</span>
      </div>
      <div className="font-mono text-xs text-text-secondary">© 2026 WitnessWeave. Secured by GenLayer.</div>
      <nav className="flex flex-wrap justify-center gap-6">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="font-mono text-xs text-on-surface-variant hover:text-primary transition-colors duration-300"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
