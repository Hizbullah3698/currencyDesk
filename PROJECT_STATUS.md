# Currency Desk — Project Status

A living document. Part 1 changes rarely, Part 2 whenever a requirement moves, Part 3 grows by one
entry every working session. Updated at the end of each session.

---

# Part 1 — What the system is

*Plain-language overview for a non-technical reader. Update only when the architecture genuinely
changes.*

## What the software does

Currency Desk runs the day-to-day operation of a currency-exchange counter. It handles:

- **Buying and selling foreign currency** against a named customer, working out the rate, the
  rupee value and the profit on each deal automatically.
- **Customer accounts** — a running record of who owes the desk money and who the desk owes,
  updated by every trade, payment and cleared cheque.
- **Cheques** — inward and outward, tracked through their full life (received → deposited →
  cleared or returned). A customer's balance only moves when a cheque actually clears, not when
  it is handed over.
- **Payroll** — salary owed per employee per month, and payments made against it, kept separate
  so what is owed and what has been paid never blur together.
- **Manual accounting entries** for anything that isn't a standard trade or payment.
- **Reports** — a searchable transaction history, a balance sheet, and a profit-and-loss
  statement. All of them print cleanly for filing.

## How it is put together

Three parts, each with a distinct job:

| Part | What it is | What it does |
|---|---|---|
| **The screen** | The web application staff use in a browser | Everything people see and click. Holds no records of its own. |
| **The server** | The system behind the screen | Owns every record. Decides what is allowed. The single source of truth. |
| **The calculator** | Shared accounting logic | The actual arithmetic — cost of stock, profit on a sale, customer balances. |

The third part matters more than it sounds. The accounting arithmetic is written **once** and used
by both the screen and the server. They cannot drift apart and start disagreeing about what a
number should be, because there is only one copy of the rules.

## How information moves

The screen holds nothing permanently. Every time it loads, and every time someone records
something, it asks the server for a **complete fresh picture** of the business and displays that.

This is a deliberate choice. When a dealer records a purchase, the screen does not calculate the
result and show it optimistically — it waits for the server to confirm what actually happened, and
shows that. Nothing appears on screen that hasn't been written to the database. If a save fails,
the previous figures stay on screen untouched rather than being replaced by a guess.

The screen refreshes its picture whenever a user moves between pages. So if two people are working
at once, each sees the other's work as they navigate. Information is never more than one page-move
out of date.

## Where it runs

Everything is hosted on **Vercel**, as two separate deployments, with the database hosted
separately on **Neon**.

| | Address | Purpose |
|---|---|---|
| **Live screen** | `currency-desk.vercel.app` | What staff use |
| **Live server** | `currency-desk-backend-jf1x.vercel.app` | Handles the live data |
| **Test copies** | *None — switched off 2026-09-03* | See below |

Only work merged into the main line of development reaches the live addresses, and merging is what
releases it — there is no separate "publish" step.

**Test copies used to be able to write to the real books, and no longer can.** Until 2026-09-03 the
hosting automatically built a temporary copy of the software for any branch of work in progress.
Those copies were not as separate as the name suggests — there were two distinct ways a person
looking at one could change real customer records:

- The temporary **server** copy was handed the live database's own address, so it could read and
  write the real books directly.
- The temporary **screen** copy was pointed at the **live** server. So opening a test address to
  look at a screen change was not previewing anything — it was operating the real system on real
  data, through software nobody had reviewed. This was the likelier of the two accidents, because
  clicking a test link feels harmless.

Both are now closed, in two independent ways:

1. **Temporary copies are no longer built at all.** The hosting is set to build only the live line
   of work. A branch still registers as an attempted deployment, but it is cancelled before
   anything is built and its address serves nothing.
2. **The server refuses to start as a test copy** unless someone has explicitly declared its
   database separate from the live one. This second guard exists because the first is a setting in
   a hosting dashboard — one click from being switched back on by someone who does not know this
   history. A setting does not survive the person who made it; code does.

Verified on 2026-09-03 by pushing a throwaway branch: both projects recorded the attempt, cancelled
it without building, and served nothing at the resulting addresses.

## The database

A single PostgreSQL database hosted by Neon (Frankfurt region), holding customers, trades,
cheques, accounting entries, employees, currency stock and user logins.

Structural changes to the database (adding a new field, for example) are **not** applied
automatically when new software is released. They are applied deliberately, by hand, and must be
done **before** the software that depends on them goes live. Getting that order wrong takes the
desk down — see the 2026-08-31 entry in Part 3 for a case where this was caught in advance.

## Money and accounting

**Currencies.** The desk trades six against Pakistani Rupees: **EUR (Euro), USD (US Dollar), AED
(UAE Dirham), AFN (Afghan Afghani), JPY (Japanese Yen) and IRR (Iranian Rial)** — listed
strongest-to-weakest, which is the order they appear in when choosing one.

These are not quoted the same way, and the system respects that rather than forcing one format:

- Five of the six are worth *more* than a rupee, so a dealer quotes them as **"rupees per 1
  unit"** — e.g. 77 PKR per 1 AED — and the system multiplies. That holds even for the yen, the
  weakest of them at roughly 1.9 rupees.
- IRR is worth far *less* than a rupee (one rupee buys roughly 4,950 rials). Quoting it as "rupees
  per 1 rial" would mean typing 0.0002 into a rate box, which no dealer does. It is quoted the
  other way round — **"rials per 1 rupee"** — and the system divides.

Each rate box states which format it expects, so the dealer never has to guess. Behind the scenes
every figure is converted to one common measure, so profit and stock valuation are always
calculated consistently no matter which currency or format was used.

**Cost and profit.** Currency stock is valued at **weighted-average cost**. When currency is
bought at different rates over time, the system blends them into a single average cost per unit.
Profit on a sale is measured against that real blended cost, not against the day's rate — so the
profit figure reflects what the stock actually cost the desk.

**Transaction dates.** Every trade and payment records **the day the deal was struck**, kept
separate from the day it was typed into the system. A deal entered on Monday for business done on
Friday is reported in Friday's figures. Future dates are refused.

**Double-entry.** Every movement is recorded with both of its sides, so the books balance. The
balance sheet reports honestly whether debits and credits actually agree — see the 2026-08-31
entry for a case where this reporting was previously misleading and has been fixed.

## Who can do what

Two roles:

- **Admin** — full access.
- **Operator** — can trade, take and make payments, and deposit cheques. Cannot reach payroll,
  manual accounting entries, the financial reports, or the desk's own cost and profit figures.

That restriction is enforced by the **server**, not merely hidden on screen. An operator's
software genuinely does not receive the profit figures, rather than receiving them and declining
to display them.

Staff sign in with a username or an email address and a password. There is no self-service
sign-up; accounts are created deliberately by an administrator.

