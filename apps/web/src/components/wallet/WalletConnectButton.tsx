"use client";

import { useAccount } from "wagmi";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/Button";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "appkit-button": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        label?: string;
        size?: string;
        balance?: "show" | "hide";
      };
    }
  }
}

/**
 * Renders Reown AppKit's <appkit-button> for wallet connect/disconnect (every
 * GenLayer-compatible wallet — MetaMask, Rainbow, Zerion, WalletConnect —
 * comes for free from AppKit), plus a WitnessWeave-specific "Sign in" step:
 * connecting a wallet only proves you hold it at that instant, but a backend
 * session requires actually signing a nonce, so the two are kept distinct.
 */
export function WalletConnectButton() {
  const { isConnected } = useAccount();
  const { user, status, signIn } = useAuth();

  return (
    <div className="flex items-center gap-3">
      {isConnected && !user && (
        <Button variant="secondary" onClick={signIn} disabled={status === "signing"} className="!px-4 !py-2">
          {status === "signing" ? "Check wallet…" : "Sign in"}
        </Button>
      )}
      {/*
        balance="hide": the account button otherwise tries to fetch and
        display a GEN balance for the connected address, which spins
        forever — GenLayer StudioNet (chain 61999) isn't a chain Reown's
        balance service knows about, so that fetch never resolves.
      */}
      <appkit-button label={isConnected ? undefined : "Connect Wallet"} size="md" balance="hide" />
    </div>
  );
}
