import { Router } from 'express'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { handleMutation } from '../services/transact.js'
import { createAccount, updateAccount, deleteAccount, archiveAccount, unarchiveAccount, type AccountForm } from '../services/accountsService.js'

export const accountsRouter = Router()

function parseAccountForm(body: unknown): AccountForm {
  const b = (body ?? {}) as Record<string, unknown>
  return {
    type: b.type as AccountForm['type'],
    name: String(b.name ?? ''),
    phone: String(b.phone ?? ''),
    city: String(b.city ?? ''),
    notes: String(b.notes ?? ''),
    bankName: String(b.bankName ?? ''),
    accountNo: String(b.accountNo ?? ''),
    category: String(b.category ?? ''),
    designation: String(b.designation ?? ''),
    monthlySalary: String(b.monthlySalary ?? ''),
    code: String(b.code ?? ''),
    opening: String(b.opening ?? ''),
    typeOverride: Boolean(b.typeOverride),
  }
}

// Accounts create/edit/archive/delete are Admin-only in the existing UI (Accounts.tsx blocks
// non-admins outright) — enforced server-side here as a deliberate, confirmed addition, not an
// assumption; see CLAUDE.md's "Authentication" section for the decision record.
accountsRouter.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const form = parseAccountForm(req.body)
    await handleMutation(res, (client) => createAccount(client, form, req.session.userId ?? null).then(() => undefined))
  }),
)

accountsRouter.patch(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const form = parseAccountForm(req.body)
    await handleMutation(res, (client) => updateAccount(client, req.params.id, form, req.session.userId ?? null))
  }),
)

accountsRouter.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await handleMutation(res, (client) => deleteAccount(client, req.params.id))
  }),
)

accountsRouter.post(
  '/:id/archive',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await handleMutation(res, (client) => archiveAccount(client, req.params.id, req.session.userId ?? null))
  }),
)

accountsRouter.post(
  '/:id/unarchive',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await handleMutation(res, (client) => unarchiveAccount(client, req.params.id))
  }),
)
