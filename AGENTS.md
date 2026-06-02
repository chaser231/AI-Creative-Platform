# AI Creative Platform Agent Guide

## Project Shape

- The main app lives in `platform-app/`.
- It is a Next.js app with Prisma, Vitest, ESLint, React, and TypeScript.
- Run package commands from `platform-app/`, not from the repository root.
- The repository can have user or agent changes in progress. Do not reset, checkout, or remove unrelated work.

## Codex Cloud Setup

Use this setup command for the Codex Cloud environment:

```bash
bash .codex/cloud-setup.sh
```

The setup script creates a local placeholder `platform-app/.env` when one is missing, then runs `npm ci` and `npx prisma generate`. The placeholder file is ignored by git and is only meant to make dependency install, Prisma generation, type checks, and unit tests work in an isolated cloud checkout.

For tasks that need real provider calls, configure these as Codex Cloud environment secrets instead of committing them:

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `YANDEX_CLIENT_ID`
- `YANDEX_CLIENT_SECRET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `OPENAI_API_KEY`
- `FAL_KEY`
- `REPLICATE_API_TOKEN`

## Common Commands

```bash
cd platform-app
npm test
npm run lint
npm exec tsc -- --noEmit --pretty false
```

Targeted tests are preferred while iterating, for example:

```bash
cd platform-app
npm test -- --run src/utils/imageComposite.test.ts
```

## Working Conventions

- Keep command output small. Prefer precise `rg` patterns and targeted `sed` ranges over broad dumps.
- Avoid large `rg` results without limiting scope; broad output makes local Codex context compaction fragile.
- Add focused tests near changed code when touching shared canvas, workflow, image, or AI paths.
- Use existing helpers and store patterns before adding new abstractions.
- Do not commit `.env`, `.next`, `node_modules`, coverage, build output, or temporary files.
