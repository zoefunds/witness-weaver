const STORAGE_KEY = "ww_session_token";

/**
 * The session token lives in localStorage and is attached explicitly as
 * `Authorization: Bearer <token>` on every API call, rather than relying on
 * the backend's session cookie. Frontend (Vercel) and backend (Fly.io) are
 * different sites, so that cookie is a third-party cookie from the
 * browser's point of view and gets silently dropped by default third-party
 * cookie blocking in current Chrome/Safari — which showed up as users
 * getting bounced back to "Sign in" while navigating between pages. A
 * token the app manages itself sidesteps that policy entirely.
 */
export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setAuthToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, token);
}

export function clearAuthToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