A terminal left untouched signs itself out — five minutes by default, changeable by an
administrator on the Settings page. A warning appears thirty seconds beforehand with the chance to
stay signed in. This is enforced by the server as well as the screen, so it cannot be sidestepped
by a browser with scripting turned off.

---

# Part 2 — Client requirements

*Status of each point the client raised. Update whenever a status changes.*

All eight points are now recorded. Each status below was checked against the actual software on
2026-08-31, not assumed.

**Summary: 7 of the 8 delivered. Requirement 7 (a true double-entry journal) is under way — the recording half is built and tested but deliberately not released, and the reports have not been switched over to it yet. See below.**

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | **A date on every entry** | ✅ **Done** | All four transaction screens (buy, sell, receive, pay) carry a date picker for the day the deal was struck, kept separate from when it was typed in. Reports are cut on that date. Verified live in production: a purchase recorded and correctly dated "Aug 31, 2026". Previously this worked on the two trade screens but was silently missing on the two payment screens. |
| 2 | **Full currency list** — AED, USD, EUR, IRR, AFN, JPY | ✅ **Done — all 6 live** | All six are live in production: AED, USD, EUR, IRR, AFN, JPY. Each has its own correct quoting convention and is carried separately on the balance sheet at its own cost, so no two currencies share a position. Verified in production after release — six stock positions, six separate stock accounts, and every currency present in the software actually being served to staff. Each new currency's arithmetic was checked against a real conversion (e.g. 1,000 USD at 282.50 storing 282,500 PKR), confirmed against the figure the database actually holds rather than the screen appearing to accept it. |
| 3 | **Auto-logout after inactivity** | ✅ **Done** | A terminal left untouched signs itself out, defaulting to 5 minutes. Thirty seconds beforehand a warning counts down with a "Stay logged in" button, so an active user is never cut off without notice. Enforced in **two independent places**: the screen runs the countdown, and the session itself expires on the server after the same period — so a machine with the browser's scripting disabled, or someone replaying a copied session from another computer, is cut off just the same. On timeout the session is genuinely ended, not merely hidden behind a locked screen. The period is an **admin setting** on the new Settings page, from 1 minute to 8 hours, applying to everyone. Verified in production. |
| 4 | **Ledger export** | ✅ **Done** | A Customer Ledger section opens on a searchable customer list showing name and balances only — no transaction detail at that level. Choosing a customer opens their statement: every transaction with a running balance, plus **Print**, **Export PDF** and **Export Excel**. A date range narrows all three identically, defaulting to full history. Where a customer has traded in more than one currency the running totals are kept **separate per currency**, because adding units of two different currencies produces a figure that means nothing. Verified against a real two-currency customer, not only a single-currency one. Export PDF uses the browser's print dialog rather than generating a file — see the note in Part 3. |
| 5 | **Buy screen: choose currency, customer and date** | ✅ **Done** | All three controls are on the Buy Currency form: a customer picker, a currency picker listing every traded currency by name, and a date picker defaulting to today. Verified live in production — the 2026-08-31 purchase recorded currency AED, customer "Wazir", and date Aug 31 2026, all three chosen on the form. |
| 6 | **Payment-method confidentiality on the buy flow** | ✅ **Done** | The buy screen shows no cash/bank/cheque option at all. The settlement-method buttons, the bank-account picker, the cheque sub-form and the "amount paid now" field have all been removed from the screen, and every trade is recorded on account (as a payable to the customer). How the customer was actually paid is not captured or displayed anywhere in that flow. **The client asked for this to be reversible, and it is:** nothing was deleted — the controls are retained in place, disabled, with a written step-by-step restore procedure. The server still supports all four payment methods untouched, so bringing the option back is a screen-only change. |
| 7 | **Correct Dr/Cr accounting throughout** | 🔶 **In progress — built, not released** | **The client has decided: they want traceable, auditable records per transaction — a real double-entry journal entry for every trade and payment, not merely correct report totals.** This question is settled; do not re-open it. <br><br>*What exists today:* balances are correct, and the balance sheet honestly reports whether debits and credits agree (it previously forced agreement and always claimed success — fixed 2026-08-31). Salary, manual entries and opening balances each create true paired records. <br><br>*Progress 2026-09-03:* trades, receipts, payments and cheque clearing now DO write paired entries, grouped per deal — built, tested and reviewed, but **not released and not switched on**. <br><br>*What remains:* deals recorded before 2026-09-03 have no paired entries yet, and the reports still work each figure out the old way. Until both are done the requirement is not met. A checking tool compares the two pictures and currently reports them apart by exactly the pre-2026-09-03 history; it reaching agreement is the definition of done. <br><br>*Sequencing:* **gated behind completion of the CSRF rollout** — stage 2 shipped 2026-08-31, so only stage 3 (enforcement on) now stands in front of it. Not to be started while that security work is half-finished. <br><br>*Confirmed 2026-09-02:* the client placed this **ahead of the corrections/reversals feature**, so that correction logic is not written twice when this changes the underlying shape. It is therefore the next concrete piece of work once stage 3 lands. <br><br>*Release gate:* unchanged and now binding — this work writes to the books, so it must not be released until the security rollout's last step is settled, which cannot happen while the system sits idle. This is the largest remaining piece of work in the project. |
| 8 | **Customer records show the actual currency and amount** | ✅ **Done** — *after a correction; see note* | Every screen showing a customer's transactions now leads with the currency actually dealt — "1,000 AED" — with the rupee equivalent underneath in smaller, lighter type. Fixed on the customer record, the dashboard's recent activity, the full transaction log, and the currency stock page; the Customer Ledger was already correct. Receipts and payments genuinely move rupees, so they still read in rupees with no invented conversion. Verified against a customer trading four currencies at once, each keeping its own. The customer's **overall balance** remains in rupees, which is correct — they owe rupees, not dirhams; it is the individual transactions that must name their real currency. |

> **Correction, recorded rather than quietly fixed.** This requirement was assessed earlier the same
> day and marked done, on the grounds that the customer record displayed "1,000 AED @ 77.00"
> somewhere on the row. That was too lenient: it confirmed the currency *appeared*, not that it was
> the figure being led with — while the bold, right-aligned amount, the one a reader takes as *the*
> number, still said PKR. The client was right and the earlier check was wrong. Noted because a
> status document is only useful if its "done" marks can be trusted, and this one could not.

### Delivered alongside, not on the recorded list

Worth noting because it represents real completed work, whether or not it maps to a client point:

- **Real sign-in** with username or email, proper password protection, and sessions that survive a
  browser reload.
- **Multi-user safety** — two people acting at the same moment cannot oversell stock, double-pay a
  salary, or issue duplicate cheque numbers. Tested under genuine simultaneous load.
