// Re-exports app.ts's own default export (see its comment) rather than calling createApp()
// again here — avoids constructing a second, redundant Express app instance. Vercel's Node
// runtime wraps this as a serverless function — one instance per concurrent request rather than
// the single long-lived process `src/index.ts` runs locally and on Railway/Render.
// `vercel.json`'s rewrite sends every path here, so req.url still carries the full original path
// (e.g. `/api/auth/login`) for Express's own routing to match against.
export { default } from '../src/app.js'
