import { Router } from 'express'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { handleMutation } from '../services/transact.js'
import { accrueSalary, accrueAllSalaries, paySalary, payAllSalaries } from '../services/salaryService.js'

export const salaryRouter = Router()

salaryRouter.post(
  '/accrue',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    await handleMutation(res, req, (client) => accrueSalary(client, String(b.employeeId ?? ''), String(b.period ?? ''), req.session.userId ?? null))
  }),
)

salaryRouter.post(
  '/accrue-all',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    await handleMutation(res, req, (client) => accrueAllSalaries(client, String(b.period ?? ''), req.session.userId ?? null))
  }),
)

salaryRouter.post(
  '/pay',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    await handleMutation(res, req, (client) => paySalary(client, String(b.employeeId ?? ''), String(b.bankId ?? ''), req.session.userId ?? null))
  }),
)

salaryRouter.post(
  '/pay-all',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    await handleMutation(res, req, (client) => payAllSalaries(client, String(b.bankId ?? ''), req.session.userId ?? null))
  }),
)
