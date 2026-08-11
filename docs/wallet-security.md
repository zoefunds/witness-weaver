# Wallet Security

WitnessWeave uses **external wallet authentication only**. There is no
custodial key generation, no server-side private key storage, and no
password-based accounts.

## How sign-in works

1. Connect a GenLayer-compatible wallet via Reown AppKit (`apps/web/src/components/wallet/WalletConnectButton.tsx`) — MetaMask, Rainbow, Zerion, or any WalletConnect-compatible wallet.
2. Click "Sign in". The frontend requests a one-time nonce from the backend (`POST /auth/nonce`).
3. The wallet signs a plain-text challenge message containing that nonce (`useSignMessage` from wagmi) — this is a message signature, never a transaction, and costs no gas.
4. The backend recovers the signing address from the signature (`ethers.verifyMessage`) and, only if it matches the claimed address, issues an HTTP-only session cookie (`POST /auth/verify`).

The nonce is single-use and expires after 5 minutes, preventing signature
replay.

## Threat model

- **If the Postgres database is compromised**: no private keys are exposed,
  because none are ever stored. The most sensitive data at rest is
  testimony text and evidence metadata.
- **If the backend process is compromised**: an attacker could forge
  session cookies only if they also obtain `SESSION_JWT_SECRET`; they still
  cannot move any user's funds, since every fund-moving transaction is
  signed client-side by the user's own wallet, never proxied through the
  backend.
- **If a user loses their wallet**: WitnessWeave has no recovery mechanism
  of its own — recovery is whatever the user's wallet provider supports
  (seed phrase, social recovery, etc.). This is the explicit tradeoff of
  non-custodial auth: WitnessWeave never has the ability to recover funds
  or identity on a user's behalf, which also means it never has the ability
  to lose them either.

## What WitnessWeave never does

- Never asks for or stores a password.
- Never generates a wallet on a user's behalf.
- Never stores a private key, encrypted or otherwise.
- Never signs a blockchain transaction on a user's behalf.
