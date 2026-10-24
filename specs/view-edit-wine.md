# Spec: View / edit wine

| | |
|---|---|
| **Status** | Draft v1 — questions Q1–Q7 settled, ready to implement |
| **Last updated** | 2026-10-24 |
| **Depends on** | [Sign in with Google](sign-in-with-google.md) · [Add a wine](add-wine.md) (data model, rules, form) · [View collection](view-collection.md) (entry point) |
| **Required by** | Add a wine (AC-23: "View wine" link in the duplicate notice) · View collection (US-5, AC-21: open a wine and go back) |

Assumptions are marked **[A#]** and listed in §13, with the decision log.

---

## 1. Purpose

Once a wine is in the collection, its owner needs to see everything recorded about it, fix mistakes, and keep the bottle count true as bottles are bought and opened. Because duplicates are blocked (add-wine BR-6), this is also the **only way to add more bottles of a wine the owner already has**.

## 2. Scope

**In scope**
- A detail page for one wine, showing all its fields.
- Quick quantity changes: "Opened one" (−1, with a short-lived Undo) and "Add bottles" (+N). Quantity can reach 0.
- Editing every field the owner entered, using the same form and rules as *Add a wine*.
- Deleting a wine permanently, after confirmation.
- Blocking an edit when the wine changed on another device since the form was opened.
- Opening the page from the collection list and from the duplicate notice in *Add a wine*.
- Going back to the collection with its search, filters, sort, and scroll position kept (view-collection AC-21).

**Out of scope**
- A list or filter of finished wines (quantity 0). For now they're reached only by link or through the duplicate notice; a "Finished" filter comes later.
- A history of quantity changes or edits.
- A total value (price × quantity) for a wine.
- Tasting notes, ratings, and photos.
- Editing or merging shared producers, regions, or grapes themselves (add-wine OQ-6). Editing a wine only changes **which** producer, region, or grapes it points to.
- Undo after deleting.
- Sharing a wine with other users.
- Offline use.

## 3. Users and roles

| Role | Can do |
|---|---|
| Collection owner | View, edit, change the quantity of, and delete **their own** wines only. |
| Any other signed-in user | Nothing. Another user's wine behaves exactly like a wine that doesn't exist (404). |
| Visitor | Nothing; redirected to sign-in, then back to the wine. |

## 4. User stories

### US-1 — View a wine
*As an owner, I want to see everything I recorded about a wine, so that I can find it and decide when to open it.*
1. The owner taps a wine in the collection list, or "View wine" in the duplicate notice.
2. The detail page shows every field that has a value. Empty optional fields are left out.
3. "Back" returns to the collection exactly as it was.

### US-2 — Open a bottle
*As an owner, I want to record that I opened a bottle in one tap, so that my count stays right.*
1. On the detail page the owner taps "Opened one".
2. The quantity goes down by 1. The page shows "2 bottles" and the message "1 bottle opened", with an **Undo** button for 5 seconds.
3. Tapping Undo adds the bottle back.
4. If the quantity reaches 0, the page says "No bottles left", and the wine disappears from the collection list.

### US-3 — Add more bottles of a wine I already have
*As an owner who bought more of a wine, I want to add them to the existing entry, so that I don't need a duplicate.*
1. The owner tries to add the same wine and gets the duplicate notice, which includes "View wine". Alternatively, they open the wine from the list.
2. On the detail page they tap "Add bottles", enter 6, and confirm.
3. The quantity goes up by 6.

### US-4 — Edit a wine
*As an owner, I want to fix a mistake, such as the wrong vintage or region.*
1. The owner taps "Edit". The *Add a wine* form opens, filled with the wine's current values, titled "Edit wine".
2. They change fields and tap "Save changes".
3. The system validates the changes with the add-wine rules and saves them. The detail page shows "Changes saved".

### US-5 — Delete a wine
*As an owner, I want to remove a wine I entered by mistake.*
1. The owner taps "Delete" on the detail page.
2. A confirmation asks: "Delete Quinta do Crasto Reserva 2017? This can't be undone." It has "Delete" and "Cancel".
3. After "Delete", the owner returns to the collection list with the message "‹wine› deleted".

### US-6 — The wine changed somewhere else
The owner edits on their phone while the same wine was changed on their laptop. When saving, the system says "This wine was changed on another device. Review the latest version and save again." It shows the latest values instead of overwriting them.

## 5. Functional requirements

| ID | Requirement |
|---|---|
| FR-1 | The system shall show a detail page for one wine with every field from add-wine §6 that has a value, plus its drink status. |
| FR-2 | The system shall return "not found" for a wine that doesn't exist **or** belongs to another user, and the two cases shall be indistinguishable. |
| FR-3 | "Opened one" shall decrease the quantity by 1 in a single tap, without a confirmation or opening the form. The resulting message shall offer "Undo" for 5 seconds; Undo adds 1 back. |
| FR-4 | "Add bottles" shall increase the quantity by a whole number from 1 to the amount that keeps the total ≤ 9 999. |
| FR-5 | Quantity changes shall be atomic: two quick taps of "Opened one" shall decrease the quantity by exactly 2. |
| FR-6 | Editing shall use the add-wine form, prefilled, with the same validation (add-wine BR-1 to BR-10) and the same handling of new producers, regions, and grapes (BR-11, BR-12, BR-14). |
| FR-7 | An edit that would make the wine a duplicate of **another** of the owner's wines (add-wine BR-6) shall be blocked, with a link to that other wine. |
| FR-8 | Saving an edit shall fail with a clear message, and change nothing, if the wine changed since the form was opened (optimistic concurrency). |
| FR-13 | The detail page shall show the price per bottle with its currency, and no total value. |
| FR-9 | Deleting shall require confirmation, then remove the wine and its grape links. Shared producers, regions, and grapes are kept. |
| FR-10 | Going back from the detail page shall restore the collection's search, filters, sort, and scroll position. |
| FR-11 | Leaving the edit form with unsaved changes shall ask first (as in *Add a wine*). |
| FR-12 | All changes shall require a valid session and CSRF token (as in *Add a wine*). |

## 6. Data model

**One change to `Wine`** (add-wine §6):

| Field | Type | Required? | Notes |
|---|---|---|---|
| version | integer | yes (system) | Starts at 1, increases by 1 on every change (edit or quantity). Used to detect conflicting edits (FR-8) |

`updated_at` is also refreshed on every change. No new entities.

**Quantity** keeps its range 0–9 999. *Add a wine* still requires at least 1; on this page the quantity can reach 0 ("finished").

## 7. Business rules

- **BR-1:** Only the owner can read or change a wine (FR-2).
- **BR-2:** Every add-wine rule (BR-1 to BR-14) applies to edits, except that the collection-size limit (BR-13) is not checked, because editing doesn't add a record.
- **BR-3:** The duplicate check (add-wine BR-6) on edit ignores the wine being edited.
- **BR-4:** "Opened one" is refused at quantity 0. "Add bottles" is refused if the result would exceed 9 999.
- **BR-5:** In the edit form, quantity may be 0 to 9 999.
- **BR-9:** Undo is an ordinary "+1" change, sent within 5 seconds of "Opened one". It is subject to the same limits (BR-4).
- **BR-6:** An edit must send the `version` it was based on. If the stored version is different, nothing is saved (FR-8). Quick quantity changes don't need a version: they are relative (−1 / +N), so they can't overwrite anything [A1].
- **BR-7:** Deleting removes the wine and its `wine_grape` rows. Producers, regions, and grapes stay, including private ones the owner created [A2].
- **BR-8:** Changes made in this feature are rate-limited together with *Add a wine*: 60 per minute per user [A3].

## 8. Interfaces

### Screen: Wine detail (`/collection/wines/:id`)
- **Header area:** producer and name as the heading, with vintage or "NV" and colour below.
- **Quantity block:**
  - Large text: "3 bottles" (or "No bottles left").
  - Buttons: **Opened one** and **Add bottles**.
  - "Add bottles" opens a small inline field (number, default 1) with "Add" and "Cancel".
- **Details:** each field that has a value, as label and value pairs:
  - Bottle size, region and country.
  - Grapes, with their percentages.
  - Price with its currency.
  - Purchase date.
  - Storage location.
  - Drink window and drink status.
  - Notes.
  - Date added.
- **Actions:** "Edit" (secondary) and "Delete" (styled as a danger link, at the bottom).
- **Back:** a "Back to collection" link at the top, which keeps the collection's state (FR-10).
- **Messages:** "Changes saved", "1 bottle opened" (with an **Undo** button for 5 seconds), and "6 bottles added", announced with `role="status"`. Undo stays reachable by keyboard while it is shown.

### Screen: Edit wine (`/collection/wines/:id/edit`)
- The *Add a wine* form, prefilled. The title is "Edit wine" and the button is "Save changes".
- **Quantity** is in the form too, and can be 0 to 9 999.
- **"More details"** opens automatically if any optional field has a value [A4].
- **Cancel** returns to the detail page, asking first if anything changed.

### API

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/collection/wines/{id}` | 200 with the full wine (as returned by POST in *Add a wine*) plus `version`; 404 otherwise |
| `PUT /api/v1/collection/wines/{id}` | Replaces the editable fields. Body: the same as POST, plus `"version": 4`. Returns 200 with the updated wine |
| `POST /api/v1/collection/wines/{id}/quantity` | Body `{ "change": -1 }` or `{ "change": 6 }`. Returns 200 `{ "quantity": 2, "version": 5 }` |
| `DELETE /api/v1/collection/wines/{id}` | 204 |

All except GET require the CSRF header. PUT and the quantity endpoint accept an `Idempotency-Key` header, so a repeated tap or retry is applied once.

| Status | When |
|---|---|
| 400 | Invalid fields, as in *Add a wine*; `change` is 0 or not a whole number |
| 401 / 403 | No session / CSRF check failed |
| 404 | No such wine for this user |
| 409 `{ "code": "duplicate", "existing_id", "existing_quantity" }` | The edit would duplicate another wine |
| 409 `{ "code": "version_conflict", "current": { …wine } }` | The wine changed since `version` |
| 422 `{ "code": "quantity_out_of_range", "quantity": 0 }` | The quantity change would go below 0 or above 9 999 |
| 429 | Rate limit |

## 9. Error handling and edge cases

| Situation | Behaviour |
|---|---|
| The wine doesn't exist, or belongs to someone else | "This wine isn't in your collection" with a link back. The two cases look identical |
| "Opened one" at quantity 0 | The button is replaced by "No bottles left"; the API also refuses (422) |
| Two quick taps on "Opened one" | Quantity decreases by exactly 2 (FR-5) |
| An edit makes it a duplicate of another wine | Nothing saved; "You already have this wine (N bottles). View wine" |
| The wine changed on another device | Nothing saved; the conflict message and the latest values (US-6) |
| The wine was deleted on another device | Saving returns 404: "This wine was deleted." Link to the collection |
| Session expired while editing | As in *Add a wine*: the draft is kept across sign-in |
| Network failure | The message says what didn't happen ("Your changes weren't saved", "The bottle wasn't counted"); the input is kept |
| The wine reaches quantity 0 | It stays viewable by link and via the duplicate notice, but is hidden from the list (view-collection FR-12) |
| Delete confirmed twice (double tap) | The second request gets 404, which the app treats as already deleted |

## 10. Non-functional requirements

- **Performance:** the detail page loads in under 500 ms p95; quantity changes are reflected in under 300 ms p95.
- **Security:** owner-only access returning 404, never 403, so a wine's existence isn't revealed. Same CSRF, session, and rate-limit rules as *Add a wine*.
- **Accessibility:** WCAG 2.1 AA:
  - The quantity buttons have clear names ("Opened one bottle", "Add bottles").
  - Quantity changes are announced.
  - The delete confirmation is an accessible dialog that traps focus and closes with Escape.
  - Focus returns to the triggering button after the dialog closes.
- **Platforms, language:** as in *Add a wine*.

## 11. Dependencies and constraints

- *Add a wine*: the form, the validation, and the lookup handling are reused, not duplicated.
- *View collection*: the entry point. Row taps become links (US-5), and the collection's state is kept on return (AC-21).
- Migration: add `wine.version`.
- Stack and deadline: as in *Add a wine*.

## 12. Acceptance criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-1 | I own "Quinta do Crasto Reserva 2017" with region, grapes, and notes | I open it | I see every recorded field, and no empty ones |
| AC-2 | Another user's wine id | I open `/collection/wines/{id}` or call the API | I get the same "not in your collection" / 404 as for a made-up id |
| AC-3 | A wine with 3 bottles | I tap "Opened one" | It shows 2 bottles and "1 bottle opened" is announced |
| AC-4 | A wine with 3 bottles | I send two "Opened one" requests at the same time | It has 1 bottle |
| AC-5 | A wine with 1 bottle | I tap "Opened one" | It shows "No bottles left" and is no longer in the collection list |
| AC-6 | A wine with 0 bottles | I call the quantity endpoint with −1 | 422; still 0 |
| AC-7 | A wine with 2 bottles | I add 6 bottles | It has 8 bottles |
| AC-8 | A wine with 9 990 bottles | I add 10 | 422; still 9 990 |
| AC-9 | I get the duplicate notice in *Add a wine* | I tap "View wine", then "Add bottles" | The existing wine's quantity increases (add-wine AC-23) |
| AC-10 | I edit the vintage from 2017 to 2018 | I save | The detail page shows 2018 and "Changes saved"; `version` increased |
| AC-11 | I own Reserva 2017 and Reserva 2018 | I edit the 2018 one to 2017 | Nothing is saved; the duplicate message links to the 2017 wine |
| AC-12 | I edit a wine without changing its name, producer, vintage, or size | I save | It isn't treated as a duplicate of itself |
| AC-13 | I opened the edit form at version 3, and the wine was changed elsewhere (now version 4) | I save | 409 version conflict; nothing is overwritten; I see the latest values |
| AC-14 | I tap "Opened one" on another device while editing here | I save my edit | Version conflict (the quantity change increased the version) |
| AC-15 | I tap "Delete" and then "Cancel" | — | Nothing is deleted and focus returns to "Delete" |
| AC-16 | I confirm "Delete" | — | I'm back on the collection with "‹wine› deleted"; the wine is gone; its producer still exists |
| AC-17 | I searched "douro" and scrolled down the collection | I open a wine and tap "Back to collection" | The same search, filters, sort, and scroll position are restored (view-collection AC-21) |
| AC-18 | I'm not signed in | I open `/collection/wines/{id}` and sign in | I land on that wine |
| AC-19 | A valid session but no CSRF token | I call PUT, quantity, or DELETE | 403; nothing changes |
| AC-20 | I change the region to "Rioja" while the country is Portugal | I save | Error on the region field (add-wine BR-9) |
| AC-21 | The detail page and the edit form | I scan them with axe | No WCAG 2.1 AA violations |
| AC-22 | A wine with 3 bottles | I tap "Opened one", then "Undo" within 5 seconds | It shows 3 bottles again |
| AC-23 | I tapped "Opened one" | 5 seconds pass | The Undo button is gone and the wine still has 2 bottles |
| AC-24 | A wine with a price of €24.50 and 3 bottles | I open it | I see "€24.50 per bottle" and no total |

## 13. Open questions and assumptions

### Assumptions
| ID | Assumption |
|---|---|
| A1 | Quick quantity changes are relative (−1 / +N) and need no version check; they do increase the version |
| A2 | Deleting a wine keeps the producers, regions, and grapes it used, even private ones only that user created |
| A3 | Edits, quantity changes, and deletes share the 60-per-minute limit with adding |
| A4 | The edit form opens "More details" when any optional field has a value |

### Open questions
None for this version.

### Decision log
| # | Question | Decision |
|---|---|---|
| Q1 | Can quantity reach 0? | Yes; the wine is hidden from the collection but reachable by link and the duplicate notice |
| Q2 | Delete in this version? | Yes, permanent, after confirmation |
| Q3 | Finding finished wines | Not in this version; a "Finished" filter comes later |
| Q4 | History of changes | No |
| Q5 | Edits on two devices | The second save is blocked (version check) |
| Q6 | Confirm "Opened one"? | No; the message offers Undo for 5 seconds |
| Q7 | Total value on the detail page | No; price per bottle only |
