// In production, the frontend and backend are two separate Vercel projects (different origins),
// not same-origin behind the local dev proxy — VITE_API_BASE_URL points fetches at the real
// deployed backend. Local dev leaves it unset, so relative paths keep going through
// vite.config.ts's dev-only /api proxy exactly as before.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`
}
