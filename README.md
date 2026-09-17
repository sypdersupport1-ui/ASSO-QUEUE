# QueueFlow SaaS Platform - Phase 1 Foundation

QueueFlow is a multi-tenant restaurant SaaS platform. Phase 1 establishes the production-grade application architecture, environment configuration, error hierarchy, Supabase client separation, authorization primitives, logging, and Redis abstraction.

## Getting Started

### 1. Prerequisites
- Node.js >= 18.x
- npm >= 9.x

### 2. Environment Setup
Copy the example environment template:
```bash
cp .env.example .env.local
```

### 3. Installation
Install project dependencies:
```bash
npm install
```

### 4. Running Locally
Start the Next.js development server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

## Available NPM Scripts

- `npm run dev`: Start Next.js development server.
- `npm run build`: Compile and build production bundle.
- `npm run typecheck`: Run strict TypeScript compiler verification without emitting code.
- `npm run lint`: Execute ESLint checks.
- `npm run test`: Run Vitest unit and foundation test suite.

## Security & Architecture Summary
- **Server/Client Isolation**: Server-only files use `import 'server-only'` to prevent leaking server credentials to client bundles.
- **Supabase Clients**: Browser, Server (`@supabase/ssr`), and Admin (service-role) clients are cleanly isolated.
- **Resilient Infrastructure**: Redis operations fall back automatically to an in-memory store if `REDIS_URL` is omitted or disconnected.
- **Secret Redaction**: Structured JSON logging automatically redacts passwords, tokens, API keys, and phone numbers.