- **Operator restrictions enforced server-side**, including keeping profit figures away from
  operator accounts entirely.
- **Printable reports** with fixed formatting regardless of screen theme.

---

# Part 3 — Running log

*Most recent first. Never delete an entry.*

## 2026-09-03

### Done

*At a glance: the groundwork for a real accounting journal is built and every trade and payment now
records its two sides properly. None of it is switched on yet, and none of it has been released.
Two genuine faults were caught along the way by the checking tool built for exactly that purpose.*

**Every deal now records both sides of itself.** Until today a purchase, a sale, a receipt or a
payment was stored as a transaction record, and each account's position was worked out afresh
whenever a report was run. There was no entry to point at for an individual deal — which is what
the client asked for, and the largest remaining piece of work in the project.

Each deal now also writes a set of paired accounting entries, grouped so the whole deal can be
pointed at as one thing. A purchase records the currency gained against the cash paid and the
balance owed. A sale records the currency leaving at what it actually cost, the customer owing the
sale price, and the difference as the desk's profit. Receipts and payments record the money moving
against the customer's balance.

Three things in that were less obvious than they sound.

*Selling at a loss.* A sale below what the currency cost the desk is perfectly ordinary and the
system has always allowed it. Profit and loss are opposite sides of the books, not one figure that
can go negative, so a loss is now recorded the other way round. Recorded as a plain negative
instead, it would have refused the sale outright — the sale would simply have failed for the
dealer, with no obvious reason why.

*Cheques still move nothing until they clear.* A deal settled by cheque records no money movement
on the day, because the money has not moved. That is how the system has always behaved; the new
entries follow the same rule rather than inventing a second one. Clearing the cheque is what
records it. Getting this wrong would not have produced an error — it would have quietly counted
the same money twice, once when the cheque was taken and again when it cleared.

*One name per thing.* Every currency the desk trades has an account holding it, and the obvious way
to find that account is wrong for the desk's most-traded currency for historical reasons. That
lookup is now written once, in one place, with a test that fails against the wrong version. The
same discipline settled a second question: a deal is already identified by its transaction record,
which staff already see, so no second reference number was invented for it.

**A checking tool was built first, and it earned its place immediately.** Before any of the above
was written, a tool was built to answer one question: *if the new entries were the only source,
would every account still show the figure the system reports today?* The whole point of this work is
that no reported number may change, and that is the only way to know.

It was deliberately built before it could pass, and confirmed to fail, on the principle that a check
never seen failing is not known to be checking anything.

It then caught two real faults.

*The first was in the checking tool itself.* It measured "today" at the current moment, while the
system always measures a day to its end. Because a deal dated today is treated as happening at
midday, a check run in the morning silently ignored every deal recorded that day — and reported a
gap of nearly 47,000 rupees that the system itself would never have shown. A tool that does not
measure the way the thing it is checking measures is only checking its own arithmetic.

*The second was the serious one, and it invalidated an assumption the plan was built on.* The plan
said the new entries would sit inert until a later stage switched the reports over to them. That was
wrong: two parts of the reporting already read that same store, because until now everything in it
was a standalone entry. So the moment a deal wrote its new entries, its cash was counted twice —
once from the transaction record and once from the new entry. Measured on a real purchase, cash
read 60,000 rupees against an actual 30,000, and profit 1,660 against 800.

This was caught on the very first deal put through the new code, before anything was released. Had
the plan been followed on trust, it would have gone out and every cash, bank and profit figure would
have been wrong from the first deal a dealer booked. The fix makes the new entries genuinely
invisible to the existing reports, in one shared place rather than four copies of the same rule.

**Journal entries now carry their own date.** They previously had only the date they were keyed in,
while reports are cut on the date a deal was struck. A backdated deal would have had its two halves
land in different months. Given its own date rather than borrowing one, because manual entries,
opening balances and the corrections planned later have no deal to borrow from.

**Profit is no longer reachable by an Operator through the back door.** Profit figures are stripped
from what an Operator's screen receives, but accounting entries were sent to every role unfiltered.
Since a sale now records its profit as one side of an entry, that would have handed Operators the
exact figure the system refuses them — reopening a hole closed on 2026-08-31 through a different
door. The filter was deliberately built *before* the entry that needed it. One visible consequence:
an Operator no longer sees hand-written accounting entries posted against income on the transaction
list.

**None of this is live.** Nothing has been released, and the database change behind it has not been
applied to the live system. Seven changes are finished and waiting.

**Test copies can no longer touch the real books — and there turned out to be two ways they could,
not one.** This was recorded on 2026-08-31 as a known risk and carried since. Before starting the
next piece of work — which rewrites historical records — it was investigated properly, because
iterating on that code with this unresolved meant any branch could write real entries outside a
reviewed release.

The recorded risk described a temporary *server* copy holding the live database's address. That was
real. The second path was not recorded and is the likelier accident: the temporary *screen* copy was
pointed at the **live** server, so opening a test address to look at a screen change was operating
the real system on real data through unreviewed software. Clicking a test link feels harmless, which
is exactly what makes it dangerous.

Both are closed. Temporary copies are no longer built at all, and separately the server now refuses
to start as a test copy unless someone has explicitly declared its database separate. The second
guard exists because the first is a hosting setting — one click from returning, with nothing in the
code to notice. Verified by pushing a throwaway branch: both projects cancelled the attempt without
building and served nothing.

Worth recording how close this came to going wrong: the first version of the hosting command was
written **backwards**. The setting's convention is inverted from the obvious reading — exiting zero
*skips* a build — so the proposed command would have stopped the live system deploying while
leaving test copies building freely. The client caught it by reading the settings page rather than
trusting the instruction, and applied a built-in preset instead of free text, which removes the
chance of anyone getting the direction wrong again.

### Found

| Finding | Severity | Status |
|---|---|---|
| The reporting already read the accounting store, so new entries were counted twice — cash read 60,000 against an actual 30,000, profit 1,660 against 800 | **Would have been serious.** Every cash, bank and profit figure wrong from the first deal booked. The plan explicitly assumed this could not happen | Fixed. Caught by the checking tool on the first deal, before release |
| The checking tool measured "today" at the current moment rather than to the end of the day, so it ignored deals dated today and invented a 47,000 rupee gap | Would have hidden the real result behind an artefact of the measurement | Fixed |
| A sale below cost would have been refused outright rather than recorded as a loss | Real: an ordinary trade would simply have failed, with nothing explaining why | Fixed — a loss is recorded on the opposite side, as the books require |
| Accounting entries were sent to every role unfiltered, while profit is stripped from what an Operator receives | Would have reopened a hole closed on 2026-08-31, by a different route, the moment a sale recorded its profit | Fixed before the entry that needed it existed |
| The obvious way to find a currency's holding account is wrong for the desk's most-traded currency | Would have failed at the moment of writing, on the busiest currency, not at review | Fixed — written once, with a test that fails against the wrong version |
| One test failed once and could not be reproduced in four further runs | Unknown. Two likely causes were checked and ruled out | **Open — recorded, not chased.** Written down with what was ruled out so a second occurrence is diagnosable |
| The security rollout's final step is still unvalidated, and this work writes to the books | Real, and knowingly deferred. The check cannot pass while nobody is using the system | **Open — deliberate.** Must be settled before this is released |
| Temporary copies of the software could write to the real books by **two** separate routes; only one had been recorded since 2026-08-31 | Real. The unrecorded route — a test screen pointed at the live server — needed nothing but someone opening a test link | **Closed.** Copies are no longer built, and the server independently refuses to start as one |
| The first version of the hosting command to disable them was written backwards, and would have stopped the live system deploying while leaving test copies building | Would have been a self-inflicted outage while leaving the risk open | Caught by the client before it was applied, by reading the settings page rather than trusting the instruction |

