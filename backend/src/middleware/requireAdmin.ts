import type { Request, Response, NextFunction } from 'express'

// Trusts the role cached in the session at login time rather than re-querying `users` on
// every request — a role change or deactivation takes effect on that user's next login, not
// instantly. Acceptable for this app's scope; revisit if that latency ever becomes a problem.
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    res.status(401).json({ error: 'Not authenticated.' })
    return
  }
  if (req.session.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required.' })
    return
  }
  next()
}
