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
(UAE Dirham), AFN (Afghan Afghani), JPY (Japanese Yen) and TMN (Toman, the Iranian currency as
dealers actually count it)** — listed strongest-to-weakest, which is the order they appear in when
choosing one.

These are not quoted the same way, and the system respects that rather than forcing one format:

- Five of the six are worth *more* than a rupee, so a dealer quotes them as **"rupees per 1
  unit"** — e.g. 77 PKR per 1 AED — and the system multiplies. That holds even for the yen, the
  weakest of them at roughly 1.9 rupees.
- TMN is worth far *less* than a rupee (one rupee buys roughly 500–800 toman). Quoting it as
  "rupees per 1 toman" would mean typing 0.0013 into a rate box, which no dealer does. It is quoted
  the other way round — **"toman per 1 rupee"** — and the system divides. This was the Iranian
  *rial* (IRR) until 2026-09-21; a toman is ten rials, and the dealers have only ever counted in
  toman, so see that day's entry for why the currency was replaced rather than relabelled.

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

**Summary: 7 of the 8 delivered. Requirement 7 (a true double-entry journal) is under way — the recording half is released and live in production since 2026-09-03, and the reports have not been switched over to it yet. See below.**

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | **A date on every entry** | ✅ **Done** | All four transaction screens (buy, sell, receive, pay) carry a date picker for the day the deal was struck, kept separate from when it was typed in. Reports are cut on that date. Verified live in production: a purchase recorded and correctly dated "Aug 31, 2026". Previously this worked on the two trade screens but was silently missing on the two payment screens. |
| 2 | **Full currency list** — AED, USD, EUR, IRR, AFN, JPY | ✅ **Done — all 6 live** | All six are live in production: AED, USD, EUR, IRR, AFN, JPY. Each has its own correct quoting convention and is carried separately on the balance sheet at its own cost, so no two currencies share a position. **[2026-09-21: the Iranian currency listed here as IRR is now TMN, the Toman — see that day's entry. The delivery below is as it was when recorded.]** Verified in production after release — six stock positions, six separate stock accounts, and every currency present in the software actually being served to staff. Each new currency's arithmetic was checked against a real conversion (e.g. 1,000 USD at 282.50 storing 282,500 PKR), confirmed against the figure the database actually holds rather than the screen appearing to accept it. |
| 3 | **Auto-logout after inactivity** | ✅ **Done** | A terminal left untouched signs itself out, defaulting to 5 minutes. Thirty seconds beforehand a warning counts down with a "Stay logged in" button, so an active user is never cut off without notice. Enforced in **two independent places**: the screen runs the countdown, and the session itself expires on the server after the same period — so a machine with the browser's scripting disabled, or someone replaying a copied session from another computer, is cut off just the same. On timeout the session is genuinely ended, not merely hidden behind a locked screen. The period is an **admin setting** on the new Settings page, from 1 minute to 8 hours, applying to everyone. Verified in production. |
| 4 | **Ledger export** | ✅ **Done** | A Customer Ledger section opens on a searchable customer list showing name and balances only — no transaction detail at that level. Choosing a customer opens their statement: every transaction with a running balance, plus **Print**, **Export PDF** and **Export Excel**. A date range narrows all three identically, defaulting to full history. Where a customer has traded in more than one currency the running totals are kept **separate per currency**, because adding units of two different currencies produces a figure that means nothing. Verified against a real two-currency customer, not only a single-currency one. Export PDF uses the browser's print dialog rather than generating a file — see the note in Part 3. |
| 5 | **Buy screen: choose currency, customer and date** | ✅ **Done** | All three controls are on the Buy Currency form: a customer picker, a currency picker listing every traded currency by name, and a date picker defaulting to today. Verified live in production — the 2026-08-31 purchase recorded currency AED, customer "Wazir", and date Aug 31 2026, all three chosen on the form. |
| 6 | **Payment-method confidentiality on the buy flow** | ✅ **Done** | The buy screen shows no cash/bank/cheque option at all. The settlement-method buttons, the bank-account picker, the cheque sub-form and the "amount paid now" field have all been removed from the screen, and every trade is recorded on account (as a payable to the customer). How the customer was actually paid is not captured or displayed anywhere in that flow. **The client asked for this to be reversible, and it is:** nothing was deleted — the controls are retained in place, disabled, with a written step-by-step restore procedure. The server still supports all four payment methods untouched, so bringing the option back is a screen-only change. |
| 7 | **Correct Dr/Cr accounting throughout** | 🔶 **In progress — recording half live, reports not yet switched over** | **The client has decided: they want traceable, auditable records per transaction — a real double-entry journal entry for every trade and payment, not merely correct report totals.** This question is settled; do not re-open it. <br><br>*What exists today:* balances are correct, and the balance sheet honestly reports whether debits and credits agree (it previously forced agreement and always claimed success — fixed 2026-08-31). Salary, manual entries and opening balances each create true paired records. <br><br>*Released 2026-09-03 and live:* trades, receipts, payments and cheque clearing all write paired entries, grouped per deal. Re-confirmed on 2026-09-06 against the deployed server and the live database rather than taken from this document — see the 2026-09-06 entry in Part 3. The entries are deliberately invisible to the existing reports, so no reported figure has moved. <br><br>*What remains:* ~~**(a)** the security rollout's final step~~ — **done 2026-09-09.** It was blocked from 2026-09-03 to 2026-09-06 on an idle desk; the client started trading on 2026-09-09, the readiness check returned SAFE on real traffic, the final step was switched on, and it was then proven to be actively refusing untokened requests. Nothing on the security work remains. <br><br>**The checking tool now reports RECONCILED at every date, as of 2026-09-09** — the accounting record on its own reproduces every reported figure. **This is the precondition for (b), not (b) itself, and must not be read as this requirement being complete.** The reports still work their figures out independently rather than reading the accounting record. A green checking tool alongside reports that still reconstruct their own numbers is the state (b) starts from, not the state it ends in. See the 2026-09-09 entry in Part 3. **(b)** Then phase 5: the reports still work each figure out the old way and must be switched over to read the entries instead — retired one at a time, re-running the checking tool between each. The tool reaching agreement (which it now does) is the precondition for that switch-over; **this requirement is done when the reports actually read the accounting record**, not when the tool agrees they could. <br><br>*Nothing is left to carry over, and the desk stands ready for the client's actual first deals.* It was cleared twice — on 2026-09-03 before go-live, and again on 2026-09-09 after the client's first day of trading — so there is no history to backfill at all. **Read directly from the live system on 2026-09-10:** no deals, no accounting entries, no cheques and no customer accounts; the thirteen structural accounts intact; every currency position at zero; and entry numbering unconsumed, so the client's first real entry will be JV-001. <br><br>That every deal is recorded properly as it happens **was** confirmed on 2026-09-09, when the client's first real trades produced their paired entries as designed. Those four trades were then deliberately cleared the same day, so that evidence no longer exists on the system and will be re-earned on the next real trading day — this row previously cited them as if they were still there, which is the staleness flagged on 2026-09-09 and corrected here. That first day also exposed one unintended side effect of the recording half, on which accounts the Accounts page shows; fixed the same day, see Part 3. The carry-over program remains ready and re-runnable if it is ever needed. <br><br>*Sequencing — the release gate was dropped, deliberately:* this work was previously held back from release until the CSRF rollout finished, and this row said so. **That gate no longer applies and saying otherwise here was wrong.** The recording half shipped on 2026-09-03 with CSRF stage 3 still off, because the two are independent: what is left of the security work is a control that is *unvalidated*, not one that is half-finished, and it cannot be validated on an idle desk. Recorded rather than quietly amended, because a status row that overstates a gate is as misleading as one that omits it. <br><br>*Confirmed 2026-09-02:* the client placed this **ahead of the corrections/reversals feature**, so that correction logic is not written twice when this changes the underlying shape. |
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
- **A Margin Ledger page** showing profit per currency sale over any date range, with a monthly
  close that freezes a month's profit figure and blocks new trades from being backdated into it.
  A new client ask, not one of the original eight — see the 2026-09-17 entry in Part 3.

---

# Part 3 — Running log

*Most recent first. Never delete an entry.*

## 2026-09-25 — the customer statement rewritten for the customer who reads it

### Done

*At a glance: the statement PDF was reworked so a customer with no accounting background can read it — what they
owe or are owed, in words; what each line was; what each rate means. **No figure changed**: the same rows, in the
same order, with the same running balance, totals and closing balance as before. Nothing is pushed.*

**Checked against the reference statement first.** The reference (`3-statement-test-customer-as-admin.pdf`,
"Statement Test Customer", 15–21 Sep 2026) was printed before the dev database was cleared, so its data no longer
exists anywhere else. It was rebuilt line for line as a test fixture, and the new statement reproduces its four
figures exactly: **opening 0.00, total debits 1,422,242.49, total credits 3,014,816.16, closing 1,592,573.67 Cr.**

**What Dr and Cr mean, confirmed in the calculation rather than assumed.** The statement's balance is "what the
customer owes the desk, less what the desk owes the customer". So **Dr means the customer owes the business and Cr
means the business owes the customer.** The closing balance now says so in words — *Amount payable to customer* (Cr),
*Amount receivable from customer* (Dr) or *Account settled — no outstanding balance* — and page 1 explains Dr and Cr
once. The reference closing balance reads "1,592,573.67 Cr — Amount payable to customer".

**What changed on the page.**
- **Header:** business name and "Statement of Account", then labelled facts — customer, account ID, statement
  period, account currency (PKR), generated date and time. No address or phone is printed because none is recorded
  anywhere; nothing was invented.
- **Summary:** opening balance, total debits, total credits and — largest — the closing balance with its meaning.
  Every heading says PKR.
- **Table:** Date | Particulars | Voucher No. | Debit (PKR) | Credit (PKR) | Balance (PKR), with the **date on every
  row**. Lines read from the desk's side: "Sold to customer: AED 20", "Bought from customer: TMN 150,000,000", "Cash
  received from customer", "Bank payment to customer", "Cheque received from customer, cleared". Each deal has a second
  line saying what the rate means — **"Rate: PKR 79 per AED"** (multiplied) and **"Rate: 788 TMN per PKR"** (divided) —
  never a bare "@ 788". Manual entries keep the words the person wrote (a credit is not relabelled "discount"), with
  their JV number.
- **End of the table:** "Period totals" and "Closing balance" are now two separate rows.
- **Page breaks:** each page the table leaves ends with "Balance carried forward" and the next starts with "Balance
  brought forward", showing the same figure — the running balance at that point. They are not transactions and are in
  no total. Later pages have a compact header naming the customer, account and period.
- **Currency Trading Summary** (was "Currency Position"): per currency, how much was bought from the customer, how
  much sold to them, and the net — so the reference's AED now reads *bought 75, sold 100, net 25 sold to customer*
  instead of "Sold to customer 25 AED", which read like a single sale of 25. It says it is a trading summary only and
  not an additional amount payable.
- **Uncleared Cheques** (was "Pending cheques"): direction, number, bank, due date, the cheque's **real status**
  ("Deposited" is not shown as cleared), and separate totals for received and issued. Confirmed in the calculation
  that uncleared cheques are not in the balance. The section disappears when there are none.
- **Type and print:** 10 pt text (was 8.7), an embedded font with evenly spaced digits, dark ink on white, one navy
  accent, grey shading, thin lines between rows. No red or green and no meaning carried by colour, checked on a
  black-and-white proof. Long names and descriptions wrap instead of being cut; no amount is cut.

**The font is now embedded.** The previous entry recorded "no font embedded, as instructed". This brief asked for a
properly embedded font, so one was added: Noto Sans, a free open-licence face, cut down to exactly the characters the
statement already allowed (about 18 KB per weight, loaded only when a PDF is made). Before, each viewer and printer
swapped in its own lookalike of Helvetica, so spacing could differ from machine to machine. **Arabic and Urdu still
cannot be printed** — no tool here arranges right-to-left text — and the app still warns before the PDF opens.

**The trade-off, stated plainly.** Larger type and a second line for each deal's rate take room: the reference
statement is **four pages where the old one was three**. Page 3 ends with the closing balance and page 4 holds the
currency summary and the two uncleared cheques. Smaller type or narrower amount columns would have saved a page but
shrunk multi-million amounts, and the brief put readability first.

**Tests: 220 screen tests pass** (up from 194), plus 80 calculator tests; the 203 server tests were not re-run
because no server code changed. New tests cover: the reference's four figures; the Dr, Cr and settled wording;
a non-zero opening balance; both rate directions; gross against net currency figures; uncleared cheques kept out of the
balance; carried- and brought-forward figures matching the running balance at every page break; long names and
descriptions, very large amounts and a 40-cheque list running over a page; an empty statement; no text overlapping
other text or crossing a margin. Three faults were introduced on purpose (the rate direction flipped, the brought-forward
figure off by one row, payable and receivable swapped) and each was caught.

**Every page was looked at**, not just built: the reference statement, its black-and-white proof, a stress statement
and an empty one. Copies are in `Downloads\statement-pdf-samples-v3`.

### Found

| Finding | Severity | Status |
|---|---|---|
| The old statement printed a net currency figure as if it were a sale or purchase ("Sold to customer 25 AED" for 100 sold and 75 bought) | Medium — misleading to a customer | **Fixed** (presentation only; the figures were right) |
| Bold totals were being shrunk to fit their columns (found by a test during this work) | Low | **Fixed before release** |
| There is still nowhere to record the business's real name, address, phone or logo, so the header says "DESK NAME" | Medium for a customer-facing document | **Open** — needs a settings field (a server change) |
| An operator's statement still leaves out manual entries against Income accounts (decided 2026-09-21, not built) | Medium | **Open** — unchanged by this work |

### Not done, deliberately

- Nothing about how any figure is calculated was changed.
- No sequential human deal number was invented; deals still show the same 8-character reference as the Transactions page.
- The generated time is the computer's local clock, as before, not a fixed Pakistan time zone. The browser pages
  already work this way.
- Not yet pressed through the Print button in the running app. The button runs the same code the samples were made
  with, and the type-check and build pass.
- Nothing pushed or deployed; production not touched.

### Next

1. Open the statement through the Print button once in the running app (admin and operator) and print one page on the
   desk's printer.
2. A settings field for the business name, address, phone and logo — the header already has room.
3. Show the operator's statement the customer's leg of Income entries (decided 2026-09-21).
4. Sequential human deal numbers, which the Voucher No. column will pick up.
5. Everything listed under the earlier statement-PDF entries still stands.

## 2026-09-21 — the statement PDF gets a designed look

### Done

*At a glance: the statement PDF was redesigned for hierarchy, spacing and identity. **The content and the numbers
did not change** — every figure, every description, every page-break rule is as before — and nothing is pushed.*

**Why.** The first PDF was correct but flat: rows about 10 pt apart, a cluttered top, and a whole page of grey with
no identity.

**The brand colour, and how it was checked.** The app's own accent, **`#2563eb`** — the fill of the in-app logo —
is used. White text on it is **5.17 : 1**, so it passes the 4.5 : 1 accessibility bar without being darkened. (The
favicon, oddly, is a different indigo, `#3d46d0`; the logo people actually see in the app was followed. The two
disagreeing is worth fixing on its own.) A **6% tint** of it stripes alternate rows and the closing row: printed in
black and white it is about 9 shades of 255 darker than paper — faint but visible, which was the intent.

**What it looks like now.**
- **Top of page 1:** a full-width brand band, 20 mm tall — the desk name (still a placeholder) on the left, "Statement
  of Account" on the right, both white, with room held at the left for a logo later. Under it the customer's name,
  large and bold, then one grey line: *Account 1A9B1E31 · 15 Sep 2026 to 21 Sep 2026 · Generated 21 Sep 2026, 19:34.*
- **Summary:** one horizontal strip of four — opening balance, total debits, total credits, closing balance. Closing
  is the only large figure, in the brand colour, with Dr or Cr. The "Dr" and "Cr" after the two totals are gone, and
  so is the formula sentence; the check that opening plus debits less credits equals closing **still runs in code**
  and still refuses to build a statement that does not add up.
- **Table:** rows 16 pt apart at 8.7 pt, alternate rows tinted, no lines between them. The date heading is in the
  brand colour, bold, with a thin brand rule under it. In each row the *type* — Sale, Purchase, Payment received,
  Transfer to, Cheque cleared, or a journal narration — is bold and the details after it are grey; the reference is
  smaller and grey. Numbers are black and right-aligned, and in the Balance column the Dr or Cr is smaller and
  lighter and sits in a fixed slot at the edge, so the digits line up whether or not there is one. **No red or green
  anywhere.** The closing row is a tinted band under a brand rule, bold.
- **Later pages:** a slim brand line, the customer's name and "continued", then the table header — no band.
- **Footer:** a thin grey rule, the customer's name on the left, "Page X of Y" on the right.
- **After the table:** currency position and pending cheques in the same style — small grey section labels, the same
  row spacing and tint, no boxes.

**Black and white.** A grayscale mode was added so the result could be checked rather than guessed: it renders every
colour as its grey. The band becomes a dark grey with legible white text, the date headings and the closing figure
stay bold and readable, and the stripes survive as a faint tint. The sample statement was checked in that mode.

**The trade-off, stated plainly.** Rows 16 pt apart are easier to read and take more room. Page 1 now holds about
**32 entries** in the test statement (28 in the worst case, five days on one page), where the first design held 42
and the client's reference holds about 39. On the 61-entry test customer the pending-cheques section spills onto a
third page that carries nothing else, because the currency-position section fills what was left on page 2. It obeys
the rule that a section is never split, but it is a real cost of the airier spacing; if it matters, the fixes are a
slightly tighter pitch or letting a short section share a page differently.

**One small deviation, flagged.** The closing row of the table used to print "Dr" and "Cr" after its debit and credit
totals. They were removed to match the summary strip and because the column headings already say which side each is.

**Fixed while looking at the pages.** Two faults only visible on paper: the "Payment received · Cash" separator was
hidden under the last letter of the bold type (the width was measured in the wrong face), and the pending-cheques
label was printed over by its own note.

**Tests: 477, all passing** (194 screen, 203 server, 80 calculator), up from 459. Tests that check layout numbers or
how text is emitted were updated; new ones hold the design to its promises — the palette's contrast ratios (computed),
the tint staying faint in grayscale, no colour leaning red or green, the 16 pt pitch, the 20 mm band, the removed
elements staying removed, and the grayscale mode really producing only greys. Each was confirmed to fail when the
thing it guards is broken on purpose (a lighter brand colour, a stronger tint, a red introduced, grayscale switched
off).

### Found

| Finding | Severity | Status |
|---|---|---|
| The favicon is indigo (`#3d46d0`) while the in-app logo is blue (`#2563eb`) | Low, cosmetic — two brand colours | **Open** — noted, not changed; the PDF follows the logo |
| The airier row spacing costs about ten entries on page 1 and, on a long statement, can leave a short last section alone on a page | Low | **Open** — a design trade-off for the owner to accept or tune |

### Not done, deliberately

- No font was embedded (built-in Helvetica), as instructed — so Arabic and Urdu names still cannot be printed.
- Nothing was pushed or deployed; production was not touched.
- The on-screen statement and the Excel export are unchanged.

### Next

1. Decide whether the row spacing stays at 16 pt (see the trade-off above).
2. Real branding: the desk's name and logo, when they exist — the band already has the room.
3. Everything listed under the previous statement-PDF entry still stands.

## 2026-09-21 — the customer statement becomes a real PDF, and same-day order is fixed

### Done

*At a glance: the Print button on a customer's statement now produces a proper A4 PDF instead of printing
the screen, and a fault in the order of same-day deals that the work uncovered was fixed first, as its own
change. **Nothing here is pushed or released** — it is committed locally, waiting on the owner. The
statement on screen and the Excel export are unchanged.*

**Why it was rebuilt.** Print and Export PDF both called the browser's print dialog on the statement page.
On A4 that was unusable: the Balance column was cut off ("PKR 3,8"), cells wrapped one word per line, the
closing balance landed alone on page 2, and the browser printed `localhost` addresses in the header and
footer. The client's reference is his old system's "Statement of Account Ledger" — portrait A4, about forty
rows on a page — and the brief was to match its structure and beat it.

**First, a separate fix: deals on the same day were listed backwards.** Every deal on a day carries the
same date, the database hands back the newest first, and the statement kept that order on a tie — so dates
ran oldest-first but the deals *inside* a day ran newest-first, each row's running balance following the
reversed order. A balance crossing from debit to credit partway through a day showed the wrong side on the
wrong rows. It is now oldest-first within a day, by the moment each entry was really keyed in (never by id),
so the screen, the Excel export and the PDF all agree. Its own commit, with five tests that were confirmed
to fail against the old ordering. Deliberately not in the PDF work, because it changes what the on-screen
statement shows.

**The PDF.** Portrait A4, built in the browser so the server does no extra work. The library is jsPDF,
chosen after measuring five candidates: 130 KB compressed against 200–810 KB for the others, and it is only
downloaded the first time someone presses Print. The table is drawn by hand rather than through a helper
plugin, because the page-break rules below needed exact control.

- **Header:** desk name (a placeholder — branding comes later), "Statement of Account", customer, a short
  account id, the period, and when it was generated.
- **A summary box near the top:** opening balance, total debits, total credits, closing balance, each with
  Dr or Cr, and a line stating that opening plus debits less credits equals closing. It is not only stated,
  it is *checked*: the statement refuses to be built if the figures do not add up.
- **Every amount to the exact paisa,** so every column adds up on paper. The old print rounded each row to
  a whole rupee and its rows summed to 4,749,857 against a printed closing balance of 4,749,856. Showing
  whole rupees is an open question for the client, so the number of decimals is **one setting** in one file
  rather than formatting scattered through the code.
- **Table:** Description, Ref, Debit, Credit, Balance, grouped under a date row, oldest first, starting
  with the opening balance. Each row is one line — "Sale · 3,000,000,000 TMN @ 788", "Payment received ·
  Cash", "Cheque cleared · HBL 001234", "Transfer to Bilal Traders" — and a balance shows Dr or Cr, never a
  minus sign. The closing row also carries the column totals.
- **Boxes after the table:** the currency position in plain words ("Sold to customer" / "Bought from
  customer"), and the uncleared cheques with their amounts, stating that they do not affect the balance
  until they clear.
- **Every page:** "Page X of Y", the table header repeated, and no browser header or footer. The closing
  balance always shares its page with at least three rows above it. A day that continues onto a new page
  repeats its date band marked "continued" — found by looking at the first page-2 render, where the top rows
  belonged to no date at all.
- **Roughly 42 entries fit on page 1**, against the reference's 39.
- **Print opens the PDF in a new tab; Export PDF downloads the same file.**

**Nothing about profit, for anyone.** The statement is built only from fields the statement already reads,
so an operator's copy is made from the same data. A test feeds a statement whose source rows carry cost
and margin and checks that neither the figures nor the words appear anywhere in it.

**Text the PDF's font cannot print.** The built-in fonts cover Western European text only. Measured: an
Arabic or Urdu name comes out as a run of unrelated accented letters, and an arrow as garbage — silently. So
unsupported characters are replaced with a question mark, **and the app warns before the PDF opens**,
naming the field ("Customer name") and the characters. The person can cancel, or carry on knowing. The
wording the app writes itself is checked so that it never needs the warning ("to", not an arrow).

**How it was checked.** Worked by hand for the dev customer Dubai Tmn Buyer (5 entries: 0 + 5,749,855.69 −
1,000,000.00 = 4,749,855.69 Dr) and for a test customer with 61 entries over six days including a debit-to-
credit crossing, two transfers, a cleared cheque and two pending ones (0 + 1,422,242.49 − 3,014,816.16 =
1,592,573.67 Cr). The generated pages were opened and read. In the running app, as the operator: the Print
button opens a PDF in a new tab, Export PDF produces the same file (checked without saving it), the warning
appears for an Arabic-named customer and Cancel opens nothing. The PDF the browser built for the 61-entry
customer was exactly the same size (10,477 bytes) as the one built outside the browser.

**Tests: 459, all passing** (176 screen, 203 server, 80 calculator), up from 396. The page-break rules are
tested by sweeping every table length from 1 to 200 rows. Two tests were found to be weaker than intended and
fixed by breaking the code on purpose: one read its threshold from the very setting it was guarding, and one
searched for text with an escape that made it match something else, so it could not fail.

### Found

| Finding | Severity | Status |
|---|---|---|
| The statement's Print/PDF was unusable on A4 (cut-off column, one-word lines, lone closing balance, localhost in the header) | High for a document handed to customers | **Fixed** (committed locally, not pushed) |
| Same-day deals listed newest-first inside oldest-first days, with running balances following the wrong order | Medium — wrong side printed on the wrong rows when a balance crosses in a day | **Fixed** (its own commit, not pushed) |
| **An operator's statement can differ from the customer's real balance.** The server withholds any journal entry with an Income leg from operators, so a manual entry such as a fee charged to a customer moves the stored balance but does not appear on the operator's statement. Reproduced: a customer with a sale of 8,000 plus a 2,500 fee — admin statement 10,800, stored balance 10,800, **operator statement 8,300**, and the operator's own customer list and the top bar say 10,800 | Medium — a customer statement that does not match the balance the same screen shows | **Decided by the owner 2026-09-21, not built in this release.** The rule is below. Until it is built the PDF prints whatever the statement data contains, so an operator's statement can still be short by such an entry |
| Arabic and Urdu customer names cannot be printed by the PDF's built-in font, and no library used here would shape them correctly | Medium if any customer uses those scripts | **Mitigated** by the warning; the underlying question — do any customers use those scripts? — is **open for the client** |
| Trades and payments have no human deal number; the only reference is the first 8 characters of an internal id, as the Transactions page shows | Low today, real for a client used to `DTMS6173` | **Open follow-up** — see Next |
| The statement's on-screen columns crowd at ten-digit amounts | Low, cosmetic | Open follow-up (unchanged, recorded earlier today) |

### Decided: what an operator's statement must show

Ruled by the owner on 2026-09-21, after the mismatch above was reproduced. **A statement that adds up but shows
the wrong balance is worse than one that reveals a fee exists**, so the option of keeping the operator's
document self-consistent — which had been the recommendation — is **rejected.**

**The rule:** an operator's statement must show **the customer's own leg of any entry that moves their
balance**, with a **neutral description and no account names.** So a fee charged to a customer appears on that
customer's statement, in the right place, with the right amount, described in neutral words (for example
"Adjustment") — never the Income account's name, its id, the entry's narration, or the other leg. It is
**pending the client's confirmation**, and it is **not built in this release.**

What building it will involve, so it is not underestimated:

- Today the server withholds the **whole** entry from an operator's copy of the data whenever any leg is on an
  Income account. Showing the customer's leg therefore means the server must send a **redacted** version of
  such an entry — the customer's leg only: its date, its amount, which side it moved — and nothing that names
  or identifies the Income account. That is a change to the backend's snapshot filtering, not to the PDF.
- It must be tested the other way round as carefully as the omission was: a test must prove the redacted row
  carries no Income account id or name, no narration and no reference that could identify the entry.
- The same fix would correct the on-screen statement, which today shows the operator the same wrong closing
  balance (8,300 against the real 10,800 in the reproduction).
- It will need agreement on the neutral wording, and on whether the amount of the customer's leg being visible
  is acceptable — the owner's ruling accepts that a fee's existence and its amount to the customer are shown.

Until it is built, an operator's statement remains short by any such entry.

### Not done, deliberately

- The operator filtering was **not** changed, as instructed. The rule the owner then decided for it is recorded
  under "Decided" below and is a separate piece of work.
- Human deal numbers were **not** built.
- The on-screen statement and Excel export are untouched.
- Nothing was pushed or deployed, and production was not touched.

### Still to do

- **Look at the PDF once as the admin in the running app.** Everything above was checked as the operator in the
  browser and as both roles through the server's own data; the admin path in the browser has not been pressed.
- **Dev database: done.** The test customers were cleared with the guarded reset tool — dry run first, on
  the local database only — and the client's three Dubai deals rebooked (the consistency test is green at all
  five dates afterwards). The live system was not involved. The four sample PDFs were saved before the
  reset, to `Downloads\statement-pdf-samples`.

