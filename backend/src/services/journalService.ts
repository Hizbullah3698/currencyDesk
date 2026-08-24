import type { PoolClient } from 'pg'
import { appError } from './transact.js'
import { getAccount } from './accountHelpers.js'

export interface JournalInput {
  debitAccount: string
  debitAmount: number
  creditAccount: string
  creditAmount: number
  narration: string
}

export async function postJournal(client: PoolClient, input: JournalInput, actorId: string | null): Promise<void> {
  if (!input.debitAccount || !input.creditAccount) throw appError(400, 'Select an account on both the debit and the credit line.')
  if (input.debitAccount === input.creditAccount) {
    const a = await getAccount(client, input.debitAccount)
    throw appError(400, `A journal entry can't debit and credit the same account${a ? ' (' + a.name + ')' : ''}.`)
  }
  if (input.debitAmount <= 0 || input.creditAmount <= 0) throw appError(400, 'Enter a debit and a credit amount greater than 0.')
  if (input.debitAmount !== input.creditAmount) throw appError(400, 'Entry is out of balance — total debit and total credit must match.')

  // Sequential, not Promise.all — a single client can only run one query at a time; see the
  // matching note in stateService.ts.
  const debitAcc = await getAccount(client, input.debitAccount)
  const creditAcc = await getAccount(client, input.creditAccount)
  if (!debitAcc || !creditAcc) throw appError(400, 'Select a valid account on both the debit and the credit line.')

  await client.query(
    `INSERT INTO journal_entries (narration, debit_account, credit_account, debit_label, credit_label, amount, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
    [input.narration.trim() || 'Journal entry', input.debitAccount, input.creditAccount, debitAcc.name, creditAcc.name, input.debitAmount, actorId],
  )
}