### Must happen before the next release, in this order

*Structural database changes are applied by hand and must land **before** the software that needs
them — see Part 1. Two of the three below are harmless if that order slips; the third is not.*

| # | Change | If it is released without this |
|---|---|---|
| 016 | Groups accounting entries per deal | Already applied to the live system |
| 017 | Gives accounting entries their own date | Already applied to the live system |
| **018** | **Links an entry to the cheque that produced it** | **Not yet applied. Unlike the two above this one is load-bearing: the software writes to this field on every deal, so releasing first would fail every purchase, sale, receipt and payment against an unknown field.** |

### Next — in priority order

1. **Do not release until the security rollout's last step is settled.** For the earlier groundwork
   this was optional, because nothing it wrote could affect a figure. It is not optional now: this
   work writes to the books. The check cannot pass while the system is idle, so this waits on the
   client actually using it.
2. **Carry the existing deals over.** Deals recorded before today have no paired entries. Every
   figure needed to create them is already stored, so they can be brought over rather than leaving
   the reports handling two shapes forever. Not started.
3. **Switch the reports over.** The last step: retire the four separate ways each figure is
   currently worked out, one at a time, re-running the checking tool between each until it reports
   agreement. That is the definition of this requirement being finished.
4. **Then, and only then, corrections and reversals** — planned and decided, deliberately not
   started.
5. Carried unchanged: the small Admin gaps from the 2026-09-02 audit; correcting an opening
   balance; the PDF export question; the pre-existing sessions; and the misleading error message.
   **Test copies writing to the live books is now CLOSED** — see the addition to today's entry
   below and the rewritten note in Part 1.

## 2026-09-02

### Done

*At a glance: a session-expiry defect found and fixed, the local database brought back into step
with production, an audit of what an Admin cannot do, and a scoping plan for corrections — which
the client then settled five open questions on.*

**A session that ended left the app in a dead end, and that is now fixed and live.** Identity was
worked out once when the app loaded and never revisited. So when a session ended underneath someone
— the idle window lapsing, or another tab signing out — the app carried on believing they were
signed in. The next request came back refused, and the screen reported it as an ordinary failure to
load data, behind a Retry button that could only ever fail the same way. The only escape was opening
a new tab, because a new tab re-checks who you are.

The app now treats "the server says this session is gone" as its own distinct signal, wherever it
arrives, and sends the user to the sign-in screen with a line saying the session ended. An ordinary
sign-out says nothing extra, because it needs no explaining.

The care in it is about when that message is allowed to appear. Two refusals are completely normal
and must never be reported as a session ending: the check made when someone who is not signed in
first opens the app, and a mistyped password. Both happen when no session exists, so the signal
stays silent. It also disarms itself, so a page refresh and a save failing at the same moment
produce one sign-out rather than two.

**Found while fixing it: one idle tab could sign out a colleague who was actively working.** The
countdown ran per browser tab, but signing out ends the session on the server, which every tab
shares. A second tab left open on a dashboard reached its own five-minute timeout and ended the
session in the tab someone was dealing in, mid-form, with no warning. Worse, the workaround for the
bug above — open it again in a new tab — left one of these behind every time.

Activity is now shared between tabs, so the countdown belongs to the session rather than to a tab.
An active tab keeps every other tab alive, and only a session genuinely idle everywhere runs down.

Both were verified in a real browser with two tabs, not only by automated checks. With one tab
active and the other untouched, the idle tab was still signed in after 208 seconds against a
two-minute timeout, and the working tab was unaffected throughout. With both left alone, the
warning appeared at 101 seconds and both tabs then landed on the sign-in screen reading "Your
session ended — please sign in again", which is the screen this work exists to produce.

**The local development database was three structural changes behind production.** It was missing
the two-way record used to decide when the security rollout can finish, the three newer currencies,
and the settings table. In practice that meant the local copy could only trade three of the six
currencies and had no Settings page behind it, so anything checked locally about those two features
was being checked against a database that predated them. Brought up to date and confirmed identical
to production, field by field.

**An audit of what an Admin cannot do.** The client asked where an Admin is blocked from seeing or
changing something they should reasonably control. Worth recording that every role check in the app
grants Admin *more*, never less — there is no screen an Admin is locked out of. What the audit found
instead were capabilities missing for everyone:

- **"Customer since" is not a real field.** It is worked out from the day the record was created, so
  every customer carried over from the old way of working reads as starting on the day they were
  typed in.
- **An opening balance cannot be corrected** after the account is created — blocked on the screen and
  again on the server.
- **Phone and city cannot be cleared** — emptying one stores a dash rather than nothing.
- **The record of who did what is a hover tooltip.** Worse, who archived a customer and who
  overrode an account type are both recorded in the database and shown nowhere at all.
- **Nothing posted can ever be corrected** — the finding that dominates the rest, and the subject of
  the plan below.

**A written plan for correcting posted entries.** Today a trade booked at the wrong rate, a payment
against the wrong customer or a salary accrued twice is permanent. The plan sets out correction by
*reversal* — posting an opposite entry that names the original — rather than editing, entity by
entity, with the conditions under which each is safe.

Reversal rather than editing is not a preference. Currency stock cost is rebuilt by replaying every
purchase and sale in order, so editing a historical trade would quietly re-cost every sale that came
after it with nothing in the record showing anything had moved.

Two things surfaced that were not visible before reading the posting code. Salary corrections are
blocked outright by a database rule that permits only one accrual per employee per month, which a
correction would violate — and which also means a reversed month could not be re-accrued without
reworking that rule. And forty-four separate places across eight files add up transactions on the
assumption each one counts exactly once; correcting them individually is how a correction ends up
counted on the dashboard but not on the balance sheet.

### Decided by the client

*Recorded because these were delegated decisions, answered by the client, not assumptions made on
their behalf. They are settled; do not re-open them.*

