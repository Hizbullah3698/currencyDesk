import type { Account, Activity, Cheque, JournalEntry } from './engine'
import type { StatementSource } from './statementDoc'

// ---------------------------------------------------------------------------
// The reference statement's data: "Statement Test Customer", 15-21 Sep 2026
// ---------------------------------------------------------------------------
//
// Rebuilt row for row from the reference PDF (`3-statement-test-customer-as-admin.pdf`), which was printed
// from the dev desk before that database was cleared — so this is the only surviving copy of the data.
// Every deal keeps its reference (the id starts with the 8 characters the PDF printed), its stored rupee
// value exactly as printed, and its order within the day. The PDF printed:
//
//   opening 0.00 · total debits 1,422,242.49 · total credits 3,014,816.16 · closing 1,592,573.67 Cr
//
// and statementDoc.test.ts checks those four figures against this data. They are the reference dataset's
// figures only; nothing else is held to them.

const AUDIT = { createdBy: 'admin', updatedBy: 'admin' }
const CUST = '1a9b1e31-0000-4000-8000-00000000c001'
const PARTNER = '7a1f2b3c-0000-4000-8000-00000000c002'

const acct = (o: Partial<Account> & Pick<Account, 'id' | 'type' | 'name'>): Account =>
  ({ notes: '', since: 'Sep 2026', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', ...AUDIT, ...o }) as Account

export const REFERENCE_CUSTOMER = acct({ id: CUST, type: 'Customer', name: 'Statement Test Customer', receivable: 0, payable: 1_592_573.67 })
const partner = acct({ id: PARTNER, type: 'Customer', name: 'Transfer Partner' })
const income = acct({ id: 'margin', type: 'Income', name: 'Exchange margin' })

type Row =
  | ['sale' | 'purchase', string, string, number, number, number] // id8, currency, amount, rate, pkrValue
  | ['receive' | 'pay', string, 'Cash' | 'Bank', number]
  | ['jv', string, 'dr' | 'cr', number, string, string?] // ref, side for this customer, amount, narration, other customer

/** One trading day as the reference printed it, top to bottom. */
function standardDay(ids: string[], tmnFirst: number, rateFirst: number, pkrFirst: number, received: number, jv: string, n: number): Row[] {
  return [
    ['sale', ids[0], 'TMN', tmnFirst, rateFirst, pkrFirst],
    ['receive', ids[1], 'Cash', received],
    ['sale', ids[2], 'AED', 20, 79, 1_580],
    ['purchase', ids[3], 'TMN', 150_000_000, 788, 190_355.33],
    ['sale', ids[4], 'TMN', 40_000_000, 789, 50_697.08],
    ['pay', ids[5], 'Cash', 50_000],
    ['jv', jv, 'dr', 1_500, `Service charge day ${n}`],
    ['sale', ids[6], 'TMN', 30_000_000, 791, 37_926.68],
    ['receive', ids[7], 'Bank', 75_000],
    ['purchase', ids[8], 'AED', 15, 78, 1_170],
    ['sale', ids[9], 'TMN', 25_000_000, 787, 31_766.2],
  ]
}

const DAYS: [string, Row[]][] = [
  ['2026-09-15', standardDay(['39f97e19', '5c55e1e4', 'da3939df', 'b5da62b7', '598e49f9', '38bef58e', '2de7be04', '07400a07', '0a8d59ca', '510a4262'], 60_000_000, 790, 75_949.37, 75_949, 'JV-022', 1)],
  ['2026-09-16', standardDay(['ebc97438', '98926e26', '06ef3a38', 'ac04035e', '327b0816', '575ec4f8', '3c95abaa', '74f27235', '3987a877', 'aedf26b7'], 70_000_000, 791, 88_495.58, 100_000, 'JV-038', 2)],
  [
    '2026-09-17',
    [
      ...standardDay(['bbe8be90', '538144ea', 'a10b6630', 'f37d9522', 'a2b148b7', '323cd205', '63c14265', '5312d93f', 'ffc1ff00', '1fbc654e'], 80_000_000, 792, 101_010.1, 100_000, 'JV-054', 3),
      ['purchase', '4677c657', 'TMN', 900_000_000, 790, 1_139_240.51],
      ['jv', 'JV-062', 'cr', 2_000, 'Rebate allowed'],
      ['pay', '080679cb', 'Bank', 30_000],
    ],
  ],
  [
    '2026-09-18',
    [
      ...standardDay(['296a14e5', '55b2af5e', '528cb53f', '1fe80371', '237ead89', '20009b12', '2827180e', 'f720bc48', '8841105e', '51f28776'], 90_000_000, 793, 113_493.06, 100_000, 'JV-073', 4),
      ['jv', 'JV-080', 'dr', 20_000, 'Transfer from Statement Test Customer to Transfer Partner', 'partner'],
      ['jv', 'JV-081', 'cr', 5_000, 'Transfer from Transfer Partner to Statement Test Customer', 'partner'],
    ],
  ],
  ['2026-09-19', standardDay(['2bfdb4f7', '30723a68', 'c662eecc', '2f482607', '425291ed', '13a30d05', '9dbc732b', 'f8f84235', '5cee599c', '93d76c77'], 100_000_000, 794, 125_944.58, 100_000, 'JV-091', 5)],
]

export function referenceStatementSource(): StatementSource {
  const activity: Activity[] = []
  const journalEntries: JournalEntry[] = []
  let seq = 0
  for (const [day, rows] of DAYS) {
    rows.forEach((row, i) => {
      const createdAt = `${day}T${String(4 + Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')}:00.000Z`
      const base = { customerId: CUST, customerName: REFERENCE_CUSTOMER.name, txnDate: day, createdAt, updatedAt: createdAt, ...AUDIT }
      const id = (id8: string) => `${id8}-0000-4000-8000-${String(++seq).padStart(12, '0')}`
      if (row[0] === 'sale' || row[0] === 'purchase') {
        const [type, id8, currency, amount, rate, pkrValue] = row
        activity.push({ ...base, id: id(id8), type, currency, amount, rate, pkrValue, method: 'Credit' } as Activity)
      } else if (row[0] === 'receive' || row[0] === 'pay') {
        const [type, id8, method, amount] = row
        activity.push({ ...base, id: id(id8), type, amount, pkrValue: amount, method } as Activity)
      } else {
        const [, ref, side, amount, narration, other] = row
        const otherId = other ? PARTNER : income.id
        const otherName = other ? partner.name : income.name
        journalEntries.push({
          id: id('e0000000'.slice(0, 8)),
          ref,
          narration,
          debitAccount: side === 'dr' ? CUST : otherId,
          creditAccount: side === 'dr' ? otherId : CUST,
          debitLabel: side === 'dr' ? REFERENCE_CUSTOMER.name : otherName,
          creditLabel: side === 'dr' ? otherName : REFERENCE_CUSTOMER.name,
          amount,
          txnDate: day,
          createdAt,
          updatedAt: createdAt,
          ...AUDIT,
        } as JournalEntry)
      }
    })
  }

  const cheque = (o: Partial<Cheque> & Pick<Cheque, 'id' | 'direction' | 'number' | 'bank' | 'amount' | 'due' | 'status'>): Cheque =>
    ({ party: REFERENCE_CUSTOMER.name, customerId: CUST, bankAccountId: 'bank1', ledgerApplied: false, history: [], createdAt: '2026-09-15T03:00:00.000Z', updatedAt: '2026-09-15T03:00:00.000Z', ...AUDIT, ...o }) as Cheque
  const cheques = [
    cheque({ id: '53680532-0000-4000-8000-0000000000c1', direction: 'Inward', number: 'CLR-4471', bank: 'Meezan Bank', amount: 60_000, due: '2026-09-20', status: 'Cleared', ledgerApplied: true, updatedAt: '2026-09-21T06:00:00.000Z' }),
    cheque({ id: '0f0e0d0c-0000-4000-8000-0000000000c2', direction: 'Outward', number: 'OUT-991', bank: 'UBL', amount: 30_000, due: '2026-09-28', status: 'Deposited' }),
    cheque({ id: '0a0b0c0d-0000-4000-8000-0000000000c3', direction: 'Inward', number: 'IN-778', bank: 'HBL', amount: 45_000, due: '2026-10-05', status: 'Pending' }),
  ]

  return { customer: REFERENCE_CUSTOMER, accounts: [REFERENCE_CUSTOMER, partner, income], activity, cheques, journalEntries }
}

/** The reference was printed for 15-21 Sep 2026, at 19:34 on the 21st. */
export const REFERENCE_OPTIONS = { from: '2026-09-15', to: '2026-09-21', now: new Date(2026, 8, 21, 19, 34) }

// ---------------------------------------------------------------------------
// The one-transaction baseline: "Dubai Tmn Buyer", a single TMN sale
// ---------------------------------------------------------------------------
//
// The latest PDF the owner reviewed showed one deal: 3,000,000,000 TMN at 788 TMN per PKR, which is
// 3,807,106.60 (the client's own third ledger line). Opening 0.00, debits 3,807,106.60, credits 0.00,
// closing 3,807,106.60 Dr. Fixture values only.

const DUBAI = '5c9ab663-ea1e-4196-85db-a1c4503bd44e'
export const DUBAI_CUSTOMER = acct({ id: DUBAI, type: 'Customer', name: 'Dubai Tmn Buyer', receivable: 3_807_106.6, payable: 0 })

export function dubaiOneTransactionSource(): StatementSource {
  const sale = {
    id: 'a3f39cc7-0000-4000-8000-000000000002',
    type: 'sale',
    currency: 'TMN',
    customerId: DUBAI,
    customerName: DUBAI_CUSTOMER.name,
    amount: 3_000_000_000,
    rate: 788,
    pkrValue: 3_807_106.6,
    method: 'Credit',
    txnDate: '2026-09-19',
    createdAt: '2026-09-19T07:00:00.000Z',
    updatedAt: '2026-09-19T07:00:00.000Z',
    ...AUDIT,
  } as Activity
  return { customer: DUBAI_CUSTOMER, accounts: [DUBAI_CUSTOMER], activity: [sale], cheques: [], journalEntries: [] }
}
