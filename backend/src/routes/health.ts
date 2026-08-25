import { Router } from 'express'

export const healthRouter = Router()

healthRouter.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    // Temporary diagnostic for the missing-Set-Cookie investigation — remove once resolved.
    _diag: { secure: req.secure, protocol: req.protocol, xForwardedProto: req.headers['x-forwarded-proto'], nodeEnv: process.env.NODE_ENV },
  })
})
