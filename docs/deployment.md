# Deployment

## 1. Database — Fly Postgres

```bash
fly postgres create --name witnessweave-db --region iad
fly postgres attach witnessweave-db --app witnessweave-api
```

This sets `DATABASE_URL` as a secret on the API app automatically.

## 2. Backend — Fly.io (must stay 24/7)

```bash
cd apps/api
fly launch --no-deploy   # first time only; it will detect fly.toml
fly secrets set \
  SESSION_JWT_SECRET="$(openssl rand -hex 32)" \
  CORS_ORIGINS="https://your-frontend.vercel.app" \
  GENLAYER_RPC_URL="https://studio.genlayer.com/api" \
  GENLAYER_CONTRACT_ADDRESS="0x..." \
  INTERNAL_API_SECRET="$(openssl rand -hex 32)"
fly deploy
npm run migrate   # against DATABASE_URL, e.g. via `fly ssh console` or `fly proxy`
```

`apps/api/fly.toml` is already configured for continuous uptime:
`auto_stop_machines = false`, `min_machines_running = 1`, with an HTTP
health check against `/health` that restarts the machine if it stops
responding. This satisfies the "backend must never die" requirement — Fly
keeps at least one machine running at all times and auto-restarts on health
check failure, rather than scaling to zero when idle.

## 3. Intelligent Contract — GenLayer Studio

See [`genlayer.md`](./genlayer.md) — deployed manually by the project owner
through GenLayer Studio, not by this repo's tooling. Once deployed, set the
resulting address as `GENLAYER_CONTRACT_ADDRESS` (backend) and
`NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS` (frontend).

## 4. Frontend — Vercel

```bash
cd apps/web
vercel link
vercel env add NEXT_PUBLIC_API_BASE_URL production        # https://witnessweave-api.fly.dev
vercel env add NEXT_PUBLIC_REOWN_PROJECT_ID production
vercel env add NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS production
vercel env add NEXT_PUBLIC_GENLAYER_RPC_URL production
vercel deploy --prod
```

`apps/web/vercel.json` sets the Next.js framework preset explicitly. If the
Vercel project's root directory isn't already `apps/web`, set it in the
Vercel dashboard's Project Settings → General → Root Directory.

## Order matters

Deploy in this order so each step's output feeds the next: **database →
backend → contract → frontend**. The frontend needs the backend's URL and
the deployed contract address before its first production build; the
backend needs the database URL and (for read-mirroring) the contract
address before it can serve traffic correctly.
