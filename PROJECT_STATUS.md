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
| **Test copies** | Temporary preview addresses | Created automatically for work in progress |

**Important:** the preview copies are wired to the **same live database** as production. They are a
preview of the *software*, not of the data. Anything recorded through a preview address is a real
entry in the real books. This is currently a known risk rather than a designed feature — see
Part 3.

Only work merged into the main line of development reaches the live addresses. Work in progress
gets a preview address and does not affect staff.

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

**Summary: 7 of the 8 delivered. Requirement 7 (a true double-entry journal) is confirmed further work — see below.**

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | **A date on every entry** | ✅ **Done** | All four transaction screens (buy, sell, receive, pay) carry a date picker for the day the deal was struck, kept separate from when it was typed in. Reports are cut on that date. Verified live in production: a purchase recorded and correctly dated "Aug 31, 2026". Previously this worked on the two trade screens but was silently missing on the two payment screens. |
| 2 | **Full currency list** — AED, USD, EUR, IRR, AFN, JPY | ✅ **Done — all 6 live** | All six are live in production: AED, USD, EUR, IRR, AFN, JPY. Each has its own correct quoting convention and is carried separately on the balance sheet at its own cost, so no two currencies share a position. Verified in production after release — six stock positions, six separate stock accounts, and every currency present in the software actually being served to staff. Each new currency's arithmetic was checked against a real conversion (e.g. 1,000 USD at 282.50 storing 282,500 PKR), confirmed against the figure the database actually holds rather than the screen appearing to accept it. |
| 3 | **Auto-logout after inactivity** | ✅ **Done** | A terminal left untouched signs itself out, defaulting to 5 minutes. Thirty seconds beforehand a warning counts down with a "Stay logged in" button, so an active user is never cut off without notice. Enforced in **two independent places**: the screen runs the countdown, and the session itself expires on the server after the same period — so a machine with the browser's scripting disabled, or someone replaying a copied session from another computer, is cut off just the same. On timeout the session is genuinely ended, not merely hidden behind a locked screen. The period is an **admin setting** on the new Settings page, from 1 minute to 8 hours, applying to everyone. Verified in production. |
| 4 | **Ledger export** | ✅ **Done** | A Customer Ledger section opens on a searchable customer list showing name and balances only — no transaction detail at that level. Choosing a customer opens their statement: every transaction with a running balance, plus **Print**, **Export PDF** and **Export Excel**. A date range narrows all three identically, defaulting to full history. Where a customer has traded in more than one currency the running totals are kept **separate per currency**, because adding units of two different currencies produces a figure that means nothing. Verified against a real two-currency customer, not only a single-currency one. Export PDF uses the browser's print dialog rather than generating a file — see the note in Part 3. |
| 5 | **Buy screen: choose currency, customer and date** | ✅ **Done** | All three controls are on the Buy Currency form: a customer picker, a currency picker listing every traded currency by name, and a date picker defaulting to today. Verified live in production — the 2026-08-31 purchase recorded currency AED, customer "Wazir", and date Aug 31 2026, all three chosen on the form. |
| 6 | **Payment-method confidentiality on the buy flow** | ✅ **Done** | The buy screen shows no cash/bank/cheque option at all. The settlement-method buttons, the bank-account picker, the cheque sub-form and the "amount paid now" field have all been removed from the screen, and every trade is recorded on account (as a payable to the customer). How the customer was actually paid is not captured or displayed anywhere in that flow. **The client asked for this to be reversible, and it is:** nothing was deleted — the controls are retained in place, disabled, with a written step-by-step restore procedure. The server still supports all four payment methods untouched, so bringing the option back is a screen-only change. |
| 7 | **Correct Dr/Cr accounting throughout** | ❌ **In scope — not started** | **The client has decided: they want traceable, auditable records per transaction — a real double-entry journal entry for every trade and payment, not merely correct report totals.** This question is settled; do not re-open it. <br><br>*What exists today:* balances are correct, and the balance sheet honestly reports whether debits and credits agree (it previously forced agreement and always claimed success — fixed 2026-08-31). Salary, manual entries and opening balances each create true paired records. <br><br>*What is missing:* trades and payments create no paired entries. They are stored as transaction records, and each account's debit/credit position is reconstructed at report time. Under the client's decision this does not meet the requirement — there is no journal entry to point at for an individual purchase. <br><br>*Sequencing:* **gated behind completion of the CSRF rollout** (stages 2 and 3, enforcement on). Not to be started while that security work is half-finished. <br><br>*Before any code:* a written scoping plan is required and must be reviewed — see the next-steps list. This is the largest remaining piece of work in the project. |
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
