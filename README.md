# WitnessWeave

**Turn real-world testimony into a living truth layer.**

A decentralized testimony marketplace: open a bounty describing a
real-world dispute, gather independent witness testimony and evidence, and
let a GenLayer Intelligent Contract reach a verifiable, validator-checked
consensus that settles the bounty on-chain.

## Structure

```
apps/web/        Next.js frontend (Vercel)
apps/api/         Fastify backend (Fly.io, always-on)
contracts/         The Intelligent Contract (GenLayer StudioNet)
docs/                Architecture, database, wallet security, GenLayer, deployment
MEMORY.md          Project decision log — read this first
```

## Local development

```bash
# 1. Database
docker compose up -d postgres

# 2. Backend
cd apps/api
cp .env.example .env
npm install
npm run migrate
npm run dev          # http://localhost:8080

# 3. Frontend (new terminal)
cd apps/web
cp .env.example .env.local
npm install
npm run dev           # http://localhost:3000
```

## Docs

- [`docs/architecture.md`](docs/architecture.md) — system overview, on-chain vs off-chain split
- [`docs/database.md`](docs/database.md) — schema
- [`docs/wallet-security.md`](docs/wallet-security.md) — auth model and threat model
- [`docs/genlayer.md`](docs/genlayer.md) — the Intelligent Contract, deployment steps
- [`docs/deployment.md`](docs/deployment.md) — full production deployment sequence
- [`MEMORY.md`](MEMORY.md) — architectural decisions and why they were made

## Status

Frontend, backend, database schema, and the Intelligent Contract are
implemented and locally verified (`genvm-lint`, `tsc`, `next build` all
pass). The contract is deployed by the project owner through GenLayer
Studio, not by automated tooling — see
[`docs/genlayer.md`](docs/genlayer.md) for the handoff steps.
