# Nexus Nook — Web App

An unofficial, fan-made Star Citizen companion. Track your fleet, manage a personal
inventory, watch server status, and manage your public RSI handle — "a nook in the wide
expanse of the Nexus."

React + Vite + TypeScript single-page app with a dark space/sci-fi theme. It works with
**zero backend** out of the box (demo mode), and can optionally talk to the real backend.

> **Unofficial.** Nexus Nook is not affiliated with or endorsed by Cloud Imperium Games.
> Star Citizen® is a registered trademark of Cloud Imperium Rights LLC. We never ask for
> an RSI password — only your **public** RSI handle, entered by you.

## Quick start

```bash
cd web
npm install
npm run dev      # http://localhost:5173
```

## Scripts

| Command         | Description                                   |
| --------------- | --------------------------------------------- |
| `npm run dev`     | Start the Vite dev server                     |
| `npm run build`   | Type-check + build production bundle to `dist/` |
| `npm run preview` | Preview the production build locally          |

- **Build output dir:** `web/dist`
- **Node:** 18+ (developed and verified on Node 22).

## Demo mode vs. API mode

The whole UI talks to one `Store` interface (`src/services/store.ts`) with two
implementations chosen at runtime by a factory:

- **Demo mode (default):** `LocalStore` keeps everything in `localStorage`. No backend, no
  real auth — "entering" just creates a local profile (display name + email + optional
  public RSI handle). Server status uses realistic sample data generated client-side. A
  **"Demo mode"** badge is shown. This makes a deployed link work for anyone instantly.
- **API mode:** when `VITE_API_URL` is set, `ApiStore` is used instead. It calls the REST
  contract in [`../docs/API.md`](../docs/API.md) (`/api/auth/*`, `/api/user/save`,
  `/api/user/load`, `/api/servers/status`) with a JWT stored in `localStorage`. Fleet,
  inventory, and the RSI handle are persisted inside the backend's `gameData` blob. The UI
  is identical either way.

## Environment variables

Copy `.env.example` to `.env.local` and fill in what you need:

| Variable              | Required | Effect                                                                 |
| --------------------- | -------- | ---------------------------------------------------------------------- |
| `VITE_API_URL`        | No       | If set, use the real backend. If unset, run in demo mode.              |
| `VITE_DISCORD_INVITE` | No       | Discord invite URL for the "Join our Discord" button. Disabled if unset. |

## Deployment (GitHub Pages)

The app is configured for GitHub Pages at base path `/Nexus-Nook/`
(`base` in `vite.config.ts`). It uses a `HashRouter`, so deep links work without any
server rewrite config. A `public/404.html` is included as a safety net.

```bash
npm run build          # outputs web/dist
# publish web/dist to the gh-pages branch (or via GitHub Actions)
```

Because the default build is demo mode (no `VITE_API_URL`), the published link is fully
functional for any visitor with no backend required.