| # | Question | Client's decision |
|---|---|---|
| 1 | What date does a correction post on? | **Always today.** Never backdated into the period being corrected, so figures already reported for a past month cannot change after the fact. |
| 2 | Are corrected entries hidden or shown? | **Always shown** — the original struck through, with the correction linked beside it. Never hidden, so a correction can never become invisible. |
| 3 | Can a purchase be undone once some of it has been sold? | **Yes.** Post an adjustment so the profit total stays right, rather than refusing the correction. Accepted alongside it: the profit figures on the sales in between stand as they were originally posted. |
| 4 | Is there an age limit on corrections? | **No.** An Admin can correct an entry of any age at any time. Who performed each correction and when is recorded, as already planned. |
| 5 | Does correction come before or after the full journal work? | **After.** Build the paired double-entry postings first, then corrections on top — so the correction logic is not written twice when the underlying shape changes. |

### Found

| Finding | Severity | Status |
|---|---|---|
| A session ending mid-use left the app on a dead-end error with a Retry button that could only fail again; the only escape was a new tab | Real, and reachable in ordinary use — the auto-logout released on 2026-08-31 made it reachable every five idle minutes | Fixed and live |
| One idle tab could end the session in a tab someone was actively dealing in, mid-form, with no warning | Real — and made *more* likely by the bug above, whose workaround left spare tabs open | Fixed and live |
| The local development database was three structural changes behind production | Anything checked locally about the newer currencies or the Settings page was being checked against the wrong shape | Fixed — local now matches production exactly |
| Two claims in the engineering reference were no longer true: the note on browser storage, and the test count (76 claimed, 162 actual) | Low, but this is the document people trust to be current | Corrected in the same change |
| The old browser-only version of the app left real business data in the browser's own storage, which nothing clears | Low — current code neither writes nor reads it, but it sits in any browser that used the app before the move to a server | **Open — noted, not acted on** |
| Salary corrections are blocked by the database rule allowing one accrual per employee per month; a reversed month also could not be re-accrued | Would have been discovered mid-build. Both the rule and the field it checks have to change first | Recorded in the plan, not yet built |
| Forty-four places across eight files total up transactions assuming each counts once | The main sizing risk in the correction work — doing them one by one is how a correction lands in one report and not another | Recorded in the plan; belongs in one shared rule, not forty-four edits |
| Profit is stripped from what an Operator receives, but journal entries are sent to every role unfiltered | **Real risk in the work about to start.** Once trades post journal entries, recording profit as one side of an entry would hand Operators the exact figure the server currently withholds | **Open — must be designed for before the journal work begins** |

### Next — in priority order

1. **Finish the security rollout** (unchanged, still first). Run the readiness check against production;
   it must report SAFE before enforcement is switched on.
2. **Paired double-entry postings for trades and payments** *(requirement 7)* — now the next concrete
   piece of work, and being scoped to the same standard as everything else this session. The client's
   decision 5 places it ahead of the correction feature.
3. **Corrections and reversals** — planned, decided, and deliberately **not** started until item 2 is
   done.
4. **Small Admin gaps from the audit** — "customer since" as a real field, clearing phone and city,
   and showing the record of who changed what. Independent of each other and of the work above.
5. **Correcting an opening balance** — medium-sized, and needs an accounting decision about the
   entry created with the account.
6. Carried unchanged from earlier entries: confirm the PDF export is what the client wants; decide
   whether to expire the pre-existing sessions; fix the misleading error message; decide on preview
   copies writing to the live database.

## 2026-09-01 — second session

### Done

*At a glance: a design pass over four screens. The theme throughout was removing things that
looked like information but were not — repeated labels, a chart with no scale, and a summary panel
that duplicated a table further down the same page.*

**The buying and selling screens lost three lines of grey text.** Under the amount box sat a line
reading "In AED", and under the rate box two more: the quote convention and the average cost. The
currency now sits inside the amount box itself as a small badge, reading whichever currency is
selected above. The average cost moved onto the rate field's own label line, where it is still
visible while a rate is being typed. The quote convention — which flips direction for Iranian Rial,
so it cannot simply be dropped — moved behind the small information icon the date field already
uses. The result is two labelled fields instead of two fields and three captions.

The word "buy"/"sell" came out of the amount label, leaving just "Amount". Not a preference: with
the available balance now on that same line, the longer label was being cut off to "Amoun…" as soon
as the desk held a six-figure position. The screen still says which direction the deal runs in its
title and on its button.

The scroll wheel no longer changes a figure in the amount or rate box. On a rate box, an accidental
wheel turn over a focused field is a wrong deal, not a cosmetic slip.

**The two salary summary cards were resized.** They stretched the full width of the screen with the
figure blown up to fill the space, which made a real number read as a placeholder tile. They are
now sized to their content, with the figure scaled to match. Colours, icon and wording are
untouched. The rest of that page has the same problem in its two tables — full width for about
two-thirds as much content — which is recorded below rather than changed unasked.

**The row of stock figures across the top of every screen was cut back to two.** It had grown one
tile per currency and no longer fitted, so it had quietly become horizontally scrollable: most of
the desk's positions were invisible unless someone happened to scroll a header. It now carries only
the two figures that belong on every screen — what customers owe the desk and what the desk owes
them. Currency positions live on the Currency Stock page, reached from the sidebar, which is the
page built for them. Deliberately not replaced with a single tile for one favoured currency: two
places showing the same thing is how they drift apart.

**The Currency Stock page was rebuilt around one idea per section.** It previously named the
selected currency four times on one screen, showed the same three figures twice, and had two
"recent activity" panels listing a subset of the very table three sections below them.

- The currency is now named once, at the top, with everything below it using the three-letter code.
- The decorative bar chart is gone. It had no scale, no units and no dates, and its bars were held
  to a minimum height, so an empty desk still drew a full row of them — it looked like data while
  asserting nothing. In its place is a real chart of the quantity on hand after each movement, with
  a labelled scale, dated points and a flat-then-step shape that matches how a stock level actually
  behaves. A currency with no movements shows no chart at all rather than an empty frame.
- The two "recent purchases"/"recent sales" panels were removed. The movement table below them is
  now the single history for the currency.
- The all-currencies table at the bottom became a comparison rather than a second copy of the
  figures already shown above: quantity and value only, with the currently open row marked.
- The paragraph of accounting explanation under it moved behind an information icon, matching the
  pattern used elsewhere.

**Operators can now see the movement history**, minus the two columns that carry cost and profit,
which stay restricted to Admin. Previously the ledger was Admin-only and Operators saw the two
recent-activity panels instead; removing those panels without this change would have left an
Operator with no transaction history on the page at all.

### Found

