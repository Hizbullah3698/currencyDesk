import type { Request, Response, NextFunction, RequestHandler } from 'express'

// Express 4 does not forward a rejected promise from an async route handler to the error
// middleware on its own — an uncaught rejection there just hangs the request. Every new
// business-data route is wrapped in this so a thrown AppError (see services/transact.ts) or any
// unexpected failure reaches app.ts's global error handler instead of hanging silently.
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next)
  }
}
