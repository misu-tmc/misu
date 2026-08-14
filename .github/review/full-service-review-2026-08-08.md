# MISU full service review

## Executive summary

- **Scope:** Rust/Axum/MySQL backend, production-served Preact/Vite SPA, WeChat mini-program source, authentication, meeting discovery, booking/cancellation, preparation data, check-in, voting/results, profile/logout, management reads, PWA delivery, responsive/accessibility source review, and practical local performance.
- **Environment:** macOS; local backend started from the repository Nix development shell; MySQL-backed development data; production SPA build served at `http://127.0.0.1:8080`; revision `73cee06` (`Fix device migration code redemption`); review date August 8, 2026.
- **Automated result:** SPA validation passed: 24/24 tests, production build, and distribution validation. Backend tests passed: 3/3. Backend Clippy passed with warnings treated as errors. Mini-program syntax/JSON checks passed for 13 JavaScript and 14 JSON files.
- **Validation failure:** `cargo fmt --check` fails on one existing formatting difference in the check-in status query.
- **Live result:** Health, shell/deep-link delivery, PWA/static assets, anonymous protection, device registration, challenge verification, migration, logout, meeting reads, booking/cancellation, duplicate booking, duplicate check-in, voting, and vote results were exercised successfully. Temporary QA identities and records were removed after testing.
- **Highest-risk conclusion:** The core happy paths are operational, but the release is not ready for a high-confidence accessible management/attendee rollout. The most important risks are indefinite server acceptance of expired/stolen session tokens, inaccessible editor and vote state semantics, misleading empty states during network failures, and a booking API that relies on the UI rather than enforcing the role-slot invariant.

**Finding counts:** 7 major, 4 minor, 0 critical/blocker, plus unverified follow-up risks caused by unavailable browser automation and production-like network testing.

## Coverage

| Workflow | Viewport/input mode | Result | Notable gap |
|---|---|---|---|
| Device account creation | API/Web Crypto equivalent; local service | Pass | Browser UI interaction and native browser IndexedDB were not automated |
| Device challenge login | API/Web Crypto ECDSA; local service | Pass | No Safari/WeChat browser run |
| Migration code generation/redemption/replay | API; two generated device keys | Pass | Corrected run confirmed both device keys resolve to one user and replay is rejected |
| Anonymous route/API protection | HTTP requests | Pass | No hostile browser-origin test |
| Meeting discovery/detail | Authenticated API; one upcoming, two all-scope fixtures | Pass | Only seeded data was available |
| Role booking/cancellation | Authenticated API; open role | Pass | Duplicate booking returned 200 idempotently; cancellation persisted |
| Preparation/speech editor | Source review only | Blocked | No live editor write because browser automation was unavailable and test data should not be left behind |
| Meeting create/edit/publish | Source/read coverage only | Blocked | No live write-path exercise |
| Check-in | Authenticated API; repeated POST and status read | Pass | No QR/browser navigation run |
| Table Topics/walk-in | Source/read coverage only | Blocked | No live mutation run |
| Voting and results | Authenticated API; one ballot group | Pass | Only available seeded voting group was exercised |
| Profile update | Source review only | Blocked | No live profile mutation to avoid leaving test data |
| Logout/session invalidation | Authenticated API | Pass | Cookie was invalid after logout |
| Agenda/print/deep links | HTTP shell/asset probes | Pass | No print preview or visual paper-layout inspection |
| PWA/offline behavior | Service-worker source and asset probes | Partial | No browser service-worker/offline execution |
| Accessibility | Static JSX/CSS inspection | Partial | No keyboard, screen-reader, axe, contrast rendering, or touch-device run |
| Performance | Local HTTP timing and bundle measurements | Partial | No production network, cold browser startup, long-task, CLS, or route-transition measurement |
| WeChat authentication | Source/API contract | Blocked | Real WeChat credentials and platform runtime unavailable |

## Findings

### Major — Server does not enforce the advertised session lifetime

