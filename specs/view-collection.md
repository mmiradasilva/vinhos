# Spec: View collection

| | |
|---|---|
| **Status** | Draft v1 — questions Q1–Q9 settled, ready to implement |
| **Last updated** | 2026-10-24 |
| **Depends on** | [Sign in with Google](sign-in-with-google.md) (required) · [Add a wine](add-wine.md) (to have data) · [View / edit wine](view-edit-wine.md) (draft v0) |
| **Required by** | Add a wine (redirect after saving), Sign in with Google (default landing page) |

---

## 1. Purpose

Once wines are in the app, owners need to see them quickly, to answer questions like "What do I have?" and "Do I already own this?". This is the **home screen** of the app: the first thing a signed-in user sees, and where they land after adding a wine.

## 2. Scope

**In scope**
- A list of the signed-in owner's wines, designed for phones first.
- Totals: the number of wines and the number of bottles.
- Text search.
- Filters: colour and country.
- Sorting.
- Loading more results as the user scrolls, plus a "Load more" button.
- An empty state for new users.
- The "‹wine› added" confirmation after *Add a wine*.
- An "Add wine" entry point.

**Out of scope**
- Viewing a wine's details, editing it, deleting it, or changing its quantity → *View / edit wine*.
- A drink-status filter, and a "choose a wine to drink" flow. The drink-status badge is still shown on each row.
- A "Drink soon" status.
- Collection value, prices, statistics, and charts.
- Grouping (by colour, region, location, etc.).
- Remembering search, filters, or sort between visits.
- Exporting or printing.
- Sharing the collection.
- Saved views and saved searches.
- Offline use.

## 3. Users and roles

| Role | Can do |
|---|---|
| Collection owner | See, search, filter, and sort **their own** wines only. |
| Visitor | Nothing. Redirected to sign-in, then back here. |

## 4. User stories

### US-1 — Browse
*As an owner, I want to see my wines at a glance, so that I know what I have.*
1. The owner opens the app, or lands here after signing in.
2. The system shows the totals and the first page of wines, with the most recently added first.
3. The owner scrolls down; more wines load until the end of the list.

### US-2 — Find a wine
*As an owner standing in a shop, I want to check whether I already own a wine, so that I don't buy a duplicate.*
1. The owner types "crasto" in the search box.
2. After a short pause, the list and the totals update to show only the matching wines.
3. Clearing the search box brings back the full list.

### US-3 — First visit (empty collection)
Instead of an empty list, the system shows an invitation: "Start your collection", one line of explanation, and an "Add wine" button.

### US-4 — Arrive after adding a wine
After *Add a wine* saves, the list opens with the message "‹Producer› ‹Name› ‹Vintage› added". The new wine is at the top, because the default sort is most recently added, and it is briefly highlighted.

### US-5 — Open a wine *(requires View / edit wine)*
The owner taps a row and the wine's detail page opens. Until that spec exists, rows can't be tapped.

## 5. Functional requirements

