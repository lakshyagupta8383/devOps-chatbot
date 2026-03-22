# OnCall Mentor

OnCall Mentor is an incident-response training chatbot. It generates a hidden
DevOps production incident, guides a junior engineer through debugging, and
evaluates the final diagnosis against the scenario's correct solution.

## Product Scope

- Topic: DevOps incident response and production debugging
- Knowledge base: runbook-style snippets in [`lib/knowledge-base.ts`](lib/knowledge-base.ts)
- Scenario engine: randomized incident JSON generation in
  [`lib/generateRandomIncident.ts`](lib/generateRandomIncident.ts)
- Chat behavior:
  - grounded logs/metrics from scenario JSON only
  - root cause not revealed directly
  - hypothesis-driven guidance
- Evaluation:
  - verdict (`correct`, `partially correct`, `incorrect`)
  - score (0-10)
  - explanation + missed points

## Tech Stack

- Next.js 16 (App Router)
- Tailwind CSS (v4 via `@import "tailwindcss"`)
- Gemini API (chat, evaluation, incident generation)

## Local Setup

1. Install dependencies

```bash
npm install
```

2. Create `.env.local`

```bash
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.0-flash
GEMINI_CHAT_MODEL=gemini-2.0-flash
GEMINI_EVAL_MODEL=gemini-2.0-flash
GEMINI_INCIDENT_MODEL=gemini-2.0-flash
```

3. Start development server

```bash
npm run dev
```

4. Open `http://localhost:3000`

## API Routes

- `GET /api/incidents/random`: generates (or falls back to) one incident scenario
- `POST /api/chat`: senior DevOps guidance using incident + conversation context
- `POST /api/evaluate`: evaluates user's diagnosis against correct solution

## Deployment (Vercel)

1. Push repository to GitHub
2. Import project into Vercel
3. Add environment variables from `.env.local`
4. Deploy

Use Vercel production logs to monitor model errors and fallback usage.
