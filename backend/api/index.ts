import { createApp } from '../src/app.js'

// Vercel's Node runtime wraps this default export as a serverless function — one instance per
// concurrent request rather than the single long-lived process `src/index.ts` runs locally and
// on Railway/Render. `createApp()` itself has no side effects tied to a persistent process (see
// its own comments), so the same Express app works unmodified in either model; only the entry
// point differs. `vercel.json`'s rewrite sends every path here, so req.url still carries the
// full original path (e.g. `/api/auth/login`) for Express's own routing to match against.
export default createApp()