| Finding | Severity | Status |
|---|---|---|
| The old stock chart floored every bar at a tenth of full height, so a desk holding nothing still drew six bars | Presented as data while carrying none — the failure mode is a reader trusting it | Replaced with a real chart; an empty desk now shows no chart |
| Removing the recent-activity panels would have left Operators with no transaction history at all on the Currency Stock page | Would have quietly reduced what a non-Admin can see, unasked | Movement table shown to everyone, with the cost and profit columns held back |
| For a non-Admin the server deliberately omits the profit figure. The page's old code turned a missing figure into "0" | Real defect had those columns been shown: a confident zero on every sale, which is the exact claim the server declines to make | Columns are not rendered for non-Admins, and the missing-value handling was corrected rather than left to coincidence |
| With the available balance moved onto the label line, "Amount to sell" was cut off once the figure grew past five digits | Cosmetic, but it was introduced by this session's own change | Label shortened and the three field widths rebalanced; checked at a nine-figure balance |
| Signing in to the local copy with the live site's password does not work | Not a defect — the local copy has its own separate demo database and its own demo logins | Confirmed the local sign-in works end to end; the credentials are the ones in the demo setup script |

### Next — in priority order

Unchanged from the entries below, plus two cosmetic items recorded but not acted on: on the Salary
page, the employee table and the postings list run the full width of the screen for noticeably less
content, and the Cheques page has the same pair of over-wide summary cards that were just fixed on
Salary.

Nothing on this page has automated tests — none of the app's screens do — so all of the above was
checked by running the app and looking at it, in both light and dark themes.

## 2026-09-01

### Done

*At a glance: the data-entry screens were tidied, a stale branch that could mislead was removed,
and the live server's list of permitted addresses was trimmed.*

**The dealing screens were simplified.** Choosing a customer used to mean two controls stacked on
top of each other — a box to type a filter into, and a separate dropdown to pick from. Two things
to operate for one decision, where typing in the first silently changed the contents of the second
and neither showed the current answer on its own. It is now a single field: click it, the list
opens, type to narrow it, and it closes showing the chosen name. Arrow keys and Enter work, since
this is a field a dealer goes through dozens of times a day.

The currency field now reads just the code — "AED" — while working, with the full name shown only
when the list is open, where someone unsure which code is which actually needs it. The transaction
date field went from three lines of label and explanation down to one label with a small
information icon carrying the clarification.

Applied to buying, selling, receiving and making payments — all four screens had the same pattern.
One of them turned out to have its own private copy of the filtering rather than sharing, which is
exactly how two screens quietly drift apart; both now use the same control.

**A stale branch was removed.** An old development branch had fallen 22 releases behind and still
had a working preview address. Anyone opening it would have seen a months-old version of the app
and reasonably reported bugs that were fixed long ago. Deleted rather than merely updated: updating
would have made it correct for a day and then let it fall behind again, whereas deleting removes
the trap. Nothing was lost — every change on it was already in the live line of work.

**The live server's permitted-address list was trimmed** to the real application address alone,
since the deleted branch's address was still on it. That list is currently the main thing standing
between a hostile web page and a request made in a signed-in user's name, so keeping it to exactly
what is needed matters. Verified afterwards from a real browser: the application loads and reaches
the server normally, and the removed address is now refused.

### Found

| Finding | Severity | Status |
|---|---|---|
| "Applied to all four screens" was too loose a claim: receipts and payments have **no currency field at all**, since they move rupees only | Not a defect — but it overstated what had been done, which is the kind of claim this document exists to keep honest | Corrected. The customer and date changes cover four screens; the currency change covers two, plus the account form |
| The inline "add a customer" was described as existing behaviour to preserve. It did not exist anywhere | Would have been quietly dropped had it not been checked | Built rather than skipped, and restricted to Admins because the server already restricts it — an Operator pressing it would otherwise have been refused by a control that looked available |
| Changing the permitted-address list briefly marked it unreadable, so its value could no longer be checked for a typo | Real risk: a wrong value there locks every user out, and it had just become unverifiable | Caught and undone in the same change; the value was then read back and confirmed exactly |

### Next — in priority order

Unchanged from 2026-08-31 below, with one addition: **the three data-entry screens other than
Buy have been checked at the source but not yet seen working in a browser.** Signing in is needed
for that and could not be done unattended. Worth a few minutes before treating the form changes as
finished.

## 2026-08-31

### Done

*At a glance: two of the three security releases are live; automatic sign-out on inactivity built and released; the currency list completed to all six; two real accounting defects fixed; the*
client's full requirement list recovered and verified against the software; twenty accumulated
changes released to production after three days without a release.*

**Security — cross-site request forgery protection, stages 1 and 2 of 3 shipped and verified
live.**

The live setup requires the browser to attach its sign-in credentials to requests coming from
other websites. That means a hostile page a signed-in admin visits could, in principle, instruct
the desk's server to post entries, pay salaries or delete accounts under that admin's name — and
the audit trail would record the admin as having done it.

Investigation found the system is *probably* not exploitable today, but only by accident: an
incidental technical detail of how requests are formatted causes the browser to check with the
server first, and that check rejects unknown websites. Nothing was designed to provide this
protection, nothing documents it, and several ordinary future changes would silently remove it.

The fix is a security token that only the desk's own screen can know. It is being rolled out in
**three separate releases, deliberately not combined**, because releasing them together would lock
out every user whose browser still holds an older copy of the screen software:

1. **Server issues and checks the token, but does not yet require it** — ✅ **live and verified**
2. **Screen sends the token on every action that changes data** — ✅ **live and verified**
3. Server starts requiring it — not started

Stage 1 was confirmed working in production by recording a real purchase and observing the server
log the expected message. Stage 2 was confirmed by checking the actual JavaScript being served to
users, rather than assuming a successful release meant working code.

Two problems were caught by review rather than by discovering them later:

- **Signing out would have broken at stage 3.** Signing out is a data-changing action and needs
  the token like any other, but it is not part of the normal flow that carries it. Left as it was,
  sign-out would have been the *single* action that stopped working when enforcement was switched
  on, while everything else carried on — a hard failure to diagnose from a user's description.
- **A rejected action is only retried when the rejection is genuinely about the token.** A refused
  token and "you are not allowed to do this" both look identical to the software. Retrying the
  second would waste time and, worse, hide the real reason from the user.

If a screen ever holds a valid sign-in but no token — possible after a reload — it now quietly
fetches one and continues, instead of refusing the user's action.

**Enforcement remains off**, and the way that decision gets made was rebuilt during this session.

It was originally gated on a server log going quiet. That turned out not to work, established by
measurement rather than suspicion: the hosting platform's logs are tied to a single release and
kept only briefly, a warning recorded at 13:40 could no longer be retrieved by 16:05 the same day,
and five separate releases happened in one afternoon. A quiet log therefore meant one of three
completely different things — nothing went wrong, the release is new, or the record expired — and
only the first justifies switching enforcement on. Acting on either of the others locks out every
user still running an older cached copy of the screen.

