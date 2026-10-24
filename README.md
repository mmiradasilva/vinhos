# Cellar

A wine-collection tracker, built spec-first. The specs in [`specs/`](specs/) are the source of truth:

| Spec | Status |
|---|---|
| [Sign in with Google](specs/sign-in-with-google.md) | Implemented |
| [Add a wine](specs/add-wine.md) | Implemented |
| [View collection](specs/view-collection.md) | Implemented |
| [View / edit wine](specs/view-edit-wine.md) | Implemented |

## Deploy

See **[DEPLOY.md](DEPLOY.md)** — Render (web service + PostgreSQL, from [`render.yaml`](render.yaml)), Google sign-in setup, and the pre-launch checklist.

Production locally: `npm run build`, then run `npm start` with `NODE_ENV=production` and the variables from `.env.example`; the API serves the built app on one port.

## Run it locally

Requires Node.js 24+.

```bash
npm install
```

Terminal 1 — the database (embedded PostgreSQL; data in `.data/postgres`):

```bash
npm run db
```

Terminal 2 — API (port 3000) and web app (port 5173):

```bash
npm run dev
```

Open http://localhost:5173. Without Google credentials, "Sign in with Google" goes to a **development sign-in page** that stands in for Google (never available in production).

### Real Google sign-in (development)

1. In Google Cloud Console, create an OAuth client of type *Web application* with the redirect URI `http://localhost:5173/api/v1/auth/google/callback`.
2. Copy `.env.example` to `.env` and fill in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
3. Restart `npm run dev`.

## Tests

```bash
npm test
```

Starts a throwaway PostgreSQL, then runs the shared validation tests and the API tests. Each acceptance criterion is a test named after it (e.g. `AC-5: a duplicate in different case is blocked…`).

### Browser tests (Playwright)

```bash
npm run test:e2e
```

Runs in a phone-sized Chromium against its own isolated stack (throwaway PostgreSQL, API on port 3100, web app on 5273), so it never touches your development data. Covers the UI-only acceptance criteria: keyboard-only use, linked and focused error messages, phone keyboards, the 360 px layout, "More details" opening on errors, the draft surviving an expired session, the unsaved-changes prompt, loading more wines, URL-based filters, and an axe-core WCAG 2.1 AA scan of every screen.

First time only, download the browser:

```bash
npx playwright install chromium
```

Not automated: a real screen reader (axe and the ARIA checks cover the markup, not the spoken output) and real Google sign-in.

## Layout

```
packages/shared   Validation rules, drink status, return-path check — used by API and web
apps/api          Fastify API, migrations, seeds, tests
apps/web          React single-page app (Vite)
specs/            The specs
```