- **Affected workflow/user impact:** Every web/device-authenticated workflow. A stolen `misu_session` token remains accepted by the backend after the browser-side 30-day cookie lifetime because the server-side session lookup checks only the token and user join. This weakens logout/expiry containment if a token is copied from a client or proxy.
- **Preconditions:** A valid session token is obtained and replayed by a client that does not honor the cookie expiry.
- **Reproduction:**
  1. Complete device registration or challenge verification.
  2. Observe that the issued cookie has `Max-Age=2592000`.
  3. Replay the same token directly against a protected endpoint after the client-side expiry period, or seed an old `created_at` value in a test database.
  4. The extractor still resolves the user because the SQL query has no age predicate.
- **Expected:** The backend rejects sessions older than the documented lifetime and purges them.
- **Actual:** [The session extractor](apps/backend/src/auth.rs#L40-L52) selects by token only. [The cookie builder](apps/backend/src/auth.rs#L189-L198) advertises a 30-day client lifetime, but [the session table](apps/backend/migrations/0001_init.sql#L24-L31) stores `created_at` as a string and the extractor does not use it.
- **Evidence:** Live registration, challenge, migration, and logout passed; this is a source-confirmed expiry gap rather than a 30-day wait. No token value was persisted in this report.
- **Confidence/reproducibility:** High; deterministic from the query and schema.
- **Suggested fix:** Store `created_at` as a real UTC `DATETIME`, add an expiry predicate to `AuthUser`, and periodically delete expired sessions. Add a backend test that inserts a session older than the policy and asserts 401, plus a test that a current session remains valid. Consider rotating/revoking all sessions for an account after a security-sensitive event.

### Major — Meeting editor controls lack accessible names

- **Affected workflow/user impact:** Keyboard and screen-reader users editing roles, assignees, sessions, and prepared speeches. The visible labels are separate `<label>` elements without `for`/`id` association, so the dynamic controls do not reliably expose names to assistive technology.
- **Preconditions:** Open an existing meeting editor, expand a role or session row, or open the Speeches tab.
- **Reproduction:**
  1. Navigate to the Roles, Sessions, or Speeches section.
  2. Use a screen reader's form-control list, or inspect the accessibility tree.
  3. Focus the Role, Assignee, Session name, Role, or speech fields.
  4. The control has no reliable programmatic label even though a sighted user sees a label.
- **Expected:** Every input/select/textarea has an accessible name that matches its visible label.
- **Actual:** [Dynamic role and assignee controls](apps/spa/src/pages/EditorPage.jsx#L616-L625), [session controls](apps/spa/src/pages/EditorPage.jsx#L651-L661), and [speech controls](apps/spa/src/pages/EditorPage.jsx#L676-L684) use labels without associated IDs or `aria-label`/`aria-labelledby`.
- **Evidence:** Static JSX inspection; the form labels in the Information panel are correctly associated, which makes the dynamic-section inconsistency clear.
- **Confidence/reproducibility:** High; deterministic markup issue.
- **Suggested fix:** Give every generated control a stable unique ID and use `htmlFor`, or wrap the control inside its label. Add an accessibility test that renders each editor tab and verifies `getByLabelText` for every field; run axe or equivalent in CI.

### Major — Vote selection state is visual only

- **Affected workflow/user impact:** Blind and screen-reader voters cannot reliably tell which candidate is selected or whether a prior ballot is active. This can cause accidental submissions or incorrect vote updates.
- **Preconditions:** Open a meeting with at least one vote group.
- **Reproduction:**
  1. Navigate to the ballot.
  2. Activate one candidate with keyboard or assistive technology.
  3. Query the accessibility tree or listen for the control state.
  4. The selected state is represented only by a CSS class.
- **Expected:** Candidates behave as a radio group, or each button exposes `aria-pressed=true/false`; the group and current selection are announced.
- **Actual:** [Vote options](apps/spa/src/pages/VotePage.jsx#L67-L78) render ordinary buttons with a `selected` class but no `aria-pressed`, radio semantics, group label, or selection announcement.
- **Evidence:** Source inspection; the live API ballot submission itself passed.
- **Confidence/reproducibility:** High; deterministic markup issue.
- **Suggested fix:** Prefer native radio inputs grouped by `name` with visible labels, or add `role="radio"`, `aria-checked`, roving focus, and group semantics. Add tests for selected/unselected accessibility state and keyboard arrow navigation.

### Major — Modal dialogs do not trap or restore focus

- **Affected workflow/user impact:** Keyboard users opening Add user, Add role, or Add venue can tab into controls behind the modal and lose their place. Screen-reader users receive `aria-modal=true` without the corresponding focus behavior.
- **Preconditions:** Open any Add user/role/venue dialog in the meeting editor.
- **Reproduction:**
  1. Activate the dialog trigger with the keyboard.
  2. Press Tab repeatedly past the last dialog control.
  3. Focus can move to the page behind the dialog because there is no focus trap.
  4. Close the dialog and observe that focus is not restored to the triggering button.
- **Expected:** Focus moves into the dialog, remains inside while open, Escape closes it, and focus returns to the trigger.
- **Actual:** [The editor dialogs](apps/spa/src/pages/EditorPage.jsx#L710-L743) set `role="dialog"` and focus the first input, but implement no focus trap, inert background, or trigger-focus restoration.
- **Evidence:** Static source inspection; no browser automation was available to capture an accessibility tree.
- **Confidence/reproducibility:** High from implementation; user-visible keyboard behavior should be confirmed in a browser regression test.
- **Suggested fix:** Use the native `<dialog>` element where supported or a tested focus-management utility. Add a Playwright keyboard test for open, Tab wraparound, Escape, and focus restoration.

### Major — Network failures are presented as false empty states

- **Affected workflow/user impact:** Attendees may believe there are no meetings or no bookings when the API is unavailable, with no retry action. This is particularly harmful during meeting-day use or a transient mobile connection loss.
- **Preconditions:** Load Booking or Me while `/api/meetings/upcoming` fails or is offline.
- **Reproduction:**
  1. Open `/app/booking` or `/app/me`.
  2. Block or fail the upcoming-meetings request.
  3. Observe the page after loading completes.
- **Expected:** A clear error state with a retry action; stale data should be retained where safe.
- **Actual:** [Booking catches the failure](apps/spa/src/pages/BookingPage.jsx#L13-L25) but still renders [“No upcoming meetings”](apps/spa/src/pages/BookingPage.jsx#L89-L93) and has no retry control. [Profile silently converts the failure to an empty booking list](apps/spa/src/pages/MePage.jsx#L15-L20).
- **Evidence:** Source-confirmed; the live success path passed. This could not be induced in a browser because browser automation was unavailable.
- **Confidence/reproducibility:** High; deterministic failure-state logic.
- **Suggested fix:** Track `loadError` separately from the data array, render `PageError` with retry on failure, and preserve the last successful data when a refresh fails. Add component tests for rejected API promises asserting no false empty-state copy and a retry button.

### Major — Booking API relies on UI filtering instead of enforcing bookability

- **Affected workflow/user impact:** A crafted or stale client can assign a non-bookable role slot, such as a Table Topics slot, through the booking endpoint. That can corrupt editor and voting data even though the Booking UI filters such slots out.
- **Preconditions:** Authenticated session and knowledge of an open non-bookable role-slot ID; the endpoint also accepts an explicit `user_id` for assignment-on-behalf.
- **Reproduction:**
  1. Obtain a meeting detail and identify a role slot with `is_bookable=false`.
  2. POST `/api/book` with the meeting ID and slot ID, without relying on the SPA filter.
  3. If the slot is open, the handler's self-booking branch reaches the assignment upsert; the on-behalf branch does not check bookability at all.
- **Expected:** The API rejects non-bookable slots with a clear 400/409 response and never changes their assignment.
- **Actual:** [The booking handler selects only by slot ID and meeting ID](apps/backend/src/handlers.rs#L70-L111); it does not join/check `role.is_bookable`. [The UI filter](apps/spa/src/pages/BookingPage.jsx#L104-L115) is the only visible guard. In the live fixture the discovered non-bookable slot was already occupied, so the request returned the existing “role already taken” conflict before the missing invariant could be exercised.
- **Evidence:** Source-confirmed; the live database contained a non-bookable fixture, but it was occupied and was not overwritten.
- **Confidence/reproducibility:** High for the on-behalf path; the exact 200 self-book result depends on an open fixture.
- **Suggested fix:** Join `role` in the booking lookup and require `is_bookable=1`; reject `user_id` assignment to non-bookable slots as well. Add an integration test with an open non-bookable slot and assert no assignment is created.

### Major — New-meeting save can create duplicates after a partial failure

- **Affected workflow/user impact:** A manager creating a new meeting with pre-assigned roles can receive a save error after the meeting was already created. Retrying can create another meeting because the editor still holds `meeting.id=null`.
- **Preconditions:** New editor state, at least one assigned role, successful whole-document create, and failure of the follow-up slot-assignment request.
- **Reproduction:**
  1. Open New meeting and assign a user before the first save.
  2. Make the initial POST `/api/meetings` succeed and the subsequent PUT `/api/meetings/:id/slots` fail or time out.
  3. The save handler returns null to the UI without updating local meeting identity.
  4. Press Save again; the code can issue another create request.
- **Expected:** Creation and assignment are atomic, or the editor adopts the created meeting ID and offers a safe retry of only the failed step.
- **Actual:** [saveWhole](apps/spa/src/pages/EditorPage.jsx#L326-L340) performs two separate requests for this case, while [runSave](apps/spa/src/pages/EditorPage.jsx#L354-L371) reports the failure without preserving the created ID in local state.
- **Evidence:** Source-confirmed failure path; not induced against the shared database.
- **Confidence/reproducibility:** Medium-high; deterministic with a mocked second-request failure.
- **Suggested fix:** Add an atomic backend create payload that includes takers, or set local state from the first response before the follow-up and make the follow-up resumable. Add a component test that rejects putSlots and asserts no second create is issued on retry.

### Minor — JSON API error contract is inconsistent with SPA parsing

- **Affected workflow/user impact:** Validation and malformed requests return plain text from Axum extractors, while the SPA only extracts `error` from JSON. Users receive generic “Request failed (422)” rather than actionable validation feedback.
- **Reproduction:**
  1. POST incomplete JSON to `/api/auth/device/register`.
  2. The live service returned HTTP 422 with `text/plain; charset=utf-8` and a useful deserialization message.
  3. [The SPA request helper](apps/spa/src/lib/api.js#L9-L30) leaves data as `{}` for non-JSON responses and throws the generic fallback.
- **Expected:** All API errors have one JSON shape, or the client displays safe text/plain error bodies as a fallback.
- **Actual:** Live incomplete JSON produced 422 text/plain; malformed JSON produced 400 text/plain.
- **Confidence/reproducibility:** High; reproduced directly with curl.
- **Suggested fix:** Install an Axum JSON extractor rejection mapper returning `{ "error": "..." }`, and add a defensive client fallback using `response.text()` when JSON parsing is not available. Add contract tests for malformed JSON and missing required fields.

### Minor — Core mobile controls are below the preferred touch target size

- **Affected workflow/user impact:** Booking and meeting-day actions are harder to hit accurately on small screens, especially while moving between agenda rows.
- **Evidence:** [Small buttons](apps/spa/css/components.css#L178-L182) are 34px high and are used by the Booking “Take!” action. [Meeting actions](apps/spa/css/components.css#L504-L513) override the shared 44px minimum with `min-height:0` and compact padding. [Timer controls](apps/spa/css/components.css#L563-L569) are 26px square. This is below the preferred 44px mobile target even though several controls may meet the WCAG 2.2 24px minimum depending on spacing.
- **Confidence/reproducibility:** High from computed CSS; visual hit testing was not possible without browser automation.
- **Suggested fix:** Use at least 44px hit areas for attendee actions and timer controls, or provide sufficient spacing and a larger invisible hit area. Add a mobile Playwright check at 390px width that measures the rendered bounding boxes.

### Minor — Secondary meeting/editor text fails normal-text contrast

- **Affected workflow/user impact:** Agenda metadata, speech metadata, editor hints, and drag affordances are difficult to read for low-vision users.
- **Evidence:** [Meeting metadata](apps/spa/css/components.css#L525-L558) and [editor affordances](apps/spa/css/components.css#L705-L728) use `#8a8a8f` and `#b9b9c0` on white. Calculated contrast ratios are approximately 3.44:1 and 1.95:1 respectively, below 4.5:1 for normal text. The darker `#706a74` token measures approximately 5.25:1.
- **Confidence/reproducibility:** High for the cited color pairs; browser rendering/anti-aliasing was not needed for the ratio calculation.
- **Suggested fix:** Darken secondary text to a token that meets the intended text-size threshold; retain very light colors only for decorative non-text affordances. Add automated contrast checks for the design tokens and key component selectors.

### Minor — Backend formatting gate is red

- **Affected workflow:** CI/release quality rather than runtime behavior.
- **Evidence:** `cargo fmt --check` reports a formatting diff in [the check-in status query](apps/backend/src/handlers.rs#L288-L300). The code compiles, tests, and Clippy pass, but a standard formatting gate would fail.
- **Confidence/reproducibility:** High; reproduced locally.
- **Suggested fix:** Run cargo fmt on the backend and add a CI formatting check. This was not changed during the review because application source changes are out of scope for this test pass.

## Accessibility and UX review

- **Keyboard:** Native links, buttons, inputs, selects, and forms provide a reasonable base, and the global `:focus-visible` rule is present in [base styling](apps/spa/css/base.css#L25-L28). The editor's modal focus escape, unassociated dynamic labels, and non-semantic vote selection are release-impacting defects.
- **Focus visibility:** Most controls inherit a visible focus ring. The editor input rule replaces the outline with a purple bottom border, which should be checked against the background in a real browser.
- **Semantics:** Main navigation and tab navigation have labels. Accordion headers expose `aria-expanded`, but do not identify controlled regions. Vote choices lack selected-state semantics. Dialogs declare `aria-modal` without complete focus management.
- **Labels/names/values:** Static login, profile, user-creation, and Information-panel fields are labelled. Dynamic Roles, Sessions, and Speeches fields are not reliably labelled; see the major finding above.
- **Contrast:** Main text and the darker muted token are acceptable by the measured ratios, but several 11–12px secondary colors are not.
- **Touch/responsive:** The layout is intentionally mobile-first: bottom navigation appears below 700px, the meeting list collapses to one column, and editor rows collapse to one column below 540px. Compact controls remain smaller than the preferred touch target and must be checked on actual iOS/WeChat browsers.
- **Feedback/recovery:** Loading states and `role="alert"`/`role="status"` are used in several places. Booking and profile failure handling currently conflates unavailable data with empty data. About, Agenda, and QR check-in error states also lack an explicit retry action.
- **Untested:** No screen-reader, keyboard-only, reduced-motion, high-zoom, dynamic text-size, color-blind, actual touch, or browser accessibility-tree run was possible because no Playwright/browser automation tool was available in the session.

## Performance review

### Measurements

- Built SPA assets: JavaScript 95,836 bytes and CSS 36,217 bytes, 132,053 bytes total.
- Gzip estimates from the built files: JavaScript 29,846 bytes and CSS 7,712 bytes, 37,558 bytes total. These are estimates, not transferred sizes.
- The backend served the JavaScript with a 95,836-byte `Content-Length` and no `Content-Encoding` header. The router has CORS and tracing layers but no compression layer in [backend setup](apps/backend/src/main.rs#L171-L176).
- Warm local HTTP timings over ten sequential requests were approximately: health 0.686–0.768ms, login shell 0.727–1.175ms, JavaScript asset 0.745–0.961ms, and CSS asset 0.683–0.991ms. These numbers exclude real-network latency and browser parsing/painting.
- Live authenticated API calls generally completed in tens to low hundreds of milliseconds against the local MySQL service: registration 181ms, challenge 107ms, verification 195ms, upcoming meetings 128ms, meeting detail 129ms, vote state 122ms, and vote submission 155ms in the exploratory run. These are individual observations, not percentile benchmarks.

### Bottlenecks and risks

- Lack of transfer compression increases payload cost on mobile networks by roughly 3.5x for the initial JS/CSS pair compared with the gzip estimates. Add server/edge Brotli or gzip and verify `Content-Encoding` over HTTPS.
- Hashed assets already receive immutable cache headers in [asset serving](apps/backend/src/admin.rs#L104-L136), which is good. HTML, service worker, and manifest are no-cache as expected.
- The PWA caches the shell but deliberately bypasses API requests and only falls back to a cached shell for navigation in [the service worker](apps/spa/public/sw.js#L1-L44). Offline users therefore reach the app shell but receive API failures; add an explicit offline state rather than showing empty data.
- No browser startup, route-transition waterfall, long-task, layout-shift, memory, or render-count measurements were possible without browser automation. No production or throttled-network budget should be inferred from the local timings.

### Recommended budgets/instrumentation

- Track compressed initial JS+CSS transfer, LCP, CLS, INP, and route transition time on a representative mobile profile.
- Add a performance smoke test with a cold browser and Slow 4G, with initial compressed JS+CSS under an agreed budget and no long task over 200ms during first route render.
- Add backend request duration/error metrics grouped by route, plus DB query timing for meeting detail/upcoming and editor batch writes.

## Validation

### Commands run and outcomes

- `cd apps/spa && npm run validate` — **passed**: 8 test files, 24 tests; Vite production build; PWA distribution validator.
- `nix develop --command cargo test` from the backend workspace — **passed**: 3 backend unit tests.
- `nix develop --command cargo clippy --manifest-path apps/backend/Cargo.toml -- -D warnings` — **passed**.
- `nix develop --command cargo fmt --manifest-path apps/backend/Cargo.toml -- --check` — **failed** on one formatting-only diff in the check-in status query.
- Mini-program JavaScript syntax and JSON parse sweep — **passed**: 13 JavaScript files and 14 JSON files.
- Live `GET /healthz` — **passed** with HTTP 200 and body `ok`.
- Live shell/deep-link/static probes — **passed** for `/login`, `/app/booking`, `/app/meeting`, `/app/meetings/42/edit`, `/app/meetings/42/agenda`, manifest, service worker, hashed JS/CSS, Toastmasters logo, and contact QR.
- Live anonymous API checks — **passed**: protected meeting, management, role, user, template, and check-in endpoints returned 401.
- Live end-to-end API workflow — **passed** for temporary device registration, challenge verification, migration, migration replay rejection, both-device identity continuity, logout invalidation, one open role booking/cancellation, duplicate booking, duplicate check-in, vote submission/persistence/results, and management reads. Temporary QA data was cleaned; the post-cleanup identity count was zero.
- Live malformed JSON contract check — **observed**: incomplete JSON returned 422 text/plain and malformed JSON returned 400 text/plain.

### Skipped or blocked checks

- Real WeChat login and mini-program runtime: requires platform credentials/runtime unavailable in this local session.
- Browser visual, keyboard, screen-reader, accessibility-tree, screenshot, trace, offline service-worker, and responsive hit-area checks: no browser automation tool/runtime was available.
- Full editor/table-topics/speech/profile mutation journey: not left against shared development data; source and read paths were inspected instead.
- Production performance, TLS/cookie behavior on a phone, slow-network waterfall, and multi-user race testing: local service and database only.

## Recommended plan

1. **Before release:** enforce server-side session expiration; add the booking invariant for `is_bookable`; fix editor labels, vote semantics, and modal focus management.
2. **Before attendee rollout:** replace false empty states with retryable error states; make mobile meeting/booking/timer hit areas comfortably touchable; darken low-contrast secondary text.
3. **Before enabling new-meeting management broadly:** make create plus assignment atomic or resumable, and add failure-injection tests for every editor batch save.
4. **Release hygiene:** run cargo fmt, normalize JSON error responses, add API contract tests, and add CI accessibility/contrast checks.
5. **Performance hardening:** enable Brotli/gzip at the backend or reverse proxy, then collect real mobile Web Vitals and route-transition traces.
6. **Follow-up browser pass:** run Playwright at 390×844 and a desktop management viewport, test keyboard-only flows, dialogs, editor tabs/drag alternatives, screen-reader names/values, offline recovery, duplicate taps, refresh/back/deep links, and print output.

The verified passing paths should not be interpreted as a clean bill of health: the untested browser and write-heavy management paths overlap with the highest-risk findings above.