The signal is now written to the database instead, and `npm run csrf:gate:prod` reports it as a
verdict. It deliberately answers *inconclusive* rather than *safe* when the desk has simply not
been used, because an empty result from an idle day is not evidence of anything.

That second point is not hypothetical: the first version of the check reported **safe** against
live data and was wrong — it compared a brand-new record of failures against two days of business
history. It now measures both over the same window and says how much history it actually has.

**Accounting — two real defects found and fixed.**

*The balance sheet was marking its own homework.* When the books didn't balance, the system
quietly added a balancing figure to equity and then declared the books balanced — checking its
answer against the figure it had just adjusted. It could essentially never report a problem. A
genuine bookkeeping error was indistinguishable from an expected, harmless one.

It now measures the difference **before** adjusting anything, separates the one legitimately
expected difference (currency stock the desk held before record-keeping began) from anything else,
and reports a genuine imbalance as a genuine imbalance.

A second fault was found inside the same area: a balance sheet for a **past date** valued currency
stock at *today's* quantity while valuing everything else at the historical date — mixing two
dates and guaranteeing a discrepancy, which the balancing figure then concealed. Also fixed.

*Operators could see the desk's profit.* The screen correctly hid profit and cost figures from
operator accounts — but the underlying data was still being sent to their browsers. The
restriction was cosmetic. Profit and cost figures are now removed at the server before being sent,
for both normal page loads and after an operator records a transaction.

**Payments could not be backdated.** The server already accepted a transaction date on receipts
and payments, but the screen had no way to send one, so every payment silently landed on today's
date. Now wired through, matching the trade screens.

**Database and release.** A required structural change (adding the transaction-date field and the
two new currencies) was applied to the live database **before** releasing the software that
depends on it, then verified. Twenty accumulated changes were then released to production — the
first production release in three days. Both the screen and the server are now live on the same
version.

**Documentation.** The engineering reference was rewritten from a full audit (it described a state
of the system roughly a month out of date) and then condensed. The public README, which still
described the app as a browser-only demo with no server and a fake login, was rewritten. **This
document was created**, and is now updated at the end of every working session.

**The client's requirements were recovered and checked.** Only four of the eight were written down
anywhere — in the repository, the change history, or any project document. The missing four were
supplied during the session and every one of the eight was then verified against the actual
software rather than assumed. Two turned out to have been satisfied by earlier work that had never
been recorded as meeting a requirement. One — how a customer was paid being hidden on the buy
screen — was found not only done but done reversibly, with the controls kept in place and a
written procedure for restoring them, which is what the client had asked for.

The eighth point, correct debit/credit accounting, was raised as a question and answered the same
day: the client wants a genuine auditable entry per transaction, not merely correct totals. That
moves it from ambiguous to confirmed work, and makes it the largest remaining item in the project.

**The currency list was completed — all six the client asked for are now live.** USD, EUR and JPY
join AED, AFN and IRR. Each is quoted the ordinary way round, so this repeated a pattern already
proven rather than breaking new ground; the awkward case, the Iranian rial, was solved earlier and
already covered them. Each new currency's arithmetic was checked against a real conversion and
confirmed against the figure the database actually stores, rather than the screen appearing to
accept it — the failure being guarded against is not an error message but a plausible-looking
wrong number. The yen was checked twice for that reason: at roughly 1.9 rupees it is close enough
to parity that a mistake would still look believable.

**The trade screens were simplified.** Choosing a currency now shows just the code, with the full
name appearing on hover rather than permanently taking up room. Two explanatory captions were
removed — one telling the dealer which direction a purchase runs, one explaining that a date field
holds a date. Both were the software narrating its own workings to someone who already knows them.

**Transaction amounts now read in the currency actually dealt.** Buying a thousand dirhams from a
customer and then opening their record showed a rupee figure — a currency that had no part in the
deal. The cause was not a faulty conversion but a display choice: transactions are stored with both
the real amount and its rupee value, and every screen had reached for the rupee one as the number
to show large, leaving the real currency in small grey text or nowhere.

That choice is now made in one place rather than separately on each screen, and it is made the
other way round: what was dealt leads, the rupee equivalent sits underneath. Fixed on the customer
record, the dashboard, the transaction log and the currency stock page. Receipts and payments are
untouched, because those genuinely are rupee movements and dressing them up with a conversion
would be inventing something that did not happen.

**The customer ledger was built** — the last outstanding client requirement. A Customer Ledger
section opens on a searchable list of customers showing names and balances only, deliberately with
no transaction detail: a statement belongs to one customer, and putting transactions on the chooser
would both bury the one thing that screen is for and show one customer's dealings to someone who
opened it looking for another. Choosing a customer opens their statement, with Print, Export PDF
and Export Excel, and a date range that narrows all three together.

Two decisions in it are worth recording.

*Running balances are of two kinds, on purpose.* Rupees run as a single figure, because a customer
owes one amount regardless of which currency produced it. Currency quantities run **separately per
currency**, because dirhams and dollars are not the same thing and a single total covering both
would be a number with no meaning — the same mistake as silently converting a customer's record
into rupees, in a different shape.

*Export PDF opens the browser's print dialog* rather than producing a file directly. The statement
already has a print layout, and every browser can save that as PDF. Generating a second version of
the same document through an added library would mean two layouts to keep looking alike, on a
download that is already large. Worth revisiting only if the client wants statements emailed, which
a browser dialog genuinely cannot do — that would be a different piece of work.

**A terminal left untouched now signs itself out** — five minutes by default, with a thirty-second
warning and a button to stay signed in, so an active user is never cut off mid-task.

The part worth understanding is that this is enforced **twice, independently**. The screen runs the
countdown, which is what produces the warning and the tidy sign-out. But a countdown that lives in
the browser protects nobody who is deliberately getting round it — a machine with scripting turned
off, or someone using a session copied from another computer, never runs it at all. So the session
itself also expires on the server after the same period. Either half alone would be inadequate:
without the screen there would be no warning, and without the server it would be decoration.

Keeping the two in step needed care. The server measures idleness from the last time the screen
*asked it for something*, and someone reading a long report is plainly present while asking for
nothing. Left alone, their countdown would show plenty of time while the session quietly expired
underneath them, and the next click would fail for no visible reason. Genuine activity therefore
touches the server about once a minute, and ordinary use satisfies that without extra traffic.

Making the period an administrator setting required somewhere to keep it. There was no such place:
every setting until now lives in the hosting configuration, which only the account holder can
change and only by re-releasing the software. A small settings store was added, and an admin-only
Settings page edits it.

