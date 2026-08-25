import { Router } from 'express'

export const healthRouter = Router()

healthRouter.get('/health', (req, res) => {
  // Force a session write, the same way login does, to isolate whether Set-Cookie is missing
  // for ANY session-touching route (not specific to login's regenerate() call).
  ;(req.session as any).diagTouch = Date.now()
  res.json({
    status: 'ok',
    // Temporary diagnostic for the missing-Set-Cookie investigation — remove once resolved.
    _diag: {
      secure: req.secure,
      protocol: req.protocol,
      xForwardedProto: req.headers['x-forwarded-proto'],
      nodeEnvRaw: JSON.stringify(process.env.NODE_ENV),
      sessionSecretLen: (process.env.SESSION_SECRET || '').length,
      sessionID: req.sessionID,
      cookieName: process.env.COOKIE_NAME,
    },
  })
})
