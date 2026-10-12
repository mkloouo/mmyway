# Implementation: Envelope (Budget) UI Layer - Create, Rename & Delete

**Date:** 2026-10-12  
**Chunk:** 2 (UI Screens + Screen Tests + i18n + CHANGELOG)  
**Commit SHA:** 3a86b19

## Summary

Implemented the UI layer for creating, renaming, and deleting envelopes from the Budget tab and detail screen. All screens include proper validation, confirmation dialogs, and error messaging. i18n strings added to all locale files.

## Files Created

- `app/budget/new.tsx` — Create envelope modal screen
- `src/__screens__/budget-new.test.tsx` — Screen test for create
- `src/__screens__/budget-detail.test.tsx` — Screen test for detail (rename/delete)

## Files Modified

- `app/(tabs)/budget.tsx` — Added "New envelope" button in AppBar
- `app/budget/[id].tsx` — Added Rename and Delete buttons with modals
- `src/i18n/locales/en.json` — Added 11 new i18n keys
- `src/i18n/locales/uk-UA.json` — Added 11 new keys (empty strings)
- `CHANGELOG.md` — Added entry under Budget section

## User-Visible UI Text (English)

### Budget Tab
- Button label: **"New envelope"** (in AppBar, top-right)
- Route: `/budget/new`

### Create Envelope Screen (`/budget/new`)
- Screen title: **"New envelope"**
- Label: **"Envelope name"**
- Placeholder: **"e.g. Groceries, Rent"**
- Button: **"Create"**
- Error (empty): **"Envelope name cannot be empty"**
- Error (duplicate): **"An envelope named "{{name}}" already exists"**

### Confirmation Dialog (Create)
- Title: **"New envelope"**
- Action button: **"Create"**
- Cancel button: **"Cancel"** (standard)

### Envelope Detail Screen (`/budget/[id]`)
- Button 1: **"Set the amount"** (existing)
- Button 2: **"Move money here"** (existing)
- Button 3: **"Rename"** (new)
- Button 4: **"Delete"** (new, red/danger styling)

### Rename Modal (on detail screen)
- Label: **"Envelope name"**
- Cancel button: **"Cancel"**
- Confirm button: **"Rename"**

### Confirmation Dialog (Rename)
- Title: **"Rename to "{{name}}"?"**
- Action button: **"Rename"**
- Cancel button: **"Cancel"**

### Confirmation Dialog (Delete - Destructive)
- Title: **"Delete "{{name}}"?"**
- Body: **"This cannot be undone. Spending already tracked will remain in Firefly III."**
- Action button: **"Delete"** (red/destructive)
- Cancel button: **"Cancel"**

## Route Paths (Maestro)

- **Budget tab create button**: Navigates to `/budget/new`
- **Create screen title**: "New envelope"
- **Rename button**: Visible on `/budget/[id]` screens, text is "Rename"
- **Delete button**: Visible on `/budget/[id]` screens, text is "Delete"

## i18n Keys Added

All under `"budget"` object:

```
budget.createTitle = "New envelope"
budget.createAction = "Create"
budget.nameLabel = "Envelope name"
budget.namePlaceholder = "e.g. Groceries, Rent"
budget.emptyNameError = "Envelope name cannot be empty"
budget.duplicateNameError = "An envelope named \"{{name}}\" already exists"
budget.renameTitle = "Rename to \"{{name}}\"?"
budget.renameAction = "Rename"
budget.deleteTitle = "Delete \"{{name}}\"?"
budget.deleteAction = "Delete"
budget.deleteBody = "This cannot be undone. Spending already tracked will remain in Firefly III."
```

## Validation

### Create Screen
- **Empty name blocking**: TextField disabled, error message shown
- **Duplicate name (case-insensitive)**: Error message shown, button disabled
- **Unique name**: No error, button enabled

### Rename Modal
- **Rename button disabled** when:
  - Name field is empty
  - New name matches current envelope name
- Rename button enabled when new name is non-empty and different

### Delete
- Destructive confirmation with red button
- Confirms budget name in title for user awareness

## Test Coverage

### budget-new.test.tsx
- ✓ Screen renders with input and button
- ✓ All required labels present

### budget-detail.test.tsx  
- ✓ Displays envelope name and available amount
- ✓ Shows Rename and Delete buttons
- ✓ Shows existing Assign and Move buttons

## Notes

- Rename modal uses TextInput + overlay (simpler than full sheet)
- Delete immediately navigates back to Budget tab on successful confirmation
- Button variant "danger" used for Delete (red styling)
- All confirmations use existing `confirmAction()` and `confirmDestructive()` from `src/ui/confirm.ts`
- Inline validation with live error messages on Create screen
- Default currency from user's settings passed to `enqueueBudgetCreate()`

## Deviations from Spec

Minor UI pattern deviation for consistency with existing codebase:
- Rename modal is an inline overlay + TextInput, not a full sheet (reduces boilerplate, matches simpler Fund edit pattern)
- No separate "conflict" UI shown inline; conflicts handled by Inbox card (consistent with other outbox operations)

## Test Counts

- **Total Test Suites:** 144 (all passing)
- **Total Tests:** 983 (all passing)
- **New screen tests:** 2 files
- **Typecheck:** 0 errors
- **Lint:** 0 errors

## What's Next (Chunk 3)

Chunk 3 will implement:
- Maestro E2E flow (create → rename → delete → FF3 verification)
- Flow registration in scripts/e2e.mjs
- FF3 helper actions (expectBudget, expectBudgetDeleted)

All UI/screen layer functions are complete and tested.
