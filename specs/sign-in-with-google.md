# Spec: Sign in with Google

| | |
|---|---|
| **Status** | Draft v1 — reviewed, decisions D1–D4 applied |
| **Last updated** | 2026-10-24 |
| **Required by** | [Add a wine](add-wine.md) and every other feature |

---

## 1. Purpose

Every collection belongs to one person, so the app needs to know who is using it. The app will be **launched publicly**. This feature lets anyone with a Google account sign up and sign in without creating a password, and keeps them signed in on their phone for weeks at a time.

## 2. Scope

**In scope**
- Signing in with Google (OpenID Connect).
- Accepting the terms of use and privacy notice at sign-up, with an explicit checkbox.
- Creating a User after the terms are accepted.
- Server-side sessions using a cookie, renewed with each use for 30 days, one session per device.
- Signing out on the current device.
- Returning to the page the user was on before sign-in.
- Issuing CSRF tokens.
- A `GET /me` endpoint for the web app.

**Out of scope**
- Other sign-in providers.
- Email and password sign-in.
- Admin roles.
- Allow lists of who may sign up.
- Account deletion and data export (decision D3: not for now — see OQ-2).
- Signing out of all devices.
- Accepting updated terms after a terms change (see OQ-3).
- Detecting that the user revoked the app's access at Google.

## 3. Users and roles

| Role | Can do |
|---|---|
| Visitor | Start Google sign-in; read the terms of use and privacy notice. |
| Signed-in user | Use the app; sign out on the current device. |

Anyone with a verified Google account can sign up.

## 4. User stories

### US-1 — First sign-in (sign-up)
1. The visitor taps "Sign in with Google" and consents on Google's page.
2. Google sends the user back to the app. No account exists yet for this Google account.
3. The app shows "Before you start": links to the terms of use and the privacy notice, an **unticked** checkbox "I agree to the Terms of use and Privacy notice", and a "Create account" button.
4. The user ticks the checkbox and taps "Create account".
5. The User is created with the time and version of the terms they accepted. A session is created, and the user lands on `return_to`, or on the collection list by default.

If the user leaves at step 3, nothing is stored.

### US-2 — Returning user
Same as US-1 steps 1–2, but an existing User is found by `google_sub`. Their email and name are updated, a new session is created, and they land on `return_to`. The terms screen is not shown.

### US-3 — Deep link
A visitor opens `/collection/new`, is sent to sign in, and returns to `/collection/new` afterwards.

### US-4 — Second device
A user who is signed in on their phone signs in on a laptop. Each device has its own session, and both keep working.

### US-5 — Sign out
The user taps "Sign out". The session for **this device** is deleted, and they land on the sign-in page. Sessions on other devices are not affected.

