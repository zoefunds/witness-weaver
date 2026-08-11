"use client";

import { useCallback, useState } from "react";
import { useAccount } from "wagmi";
import { useAppKitProvider } from "@reown/appkit/react";
import { TransactionStatus } from "genlayer-js/types";
import { CONTRACT_ADDRESS, getWriteClient, isContractConfigured } from "./genlayer-client";
import type { TxState } from "@/components/tx/TxLifecycle";

interface WriteOptions {
  functionName: string;
  args: unknown[];
  /** GEN value to send with a payable write, in wei (as a string/bigint). */
  value?: bigint;
}

interface WriteResult {
  txHash: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /429|rate limit|too many requests/i.test(message);
}

/**
 * GenLayer StudioNet enforces a shared 30 requests/minute limit. A single
 * write already costs a handful of calls (the write itself, then several
 * status polls), so this wraps any one GenLayer call with a few slow,
 * spaced-out retries specifically for 429s — everything else still fails
 * fast. This keeps an occasional burst from surfacing as a raw error to the
 * user; it does not, and can't, raise the actual ceiling.
 */
async function withRateLimitRetry<T>(fn: () => Promise<T>, onRetry?: (attempt: number) => void): Promise<T> {
  const delays = [4000, 8000, 15000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt === delays.length) throw err;
      onRetry?.(attempt + 1);
      await sleep(delays[attempt]);
    }
  }
  throw new Error("unreachable");
}

/**
 * Drives the full transaction lifecycle for a single GenLayer Intelligent
 * Contract write: wallet check -> submitted -> pending -> confirmed, or one
 * of the explicit failure states. Nothing is reported "confirmed" until
 * `waitForTransactionReceipt` actually returns a finalized/accepted status.
 *
 * Polling is deliberately slow (7s between checks, up to 10 checks — about
 * 70s of headroom) rather than the SDK's tighter default, so a single
 * pending transaction doesn't itself eat a meaningful share of the
 * network's shared rate limit while the user waits.
 */
export function useGenlayerWrite() {
  const { address, isConnected } = useAccount();
  const { walletProvider } = useAppKitProvider("eip155");
  const [state, setState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const write = useCallback(
    async (opts: WriteOptions): Promise<WriteResult | null> => {
      setErrorMessage(undefined);
      setTxHash(undefined);

      if (!isContractConfigured()) {
        setState("failed");
        setErrorMessage("The Intelligent Contract address isn't configured yet — deployment is pending.");
        return null;
      }

      setState("wallet_check");
      if (!isConnected || !address || !walletProvider) {
        setState("failed");
        setErrorMessage("Connect a GenLayer-compatible wallet first.");
        return null;
      }

      try {
        setState("preparing");
        const client = getWriteClient(walletProvider, address as `0x${string}`);

        setState("requested");
        const hash = await withRateLimitRetry(
          () =>
            client.writeContract({
              // No `account` here on purpose — it falls back to the client's
              // own `account`, which genlayer-js/viem already normalized
              // correctly when getWriteClient created it. Passing one here
              // explicitly is what caused the two earlier bugs (an
              // unnormalized string breaking `.address` lookups, then an
              // object breaking wallet-signing method routing) — the
              // client-level account is the only place this should be set.
              address: CONTRACT_ADDRESS,
              functionName: opts.functionName,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- args are call-site specific per contract function; CalldataEncodable union is narrower than our generic option type
              args: opts.args as any,
              value: opts.value ?? 0n,
            }),
          () => {
            setState("rate_limited");
            setErrorMessage("GenLayer's network is briefly busy — retrying automatically.");
          },
        );
        setTxHash(hash);
        setState("submitted");

        setState("pending");
        setErrorMessage(undefined);
        const receipt = await withRateLimitRetry(
          () =>
            client.waitForTransactionReceipt({
              hash,
              status: TransactionStatus.ACCEPTED,
              interval: 7000,
              retries: 10,
            }),
          () => {
            setState("rate_limited");
            setErrorMessage("GenLayer's network is briefly busy — still waiting on your confirmation.");
          },
        );

        if (!receipt) {
          setState("timeout");
          setErrorMessage("The transaction didn't confirm in time. Check the explorer before retrying.");
          return null;
        }

        setState("confirmed");
        return { txHash: hash };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const rejected = /user rejected|denied/i.test(message);
        const rateLimited = isRateLimitError(err);
        setState(rejected ? "rejected" : "failed");
        setErrorMessage(
          rateLimited
            ? "GenLayer's network is at capacity right now (it allows 30 requests/minute). Please wait a moment and try again."
            : message,
        );
        return null;
      }
    },
    [address, isConnected, walletProvider],
  );

  return { write, state, txHash, errorMessage, reset: () => setState("idle") };
}