### Next — in priority order

1. **Operators must see the customer's own leg of any entry that moves their balance, with a neutral description
   and no account names** — decided by the owner, pending the client's confirmation, **not built in this release**
   (see "Decided" above; it is a backend change to the snapshot filtering). Confirm the wording with the client, then build it.
2. **Sequential human deal numbers** (like the client's `DTMS6173`) — its own item. Trades and payments carry
   only an internal id today, so the Ref column shows its first 8 characters. Real numbers are a data-model
   change and were not built; the PDF will pick them up when they exist.
3. Ask the client three things: **whether any customers use Arabic or Urdu script** (the PDF cannot print
   them); **whether he wants whole rupees or exact paisa** on statements (a one-line change, but the columns
   then stop adding up on paper); and the desk's real name for the header.
4. Push the statement work when the owner is ready (two commits: the ordering fix, then the PDF).
5. Unchanged: fix the `idleTimeout` test failures; teach `reset:business` about closed months; widen the
   on-screen statement's columns; decide the operator's live margin estimate; the deposits-and-advances
   question for the client; and switching the reports over to read the accounting record.

## 2026-09-21 — the desk's Iranian currency is now the Toman, and a sale's figures always sum

### Done

*At a glance: the Iranian currency was replaced with the one the client's dealers actually use, and
in doing so the client's own figures exposed a one-paisa fault in how a sale is recorded, which was
fixed before this release. **Released to the live system on 2026-09-21** — the database change at
14:12 Pakistan time, the software straight after (commit `f0d3e4b`). The checks in the running app
were done first, and the release itself is recorded below.*

**The Iranian currency is now the Toman, not the Rial.** The desk used to trade the Iranian *rial*
(code IRR). The client and his dealers have only ever quoted and counted in *toman*, and his previous
system's ledger books it that way — `SALE Dubai Tmn 3,000,000,000@797`. One toman is ten rials, so
typing toman figures into a box that means rials is a tenfold booking error waiting for a busy
afternoon. The desk never deals in actual rials, so this was a clean replacement rather than a
relabel: the code is now **TMN**, shown as "Toman", and IRR is no longer a currency the software
knows or accepts (it survives only in explanatory comments, the two older database changes, and
the tests that check it is refused). It is quoted the same way as before ("toman per 1 rupee", divided), and it is still the
last currency in the list.

Deliberately left alone, as instructed: how weighted-average cost is worked out, the credit-only
trade flow, and the cap on Receive Payment.

**Nothing on the live system needed converting.** Checked read-only before starting: the live
database held no rial stock, no rial deals, no accounting entries against it and no cheques — it had
been cleared earlier the same day (see the entry below). So there was no data to convert or delete.

**A new database change, number 021, does the swap — and refuses to run if it could do harm.** It
renames the currency's stock position and its stock account. It **aborts, changing nothing,** if any
figure anywhere is still denominated in rials, or if a toman row somehow already exists. That is
deliberate: an existing rial figure is a rial figure, and relabelling it "toman" would silently make
it ten times too large. Whether a given old deal was keyed in rials or in toman by mistake is
something only a person can know, so the change never guesses. Every one of the refusal cases was
exercised, inside a transaction that was rolled back, and the change was also confirmed to run
cleanly on a brand-new database built from the very first migration. The two older changes that
created the rial (012 and 014) still say "IRR" on purpose: they record what was true the day they
ran, and editing them would make a database built before this change differ from one built after it.

**The client's own three ledger lines are now the acceptance figures.** 3,000,000,000 toman at 797 is
3,764,115 rupees; 5,000,000,000 at 787 is 6,353,240; 3,000,000,000 at 788 is 3,807,107 (it comes to
3,807,106.60 and rounds up). The software reproduces all three, and the stored figures match his
ledger to the paisa. Fifteen of the changed calculator tests were confirmed to fail against the old
rial setup, so they genuinely test the change. One protection worth knowing about: if a stray "IRR"
were merely left unrecognised rather than removed, the software would treat it as an ordinary
currency and book a rial-typed trade roughly 635,000 times too large. So IRR is refused outright,
and a test pins that.

**A sale's three figures now always add up — a fault found only because of the client's real
numbers.** Every sale produces three figures that must sum: what the customer owes, what the stock
cost, and the profit. They used to be rounded to the paisa separately and could end up one paisa
apart. The client's third ledger line reproduced it exactly: 3,807,106.60 owed, 3,794,008.34 cost,
13,098.25 profit — which adds up to 3,807,106.59. The record of the sale then debited the customer a
paisa less than the balance actually moved, and the consistency check (`npm run reconcile`) went red
on that customer at all five dates. This had been logged as an open audit finding (AUDIT.md §3 #4)
with the note "fix before the first Toman sale", and it was left alone by the currency change on
purpose, then fixed separately as its own change once the owner decided to.

The rule now: the amount owed and the cost are each rounded to the paisa **once**, and the profit is
simply the difference, never rounded on its own. The profit is the right figure to absorb the
rounding — it is the only one of the three that is derived rather than a fact. On the client's sale
the amount owed and the cost did not move at all; the profit changed from 13,098.25 to 13,098.26.
It is confined to the one shared sale calculation, so the saved record, the customer's balance and
every line of the accounting entry receive the same already-rounded figures.

Two things about how that was checked, because they are the reason to trust it. First, an early
version of the rounding moved a cost by a paisa on one value in 200,000 when compared with what the
database itself stores — the owner's rule was to stop if any figure other than the profit moved, so
it was stopped, diagnosed and rewritten to round on the digits the same way the database does; the
final version was compared with the database over 600,000 rounded values across three runs, and the
amount owed and the cost moved **zero** times. Second, the profit differed from the old
independently-rounded figure on about **one sale in ten** — so this was not a rare edge case; roughly
one in ten sales would have drifted by a paisa. The new tests were confirmed to fail against the old
rule, and my first integration test turned out to pass under both rules (extra purchases earlier in
the same file had shifted the average cost off the fault), so the regression test lives in its own
file that runs the client's exact sequence on a clean desk.

**Checked against the consistency test, before and after.** Green before the change; red by one
paisa after the currency change, traced to the rounding fault above (and confirmed against the
stored rows, not just assumed); **green at all five dates after the rounding fix**, on a local
database rebuilt with the client's three deals plus a dirham (AED) control sale. The local
database had held rial demo deals, so it was cleared with the same guarded tool used on the live
system before the change was applied there, and again before the rounding check.

**Tests: 396, all passing** (118 screen, 203 server, 75 calculator), up from 380. A normal run from
the repository root creates and migrates its own test database if it is missing.

### A test that goes red about a third of the time — pre-existing, cause unknown

The server test suite fails intermittently, always in `idleTimeout.test.ts`, and **it is not caused by
the toman change or the rounding fix.** The symptom is a login that comes back "401 not
authenticated" (or with no session cookie) partway through that one file; which test in it fails
varies from run to run (four different ones so far).

To find out whether today's work was involved, the tests were run on `b96470e`, the commit before any
of it, in a separate copy of the code with its own dependencies and a freshly recreated test
database: **1 of 3 runs failed there too**, with the same symptom. On the changed code the same
procedure gave 1 failure in 3. Counting every full server run made on the day: **3 of 11 failed**
(2 of 8 on the changed code, 1 of 3 on the old commit), plus 1 of 8 runs of that file on its own —
roughly one run in four to one in three. It is not tied to a freshly built database (it failed on the
second run of three, not the first), and it is **not** the cache problem recorded on 2026-09-03: that
one produced a wrong stored value, not a lost login. The cause has not been found. These are small
samples, so the rate is only approximate.

It does not block this release, but a test suite that goes red a third of the time trains people to
ignore red, and it needs fixing — it is listed as its own follow-up below.

### Found

| Finding | Severity | Status |
|---|---|---|
| The desk's Iranian currency was the rial, but dealers and the client's own ledger count in toman — a tenfold booking error waiting to happen | High, once real trading began | **Fixed 2026-09-21** (replaced by the toman); **released 2026-09-21** |
| A sale's amount owed, cost and profit could be one paisa apart (AUDIT.md §3 #4); reproduced by the client's own third ledger line; about one sale in ten would have drifted | Medium — small per sale, but it made the consistency test go red and the sale's accounting entry disagree with the customer's balance | **Fixed 2026-09-21** as its own change; **released 2026-09-21** |
| An early version of the fix would have moved a cost by a paisa on one value in 200,000 | Would have been Medium, had it shipped | **Caught by checking against the database before release**; rewritten |
| `idleTimeout.test.ts` fails about one run in four to three, on old and new code alike | Medium — makes the whole suite untrustworthy | **Open — pre-existing, cause unknown** |
| `npm run reset:business` does not clear closed months, so a closed month survives a reset and blocks trades dated in it | Low for now — the live system had none | **Open — follow-up** |

### Checked in the running app

Done on 2026-09-21 on the local system, as the admin login and as the operator login, in light and
dark mode. Toman deals were booked through the real screens — a sale by the admin and a sale by the
operator — not just through the server.

- **The screens read correctly.** The currency picker lists six currencies with the Toman last and no
  rial. The rate box says "toman per 1 rupee", and the sale preview and review screens show "Toman
  (TMN)". The Transactions page shows the client's three ledger lines to the rupee. The Currency
  Stock page, the customer statement and the Balance Sheet all show the toman position, its average
  cost in the dealer's own convention (790.72 toman per rupee), and totals that foot.
- **The stored figures are right.** Each sale posted through the screens stored an amount owed, a
  cost and a profit that sum to the paisa, and an accounting entry that debits the customer exactly
  the balance that moved. The consistency test stayed green at all five dates with all three
  screen-booked trades included.
- **Ten-digit amounts fit.** The screens were laid out for nine digits and the client's real amounts
  have ten; nothing is cut off anywhere it was looked at.
- **Excel export** checked by capturing the file the button builds, without saving it: exact-paisa
  figures, a TMN currency column, and a closing balance that agrees with the screen. It carries no
  cost or profit column for anyone.
- **The operator sees no profit figures, and that was checked in what the server sends, not just
  what the screen draws.** The operator's copy of the data and the response to the operator's own
  sale contain no cost or profit on any deal and no accounting entry against the profit account; the
  Income Statement shows "Admin access required"; the stock page drops its Margin and running-cost
  columns.
- **Not verified: the PDF.** "Export PDF" is the browser's print dialog, which was deliberately not
  opened. The document header it prints was read ("Customer Statement — <customer> · Full history ·
  N entries") and the table it prints is the one checked above, but the rendered print layout has
  not been looked at.

Two observations, neither changed:

- **The statement's columns crowd at ten digits.** The rate, rupee and balance columns sit only a few
  pixels apart on a ten-digit row (`788.00 PKR 3,807,107 PKR 3,847,107 Dr`). Fully readable, nothing
  truncated, but tight, and the client's real amounts will always be this size. Widening the
  statement's fixed width would fix it. Cosmetic.
- **The operator's sale form shows a live profit estimate** ("Margin +PKR 1,379"). This is not new and
  was not changed: it is worked out on the operator's screen from the average cost that screen has
  to hold to price a sale at all, and CLAUDE.md already records that profit remains approximable for
  an operator. It is noted because it sits oddly beside the server's careful omission of profit.

### Released

Released to the live system on 2026-09-21, database change first, on the owner's go-ahead after the
dry-run output had been shown.

- **Before touching anything**, a read-only look at the live database confirmed the conditions the
  change itself requires: no rial deals, no accounting entries or cheques mentioning the rial, no
  rial stock, and no toman row already there. The desk was still empty — no deals, entries, cheques,
  customers or closed months — and 20 database changes were applied.
- **Dry run:** the target was the live database and it listed exactly one pending change, number
  021, and nothing else.
- **Applied at 14:12:03 Pakistan time (09:12:03 UTC).**
- **Confirmed three ways, before anything else happened:**
  1. The tool reported the change applied and finished cleanly.
  2. The result was read back from the live database: the toman stock row exists at zero and there is
     no rial stock row; the stock account is now "Currency stock (TMN)" and is still a system
     account, and there is no rial account; six stock rows and six stock accounts; and nothing else
     moved — no deals, no entries, no customers, both logins intact, 13 system accounts.
  3. Change 021 is in the list of applied changes (21 in all), and a second dry run said nothing was
     pending.
- **The software was pushed immediately afterwards** — commit `f0d3e4b`, which carries four commits:
  the currency change, the rounding fix, the documentation, and the record of the checks. It was
  chained after the three confirmations so it could not have gone out if any had failed. Both
  hosting builds succeeded: the screen half reported success at 09:13:16 UTC and the server half at
  09:13:39 UTC. **The new server therefore went live roughly 96 seconds after the database change.**
  In that gap the old software ran against the renamed database; nobody could have traded in it,
  because the desk is empty, and the order (database first) is what made the gap harmless rather than
  a failure.
- **The live site was checked afterwards.** The screen code it actually serves contains "TMN per 1
  PKR" and "Toman", contains no "IRR per 1 PKR" and no "Iranian Rial", and contains the new rounding
  code. The server answered as expected to an unauthenticated request.

### Still to do

- **Look at the live site once.** Sign in and open Currency Purchase to see that the picker lists
  the Toman last. No trade is needed, and none should be made — the desk is empty on purpose. This
  was not done as part of the release, because the live system cannot be signed in to from here: so
  the live server's handling of the toman is confirmed by a successful build and by the database
  state, **not by having watched it work.** The first real toman trade will be its first test.
- **The PDF's printed layout** has still not been looked at (see above).

### Next — in priority order

1. Have the live site looked at once, as described under "Still to do".
2. **Fix the `idleTimeout` test failures** — its own item. Find out why a login intermittently comes
   back 401 in that file. Do not "fix" it by re-running until green; the failure predates today's
   work and a third of runs going red needs a cause, not a retry.
3. **Teach `npm run reset:business` to handle closed months** — its own item, separate from the
   above. A month closed on the Margin Ledger page survives a reset and refuses every trade dated in
   it. Found on the local database; the live system had no closed months. Either reopen closed
   months as part of the reset or have it report them, before the tool is used again.
4. Unchanged: the client still owes an answer on whether the desk ever takes a deposit or pays an
   advance before any deal exists.
5. **The operator's sale form shows a live profit estimate** — its own follow-up, named by the owner.
   Existing behaviour, not new, and documented in CLAUDE.md: it is worked out on the operator's
   screen from the average cost that screen holds. It sits oddly beside the server omitting profit
   for operators, so whether to hide it is a product decision.
6. **Widen the customer statement's columns for ten-digit amounts** — its own follow-up, named by the
   owner. The rate, rupee and balance columns sit a few pixels apart on a ten-digit row; fully
   readable, but the client's real amounts will always be that size. Cosmetic.
7. Unchanged, and still the largest open piece of work: switching the reports over to read the
   accounting record.

## 2026-09-21 — the live desk is empty on purpose

*Read this before treating an empty live system as a fault. It is not one.*

### What was cleared, and why

On 2026-09-21 the live system's business data was deliberately deleted, leaving blank books. Every
figure on it was practice data — deals and payments keyed in by the owner during a demonstration to
show the client that the live system works — and none of it was the client's. The client has not
started trading on it. So there was no reason to carry practice figures into the books he will
actually run, where they would sit in every report and every balance forever.

Removed: **12 deals, 11 accounting entries, 4 cheques**, and the practice customer accounts. 15
accounts existed in total, of which the 13 structural ones — the accounts the books themselves are
built on — were kept. Currency positions were set to zero rather than deleted, since the trading
code needs a row to exist for each currency. Entry and cheque numbering were restarted, so the
client's first transfer will be JV-001.

Kept: both logins, all login sessions, the settings row, and the database structure (20 migrations
at the time). Nothing about who can sign in changed.

### How to recognise this state

The live system shows **no customers, no deals, no cheques, no accounting entries, and no currency
held**, with all six currencies present at zero. Every page loads and every report is blank or zero.
That is the intended state until the client's first real entry. **Do not "fix" it by seeding data**
— the demo logins from `seed:demo` create logins only, never trades, and nothing else should be
added to make the screens look busy.

### Safeguards used

A full read-only backup was taken first and kept outside the repository, because it holds real
names and balances; a `.gitignore` rule now stops any such backup from ever being committed. The
tool ran a dry run first and only then the real thing, needed the database name typed back to
confirm, and ran nine checks before committing. Afterwards every count was re-queried directly
rather than trusting the tool's own report.

### One gap this turned up in the clearing tool

`reset:business` does **not** clear closed months (the `periods` table). A month closed on the
Margin Ledger page therefore survives a reset, and a closed month refuses every trade dated inside
it. Found on the local development database, where a stale closed September would have blocked every
trade dated this month. **Production was checked and had no closed months**, so the live desk is
unaffected, but the tool should be taught to handle it before it is used again.

## 2026-09-21 — the live system cleared back to empty books, and two faults the clearing exposed

### Done

*At a glance: the two items left open yesterday are both closed. A cheque was walked through its
full life on the live system, and then the live system was cleared of every practice figure. The
clearing itself surfaced two defects — one in the clearing tool, one in a test — and both are
fixed.*

**A cheque was walked end to end on the live system.** This was the one path never exercised
against the released software. All four outcomes were covered: one cheque cancelled, one deposited
and returned, one deposited and cleared, and one left pending past its due date so the overdue
flagging could be seen working. The customer's balance moved by exactly the cleared amount and by
nothing else — 39,100 down to 36,100 — which is the correct answer: a cheque that is cancelled,
returned or still pending must leave the balance alone, and all three did.

**The live system has been cleared back to empty books.** Everything on it was practice data, keyed
in during a demonstration to show the client that the live system worked. It is all gone. What
remains is what should remain: the thirteen structural accounts the books are built on, both
logins, the settings, and the currency rows the trading code needs to exist. No customers, no
deals, no cheques, no accounting entries, and no currency held. The reference numbers are reset, so
the client's first real transfer will be JV-001 rather than continuing from a practice number.

Verified independently rather than taking the tool's word for it — every count queried directly
afterwards. A backup of everything was taken first and kept off the machine's shared history, since
it holds real names and balances.

**The clearing tool refused to run, and it was right to refuse — for the wrong reason.** It checks
that the database structure is untouched before committing, and that check compared against a
number written into the code by hand. Two structural changes have shipped since it was written, so
the number had gone stale and the check failed — announcing that the structure had changed when
nothing about the clearing touches the structure at all. Because a failed check correctly abandons
the whole operation, nothing was cleared and nothing was damaged; the tool behaved safely.

The obvious repair was to update the number. That was not done, because it would have set the same
failure to happen again on the next structural change. The check now reads the real figure before
starting and confirms it is unchanged at the end, which is how the two checks either side of it
already work. It keeps its meaning and stops expiring.

**A test was found to be wrong about time, in the app's oldest trap.** The desk runs on Pakistan
time; the machines the software runs on run on UTC, five hours behind. There is a whole piece of
the system built for exactly this, and a test written during the due-date work quietly bypassed it,
working out its expected date from UTC instead. The consequence: that test passed for nineteen
hours of every day and failed for the other five. It failed on a run at half past two in the
morning desk time, and the software was the one in the right — the test was wrong. Now corrected to
ask the same clock the software asks.

Worth recording because the failure is the good outcome here. A test that is wrong about time in a
five-hour window is the kind of thing that gets dismissed as a fluke, re-run an hour later, passes,
and stays broken.

**Full suite green: 380 tests** (118 screen, 200 server, 62 calculator).

### Found

| Finding | Severity | Status |
|---|---|---|
| The clearing tool's structure check compared against a hand-written number that had gone stale | Medium — it blocked a legitimate clearing and would have failed again on the next structural change | **Fixed 2026-09-21** by deriving the figure instead |
| A due-date test worked out its expected date from UTC rather than the desk's clock, so it failed for five hours of each day | Low — a test fault, not a product fault; the software was correct | **Fixed 2026-09-21** |
| The live system had no cheques, so the cancel path had never been exercised there *(carried from 2026-09-20)* | Low | **Closed** — walked end to end, all four outcomes |
| Practice data was still on the live system *(carried from 2026-09-20)* | Low | **Closed** — cleared, and verified empty |

### Next — in priority order

1. **A question for the client, still unanswered:** does the desk ever take money from a customer,
   or pay one, before any deal exists — a deposit held against future business, or an advance paid
   out? The system currently requires an existing balance before a payment can be recorded, so a
   customer with nothing outstanding cannot be paid or take a deposit. Whether that is correct is a
   business decision, not a defect, and it needs the client's answer before anything is built.
2. Unchanged, and still the largest open piece of work: switching the reports over to read the
   accounting record.

## 2026-09-20 — the cheque lifecycle gains a way to undo a mistake, a real due date, and a register

### Done

*At a glance: three pieces of cheque work, then the release that put all of it — plus the previous
day's accounting fixes — onto the live system. The release needed a database change first, and was
done in that order deliberately.*

**A cheque entered by mistake can now be cancelled.** Before this there was no way to remove one.
The only route off the uncleared list was to mark it deposited and then returned — which writes a
history saying the cheque went to the bank and bounced, two events that never happened, on a record
the client shows customers. Cancelling is now its own outcome, and it reads honestly: *"Recorded
20 Sep → Cancelled 20 Sep"*.

Deliberately only available while the cheque is still **Pending**. Once it has been marked
deposited it is with the bank and its outcome is cleared or returned; once cleared it has moved
money, and undoing that is a reversal — a separate piece of work that is scoped and deliberately
not started. Cancelling moves no money, and there is nothing to move: a cheque that has not cleared
never touched the customer's balance in the first place. Admin only, matching clearing and
returning. Who cancelled it and when are both recorded on the cheque.

**The due date is now real rather than decorative.** It used to be set automatically to two weeks
after entry, displayed, and read by nothing at all — a date that corresponded to no real date on
any real cheque, which is why nothing could sensibly be built on it. The dealer now types the date
actually written on the cheque, still defaulting to two weeks out so nothing changes for anyone who
does not care.

With a real date, the page can finally use it: an uncleared cheque past its due date is flagged, the
summary cards count how many are overdue, and the list can be sorted by due date or filtered to show
only the overdue ones. This needed its own date checking on the server — a due date is the one date
on the desk that is *supposed* to be in the future, so the existing rule that refuses future dates
would have rejected the ordinary case.

**A Cheque Register**, at the client's request: every cheque as one accounting line, listed by the
day it was received, showing which account is debited and which credited. Investigated before
building, and two things came back that changed the shape of it:

- **The debit and credit accounts are already decided by the system and never chosen by anyone.**
  An inward cheque debits the desk's bank and credits the customer; an outward one is the mirror.
  Both accounts were already fixed when the cheque was entered. So the register shows them, rather
  than offering them as choices — which is what was asked for once that was confirmed.
- **A "posting date" was asked for and dropped, on the evidence.** A cheque entry posts nothing to
  the books; the posting happens when it clears, dated the day it cleared. A posting date captured
  at entry would either be ignored or would contradict the rule the whole cheque model rests on.

It is a **view, not a second way to enter cheques** — confirmed before building. Cheques are still
recorded on Receive/Make Payment, which writes both the cheque and the payment behind it together.
A second entry path would either duplicate that pair or, worse, write a cheque with no payment
behind it: that looks correct on screen and produces wrong books, because clearing then moves a
balance that was never raised.

**One thing the register needed that did not exist:** a cheque row carries only the date it was
keyed in, so a cheque taken on Monday and entered on Wednesday would have listed under Wednesday.
The day it was actually received is the date of the payment it was taken against, so the register
reads that instead.

**Two rounds of visual polish** on the Cheques page and the register, at the client-facing owner's
direction: text that was butting together given real spacing, one consistent status badge
everywhere, actions gathered into a single column on the right so row height stops depending on how
many buttons a row happens to offer, customer names no longer cut off mid-word, and the date the
cheque was received promoted from a greyed-out caption to a column of its own beside the due date.

**Released to production, database change first.** This is the part worth recording carefully. The
new cancelled status needed a database change, and the instruction as first written would have put
the new software live before that change was made. Pushing *is* the release on this setup — there
is no separate step — so the order was inverted after flagging it: the database was changed first,
confirmed applied three separate ways, and only then was the software released. Both halves
deployed successfully and are serving the released version.

Checked afterwards on the live system: the pages load, the register appears, no errors. One check
could not be completed — there are no cheques on the live system at all, so there is no pending
cheque for the cancel button to appear on. The underlying route was confirmed present and
responding; it simply has nothing to act on yet. It will be exercised the first time the client
records a real cheque.

**Full suite green throughout: 380 tests** (118 screen, 200 server, 62 calculator), up from 357.

### Found

| Finding | Severity | Status |
|---|---|---|
| A mis-entered cheque could only be removed by recording a bank trip and a bounce that never happened | Medium — false history on a record the client shows customers | **Fixed 2026-09-20** |
| The due date was automatic, unchangeable and read by nothing — so no overdue tracking was possible | Medium — the client cannot be warned about cheques going stale | **Fixed 2026-09-20**, and overdue flagging built on top of it |
| The release order as first written would have put new software live before the database change it needed | **High**, had it gone ahead | **Caught before release**; order inverted and the database changed first |
| The live system has no cheques at all, so the cancel button could not be exercised there | Low — the route was confirmed present | **Open**: it will be exercised on the client's first real cheque |

### Next — in priority order

1. Walk a cheque through its full life on the live system once there is one to walk — the cancel
   path is the only one never exercised against the released software.
2. Clear the practice data from the live system, as planned.
3. Unchanged: switching the reports over to read the accounting record remains the largest open
   piece of work.

## 2026-09-19 — a customer-to-customer transfer, and the accounting replay it forced

### Done

*At a glance: a new client request (move money between two customers' accounts without any cash
changing hands), and then three accounting corrections it exposed — one of which had to be fixed
before the new feature could safely go live.*

**What the client asked for.** One customer says "take 10 lac out of my account and give it to the
other customer". The second customer does not want it paid out; he keeps a running balance with the
desk and wants it credited there. No money moves through any bank or cash account — one customer's
balance goes down and the other's goes up.

**Most of it already existed.** Checked before building, per the usual instruction: the accounting
for exactly this was already possible from the admin-only Journal Entry page, which has always been
able to post between any two accounts and has always moved both customers' balances correctly. What
was missing was a sensible way in. So this is a purpose-built screen for something the books could
already do, not new accounting — which is why the server needed almost no change.

**Deliberately not treated as a new payment method.** It sits beside Cash/Bank/Cheque as its own
control rather than joining them, because it is not a way of moving money — it is a different kind
of record that replaces the money side entirely.

**Transferring more than the customer has is allowed, with a clear warning.** Confirmed with the
client. A running balance legitimately crosses from credit into debt, and refusing it would make
the new screen less capable than the Journal Entry page it replaces. The screen says plainly what
will happen — "this will leave them owing the desk X" — rather than silently allowing it or
blocking it outright. Creating one is admin-only; the resulting entry is visible to everyone, since
it discloses no profit figures.

**Then the checking tool was run, and it was not clean.** Standard practice before touching the
reporting code: run the tool that asks whether the accounting record alone reproduces every
reported figure. It came back with two disagreements, and they turned out to be two different
faults:

- **One was caused by the new transfer feature.** A customer whose only activity is a transfer has
  no trade and no cheque, and the balance sheet's rule for deciding whether to replay history or
  trust the stored figure only looked at trades and cheques. So such a customer's *current* balance
  was reported at *every* historical date — including dates before the customer existed. This would
  have turned the checking tool red the first time anyone posted a transfer on the live system.
- **One was older and unrelated.** A customer's opening balance carried no date, so it was applied
  at every date, including dates before the account was created — while the accounting record
  correctly showed nothing. Confirmed real by removing the practice data and re-running: it
  reproduced on clean data.

**Both were fixed, separately, each verified on its own** so that if a figure had moved it would be
obvious which change caused it. The opening-balance fix turned out to be a single dated check. The
larger one was a rewrite: a customer's history now replays as one chronological pass rather than
three separate sums, because a hand-written entry's effect depends on the running balance at that
moment and sums cannot express that. The result is that **manual entries and transfers now appear
on a customer's statement**, which they never did before — the balance moved but no line explained
why, and the closing figure was short by exactly that amount.

**The checking tool reports clean before and after every change**, at all five dates, which is the
standard this work is held to: a red run is a finding, not something to explain away.

**A third fault, found by reading rather than by a tool.** Clearing a cheque for more than the
customer owed stored a *negative* balance — the only place in the system with neither a guard nor a
rule for handling the excess. The total was right and the split was wrong, which is the half anyone
actually reads: "owed to us: minus 70,000" where the books mean "we owe them 70,000". Put to the
client, who confirmed the excess should settle the debt and the remainder stay as a credit for
later — the same rule already used elsewhere. Checked the live system first: no customer there
carried a negative balance and no cheque had ever been recorded, so nothing historical needed
correcting.

**Also this session:** who posted an entry is now visible on the row rather than only on hover. A
transfer bypasses the bank entirely, so its entry is the only record that the money moved and the
only record of who authorised it — and that was reachable only by hovering the right cell on the
right screen, and not shown at all on the Journal page.

### Found

| Finding | Severity | Status |
|---|---|---|
| A transfer would have turned the accounting checking tool red the first time one was posted on the live system | **High** — would have broken the standard that a red run is a real finding | **Fixed 2026-09-19** before the feature shipped |
| A customer's opening balance was applied at dates before the account existed | Medium — wrong figures on any historical report covering that period | **Fixed 2026-09-19**; confirmed real on clean data first |
| Manual entries and transfers moved a customer's balance but appeared on no statement | Medium — a balance that moves with nothing explaining it | **Fixed 2026-09-19** |
| Clearing a cheque for more than owed stored a negative balance instead of a credit | Medium — total right, split wrong, and the split is what is read | **Fixed 2026-09-19**; live system confirmed unaffected |
| Who posted an entry was only reachable by hovering one cell on one screen | Low, but it is the only record of who authorised a transfer | **Fixed 2026-09-19** |

### Next — in priority order

1. Ship the above together — the transfer feature must not go live without the replay fix.
2. Unchanged: switching the reports over to read the accounting record.

## 2026-09-19 — a release to production was stopped before it could take the desk down

### Done

*At a glance: a routine "push this live" was requested and deliberately not carried out. Checking
what would actually ship revealed that releasing right now would stop the entire desk working —
not one page, the whole thing. Nothing was released. Production is untouched and healthy.*

**What was asked for.** Release the two small screen fixes from the previous day to the live system.

**What the check found.** The release would not have carried two changes. It would have carried
**nine** — everything built since the Margin Ledger, none of which had ever been released. That by
itself is only untidy. The problem is what is inside it.

**Why releasing would have stopped the desk.** The Margin Ledger work added a new table to the
database (the one that records closed months). Three facts combine badly:

- **Adding a table to the live database is a separate, manual step.** It does not happen
  automatically when software is released. This is deliberate and long-standing.
- **The new software asks that table a question on every single request** — not only when someone
  opens the Margin Ledger page.
- **That question sits inside the one routine every screen and every action depends on.** It is
  what loads the desk when you sign in, and it also runs inside every purchase, sale, payment,
  cheque movement and accounting entry before the entry is saved.

So releasing the software before adding the table means the desk asks for a table that is not
there, on every request. The result is not a broken Margin Ledger page. **Nothing loads, and
nothing can be recorded at all** — a full stop for the client's business, until the table is added.

**The correct order, which is not optional.** Add the table to the live database first. Confirm it
is there. Then release. Getting this the wrong way round is precisely the failure above.

**One thing that does not exist yet.** Every other job that runs against the live system has a
dedicated, named command for it — the security check, the data snapshot, the carry-over program,
the desk-clearing routine. **Adding a table to the live database does not.** There is no rehearsed,
written-down path for it, which is part of why this step is easy to forget. That gap is now
recorded rather than left to be rediscovered.

**Also worth a look before release, separately from all of the above.** The Accounts page change
from 2026-09-18 makes real bank and cash balances visible to the client where the screen previously
showed a dash. The figures are correct and agree with the Balance Sheet — but it is a visible
change in what the client can see, and worth a glance before it goes out rather than after.

**Nothing was committed or changed in this session.** The work was reading, checking and recording.

### Found

| Finding | Severity | Status |
|---|---|---|
| Releasing the current software to the live system would stop the entire desk working — every screen and every action, not one page — because it depends on a database table that has to be added by hand first | **Critical**, had it been released | **Caught before release, 2026-09-19.** Nothing was pushed; production untouched. Recorded here and in Notion so it cannot be walked into again |
| Nine sessions' worth of finished, tested work has accumulated without ever being released | Medium — the work is safe and committed, but the longer it sits the larger and riskier a single release becomes | **Recorded 2026-09-19**, awaiting the decision below |
| There is no dedicated command for adding a table to the live database, unlike every other live-system job | Low on its own, but it is a contributing cause of the finding above | **Open** — worth adding before the next release |

### Next — in priority order

1. **Decide what actually ships.** Either add the new table to the live database and release all
   nine changes together, or release only the two screen fixes on their own — they need no database
   change at all and carry no risk of the above. This is a decision, not a technical problem.
2. Add a proper named command for the "add a table to the live database" step, so the next schema
   change has a rehearsed path instead of an improvised one.
3. Unchanged: phase 5 of requirement 7 remains the largest open piece of work.

## 2026-09-18 — bank and cash balances appear on the Accounts page; vague dates removed for good

### Done

*At a glance: two screen fixes. The Accounts page was showing a dash where every bank and cash
balance should have been. Separately, the last two screens still saying "Today" and "Yesterday"
instead of a real date were fixed, which removes that habit from the system entirely.*

**The Accounts page was not showing bank balances at all.** Every bank and cash account displayed a
plain dash in the Balance column. The figures were never missing or wrong — the page simply never
asked for them, filling in a zero for every account that was not a customer.

**Fixed by reusing the Balance Sheet's own calculation rather than writing a second one.** This
matters more than it sounds. The balance shown on the Accounts page is now produced by the exact
same routine that produces the Balance Sheet's bank and cash figures — so the two screens cannot
drift apart and start telling the client different things about the same account. It correctly
accounts for the account's opening balance, every payment made or received through that account,
and cheques that have cleared through it.

**Checked, not assumed.** The same books were read on both screens side by side and the figures
match exactly — Bank 6,250, Meezan Bank – Current 2,000, Cash in hand 22,000. Nothing about the
Balance Sheet changed; this only displays a figure it was already producing.

**The vague-dates problem, finally finished.** On 2026-09-15 the Transactions and Payments tables
were changed to show a real date ("Sep 17, 2026") instead of "Today" / "Yesterday" / "3 days ago",
on the grounds that a relative label is not an acceptable date on a financial record. Two screens
were missed at the time:

- The **customer's own transaction history** — flagged in an earlier session, never actually fixed.
- The **customer list's "Last activity" column** — found while fixing the first.

Both now show the real date, using the same shared piece of formatting the other two screens
already used. Worth recording that the earlier fixes had been done properly — one shared piece of
formatting, not copy-pasted four times — so this was reusing it rather than repairing it.

**One subtlety that would have been a quiet wrong answer.** The customer list's "Last activity"
now picks *and* displays the same date — the day the deal was struck. Previously it chose the most
recently *typed-in* deal. Left half-changed, a deal entered this morning for an old date would have
won "most recent" and then displayed that old date — showing an older date than a deal that really
was more recent. Both halves were changed together.

**Full suite green: 332 tests** (105 screen, 172 server, 55 calculator), up from 326. Type-checking
and the linter clean. Both screens were checked in the running desk in light and dark mode.

**Committed locally as `1f59ab1` and `61b3b1f`, not released** — see the 2026-09-19 entry above for
why nothing has been released.

### Found

| Finding | Severity | Status |
|---|---|---|
| The Accounts page showed a dash instead of the balance for every bank and cash account | Medium — no figure was wrong, but the client could not see balances on the page where they would expect them | **Fixed 2026-09-18** by reusing the Balance Sheet's own calculation, so the two cannot disagree |
| The customer's transaction history and the customer list still showed "Today" / "Yesterday" instead of real dates | Medium — not acceptable on a financial record, and previously flagged but never actually fixed | **Fixed 2026-09-18**; relative dates are now gone from the system entirely |
| The customer list chose "last activity" by the date a deal was typed in, while intending to show the date it was struck | Low today, wrong answer the moment a deal is backdated | **Fixed in the same change**, both halves together |

### Next — in priority order

Unchanged. Phase 5 of requirement 7 remains the largest open item; nothing in this session touched
how any figure is calculated.

## 2026-09-17 — later the same day: payments now record which bank account the money moved through

### Done

*At a glance: when money is received or paid, the desk now records which bank account it actually
went through, and shows it everywhere that payment appears. Previously it recorded only "by bank",
which is not enough to check against a real bank statement.*

**What was missing.** Receiving or making a payment recorded the method — cash, bank, cheque — but
not *which* bank account. The client has several (Meezan, HBL and others). "Paid by bank" with no
account named cannot be reconciled against an actual bank statement, which is the main thing that
information is for.

**What changed.** The Receive Payment and Make Payment screens now let the dealer choose the bank
account, and that choice is saved with the payment and displayed wherever that payment appears —
the Payments list, the Transactions list, and the customer's own history. The display is produced
by one shared piece of logic rather than three separate copies, for the same reason as always: three
copies eventually disagree.

**The account chooser is a searchable dropdown, not a row of buttons.** A row of buttons works for
three accounts and falls apart at ten. This was changed after the first version, on review.

**No new database table was needed.** Bank accounts were already ordinary accounts in the existing
chart of accounts, which already supported being created, edited and retired like any other. This
is also what made the following day's Accounts page work possible at all.

**The trade screens were deliberately left alone, and this was re-confirmed with the client.**
Currency Purchase and Currency Sale still have no payment section — every trade is recorded as
unpaid, and money is settled afterwards through Receive/Make Payment. The client confirmed again
this session that this is exactly how he works: the deal is recorded when struck, and paid later,
sometimes the next day, sometimes later than that. The older payment section remains commented out
in place with instructions for restoring it. **This is a settled decision, not an open question.**

**Committed locally as `133499e`, `afd8157` and `a4d4992`, not released.**

### Found

| Finding | Severity | Status |
|---|---|---|
| Payments recorded the method but not which bank account, making them impossible to reconcile against a real bank statement | Medium — a real gap in the records, not just a display issue | **Fixed 2026-09-17** |
| The bank account chooser was first built as a row of buttons, which does not scale past a handful of accounts | Low — caught on review before it reached the client | **Changed to a searchable dropdown** the same session |

### Next — in priority order

Unchanged from the Margin Ledger entry below.

## 2026-09-17 — Margin Ledger page and monthly period close

### Done

*At a glance: a new client ask — see profit per sale, review it over any date range, and lock a
month's figure once reviewed. Investigated before building, per the client's own instruction: two
of the three pieces already existed and needed no new code. Built, tested, and watched working live
on the real screen before being called done. Committed locally, not shipped.*

**What was asked for.** The client wants to see the profit on every currency sale, review the total
over a date range ("last 10 days", "last month"), and formally close a month once it has been
reviewed — similar to a monthly accounting close.

**Two of the three pieces already existed.** Before writing anything, the codebase was checked
against two specific questions, per the client's own instruction:

- **Is profit worked out once, in one place, and used consistently?** Yes. One shared formula
  already produces the profit figure shown on the Sale screen at the moment of sale **and** the
  figure saved permanently to that sale's own record — the same calculation, not two copies that
  could ever disagree. And it already **was** being saved permanently, not recalculated later from
  today's rates — a sale from three months ago still shows the profit it actually made at the time,
  even if costs have moved since.
- **How does the desk price stock bought at different rates on different days?** By a running
  blended average across every purchase of that currency — not "the oldest stock sold first"
  (a method called FIFO). This was already the desk's method everywhere: the Sale screen, the
  Currency Stock page, and the balance sheet's stock valuation all already work this way, and the
  checking tool already verifies against it. Switching to "oldest first" would have meant rebuilding
  how the whole desk prices stock, not just this new page — a much larger and riskier change than
  what was asked for. **Flagged to you directly before building anything, and you confirmed: keep
  the existing blended-average method.**

**What was actually new: a page to see it, and a way to close a month.**

- **Margin Ledger**, a new page under Books (admin-only, matching the Balance Sheet and Income
  Statement). Every sale, with its date, customer, currency, amount, the rate bought at, the rate
  sold at, and the profit. Quick date filters (last 7/10/30 days, this month, last month, or a
  custom range), a running total for whatever range is selected, and — when more than one currency
  was sold in that range — a separate subtotal per currency as well as the combined total, so
  currencies are never blended into one misleading figure. Sortable by date or by profit, to spot
  the best and worst deals at a glance.
- **Close a period.** An admin can close a calendar month. Doing so permanently freezes that
  month's total profit figure — computed from the same saved per-sale figures the ledger already
  shows, so the frozen number can never disagree with what was on screen when it was closed — and
  from then on refuses any new purchase or sale dated back into that month, with a plain message
  naming the month and saying an admin can reopen it first. Reopening is a separate, explicit
  action; it does not happen automatically. Deliberately scoped to purchases and sales only, per
  the ask — manual accounting entries are not affected by a closed period.

**Verified live, not just in tests.** Closed September 2026 on a running copy of the desk with real
trade data, watched the page show it as Closed with the frozen total and who closed it and when,
then tried to record a backdated sale into September — refused, with the exact message: *"September
2026 is closed for trading. An admin can reopen it from the Margin Ledger before this can be
posted."* Reopened it from the same page and confirmed a September sale went through normally
again afterward.

**A real bug caught and fixed before it could bite.** The automated test suite resets its own
practice database between test files by clearing out the business tables — the new "closed periods"
table was left off that reset list. Left as found, a month closed by one test would have stayed
closed for every test after it in the same run, and an unrelated test posting a trade into that
month would have failed for a reason that had nothing to do with what it was actually testing.
Caught before it could cause a confusing false alarm later, and fixed.

**Full suite green:** 55 calculator tests (up from 46, the new ones covering the date-range
shortcuts and the period-close rules), 172 server tests (up from 160, 12 of them new — covering the
close/reopen actions, the admin-only restriction, and the trading block itself), and 99 screen
tests, unaffected. Type-checking and the linter both clean.

**Committed locally as `6cb8ce9`, not pushed.** Same discipline as the prior features in this log.

### Found

| Finding | Severity | Status |
|---|---|---|
| The two "does this already exist" questions the client asked to have answered first — both answered, with evidence, before any code was written | n/a — this is the requested process working as asked | **Confirmed 2026-09-17**: profit is already one shared, already-saved calculation; cost basis is already blended-average everywhere, not FIFO |
| The test database's per-file reset was missing the new closed-periods table | Low today (nothing else uses that table yet), but would have caused a confusing, unrelated test failure the first time a test closed a period | **Fixed 2026-09-17**, caught during this session's own testing rather than by a later report |

### Next — in priority order

Unchanged from before this session: phase 5 of requirement 7 (switching the reports to read the
accounting record) remains the largest open item. This session's work did not touch that — the
Margin Ledger page reads the same saved per-sale figures the reports already use, not the
accounting record.

## 2026-09-11 — audit cleanup pass: dead code, stale docs, duplicated constants, hygiene

### Done

*At a glance: four small commits working through the "quick wins" list in `AUDIT.md`. None of them
changes a stored figure, a business rule, or how money is calculated. All four are on the live
system. The full test suite was green after each one — 305 tests now, up from 303, the two added
covering the amount-bound and CSRF changes below.*

**`61915cf` — deleted dead code and unused frontend dependencies.** Three UI component wrappers
(`dialog`, `select`, `tabs`) that nothing imported, along with the three third-party packages they
were the only users of, so the frontend now carries slightly less code to download. A handful of
exported functions and type definitions that no screen references any more. And a migration
safety-net in the login code (`hasUsernameColumn`) that has been dead weight since the username
migration went live in August — every sign-in was paying for a check that could only ever have one
answer. Two things the audit flagged as unused were deliberately kept: a session helper that a test
relies on, and two more Radix packages that are out of this pass's scope.

**`645e1bb` — fixed stale documentation.** The public `README` said the desk trades three
currencies (it trades six) and that security-token protection "is not yet implemented" (it has been
enforced in production since 2026-09-09); it also pointed at a section of the engineering guide that
no longer exists. A code comment claimed the app loads its data from the browser's local storage,
which stopped being true weeks ago. The engineering guide's test count was three behind. All
corrected. No code changed.

**`0135032` — deduplicated constants.** Several values were written out in more than one file, so a
change to one copy could silently miss the others: the internal id of the trading-margin account
(two copies), the minimum password length the account-creation scripts enforce (two copies), and
the idle-timeout default and bounds, which the server and the screen each hardcoded separately —
now a single definition in the shared calculator package that both sides import, so the screen's
fallback can never assert a limit the server has stopped honouring. The screen's deliberate
fail-closed behaviour (fall back to a real timeout if the setting can't be fetched) is unchanged.
The five copies of a small command-line argument parser turned out to be three genuinely different
implementations rather than copies; the two identical ones were merged and the other two, one of
which guards a destructive operation, were left alone and the reason recorded.

**`4417b43` — small correctness and hygiene fixes.** An absurd amount typed into a trade or payment
(a number so large it overflows the database's numeric limit) now returns a clean "too large" error
instead of a generic "something went wrong" — it never reaches the database. The security-token
rejection response gained a machine-readable `code` field, and the screen now recognises that kind
of rejection by the code rather than by matching words in the error text, so a reworded message
cannot quietly break the screen's automatic retry; the old text-matching is kept as a fallback for
the one release where the two halves might briefly be out of step. The disposable test-database
reset helper was renamed so it can no longer be confused with the similarly-named production reset
routine — the two do opposite things, and one is safe against a real database while the other is
not. And `npm audit fix` was run: three advisories down to two, the last two being a transitive
dependency of the web framework that only clears with a major framework upgrade, left for a
separate pass.

### Found

| Finding | Severity | Status |
|---|---|---|
| Dead UI components, unused exports, and a login-path migration fallback long past its purpose | Low, hygiene | **Removed 2026-09-11** (`61915cf`) |
| `README` overstated the currency count and understated the security-token work; a code comment and the test count were stale | Low, but the README is what a new reader trusts first | **Fixed 2026-09-11** (`645e1bb`) |
| The margin account id, the password-length minimum, and the idle-timeout constants were each written in two places | Low. A one-sided edit would have gone unnoticed until it mattered | **Consolidated 2026-09-11** (`0135032`) |
| An oversized amount reached the database and surfaced as a raw 500 | Low, bounded — the database refuses it, so no wrong figure, just an unhelpful error | **Fixed 2026-09-11** (`4417b43`) — now a clean 400 |
| The screen recognised a security-token rejection by matching text in the error message | Low. A message reword would have silently disabled the automatic retry | **Fixed 2026-09-11** (`4417b43`) — a `code` field, with the text match kept as a one-release fallback |
| Two reset routines with near-identical names and opposite safety properties | Low, but a real "wrong one in the wrong place" risk | **Renamed 2026-09-11** (`4417b43`) — the test helper is now unmistakable |
| Two more unused third-party packages, and the web framework's transitive advisory | Low | **Left for a later pass** — out of this batch's scope; the framework one needs a major-version upgrade |

### Next — in priority order

Unchanged. The client reads `AUDIT.md` and decides what else to act on; the remaining quick wins in
its section 6 follow in order; then phase 5, switching the reports over to read the accounting
record.

## 2026-09-10 — a payment can no longer be booked "on credit"

### Done

*At a glance: one API-only gap from the audit closed. The screens never offered the bad option;
a hand-built request could. Fixed, tested, committed locally, not shipped.*

**A receipt or payment sent with the method `Credit` used to move the customer's balance and
record nothing on the other side.** `Credit` is what a *trade* uses to mean "nothing was settled,
it is all on account" — there is no cash or bank account behind it. The Receive Payment and Make
Payment screens have never shown it as a choice, but the server accepted it from a
directly-constructed request by any signed-in user. When it did, the customer's balance dropped as
if they had paid, no cash or bank balance rose anywhere, and the missing amount was quietly
absorbed by the balancing figure on the balance sheet — which would still read "Balanced" if the
gap was under half a rupee.

**The fix rejects it in two places.** The type that describes a settlement no longer lists
`Credit` at all, so any future code that tries to pass it fails to compile. And because the web
layer hands the service whatever method string arrived in the request without checking it, there
is also a plain runtime check at the start of both the receive and the pay path: anything that is
not cash, bank or cheque is refused with a clear message before a single row is written.

**Tested first, then fixed.** Two tests drive the real server over HTTP: set a customer up owing
money, send a receipt (and separately a payment) with method `Credit`, and require a refusal with
the balance untouched and nothing recorded. Both failed against the old code exactly as the audit
described — the balance moved from 50,000 to 40,000, an activity row was written, no accounting
entry followed — and both pass now. The full suite is green: 303 tests across the three parts, up
from 301.

**Not certain of:** nothing about the fix itself. Worth noting only that the audit lists a
related, wider gap (`bankId` on a settlement is trusted to be a real bank or cash account, and is
not checked) which this change does *not* touch — that is audit finding §3 #6, a separate item.

### Found

| Finding | Severity | Status |
|---|---|---|
| A settlement with `method: 'Credit'` moved the balance and posted no accounting entry; API-only, any signed-in user | Medium. Live, but not reachable from any screen | **Fixed 2026-09-10**, tests failed first. Committed locally, not shipped |

### Next — in priority order

Unchanged. The client reads `AUDIT.md` and marks what to act on; the remaining quick wins in its
section 6 follow in order; then phase 5.

## 2026-09-10 — closing the day: admin password reset, one-off script removed

### Done

*At a glance: housekeeping only. No application code changed, no migration, nothing that touches
business data. The admin login was restored, the throwaway script that did it is gone, and
requirement 7's status row has been corrected against the live system rather than from memory.*

**The admin password for `info@kakabrothersgroup.com` was reset, and the account works.** There is
no forgot-password flow and no user-management screen in the app, and passwords are stored one-way,
so a forgotten password can only be replaced. A one-off script did it, reading the new password from
a hidden prompt rather than the command line so it never reached shell history or a process list.
The account holder reports the script's end-to-end check returned a successful login.

**Confirmed against the live database rather than taken from that report**, which is the discipline
this document has needed before. The account is `role=admin`, active, and has a successful sign-in
recorded. Two timestamps, both read directly:

| | UTC | Desk time (UTC+5) |
|---|---|---|
| Password last written | 2026-09-09 16:02:42 | 2026-09-09 21:02 |
| Last successful login | 2026-09-10 14:05:45 | 2026-09-10 19:05 |

*Worth reading precisely, because the two dates differ.* A login updates only the last-login stamp;
only a password or username change moves the other one. So the reset itself was performed on the
evening of **2026-09-09**, not on the 10th, and the account has been signed into successfully again
since. Both halves of the claim hold — the password was replaced and the account logs in — but the
reset is a day older than it was described as, and the figures above are what the system actually
holds.

**The one-off script has been deleted.** `backend/src/scripts/resetAdminPassword.oneoff.ts` was
never committed, so this removes a file that existed only on one machine and leaves no trace in the
history. Its own header said to delete it once the password was reset. It also carried the client's
admin email address and the live server address as defaults, and its verification step performed a
real sign-in against production, so it was not something to leave lying around. If a password ever
needs replacing again, `npm run set-password` does the same job; its one drawback is that it takes
the password as a command-line argument, which is the exposure the deleted script existed to avoid.
Reinstating a hidden prompt is a small change to that script rather than a reason to keep this one.

**Requirement 7's status row has been corrected.** It was flagged as stale on 2026-09-09 and left
deliberately unedited at the time because it is client-facing. It named 2026-09-03 as the last
clearing and cited the client's first four real trades as live evidence, when the desk had in fact
been cleared again on 2026-09-09 and those trades no longer exist. The row now names both clearings,
keeps the historical fact that those trades did produce their paired entries as designed, and states
plainly that the evidence was discarded with them and will be re-earned on the next trading day.

**The desk's readiness was read from the live system, not assumed:**

| | |
|---|---|
| Deals, accounting entries, cheques | **0** each |
| Customer and other non-structural accounts | **0** |
| Structural accounts | **13**, intact |
| Currency positions holding value | **0** |
| Next accounting entry number | **JV-001**, unconsumed |

The desk is clear and ready for the client's actual first deals.

### Found

| Finding | Severity | Status |
|---|---|---|
| The password reset was performed on 2026-09-09, not on 2026-09-10 as described | Low, and a description rather than a fault. The reset worked and the account logs in | **Corrected here** from the stored timestamps |
| No second clearing happened on 2026-09-10; the 2026-09-09 clearing still stands and the desk has been untouched since | Not a fault. The end state is the same either way, and it is what the row now says | **Recorded** — read from the live system |
| Requirement 7's row named the wrong clearing date and cited deleted trades as evidence | Real but documentary, and already flagged on 2026-09-09 | **Fixed 2026-09-10** |
| The one-off script held a real admin email and the production address, and signed in to production as a verification step | Low while it stayed on one machine and uncommitted. It would have become real the first time anyone ran `git add -A` | **Deleted 2026-09-10** |

### Next — in priority order

Unchanged. The client reads `AUDIT.md` and marks what to act on; the remaining quick wins in its
section 6 follow in order; then phase 5, switching the reports over to read the accounting record.

## 2026-09-10 — later the same day: the two date faults fixed

### Done

*At a glance: the two date faults the audit put first are fixed, each with a test that was watched
failing on the old code before the fix went in, and then confirmed on screen in a running copy.*

**Customer statements no longer drop the last day.** A statement for 1–30 September now lists every
deal struck on the 30th, in the on-screen statement, the PDF and the Excel file, and the closing
balance includes them. The cause was that the statement screen worked out its date range one way
and the balance sheet another; it now uses the same rule the balance sheet always has. A test places
a deal exactly on the "To" day, which no earlier test did — it failed on the old code (the deal was
missing, the closing balance short by exactly its value) and passes now. Then, in the running app: a
sale dated 10 September, a statement "to 10 September" lists it and closes at PKR 4,100; "to 9
September" correctly leaves it out and closes at PKR 3,900.

**The server now knows which day it is on the desk's clock.** Every date the server works out for
itself — a deal posted without a date, a manual accounting entry, an opening balance, a salary
posting, the day a cheque cleared, its due date, and the "not in the future" check — is now computed
in the desk's own timezone, set once and defaulting to Pakistan. Before, the server used its own
clock (UTC on the hosting platform, five hours behind), so from midnight to 05:00 local it refused a
deal dated today and dated everything else yesterday. Two sets of tests pin this: one forces the
test process onto UTC and freezes the clock at 02:30 on the desk's morning, and proves a deal dated
"today" is accepted; the other freezes the same clock against the real server and database and
proves a trade, a receipt, a manual entry and a cheque clearing all land on the desk's day. All six
failed on the old code.

*The fix was deliberately not "set the timezone on the server".* That would have worked and would
have been invisible: an environment setting on the hosting platform that nobody would notice was
missing on a new project, and a database session setting that the database's connection pooler does
not reliably keep. The timezone is instead an explicit input to every date the code derives, so it
is right on any host and can be tested.

*One small extension, flagged.* Manual accounting entries can now carry a date, validated exactly as
a deal's is. The server accepts it; the Journal screen does not offer a date picker yet. That is a
screen change for a later session.

**Full suite green:** 301 tests across the three parts (up from 286), plus type-check and lint.

### Found

| Finding | Severity | Status |
|---|---|---|
| Statement "To" date dropped same-day deals | Real, client-facing | **Fixed 2026-09-10**, test failed first, confirmed on screen |
| Server "today" was UTC | Real; refused same-day deals 00:00–05:00, misdated five kinds of record | **Fixed 2026-09-10**, tests failed first |
| Opening-balance and salary postings also took the database's day | Same fault, two more places the audit's table had not listed | **Fixed 2026-09-10** in the same change |
| The Journal screen has no date field | Product gap, now unblocked on the server side | **Open** — small screen change |

### Next — in priority order

Unchanged: the client reads `AUDIT.md` and marks what to act on; the remaining quick wins in §6
follow in order, then phase 5.

## 2026-09-10

### Done

*At a glance: a full read of every source file in all three parts of the system, written up as
`AUDIT.md` in the repository root. Nothing was changed. The report is for review; each item in it
is a recommendation, not a decision.*

**A one-time audit of the whole codebase was carried out and written down.** Every file was read
rather than sampled: the calculator, the server, and the screen — about 16,500 lines across 214
files. The findings are organised under six headings the client asked for: values written into the
code that ought to be settings, how the parts are structured, anything that could quietly produce a
wrong figure, security, leftover or outdated code, and finally a split between what can be fixed in
under half an hour and what needs a real decision first.

**Three of the findings were confirmed by running code rather than by reading it**, and two of them
matter to the client directly:

- **A customer statement's "To" date leaves out every deal struck on that day.** Set the range to
  1–30 September and every deal from 30 September is missing from the printed statement, the PDF
  and the Excel file, so the closing balance on the document is wrong. Confirmed by running the
  date arithmetic. The balance sheet and income statement do not have this fault; the statement
  screen builds its date range differently from them. A half-hour fix.
- **The server does not know which country it is in.** It runs on the hosting platform's clock
  (UTC) while the desk is five hours ahead. Between midnight and five in the morning local time, a
  deal dated "today" is refused as being in the future, and any entry that relies on the server's
  idea of today lands on yesterday. It has not been reported because the desk has traded for one
  day. A one-line configuration change fixes most of it; the rest is a small code change.
- A guess about a third fault — that an absurdly large number typed into an amount box could be
  stored — was **checked against the database and found not to be true**: the database refuses it.
  It becomes an unhelpful error message rather than a wrong figure, and is recorded as such.

**Also found, and recorded with the reasoning:** the local-development seeding script has no guard
against being pointed at the live database, and would create an administrator login with a
publicly known password if it were; a deactivated user keeps their access until their session
lapses on its own; operators can read every employee's salary on the Transactions and Accounts
screens even though the Salary page itself is admin-only; clearing a cheque can push a customer's
balance below zero if a manual entry reduced it in between; archived employees are still included
in "accrue for all"; and the cost and profit figures on a sale are rounded separately, which will
make the checking tool report a one-paisa disagreement the first time a fractional-rate currency is
sold. None of these has produced a wrong figure on the live desk yet.

**What the audit deliberately does not recommend.** Making the base currency configurable (a large
change with no benefit to this client), moving the seven core account ids out of the code (they are
protected by the database and are the right thing to hardcode), or starting any of it before the
client has read the list. The largest structural point — that the financial reports are computed
in the screen rather than in the shared calculator — is already the shape of the remaining
requirement 7 work, and the audit's advice is to do the two together rather than twice.

### Found

| Finding | Severity | Status |
|---|---|---|
| Customer statement "To" date excludes the last day's entries, on screen, PDF and Excel | Real, client-facing, verified by running the arithmetic | **Open — recorded in AUDIT.md §3 #1.** First item in the quick-wins list |
| Server timezone is unset; "today" is UTC, five hours behind the desk | Real. Refuses same-day deals 00:00–05:00 local; dates manual entries and cheque clearings on the wrong day in that window | **Open — AUDIT.md §3 #2 and §1.7.** Config half is a quick win; code half is a small refactor |
| Demo seeding script has no production guard | Real. Would create an admin login with a known password on the live database if misdirected | **Open — AUDIT.md §4 #1.** Quick win |
| Operators can read employee salaries via Transactions and Accounts | Real. Contradicts Part 1's "cannot reach payroll" | **Open — AUDIT.md §4 #3.** Needs a small design decision |
| Cheque clearing can drive a customer balance negative after a manual entry | Real but needs a second event to trigger | **Open — AUDIT.md §3 #3.** Needs the client to choose between two behaviours |
| Cost and profit on a sale rounded separately; will show as a one-paisa reconcile drift on the first fractional-rate sale | Real, latent until the first IRR or JPY sale | **Open — AUDIT.md §3 #4.** Do before that sale |
| Archived employees still accrued and paid by the bulk salary actions | Real money, wrong direction | **Open — AUDIT.md §3 #7.** Quick win |
| Very large amounts corrupt stored figures | **Not a fault.** Checked against the database: refused with an error | Closed — recorded as a raw error message, not a data risk |
| The one-off password-reset script is still on disk, with a client email and the live address in it | Housekeeping; its own header says to delete it | **Open — AUDIT.md §1.13.** Delete |

### Next — in priority order

The audit does not change the order of existing work; it adds a short list ahead of it.

1. **Client reads `AUDIT.md` and marks what to act on.** Nothing in it has been started.
2. **The quick wins the client approves**, in the order §6 lists them — the statement date fix, the
   seeding guard and the timezone configuration are the three that matter most and together are
   about an hour.
3. **Then the existing list, unchanged:** phase 5 of requirement 7 (reports read the accounting
   record), taking the audit's advice to move the report calculations into the shared calculator
   in the same pass; then corrections and reversals; then the carried Admin gaps.

## 2026-09-09

### Done

*At a glance: the client used the desk for the first time and sent back eight problems. All eight
were real — none was a misreading of a working system. Seven are fixed; the eighth was a policy
question the client answered, and the answer was to keep the current behaviour and fix what made it
look broken.*

**The client has started trading.** This is the first session with real business on the system. The
2026-09-06 entry recorded that nobody had signed in since the desk was cleared on 2026-09-03; that
is no longer true. Two purchases are on the books, from two customers the client created. Every
problem below comes from that first day of use, which is why several of them had never surfaced
before — they needed a real trade to exist.

**One of the eight was a fault we introduced.** The accounting work released on 2026-09-03 has a
side effect nobody predicted. The Accounts page was built to show the client the accounts they
created and to keep the system's own internal accounts out of sight until one is actually used.
That rule was written when the only way to use an internal account was to choose it deliberately.
The new accounting work changed that: every purchase now automatically writes an entry against the
relevant currency's internal account. So the client's first two trades pushed "Currency stock
(AED)" and "Currency stock (USD)" onto a list that is supposed to show their own customers.

The system now distinguishes between an account something was posted to *automatically* and one a
person posted to *deliberately*, and only the second kind brings an internal account into view. The
distinction is written down in one place and covered by tests, including a test that fails if the
two are ever collapsed back together — which would quietly re-open a different problem, because the
"has anything touched this account" question is still the right one for deciding whether an account
can be deleted or reclassified.

**A total that disagreed with the list behind it.** The header showed "You owe PKR 328,200 across 2
customers"; clicking it listed one customer and PKR 78,000. The missing money belonged to an
archived customer, who was counted in the header and hidden from the list.

The client chose that archived customers should keep counting, which is the safer of the two
answers — money owed to a retired customer is still owed, and a header figure that quietly dropped
it would understate what the desk owes with nothing to reveal the gap. So the lists reached from
those headers now include archived customers, marked as archived. The rule, recorded for the
future: **whatever a total counts must be reachable from the list that total links to.**

**Archiving looked broken, and was not.** Archiving a customer worked and always had — the customer
disappears from the screens where you buy, sell and settle, exactly as intended. But the Accounts
page ignored it completely, so the account still sat there looking untouched. The Accounts page now
hides archived accounts behind a "Show archived" switch and labels them when shown, matching how
the Customers page has always behaved.

**Deletion: the client's request, and what we did instead.** The client asked for outright deletion
through the admin account. The system refuses to delete an account that has transactions or carries
a balance, and offers archiving instead.

We put the cost of the alternative in front of the client rather than simply building it: deleting
a customer does not delete their trades. It would leave purchases, accounting entries and currency
positions in the books referring to a customer who no longer exists — the books would still add up,
but the trail behind them would point at nothing, which is the thing anyone auditing a currency
business asks about. The client chose to keep the current rule and have archiving made to work
properly instead.

One consequence worth stating, because it decides a related question: **archiving deliberately does
not refuse an account carrying a balance.** Deletion already does. If archiving refused as well,
there would be no way to retire a customer who is still owed money — which is precisely the
customer the client was trying to retire.

**Two screens that were simply hard to read.**

*The transaction list's first three columns ran into each other.* The cause was not spacing: the
reference column was printing a 36-character internal identifier that overflowed its column and
shoved the next two against it. References are now shortened to eight characters, with the full
value available on hover. Separately, the column widths in the header and the widths in the rows
had been written down twice and had drifted apart, so every heading after the first sat to the left
of the column it named. They are now defined once.

*The Customers screen had two search boxes a few inches apart* — one in the top bar, one on the
page. Worse, the one the eye reaches for first did nothing until Enter was pressed, which is
exactly what the client's screenshot caught. The top bar's box is a jump-to-customers shortcut and
has nothing to offer on the page it jumps to, so it is now hidden there. One search box on that
screen, the one with the context.

**The balance sheet printed every account, including the empty ones.** A desk with two purchases on
it was printing four untouched currencies, two unused expense accounts and an empty salary account
as blank lines around the few figures that carried anything. Accounts with nothing on either side
are no longer printed, and a section left with nothing in it does not appear.

This is a change to what is shown and not to any figure. Every total, and the sheet's own
"balanced" verdict, are computed independently of the printed rows, and there is now a test that
compares a sheet against the same books with the empty accounts removed by hand and requires every
figure to match. The checking tool used for the accounting work is also unaffected, because it was
deliberately built to work out its own answers rather than read the balance sheet's.

**Clicking a currency's account showed a form that explained where its numbers were and then showed
none of them.** Those rows now open the currency ledger, which is the page that actually holds the
quantity, the cost and the movement history.

**All of it was then checked on screen, in both colour schemes**, against a local copy of the books
that happens to reproduce the reported problems exactly — one archived customer carrying money in
both directions, four trades, and the automatic accounting entries behind them. The balance sheet
still totals the same figure on both sides and still reports itself balanced, which is the check
that matters most: the change to it was to what is shown, and nothing shown changed what is
counted.

Two further problems were found by looking rather than by reasoning, and both are fixed:

- The new "Show archived" switch, placed first in the row of type filters, squeezed that row enough
  to clip the last filter mid-word. It now sits beside "New account", which is where the Customers
  page has always put the same control.
- With the desk's only customer archived, the Customers screen said "No customers on file yet."
  directly beneath a header counting that customer. "None on file" and "none that aren't archived"
  are different statements and it was making the wrong one. It now says how many are archived and
  points at the switch.

**Released to the live system the same day, and confirmed by reading what the live address actually
serves** rather than trusting the hosting's status display. Before the release the served program
did not contain the new wording at all; after it, three phrases unique to this work are present, the
program's fingerprint has changed, and the copy being served is 46 seconds old rather than two and a
half hours. The old, mismatched column widths are gone from it and the corrected ones are there.
That is the same check used on 2026-09-06, and this time it reads the change directly rather than
inferring it from timing.

**The security rollout's readiness check now says SAFE, for the first time since it was built.**
Run against the live system immediately after the release: over the last 48 hours, **zero** requests
reached the server without a security token, and there were **4 real business writes** in that same
window — 2 trades or settlements and 2 accounting entries. Both halves matter and both are now
satisfied. Every previous run said *inconclusive*, correctly, because an unused desk proves nothing.

*One honest qualification.* Four writes is a first day, not a busy one. The check's own condition is
met and its verdict is SAFE, and nothing in the result is ambiguous. But the confidence it gives is
proportional to the traffic behind it, and this is the thinnest traffic that can pass. Turning
enforcement on is a one-variable change and revertible the same way, so the choice is between doing
it now on a thin-but-clean result, or re-running the check after a fuller week and acting on a
stronger one. **This is the client's call and has not been made.** Nothing has been switched on.

**The security rollout's final step was switched on, and the decision is the client's, taken on the
evidence.** The readiness check was re-run after a third deal was recorded and reported SAFE with
more behind it than the first run: over 48 hours, **zero** requests reached the server without a
security token, against **7 real business writes** — three trades across two customers and the four
accounting entries they produced. The earlier reservation about thin traffic is materially reduced,
though it is still one day.

The setting was added to the live server's configuration and the running copy rebuilt to pick it up.
The server is answering normally afterwards, which also confirms it started cleanly — it is written
to refuse to start at all if its configuration is incomplete.

*What was verified, and what was not.* The setting is present on the live environment, it was absent
beforehand (checked first, so the change is a measured difference rather than an assumption), a new
copy of the server was built after it and is the one the live address now points to, and that copy
is healthy.

**A real signed-in deal was then recorded against the live system — a 500 USD sale to Ahmed Khan —
and it went through cleanly with no security error.** That settles the question this stage actually
carries. The danger of switching on rejection was that staff would be locked out of their own desk;
they are not, and it has now been demonstrated with a real deal on real books rather than argued
from configuration. **Staff are unaffected and the desk is working normally.**

*What that deal did not tell us, and why a second check was needed.* The rejection only comes into
play for a request arriving **without** a security token. The desk's own screens always send one, so
a deal recorded from them travels a different path through the code entirely — one that behaves
identically whether rejection is switched on or off. A successful deal proves nobody is locked out.
It cannot observe the switch.

**So a second, deliberate check was run, and the rollout is now complete.** From a signed-in browser
on the live system, a request was sent that deliberately omitted its security token and pointed at
an address with nothing behind it — chosen so that nothing could be recorded whichever way it went.
The server **refused it outright**, with the exact message it only produces when rejection is
switched on. Had the switch not been taking effect, that request would have been let through and
answered "no such address" instead. A normal read was made alongside it and succeeded, so the
refusal was the protection acting and not a connection or sign-in problem.

**That is the whole rollout finished.** The desk now refuses any instruction that does not carry
proof it came from the desk's own screens — the protection this three-stage piece of work existed to
build. Staff are unaffected: the same day's real deals went through normally.

*One housekeeping note so a later reader is not alarmed.* The deliberate check leaves a record of
itself, by design — the system logs every untokened request whether it refuses it or not. So the
readiness tool now reports **NOT SAFE, 1 request missing a token**. That entry is the check itself
(its address is recorded alongside it and is the made-up one used above), not a real fault, and it
disappears from the tool's two-day window on its own. A second trap worth knowing: that tool's
"enforcement currently" line reads the developer's own local settings, not the live server's, so it
says "off" even though the live server is armed. Neither is a problem; both would look like one.

**The last known fault in the historical reports is fixed, and the checking tool now passes for the
first time.** Asking the balance sheet for any past date used to give a customer's balance as it
stands *today*, whatever date was asked for — so a sheet "as at last month" quietly mixed last
month's stock and cash with this morning's customer figures. Every other line on the sheet was
already cut at the requested date; customers were the one exception, recorded on 2026-09-02 and left
until now.

The correction reuses a piece of the shared calculator that already existed for exactly this and had
simply never been connected. It reconstructs what a customer owed, or was owed, on the date asked
for, from the deals and cheques up to that point.

*One deliberate restraint, because it protects the figures the client actually looks at.* The
reconstruction is used **only** for a past date. For today, the stored balances are used exactly as
before. That is not a shortcut: the reconstruction covers deals and cheques but not hand-written
accounting entries, which also move a customer's balance, so rebuilding from scratch could disagree
with the desk's own figure for any customer with one. Present-day numbers are therefore untouched
**by construction rather than by testing** — there is no path by which they can move. This was found
the honest way: swapping straight to the reconstruction broke three existing checks, which is those
checks doing their job.

The remaining gap — a past-dated sheet for a customer with hand-written entries — is recorded as a
failing-if-broken check rather than a comment, so it stays visible.

**Confirmed on the live system afterwards, not just in the checks.** A balance sheet asked for
August, and again for the day before the desk's first deal, came back empty — no customer balances
at all — while the same screen's header still showed the real current position of PKR 220,000 owed
to the desk and PKR 328,200 owed by it. **Those two figures disagreeing, on one screen, is the
proof.** They come from different places: the header reads the desk's stored balances, and the sheet
now reconstructs what was true on the date asked for. Before the correction the sheet simply
reprinted the header's figures at every date, so seeing them differ — correctly — is the fix working
end to end on real books rather than in a test.

*What this does not yet demonstrate.* Every deal on the desk was struck on the same day, so there is
no date that falls between two deals. The live check therefore covers the all-or-nothing case
cleanly and not a partly-populated historical sheet, where some deals are counted and later ones are
not. That path is covered by the automated checks, including backdating and cheque clearing.
Demonstrating it on the live desk would need a deal deliberately recorded with an earlier date.

**The checking tool now reports RECONCILED at every date it examines.** It had one further copy of
the same fault inside itself: it deliberately re-implements the report's workings rather than calling
them, so that it can act as an independent check, and its customer branch had the same defect. That
was corrected too — a copy that has stopped matching the thing it copies measures nothing, and worse,
its own failure message would have blamed a fault that no longer exists and sent the next person to
fix something already fixed.

### What RECONCILED means — and the two things it does not mean

Stated separately and at length because the word is easy to over-read, and a wrong reading here would
have someone believe a large piece of work is finished when it is not. The tool itself now prints
this on success for the same reason.

**It does mean:** the accounting record on its own reproduces every figure the system reports, for
every account, at every date checked. The books and the reports tell the same story. This is the
**precondition** for the remaining work, and the evidence that it can be done without any reported
number changing.

**It does not mean that remaining work is done.** The reports still work their figures out
independently rather than reading the accounting record — the balance sheet still takes customer
balances from stored columns, currency holdings from a replay of trades, and everything else from its
own reconstruction. Retiring those, one at a time, is the work that remains.

**It does not mean requirement 7 is complete.** Requirement 7 is finished when the reports read the
accounting record. RECONCILED says they *could* — not that they *do*. A green checking tool alongside
reports that still reconstruct their own figures is exactly the state that work **starts** from, not
the state it ends in.

### Found

| Finding | Severity | Status |
|---|---|---|
| The 2026-09-03 accounting release put internal currency accounts onto the client's Accounts page from their first trade onward | Real, and ours. Not a wrong figure, but the first thing the client saw on the screen listing their own customers | **Fixed 2026-09-09**, with tests that fail if the fix is undone |
| "You owe" in the header counted an archived customer that the list it links to hid | Real. A headline figure that its own drill-down cannot account for | **Fixed 2026-09-09** — the client chose that archived balances keep counting; the lists now include them |
| The Accounts page ignored the archived flag entirely | Real. Archiving worked everywhere else, so the one screen an admin checks afterwards was the one that made it look broken | **Fixed 2026-09-09** |
| The transaction list printed a full 36-character internal identifier in a narrow column | Real. It overran the column and pushed the next two into it | **Fixed 2026-09-09** |
| Column widths in that list were written down twice and had drifted apart | Real. Every heading after the first was offset from its column | **Fixed 2026-09-09** — now defined once |
| Two search boxes on the Customers screen, and the more obvious one did nothing without Enter | Real | **Fixed 2026-09-09** |
| The balance sheet listed accounts holding nothing | Real but cosmetic | **Fixed 2026-09-09**, presentation only — no figure moved |
| A currency account's row opened a form with none of that currency's information in it | Real | **Fixed 2026-09-09** — it opens the currency ledger now |
| The security rollout's final stage is complete — switched on, proven not to lock anyone out, and proven to be actively refusing untokened requests | n/a — this is the work finishing, recorded because it took two separate checks proving two different things, and only the second one settles it | **Closed 2026-09-09.** Both checks passed and both are cited in the developer guide |
| The readiness tool now reports NOT SAFE, and its "enforcement currently" line says off | Neither is a fault. The first is the deliberate check's own footprint and clears itself within two days; the second reads local settings rather than the live server's | **Documented, not fixed.** Both are recorded in the developer guide so they are not mistaken for regressions |
| Historical balance sheets reported today's customer figures at every past date | Real, and the last known fault of its kind. Recorded 2026-09-02 and carried until now | **Fixed 2026-09-09**, with checks confirmed failing on the old code first. Present-day figures untouched by construction. **Confirmed live in the production screen**, not only in the checks — a past-dated sheet came back empty while the header still showed the real 220,000 / 328,200 position |
| The checking tool contained its own copy of the same fault | Real, and would have become actively misleading once the report was fixed — its failure message would have blamed a defect that no longer exists | **Fixed 2026-09-09** in the same batch |
| A past-dated sheet still ignores hand-written accounting entries against a customer | Low and bounded. Today's figures are unaffected; only past-dated sheets for customers with such entries are short | **Open, recorded as a failing-if-broken check.** Closing it is part of the remaining requirement 7 work |
| Full deletion of an account with history is still refused | Working as designed. Raised with the client with the cost spelled out; they chose to keep it | **Closed — no change wanted.** Archiving is the route, and it now works properly |
| The new archived switch clipped the last type filter mid-word | Cosmetic, and introduced by this session's own fix | **Fixed 2026-09-09**, found by looking at the screen rather than by reasoning about it |
| With every customer archived, the Customers screen claimed none were on file, contradicting the header above it | Real, and pre-existing rather than introduced here — but the same fault as the one the client reported, so fixed alongside it | **Fixed 2026-09-09** |

### Next — in priority order

The list is unchanged from 2026-09-06 except that its first item is no longer blocked.

1. ~~Finish the security rollout.~~ **Done 2026-09-09** — switched on, proven not to lock anyone
   out, and proven to be actively refusing untokened requests. Nothing remains on it. **The next
   item is now first**, and it is no longer blocked on anything: the checking tool reports
   RECONCILED, which is exactly the green light it was built to give.
   With that done, the rollout is finished.
2. **Switch the reports over** (the last step of the accounting work): retire the four separate
   ways each figure is currently worked out, one at a time, re-running the checking tool between
   each. **It already reports agreement — that is the starting condition, not the finish line.**
   The work is done when the reports actually read the accounting record instead of rebuilding
   their own figures. Closing the hand-written-entries gap noted above belongs here.
3. **Then, and only then, corrections and reversals** — planned and decided, deliberately not
   started.
4. Carried unchanged: the small Admin gaps from the 2026-09-02 audit; correcting an opening
   balance; the PDF export question; the pre-existing sessions; and the misleading error message.

## 2026-09-09 — later the same day: the desk cleared

### Done

*At a glance: everything in the entry above happened first. Then, at explicit request and ahead of a
client meeting, the desk was cleared back to blank books. The first day of real trading is gone from
the system deliberately, not by accident. This entry exists mainly so nobody later reads the entry
above, goes looking for the four deals it describes, finds nothing, and concludes something broke.*

**The desk was cleared back to structural accounts only.** `npm run reset:business:prod` — the CLI in
`scripts/resetBusinessData.ts`, over `services/businessDataReset.ts` — was run against production at
about 15:52, after the 15:31 commit that closes the entry above. It is the same routine used on
2026-09-03 for go-live, used a second time for the same purpose: handing the client a clean desk.

**What it removed:**

| | |
|---|---|
| Customer accounts | **2** — Ahmed Khan, Wazir |
| Deals | **4** |
| Accounting entries | **6** |

The four deals were:

- Ahmed Khan — purchase, 1,000 AED, PKR 78,000
- Wazir — purchase, 900 USD, PKR 250,200
- Ahmed Khan — sale, 1,000 AED, PKR 80,000
- Ahmed Khan — sale, 500 USD, PKR 140,000

**Those figures reconcile exactly against what the entry above reports, and that is worth stating,
because it confirms the books were complete and consistent at the moment they were cleared.** The two
purchases are money the desk owed its customers: 78,000 + 250,200 = **PKR 328,200**, which is the
"You owe" figure quoted above to the rupee. The two sales are money owed to the desk: 80,000 +
140,000 = **PKR 220,000**, which is the other one. The six accounting entries reconcile too. On the
on-account flow the desk now uses, a purchase produces one paired record and a sale produces two —
a sale splits its credit side between the cost of the currency and the profit. So two purchases and
two sales give 2 + 4 = 6. The same arithmetic at the point the security readiness check ran, with
three deals on the books, gives the four accounting entries that check reported.

**What was confirmed untouched, read separately rather than taken from the routine's own report:** the
**13** structural accounts, **both** logins, **33** sessions and the settings row. The routine does run
nine assertions inside its own transaction before committing — but those are its account of itself.
The counts above were taken independently afterwards, which is the same discipline applied on
2026-09-03 and for the same reason: a routine reporting success is not evidence that it succeeded.

**Numbering restarted.** Both sequences were reset, so the client's first real accounting entry is
**JV-001** rather than JV-007, and cheque numbering begins from the start again.

**Currency stock was zeroed, not deleted** — six rows, one per traded currency, left in place holding
nothing. That is deliberate, and it is the reason this routine exists rather than a blunt table wipe:
the guard that stops two people overselling the same currency needs a row per currency to exist, and
the database-level protection on the structural accounts does not fire on a table wipe at all, so
that route would walk straight past it and take the chart of accounts with it.

### What this cost, and it is worth writing down

**The evidence behind two claims made earlier the same day no longer exists on the system.**

The checking tool reported RECONCILED at all five dates, and requirement 7's status cites the day's
first real trades producing their paired records as designed. Both were true, and both were measured
against the four deals listed above — which have now been deleted. Re-running the checking tool today
will still say RECONCILED, but against empty books, where it is close to trivially true.

Neither claim is retrospectively wrong and nothing needs re-doing. But the next person to run that
tool should know that a green result *now* carries far less weight than the one recorded above, and
that the strongest evidence requirement 7 has ever had was gathered and then deliberately discarded
within about four hours. The next real trading day rebuilds it.

**Part 2's requirement 7 row is now stale in two specific places, and has deliberately not been
edited here.** It says the desk was cleared "on 2026-09-03" with no history before that to carry over,
and it cites the day's first real trades as confirmation that deals are recorded properly as they
happen. Both sentences now describe a state that no longer holds. It is a client-facing status row,
so it is flagged here rather than quietly amended — this document has already been burned once by a
"done" mark that could not be trusted, and the fix for that was to record the correction, not to
smooth it over.

### Found

| Finding | Severity | Status |
|---|---|---|
| The desk's first day of real trading was cleared from production | Not a fault — done at explicit request, ahead of a client meeting | **Done 2026-09-09**, verified independently of the routine's own report |
| Part 2's requirement 7 row still names 2026-09-03 as the last clearing, and cites trades that have since been deleted as its evidence | Real. The same class of stale "done" claim this document has been caught by before | **Open** — flagged rather than edited, because it is a client-facing status row |
| RECONCILED, and the requirement 7 confirmation, now rest on books that no longer exist | Low, and inherent in clearing the desk. Neither claim was wrong when it was made | **Recorded, no action.** Re-earned on the next real trading day |

### Next — in priority order

Unchanged from the entry above — clearing the desk moves none of it. Phase 5, switching the reports
over to read the accounting record, remains first and remains unblocked.

One item is added ahead of the list, because it is a documentation fix rather than development work
and takes minutes:

- **Update Part 2's requirement 7 row** to name this clearing rather than 2026-09-03, and to stop
  citing deals that have been deleted as its evidence.

## 2026-09-06

### Done

*At a glance: no code was written and none needed to be. This was a status check before starting
new work, and it found the project exactly where the last session left it — except that the
tracker itself had drifted out of step with reality in two places, both now corrected.*

**Nothing has happened on the live system since 2026-09-03.** The desk was cleared that day and has
not been used since. Checked against the live database rather than read off this document: no
deals, no accounting entries, no cheques. What is there is what the clearing left behind — the
thirteen structural accounts, six currency positions all at zero, both logins, and the settings.

Two independent signs point the same way. Since that recording began on 2026-08-31, not one request
has reached the live server without a security token; and the newest sign-in session on record was
last touched on the same day. As far as the system can tell, **nobody has signed in to the live desk
since before the clearing.** The client has not started trading.

**The accounting work released on 2026-09-03 is confirmed live.** The tracker said in one place
that it was released and in another that it was not, so it was checked against the hosting record
rather than believed: the copy of the server currently answering the live address was built from
the main line of work seconds after the last change of that day was committed, and nothing has been
released since. The structural database change it depends on was applied three hours before that
release, so the ordering rule held. Every deal the client records from their first onward will be
written with both of its sides automatically.

*One limit worth stating.* The hosting's own command-line tool no longer reports which exact
version of the code a release was built from, and the alternative route to that figure needs a
credential this session was not permitted to read. So the conclusion rests on the release being
built from the main line, created seconds after the final change, with nothing newer since — which
is strong, but is reasoning from timing rather than reading the version directly. Recorded because
"confirmed" and "inferred from three facts that agree" are different claims.

**The security rollout's final step is still waiting, and the readiness check says so correctly.**
Run against the live system, it reports **inconclusive**: no request has arrived without a token,
but no real business has been recorded either, and an empty result from an idle desk is not
evidence of anything. This is the check behaving exactly as designed — it was deliberately built to
refuse a false all-clear rather than flatter an unused system. Widening the window would not help;
there is no business activity in the database at any date.

Separately confirmed that enforcement is genuinely still off on the live server, by reading the
hosting's own settings rather than the local copy of them: the setting that would switch it on is
not present at all.

**Two entries in this document were out of step with the system and are now fixed.**

*The requirement 7 row said the work was built but not released, and that it must not be released
until the security rollout finished.* Both were true when written and neither is true now — the
recording half was released on 2026-09-03, and the same day's log entry in Part 3 explicitly
retired that release gate. The row has been rewritten to match: released and live, the gate
dropped, and what actually remains stated in order — validate the security step once real trading
gives it something to measure, then switch the reports over.

*The developer guide said the frontend half of the security rollout had not been started.* It has
been live since 2026-08-31, which Part 3 of this document has recorded correctly all along. Checked
by reading the actual JavaScript being served to staff, not just the source, before changing the
line.

Both were stale rather than wrong-headed — the kind of drift that happens when a document is
updated in one place and not another. Worth fixing promptly all the same: the requirement 7 row is
the line anyone would read first to decide what to do next, and it would have sent them to finish a
release that is already finished.

### Found

| Finding | Severity | Status |
|---|---|---|
| The requirement 7 row claimed the accounting work was unreleased and gated behind the security rollout, while Part 3 of the same document recorded it as released and the gate as dropped | Real but documentary. Anyone reading the summary table first would have set out to release something already live, and treated a dropped gate as binding | **Fixed 2026-09-06** — row rewritten from the live system, with the correction stated rather than quietly applied |
| The developer guide listed the frontend half of the security rollout as "not started" when it has been live since 2026-08-31 | Real. It understates how far the rollout has got, and the next step is the one that can lock users out — a wrong picture of what has shipped is exactly the wrong thing to have there | **Fixed 2026-09-06**, after confirming against the code actually being served |
| The exact version of the code behind the live release could not be read directly | Low. Three independent facts agree on the answer; none of them is the answer itself | **Open — noted, not chased.** Readable from the hosting dashboard if it ever matters |
| The live database's address is still a single shared setting covering both the live system and any test copy | Real but already contained — test copies are no longer built, and the server refuses to start as one unless someone declares its database separate. The shared setting is the shape of the old risk, not the risk itself | **Open — carried.** Closing it properly means giving test copies their own database, which is only worth doing if test copies are ever wanted again |

### Next — in priority order

Unchanged from 2026-09-03. Nothing here is blocked on work to be done; the first item is blocked on
the client using the system.

1. **Finish the security rollout.** The readiness check can only give a verdict once the desk has
   been used for a normal day. Re-run it then. Nothing else about it needs building.
2. **Switch the reports over** (the last step of requirement 7): retire the four separate ways each
   figure is currently worked out, one at a time, re-running the checking tool between each until
   it reports agreement.
3. **Then, and only then, corrections and reversals** — planned and decided, deliberately not
   started.
4. Carried unchanged: the small Admin gaps from the 2026-09-02 audit; correcting an opening
   balance; the PDF export question; the pre-existing sessions; and the misleading error message.

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

**Deals recorded before the accounting work began have now been carried over — rehearsed against a
copy of the live books, and stopped there.**

Every deal from today onward records both of its sides automatically. Deals recorded *before* that
did not, so they were carried over by a one-off program. It was run against the local copy first,
then against a full copy of the live books taken for the purpose, and it has **not** been run
against the live system — see the open item below.

The program was deliberately built to be cautious in three ways.

*It reports before it writes.* Run normally it does the entire job, prints exactly what it would
record, and then throws it all away. Actually saving requires a second, explicit instruction. A
program that writes to the real books should do so because someone read the plan and agreed, not
because someone typed a command.

*It can be run twice safely.* Each pass skips anything already carried over, so an interruption is
recovered by running it again rather than by unpicking half-finished work by hand.

*It describes nothing twice.* It does not decide for itself what a purchase or a sale looks like —
it asks the same piece of the system the live screens ask. Writing that description a second time
inside the carry-over program is how the two would quietly stop agreeing, and the disagreement would
not show up as an error, just as wrong books.

**The rehearsal against real data earned its place immediately.** A full copy of the live books was
taken and restored locally, checked figure by figure against the original — every count and every
total matched, down to the last fraction of a rupee. Then the carry-over program was run against it.

The first attempt **failed outright**, and that was the point: the live system is missing one
structural database change the program depends on. It failed cleanly, saved nothing, and said
exactly what was missing. Run against the live system without that change applied first, it would
have done the same — which is precisely the ordering rule recorded in Part 1, now demonstrated
rather than assumed.

With the change applied to the copy, the carry-over recorded four deals and the difference between
the accounting record and the reported figures fell from **PKR 13,912,192 to PKR 4,992**.

That remaining 4,992 is not a fault in the carry-over. It was a genuine disagreement inside the live
books: a hand-written entry moving PKR 4,992 out of the bank to a customer on 2026-08-29 that never
updated that customer's balance.

**Resolved the same day, and it turned out not to need the client at all.** The entry was practice
data recorded by the account holder while testing that the system worked — not a real customer
transaction. It is a correct posting, so the accounting record's **PKR 9,608 is the right figure**,
and the **PKR 14,600** still showing on screen is precisely what the separate fault below produces.
What looked like two problems is one: a hand-written entry against a customer does not move that
customer's balance, and this is what that looks like from the outside. The carry-over needs no
special handling for it — reproducing the accounting record faithfully is exactly what gives the
correct figure.

*A cosmetic effect worth knowing about in advance.* Every accounting entry takes the next reference
number in sequence, so carrying over a batch consumes a block of them and the next hand-written
entry continues from a much higher number. Nothing is lost and nothing is wrong — but a jump from
JV-016 to JV-020 looks like missing records if you are not expecting it.

**A separate fault was found while investigating, unrelated to this work and still live.** Recorded
below as its own item so it is not mistaken for part of the carry-over and forgotten when this work
finishes.

**The desk was cleared, and the practice data is gone.** The live system held two test customers,
four test purchases and three accounting entries recorded while checking things worked. All of it is
removed. What remains is the structural chart of accounts the client fills in themselves — Bank,
Cash, Capital, one stock account per traded currency, Expenses, Salary Expense, Margin, Salary
Payable — with every currency position at zero and entry and cheque numbering restarted, so their
first real record is JV-001.

There was no way to do this, and the obvious way would have been dangerous. The nearest existing
code empties the accounts table wholesale, which — because of how the database applies its own
protections — would have stepped straight past the guard shielding the structural accounts instead
of being stopped by it. The routine written for this removes rows one table at a time in dependency
order, which leaves that guard armed and doing its job throughout. The safe-looking bulk operation
was the dangerous one.

It reports before it writes and requires two separate confirmations to commit, the second being the
name of the database it is pointed at — so running it against the wrong system is something you have
to type your way into rather than something you can do by having the wrong window in focus. Both
refusals were tested. Nine checks run before anything is committed, including that the structural
accounts, the logins, the sessions and the settings are all still exactly as they were; any failure
undoes everything. Logins and sessions are never written to at all — read twice, to prove they were
not touched.

Verified afterwards independently of the routine's own report: nothing left in deals, entries,
cheques, non-structural accounts or currency positions; 13 structural accounts, 6 currency rows, the
schema, both logins, all sessions and the settings all present and unchanged.

**The fault that let a hand-written entry break a customer's balance is fixed and live.** This was
found earlier the same day and is the one thing that would have damaged the client's real books
rather than merely being untidy: recording an entry by hand against a customer wrote the accounting
record and left the balance staff read off the screen untouched. The two then disagreed for good. It
was live, it was reachable in two clicks from the Journal page, and it would have done the same to a
real customer the first time anyone used it.

The fix had a decision inside it that "make it work like the others" does not answer. A customer
carries two figures at once — what they owe the desk, and what the desk owes them — and a
hand-written entry says only which direction the net moves, not which of the two should change. The
rule chosen is to settle whatever is outstanding in the opposite direction first and let anything
left over cross to the other side. It reproduces the correct figure on the one real case that
existed, arrived at by a completely different route than the one that first established it, and it
makes it impossible for either figure to go negative.

Deployed the same day, before the client's first trade. The one thing not done was exercising it
against the live system, which would have meant creating a customer, posting an entry and deleting
it — spending the client's JV-001 to re-prove something nine tests and four deliberate sabotage
runs already cover.


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
| **A hand-written accounting entry against a customer never updates that customer's balance.** Found on Ahmed khan: PKR 4,992 recorded on 2026-08-29, balance untouched ever since | **Real, live and ongoing** — not historical. Any hand-written entry against a customer today creates the same split between the accounting record and the balance staff see | **Open — its own item below**, deliberately not folded into the carry-over work |
| The live books disagree with themselves by PKR 4,992 on one customer, because of the entry above | Looked like it needed the client to adjudicate. It did not | **Closed 2026-09-03.** The entry was practice data recorded during testing by the account holder, not a real customer transaction. It is a correct posting, so **PKR 9,608 is the right figure** and the 14,600 on screen is exactly what the bug above produces. The two findings are one root cause, not two |
| A hand-written entry against a customer left that customer's balance untouched, so the books and the screen disagreed from that moment on | **The most serious fault found today** — live, reachable in two clicks, and it would have damaged the client's real records rather than practice ones | **Fixed and deployed 2026-09-03.** Nine tests, four sabotage runs, all caught. Reproduces the correct figure on the one real case by an independent route |
| The live system held practice data from testing, which the client would have started from | Would have handed them someone else's test records as their opening books | **Cleared 2026-09-03**, verified independently of the clearing routine's own report |
| The carry-over program failed against a copy of the live books because a structural database change had not been applied | Working as intended — it failed cleanly and saved nothing. Demonstrates the ordering rule rather than assuming it | Confirmed safe. The change must be applied to the live system first |
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

1. **Finish the security rollout.** Its last step has never been switched on, and it is the oldest
   outstanding item in the project. The readiness check cannot give a verdict while nobody is using
   the system — it deliberately answers "inconclusive" rather than a false all-clear on an idle
   desk — so it can only be settled once the client has traded for a normal day. Note this is no
   longer a release gate: the software that records both sides of every deal is already live. It is
   a security control that remains unvalidated, which is a different and more honest thing to say.
2. **The carry-over is finished and idle.** The work is
   written, tested, rehearsed end to end against a full copy of the live books, and then run against
   the live system in report-only mode, which produced output identical to the rehearsal line for
   line. The structural database change it depends on **has been applied**. It is ready.
   <br><br>**The desk has since been cleared, so there is now nothing to carry over.** This
   sits idle until real deals exist, at which point it can simply be run — it was built to be
   re-runnable. Better still: the software that records both sides of a deal automatically is
   already live, so every real deal from the client's first onward is recorded properly as it
   happens, and this may never need to run at all.
   <br><br>Read this as *waiting for the right moment*, not as *not ready*.
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