### US-6 — Session expiry
After 30 days without activity on a device, the next request returns 401 and the web app starts sign-in again. In *Add a wine*, the form draft is kept (that spec's FR-13).

## 5. Functional requirements

| ID | Requirement |
|---|---|
| FR-1 | The system shall authenticate users with Google OpenID Connect, using the authorization code flow with PKCE, a `state` value, and a `nonce`, and requesting only the scopes `openid email profile`. |
| FR-2 | The system shall accept an ID token only if its signature, `iss`, `aud`, `exp`, and `nonce` are all valid **and** `email_verified` is `true`. |
| FR-3 | The system shall identify users by `google_sub`. |
| FR-4 | When a `google_sub` has no User yet, the system shall show the terms screen. It shall create the User **only** after the checkbox is ticked and submitted, recording `terms_accepted_at` and `terms_version`. |
| FR-5 | When an existing User signs in, the system shall update their stored email and display name from the ID token. |
| FR-6 | Each sign-in shall create a **new** session with a freshly generated random token. A session token the browser already had is never reused. |
| FR-7 | The system shall set the session cookie `__Host-session` with `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and `Max-Age` of 30 days. |
| FR-8 | A session expires after 30 days without activity. Each authenticated request extends it. Whenever the session is extended, the cookie is sent again with a new 30-day `Max-Age`, at most once per day. |
| FR-9 | A user can have any number of active sessions, one per device. |
| FR-10 | Signing out shall delete the current session on the server and clear the cookie on this device. |
| FR-11 | The system shall issue a CSRF token tied to the session and require it in the `X-CSRF-Token` header on every request that changes data, including the "Create account" request on the terms screen. |
| FR-12 | After sign-in, the system shall redirect to `return_to` only if it passes BR-5. Otherwise it shall redirect to the collection list. |
| FR-13 | The system shall rate-limit sign-in endpoints to 60 requests per minute per IP and 10 per minute per Google account. |

## 6. Data model

### User
| Field | Type | Required? | Notes |
|---|---|---|---|
| id | UUID | yes | |
| google_sub | string | yes, unique | Stable Google account ID; the identity key |
| email | string | yes | **Not unique** — emails can change at Google and be reused |
| display_name | string | no | |
| terms_accepted_at | timestamp | yes | When the checkbox was submitted |
| terms_version | string | yes | e.g. `2026-10-01`; the version of the terms that was accepted |
| created_at | timestamp | yes | |
| last_sign_in_at | timestamp | yes | |

### Session
| Field | Type | Required? | Notes |
|---|---|---|---|
| id | UUID | yes | Internal ID |
| token_hash | string | yes, unique | Hash of the cookie token. The token itself is never stored |
| user_id | FK → User | yes | |
| csrf_token | string | yes | |
| created_at | timestamp | yes | |
| last_seen_at | timestamp | yes | |
| expires_at | timestamp | yes | `last_seen_at` + 30 days |
| cookie_refreshed_at | timestamp | yes | When the cookie was last sent again (FR-8) |

### Temporary sign-in state (not a table)
| Item | Where | Lifetime |
|---|---|---|
| `state`, `nonce`, PKCE verifier, `return_to` | Encrypted cookie `__Host-auth_request` | 10 minutes; deleted after the callback |
| Pending sign-up (`google_sub`, email, name, `return_to`) | Encrypted cookie `__Host-pending_signup` | 10 minutes; deleted when the account is created or the cookie expires |

No database rows are written for a visitor who has not accepted the terms.

## 7. Business rules

- **BR-1:** `google_sub` is unique. The email is **not** used to identify a user.
- **BR-2:** Unverified Google emails are rejected.
- **BR-3:** A session is valid only if `expires_at` is in the future.
- **BR-4:** To limit database writes, a session's `last_seen_at` is updated at most once per minute, so expiry is accurate to within one minute.
- **BR-5:** `return_to` is accepted only if it starts with `/`, does not start with `//`, contains no backslash (`\`), and matches a known app route.
- **BR-6:** An account can't be created unless the terms checkbox is ticked. The check happens on the server, not only in the browser.
- **BR-7:** `terms_version` is the current version on the server when the account is created. The browser cannot set it.

## 8. Interfaces

### Endpoints
| Endpoint | Purpose |
|---|---|
| `GET /api/v1/auth/google/start?return_to=/path` | Sets `__Host-auth_request` and redirects to Google |
| `GET /api/v1/auth/google/callback` | Checks `state` and the ID token (FR-2). Existing user: creates a session, sets the cookie, redirects to `return_to`. New user: sets `__Host-pending_signup` and redirects to `/welcome` |
| `GET /api/v1/auth/pending-signup` | 200 `{ "email", "display_name", "terms_version", "csrf_token" }` for the terms screen, or 404 if there is no pending sign-up |
| `POST /api/v1/auth/signup` | Body `{ "accept_terms": true }` plus the CSRF header. Creates the User and a session, then returns 201 `{ "return_to" }`. Returns 400 if `accept_terms` isn't `true`, or 410 if the pending sign-up has expired |
| `POST /api/v1/auth/logout` | Requires CSRF. Deletes the current session and clears the cookie. Returns 204 |
| `GET /api/v1/me` | 200 `{ "id", "email", "display_name", "csrf_token" }`, or 401 |

The CSRF token for a visitor who hasn't signed up yet is tied to the pending sign-up cookie. After sign-up, it is tied to the session.

### Screens
- **Sign in:**
  - The app name.
  - One "Sign in with Google" button, following Google's branding guidelines.
  - Links to the terms of use and the privacy notice.
- **Before you start (`/welcome`):**
  - Greeting: "Signed in as ‹email›".
  - Links to the terms of use and the privacy notice, opening in a new tab.
  - An **unticked** checkbox: "I agree to the Terms of use and Privacy notice".
  - A primary button: "Create account".
  - A secondary link: "Cancel", which discards the pending sign-up and returns to the sign-in screen.
  - Tapping "Create account" without the checkbox ticked shows "Agree to the terms to continue" next to the checkbox. "Create account" stays enabled, so the user always gets this explanation.

## 9. Error handling and edge cases

| Situation | Behaviour |
|---|---|
| The user cancels on Google's page | Back to the sign-in screen, with "Sign-in was cancelled." |
| The state or nonce doesn't match, or the ID token is invalid | Back to the sign-in screen, with "Couldn't sign you in. Try again." No session is created. |
| The email is not verified | "Your Google email isn't verified." Nothing is stored. |
| The Google account is suspended or deleted | Google refuses the sign-in. Show the generic "Couldn't sign you in" message. |
| Cookies are blocked (the auth_request cookie is missing at the callback) | "Sign-in needs cookies enabled." |
| More than 10 minutes on Google's page (auth request expired) | Restart sign-in automatically, once. If it expires again, show the generic message. |
| More than 10 minutes on the terms screen | "Create account" returns 410. Show "Your sign-in timed out. Sign in again." Nothing is stored. |
| "Create account" without the checkbox | 400. Show "Agree to the terms to continue." No account is created. |
| The user taps "Create account" twice | Exactly one User is created (unique `google_sub`). The second request signs them in. |
| `return_to` fails BR-5 | Ignored; redirect to the collection list. |
| The user changed their email at Google | Same User via `sub`; email updated. |
| The user revoked the app's access at Google | Existing sessions keep working until they expire. Known limitation. |
| Rate limit hit | 429. Show "Too many sign-in attempts. Wait a minute and try again." |

## 10. Non-functional requirements

- **Security:**
  - HTTPS only.
  - No tokens stored in `localStorage`.
  - Session tokens are stored only as hashes.
  - Temporary sign-in cookies are encrypted and authenticated.
  - Rate limits as in FR-13.
- **Logging:**
  - Never log ID tokens, authorization codes, session tokens, CSRF tokens, or cookie values.
  - Log sign-in success and failure using the user ID or `sub`, not the email.
- **Housekeeping:** a daily job deletes expired sessions.
- **Privacy:**
  - Only `sub`, the email, and the name are stored, plus the terms acceptance record.
  - Google access tokens are not kept after sign-in.
  - Nothing is stored for visitors who don't accept the terms.
- **Legal:** the terms of use and privacy notice must be published before launch. Their version is recorded on each User.
- **Accessibility:** both screens meet WCAG 2.1 AA:
  - The checkbox has a proper label.
  - The error message is linked to the checkbox and announced to screen readers.
- **Platforms:** the same browsers as *Add a wine*.

## 11. Dependencies and constraints

- **Google Cloud project:**
  - OAuth consent screen set to "In production", with the app name, logo, and privacy notice link verified by Google.
  - A **production** OAuth client whose redirect URIs are on the production domain only.
  - A **separate development** OAuth client whose redirect URI is `localhost`. `localhost` is never added to the production client.
- **Published documents:** the terms of use and the privacy notice, each with a version identifier.
- **Stack:** the same as *Add a wine* (Node.js + Fastify, PostgreSQL, React single-page app).
- **Local development:** over plain `http://localhost` the cookies drop the `__Host-` prefix and the `Secure` flag (`COOKIE_SECURE=false`, the default outside production). Production always uses `__Host-` cookies.
- **Development sign-in:** without a Google client ID, a local page stands in for Google. The server refuses to start in production without a real Google client.
- **Fallback:** until *View collection* exists, the default after sign-in is the same temporary confirmation page used by *Add a wine*.

## 12. Acceptance criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-1 | A Google account that has never signed in | I sign in, tick the checkbox, and tap "Create account" | A User is created with `terms_accepted_at` and `terms_version` set, and I land on the collection list |
| AC-2 | A Google account that has never signed in | I sign in and tap "Create account" without ticking the checkbox | No User is created and I see "Agree to the terms to continue" |
| AC-3 | A Google account that has never signed in | I sign in and then close the terms screen | No User row exists |
| AC-4 | A request to `POST /auth/signup` with `accept_terms: false` | — | 400; no User is created |
| AC-5 | An existing User whose Google email changed | I sign in | The same User is used, its email is updated, and the terms screen is not shown |
| AC-6 | I'm not signed in | I open `/collection/new` and sign in | I'm returned to `/collection/new` |
| AC-7 | `return_to=https://evil.example`, `//evil.example`, or `/\evil.example` | I sign in | I land on the collection list |
| AC-8 | A callback with a `state` or `nonce` that doesn't match | — | Sign-in fails with the generic message; no session is created |
| AC-9 | I use the app every day | It is day 31 after I signed in | I'm still signed in (the cookie was refreshed) |
| AC-10 | My last request on this device was 31 days ago | I open the app | I get 401 and I'm sent to sign in |
| AC-11 | I'm signed in on my phone | I sign in on my laptop | Both devices stay signed in |
| AC-12 | I'm signed in on two devices | I sign out on one | The other stays signed in. The signed-out cookie no longer works, even if replayed |
| AC-13 | A sign-out request without a CSRF token | — | 403; the session is unaffected |
| AC-14 | A Google account with an unverified email | I sign in | Nothing is stored and I see the "unverified" message |
| AC-15 | My browser blocks cookies | I sign in | I see "Sign-in needs cookies enabled" |
| AC-16 | 60 sign-in attempts from one IP within a minute | Another attempt arrives | 429 |
| AC-17 | Any successful or failed sign-in | I inspect the logs | No tokens, codes, or cookie values appear |

## 13. Open questions and assumptions

### Assumptions
| ID | Assumption |
|---|---|
| A1 | `last_seen_at` is written at most once per minute |
| A2 | The cookie is sent again at most once per day when the session is extended |
| A3 | Temporary sign-in state lives in encrypted cookies with a 10-minute lifetime, not in database tables |

### Open questions
| ID | Question |
|---|---|
| OQ-1 | Is a "Sign out of all devices" option needed later? |
| OQ-2 | **Account deletion (D3: not for now).** For a public launch, data-protection laws such as GDPR usually give users the right to have their data deleted. Revisit before launch, and when you do, decide what happens to shared producers, regions, and grapes the user created. Assumption: they stay, with `created_by` set to null. |
| OQ-3 | When the terms of use change, must existing users accept the new version before continuing? `terms_version` is stored so this can be added later. |
| OQ-4 | Is a recorded checkbox enough for the jurisdiction you launch in? Confirm with legal advice. |

### Decision log
| # | Question | Decision |
|---|---|---|
| D1 | How users accept the terms | An explicit, unticked checkbox at first sign-in; acceptance recorded with `terms_accepted_at` and `terms_version` |
| D2 | Multiple devices | Unlimited parallel sessions, one per device |
| D3 | Account deletion before launch | Not for now (see OQ-2) |
| D4 | Rate limits | 60 per minute per IP, plus 10 per minute per Google account |