| ID | Requirement |
|---|---|
| FR-1 | The system shall list only the signed-in owner's wines. |
| FR-2 | Each row shall show: producer and name, vintage (or "NV"), colour, region (or country if no region is set), bottle size (only if it isn't 750 ml), quantity, and a drink-status badge (if the status is known). |
| FR-3 | The system shall show the number of wines and the total number of bottles for the current search and filters. Value is not shown. |
| FR-4 | Search shall match producer name, wine name, region, and grape names. It shall ignore case and accents, so "chateau" matches "Château". |
| FR-5 | Filters: colour (more than one can be chosen) and country (one at a time). |
| FR-6 | Sort options: recently added (default), producer A–Z, vintage newest first, vintage oldest first, drink by soonest. |
| FR-7 | The list shall load in pages of 50, using a cursor. The next page shall load automatically near the end of the list. A "Load more" button shall do the same, for keyboard and screen-reader users. |
| FR-8 | The current search, filters, and sort shall be kept in the page URL, so the back button and links restore the same view. Opening `/collection` with no parameters always starts from the defaults; nothing is remembered between visits. |
| FR-9 | An "Add wine" button shall be available at all times, fixed at the bottom of the screen on phones. |
| FR-10 | Arriving from *Add a wine* shall show the confirmation message and highlight the new wine if it is visible. |
| FR-11 | When nothing matches, the system shall say so and offer "Clear search and filters". |
| FR-12 | Wines with quantity 0 shall not be listed or counted in the totals. |

## 6. Data model

**No new stored entities.** This feature reads `Wine`, `Producer`, `Region`, `Country`, `Colour`, `BottleSize`, `Grape`, and `WineGrape` (see [add-wine.md §6](add-wine.md)).

**Drink status** is worked out when the list is read; it is never stored. `year` means the current year.

| Status | Rule |
|---|---|
| Too young | `drink_from` is set and `year` < `drink_from` |
| Past best | `drink_until` is set and `year` > `drink_until` |
| Ready | Neither of the above, and at least one of `drink_from` / `drink_until` is set |
| Unknown | Neither `drink_from` nor `drink_until` is set — no badge is shown |

## 7. Business rules

- **BR-1:** The owner always comes from the session. No request can list another user's wines.
- **BR-2:** The search text is trimmed. Searches shorter than 2 characters are ignored, and search text longer than 100 characters is rejected.
- **BR-3:** "Drink by soonest" sorts by `drink_until`, earliest first. Wines with no `drink_until` come last.
- **BR-4:** Every sort uses `created_at` and then `id` as tie-breakers, so pages stay stable and no wine appears twice or is skipped.
- **BR-5:** Totals count wine records (`wines`) and the sum of `quantity` (`bottles`) for the current search and filters.
- **BR-6:** Wines with quantity 0 are hidden. *Add a wine* can't create them; *View / edit wine* will decide whether quantity can reach 0.

## 8. Interfaces

### Screen: Collection (home, `/collection`)
- **Header:** the app name and the user menu (with "Sign out").
- **Totals line:** "42 wines · 117 bottles". When a search or filter is active: "3 of 42 wines · 8 bottles".
- **Search box:** the placeholder reads "Search producer, wine, region, grape". The list updates 300 ms after the user stops typing.
- **Filters:** a "Filters" button opens a panel (a bottom sheet on phones) with colour and country. Each active filter shows as a chip that can be removed with one tap.
- **Sort:** a select with the options in FR-6.
- **Rows:**
  - Line 1: producer and name.
  - Line 2: vintage · colour · region or country · bottle size if it isn't 750 ml.
  - Right side: quantity (e.g. "×3") and the drink-status badge.
- **Empty collection:** "Start your collection", one line of explanation, and an "Add wine" button.
- **No matches:** "No wines match" and a "Clear search and filters" button.
- **Loading:** placeholder rows are shown while results load, so the layout doesn't jump when they arrive.

### API

**`GET /api/v1/collection/wines`**

| Parameter | Type | Notes |
|---|---|---|
| `q` | string | Optional; see BR-2 |
| `colour` | comma-separated codes | e.g. `red,white` |
| `country` | ISO code | |
| `sort` | enum | `added_desc` (default), `producer_asc`, `vintage_desc`, `vintage_asc`, `drink_by_asc` |
| `cursor` | string | Copied from the previous response; the client never builds or reads it |
| `limit` | integer | 1–100, default 50 |

Response `200`:
```json
{
  "items": [
    {
      "id": "…",
      "producer": { "id": "…", "name": "Quinta do Crasto" },
      "name": "Reserva",
      "vintage": 2017,
      "is_non_vintage": false,
      "colour": { "code": "red", "name": "Red" },
      "bottle_size": { "volume_ml": 750, "name": "Standard" },
      "quantity": 3,
      "country": { "iso_code": "PT", "name": "Portugal" },
      "region": { "id": "…", "name": "Douro" },
      "drink_status": "ready",
      "created_at": "2026-10-24T10:12:00Z"
    }
  ],
  "next_cursor": "…",
  "totals": { "wines": 42, "bottles": 117, "all_wines": 42 }
}
```

`totals.wines` and `totals.bottles` follow the current search and filters; `totals.all_wines` is the whole collection, used for "3 of 42 wines".

| Status | When |
|---|---|
| 200 | OK; `items` may be empty. `next_cursor` is null on the last page |
| 400 | Invalid parameter, e.g. an unknown sort or a bad cursor: `{ "errors": [ { "field", "code", "message" } ] }` |
| 401 | No valid session |

The options for the colour and country filters come from the existing lookup endpoints (`/colours`, `/countries`).

## 9. Error handling and edge cases

| Situation | Behaviour |
|---|---|
| Empty collection | The empty state from US-3, not "No wines match" |
| Search or filter has no matches | "No wines match" plus "Clear search and filters" |
| The URL has an invalid parameter (e.g. `?sort=foo`) | The web app uses the default for that parameter; the rest of the view still applies |
| The cursor has expired or been altered | The API returns 400; the web app reloads from the first page |
| A wine is added in another tab while scrolling | It may not appear until the page is refreshed; the wines already shown have no duplicates or gaps (BR-4) |
| A page fails to load because of the network | The rows already shown stay; a "Couldn't load more wines. Retry" button appears |
| The session has expired | The user signs in and returns to the same URL, with the same search and filters |
| A very long producer or wine name | Shortened with an ellipsis on one line; the full text is in the row's accessible label |
| 10 000 wines (the collection limit) | Search, filters, and sort still meet the performance targets |

## 10. Non-functional requirements

- **Performance:**
  - The first page and totals load in under 500 ms (p95) for a collection of 10 000 wines.
  - Search results load in under 500 ms (p95), counted from the end of the 300 ms typing pause.
- **Security:**
  - Only the owner can see their wines (BR-1).
  - The search text is passed to the database as a parameter, never pasted into the SQL.
- **Privacy:** search text is not written to logs.
- **Accessibility:** WCAG 2.1 AA:
  - The wines are marked up as a list.
  - Each row is a link whose accessible name is its full visible text, e.g. "Quinta do Crasto Reserva 2017 · Red · Douro 3 bottles Ready". (A separate `aria-label` would break WCAG 2.5.3, label in name.) Quantities are shown as "3 bottles", not "×3".
  - Changes to the number of results are announced to screen readers.
  - "Load more" can be reached and used with the keyboard.
  - Drink-status badges use text, not only colour.
- **Platforms:** the same as *Add a wine*; usable from 360 px wide.
- **Language:** English.

## 11. Dependencies and constraints

- *Sign in with Google*: provides the session, and `return_to` for links into the app.
- *Add a wine*: provides the data model, and redirects here with the confirmation.
- *View / edit wine*: needed to open a wine by tapping its row (US-5). Until then, rows can't be tapped.
- Database: searching producer, wine, region, and grape names while ignoring case and accents needs suitable indexes. This is a matter for the implementation; no new entities are needed.
- Stack, platforms, and deadline: as in *Add a wine*.

## 12. Acceptance criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-1 | I own 3 wines and another user owns 5 | I open the collection | I see exactly my 3 wines |
| AC-2 | I own 0 wines | I open the collection | I see "Start your collection" and an "Add wine" button |
| AC-3 | I own Quinta do Crasto Reserva 2017 ×3 and Krug Grande Cuvée NV ×1 | I open the collection | The totals read "2 wines · 4 bottles", and Krug shows "NV" |
| AC-4 | I own a wine from "Château Margaux" | I search "chateau" | It is listed |
| AC-5 | I own a wine with the grape "Touriga Nacional" | I search "touriga" | It is listed |
| AC-6 | No wine matches "zzz" | I search "zzz" | I see "No wines match" and "Clear search and filters"; tapping it brings back the full list |
| AC-7 | I filter by colour red and white | — | Only red and white wines are listed, and the totals reflect the filter |
| AC-8 | I filter by country Portugal | — | Only Portuguese wines are listed |
| AC-9 | It is 2026 and a wine has drink_from 2028 | I view the list | That wine shows a "Too young" badge |
| AC-10 | A wine has neither drink_from nor drink_until | I view the list | It shows no drink-status badge |
| AC-11 | I sort by "Drink by soonest" | — | Wines are ordered by drink_until, earliest first; wines without one come last |
| AC-12 | I own 120 wines | I scroll to the end | 120 different wines have loaded across 3 pages, with no duplicates |
| AC-13 | I use only the keyboard | I reach the end of the first page | I can press "Load more" to load the next page |
| AC-14 | I searched "douro" and filtered red | I reload the page | The same search and filter are applied (they are in the URL) |
| AC-15 | I searched and filtered earlier | I open `/collection` fresh | The defaults apply: no search, no filters, sorted by recently added |
| AC-16 | I just added "Quinta do Crasto Reserva 2017" | I land on the collection | I see "Quinta do Crasto Reserva 2017 added" and the wine at the top |
| AC-17 | I'm not signed in | I open `/collection?colour=red` and sign in | I return to `/collection?colour=red` |
| AC-18 | A request to `GET /api/v1/collection/wines?sort=foo` | — | 400 with an error on `sort` |
| AC-19 | A collection of 10 000 wines | I open the collection | The first page and totals appear in under 500 ms p95 |
| AC-20 | A 360 px-wide screen | I open the collection | There is no horizontal scrolling, and each row fits on two lines |
| AC-21 *(requires View / edit wine)* | I searched and filtered | I open a wine and go back | The same search, filters, sort, and scroll position are restored |

## 13. Open questions and assumptions

### Assumptions
| ID | Assumption |
|---|---|
| A1 | The new wine is highlighted for a few seconds after it is added, and the confirmation message then disappears |
| A2 | The 500 ms p95 targets in §10 hold for collections of up to 10 000 wines |

### Open questions
None for this version.

### Decision log
| # | Question | Decision |
|---|---|---|
| Q1 | What each row shows | Producer and name, vintage, colour, region or country, bottle size if not 750 ml, quantity, drink-status badge |
| Q2 | Default sort | Recently added |
| Q3 | Filters | Colour and country (no drink-status filter) |
| Q4 | Collection value | Not shown |
| Q5 | Loading long lists | Load on scroll, plus a "Load more" button |
| Q6 | Remembering the view | Not remembered between visits; kept in the URL only |
| Q7 | Grouping | None |
| Q8 | Quantity 0 | Hidden; the final rule belongs in the *View / edit wine* spec |
| Q9 | "Drink soon" status | No |
| — | "Choose a wine to drink" story | Dropped from this version |
