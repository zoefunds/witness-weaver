"use client";

import { useEffect, useState } from "react";

/**
 * Date.toLocaleString() resolves "the local timezone" from whatever
 * process is running it. Called from a Server Component, that's Vercel's
 * serverless function (UTC), not the visitor's browser — so a page that
 * looked timezone-aware in code was actually showing every visitor the
 * same UTC time regardless of where they are. Rendering this bit
 * client-side (after mount, to avoid a server/client hydration mismatch)
 * is the only way to get the browser's actual local timezone.
 */
export function LocalDateTime({ epochSeconds, iso }: { epochSeconds?: number; iso?: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const date = epochSeconds !== undefined ? new Date(epochSeconds * 1000) : new Date(iso!);
    setText(date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
  }, [epochSeconds, iso]);

  // Renders nothing meaningful until mounted — a blank/placeholder beats
  // briefly flashing the wrong (UTC) time before the client-side value
  // replaces it.
  return <>{text ?? "…"}</>;
}