### Found

| Finding | Severity | Status |
|---|---|---|
| Releasing the software before the database change would have returned an error on **every** purchase, sale, receipt and payment | Would have been a full outage of the desk's core function | Avoided — caught before release, database updated first, verified |
| The balance sheet's "balanced" confirmation was meaningless | Real — it could not detect a genuine bookkeeping error | Fixed |
| Operators received profit and cost data the screen claimed was restricted | Real — an access boundary that wasn't one | Fixed |
| Every server error is reported to the user as "Something went wrong", including ordinary faults that should say what was actually wrong | Misleading. Cost real time today: a malformed test command looked exactly like a broken production sign-in | **Open** — small fix, needs a release |
| Preview copies of the software are wired to the **live** database | Real risk — test work writes to the real books | **Open** — needs a decision |
| Sign-in appeared broken in production | **Not a fault.** The test command was malformed by the Windows shell and never reached the server intact. Sign-in verified working. | Closed, no action |
| The automatic sign-out would not have applied until a user's *second* request — the first sign-in of every session still handed out the old 30-day window | Would have quietly weakened the new control for exactly the first moments of each session | Fixed before release — found while writing the test, not afterwards |
| Customer transaction amounts were shown converted into rupees, on five screens — the client's own report | Real: a purchase of 1,000 dirhams read as a rupee figure, a currency that was never part of the deal | Fixed. One shared rule now decides which figure leads, instead of the same choice being made separately on each screen |
| **An earlier assessment in this document was wrong.** Requirement 8 was marked done because the currency appeared on the row, without checking it was the figure being led with | The client had to report a bug this document said was already handled | Corrected in Part 2, and the correction left visible rather than quietly overwritten |
| 34 sessions that existed before this release still carry the old 30-day window until they are next used | Low but real: an old unused session stays usable for its original period, which is precisely the case the timeout exists to close | **Open — a decision, not a defect.** Expiring them is one command, but it signs every current user out immediately |
| The planned way of deciding when to switch on CSRF enforcement did not work — the hosting platform's logs are tied to a single release and expire within hours | Would have meant guessing at the final step of a rollout that was split into three specifically to avoid guessing | Fixed — signal now written to the database, with a one-command check |
| The first version of that check reported "safe" against live data, incorrectly | Would have caused enforcement to be switched on prematurely, locking out anyone on a cached copy of the screen | Fixed the same session — it compared a brand-new failure record against two days of business history; both are now measured over the same window |
| Trades and payments create no paired ledger entries — the balance sheet reconstructs each account's debit/credit position from transaction records instead | Figures are correct, but there is no auditable entry per transaction | **Open — confirmed in scope.** Client has since decided they want full traceability, so this is real work, not a question. Gated behind the CSRF rollout; scoping plan required first |

### Client requirements

The client's full eight-point list was supplied and every point checked against the actual
software rather than assumed. Result: **5 done, 2 partial, 1 not started** — see Part 2.

Two points were found already satisfied by work done previously and simply never recorded as
such: the buy screen's currency/customer/date controls (requirement 5) and customer records
showing the real transacted currency rather than a rupee conversion (requirement 8). One point —
hiding how a customer was paid on the buy flow (requirement 6) — was found not only done but done
reversibly, with the controls retained in place and a written restore procedure, which is what the
client asked for.

Requirement 7 was raised as a question — whether "correct Dr/Cr" meant correct figures or a
conventional journal per movement — and **the client answered it the same day: they want
traceable, auditable records per transaction, a real double-entry journal entry for every trade
and payment, not just correct report totals.**

That settles it as confirmed work rather than an open question, and makes it the largest remaining
item in the project. It is deliberately sequenced *after* the CSRF rollout completes, and requires
a reviewed scoping plan before any code. **This decision is recorded so it is not re-asked.**

### Next — in priority order

1. **CSRF stage 3 — switch enforcement on.** The last step of the security rollout. Stages 1 and 2
   are both live, so the software is ready; what remains is waiting for evidence.
   - **Gate:** run `npm run csrf:gate:prod` (checks the live database directly). It answers, in one command,
     whether anything is still sending data-changing requests without a token — and returns
     *inconclusive* rather than a false all-clear when the desk simply has not been used. It must
     say **SAFE** before enforcement is switched on.
   - As of 2026-08-31 it reports **inconclusive**: recording had only been running for a few
     minutes and no trades had been posted since. Re-run after a normal working day.
   - Anyone still working from an older cached copy of the screen is still sending requests
     without a token and would be locked out, which is what the gate is watching for.
   - **Switching it on is a single setting**, `CSRF_ENFORCE=true`, not a code change — so it can be
     reversed by changing one value rather than releasing a fix.
   - Once this is done the security work is complete, and the double-entry work below is unblocked.
2. **Double-entry journal for every trade and payment** *(requirement 7)* — **the largest remaining
   piece of work in the project.** The client has decided they want full traceability, not just
   correct totals, so this is confirmed in scope.
   - **Hard prerequisite: do not begin until CSRF stage 3 is live and enforcement is on.** The
     security rollout must not be left half-finished while a change of this size is in progress.
   - **A written scoping plan comes first, reviewed before any code is written.** It must cover:
     what changes in the trade and settlement posting logic to write real paired entries instead
     of bare transaction records; whether a database change is needed; how the existing balance
     sheet and report logic is affected, given it currently reconstructs debit/credit positions
     from transaction records rather than reading posted entries; and an honest sizing of the
     change.
   - Note the migration risk this carries: existing trades have no journal entries, so the plan
     must say what happens to historical records — backfilled, left as-is with reports handling
     both shapes, or something else. That decision affects whether past reports stay reproducible.
3. **Confirm the PDF export is what the client wants.** "Export PDF" currently opens the browser's
   print dialog, which offers Save as PDF from the same layout the printed statement uses. That
   avoids a second rendering of the same document and a sizeable library on an already-large
   download. If the client expects a file generated without a dialog — or wants statements emailed,
   which a browser cannot do at all — that is a different piece of work and needs saying so.
4. **Decide whether to expire the 34 pre-existing sessions** — they keep the old 30-day window
   until next used. One command, but it signs every current user out, so it wants a quiet moment
   rather than a busy trading hour.
5. **Fix the misleading error message** — report the actual fault instead of "Something went
   wrong". Small, and it will mislead again if left.
6. **Decide on the preview-writes-to-live-database risk** — either a separate database for
   previews, or an explicit accepted decision recorded here. One such address was removed on
   2026-09-01 with the stale branch, but the underlying arrangement is unchanged: any new preview
   still writes to the real books.
7. **Lower priority, carried:** no automated checks on the visual side of the app; no automatic
   test run on release; sign-in itself is not protected against a forced-login attack; the screen
   downloads as a single large file rather than in parts.
