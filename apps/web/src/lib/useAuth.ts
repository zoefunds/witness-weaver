"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { api, ApiError } from "./api";

export interface AuthUser {
  id: string;
  wallet_address: string;
  display_name: string | null;
  avatar_url: string | null;
}

/**
 * Sign-in-with-wallet: request a one-time nonce, have the connected wallet
 * sign the exact challenge message, then exchange the signature for a
 * backend session cookie. No password, no custodial key — the wallet IS the
 * identity, matching WitnessWeave's external-wallet-only auth decision.
 */
export function useAuth() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<"idle" | "signing" | "authenticated" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.get<{ user: AuthUser }>("/auth/me");
      setUser(user);
      setStatus("authenticated");
    } catch {
      setUser(null);
      setStatus("idle");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signIn = useCallback(async () => {
    if (!address) return;
    setStatus("signing");
    setError(null);
    try {
      const { message } = await api.post<{ message: string }>("/auth/nonce", { address });
      const signature = await signMessageAsync({ message });
      const { user } = await api.post<{ user: AuthUser }>("/auth/verify", { address, signature });
      setUser(user);
      setStatus("authenticated");
    } catch (err) {
      setStatus("error");
      setError(err instanceof ApiError ? "Sign-in was rejected by the server." : "Sign-in was cancelled or failed.");
    }
  }, [address, signMessageAsync]);

  const signOut = useCallback(async () => {
    await api.post("/auth/logout").catch(() => undefined);
    setUser(null);
    setStatus("idle");
  }, []);

  return { user, status, error, isConnected, signIn, signOut, refresh };
}
