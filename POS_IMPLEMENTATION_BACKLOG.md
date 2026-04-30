# Smart POS - Safe Implementation Backlog

This backlog is prioritized for production stability and built to align with current Smart POS architecture without breaking existing flows.

Last updated: 2026-04-30

---

## Guiding Principle (Do Not Break Existing Logic)

For every new feature:
- Reuse existing order lifecycle (`open -> sent -> in_progress -> ready -> paid -> served`) unless explicitly extending it.
- Keep cashier-gated tablet flow intact (tablet submit must not bypass cashier approval).
- Preserve current kitchen routing behavior (`kitchen` vs `direct_sale`).
- Use additive DB migrations only (never rewrite old migrations already applied).
- Add feature flags/config toggles where behavior changes could impact current operations.
- Validate with regression tests on tablet, POS, kitchen, and multi-cashier sessions.

---

## P0 - Must Ship First (Safety + Trust)

## 1) Audit Trail + Manager Override
### Goal
Owner can answer: who changed what, when, and why.

### Scope
- Add audit log table + helper RPC(s) for key events:
  - void item/order
  - discount override
  - payment method correction/reversal
  - manager PIN approvals
- Enforce manager PIN for high-risk actions after kitchen send.

### Integration Notes
- Hook from `POSTerminal` action handlers only; do not alter existing order state transitions.
- Keep current UX; append approval modal before sensitive action.

### Regression Checks
- Cashier normal flow still fast.
- No audit write failure should block non-critical UI rendering.

---

## 2) Void Governance (Post-Kitchen Control)
### Goal
Prevent ghost-sales and silent reversals.

### Scope
- If item already sent to kitchen: cashier cannot void without manager approval.
- If order already paid: enforce reversal path instead of direct mutation.
- Capture reason codes (`wrong_item`, `customer_cancelled`, `kitchen_issue`, `other`).

### Integration Notes
- Reuse existing `sentToKitchen` flags and status checks.
- Do not permit direct destructive changes on paid orders; create corrective event + audit row.

### Regression Checks
- Direct-sale items remain unaffected for valid pre-send edits.
- Kitchen display remains consistent after void events.

---

## 3) Blind Cash-Up
### Goal
Reduce till manipulation risk.

### Scope
- In shift close flow, cashier enters counted cash before system variance is shown.
- Show variance only after submit/confirm.

### Integration Notes
- Keep existing shift/till assignment model untouched.
- Add display-layer change first; backend validation stays same.

### Regression Checks
- Existing cash-up totals and reports still reconcile.

---

## P1 - High Impact Operations

## 4) Split Bill / Split Tender
### Goal
Handle real restaurant payment patterns.

### Scope
- Split one table order into multiple settlement lines/receipts.
- Split tender support (cash + card + mobile money in one order).

### Integration Notes
- Do not clone full orders; keep one parent order with settlement allocations.
- Extend payment dialog and receipt payload schema additively.

### Regression Checks
- Existing single-payment flow unchanged.
- Totals, tax, and discount allocations still tie exactly.

---

## 5) Mobile Money Pending State
### Goal
Cashier can continue serving while payment authorization is pending.

### Scope
- Add `pending_payment` sub-state or equivalent payment status layer.
- Await confirmation callback/manual confirmation.
- Timeout + retry + cancel paths.

### Integration Notes
- Keep order status model stable; prefer separate payment-status field if possible.
- Notify tablet only on confirmed paid status.

### Regression Checks
- No accidental "paid" marking from pending requests.
- Payment request clearing remains cross-terminal consistent.

---

## 6) Wastage Module
### Goal
Accurate stock and profitability accounting.

### Scope
- Waste entry by item/batch with reason and approving role.
- Link to stock deduction path and variance reports.

### Integration Notes
- Integrate with existing front stock/manufacturing logic.
- Keep sales and wastage as separate event streams.

### Regression Checks
- Batch production stock math remains correct after waste entries.

---

## P2 - Compliance, Reporting, and Device Hardening

## 7) Reporting Center (Operational + Finance + Tax)
### Goal
One place for owner-grade reporting.

### Scope
- Sales by shift/cashier/till/table
- Tax/VAT summary and filing exports
- Voids/discounts/comps and margin impact
- Theoretical vs actual usage (yield variance)

### Integration Notes
- Build read models/materialized views from existing events, not UI state.

---

## 8) ZRA Production Hardening
### Goal
Move from demo-ready to compliance-ready.

### Scope
- Signed/traceable invoice lifecycle
- Retry and failure-handling policies
- Fiscal report reconciliation checks

### Integration Notes
- Keep current invoicing demo paths isolated until production integration is proven.

---

## 9) Printer + Device Configuration Center
### Goal
Reliable printing and terminal operations at scale.

### Scope
- Per-device receipt printer assignment
- Kitchen printer routing by station/category
- Test print diagnostics and fallback behavior

### Integration Notes
- Must be config-driven, not hardcoded in POS views.

---

## Build Order (Recommended)
1. Audit Trail + Manager Override
2. Void Governance
3. Blind Cash-Up
4. Split Bill / Split Tender
5. Mobile Money Pending
6. Wastage Module
7. Reporting Center
8. ZRA Hardening
9. Printer/Device Config Center

---

## Definition of Done (Per Feature)
- Additive migration created and reviewed.
- UI + backend logic integrated without changing unrelated behavior.
- Multi-terminal regression passed (2+ cashier sessions).
- Tablet and kitchen regression passed.
- Lint/type checks passed.
- Feature documented in `POS_FEATURE_SUMMARY.md`.

