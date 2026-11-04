# Issue review: #564 — console team roles and invitations

## Outcome and authority

Ready for `plan`. No unanswered owner question blocks specification. The owner confirmation in [#564](https://github.com/lorenzh/pulse-meta/issues/564#issuecomment-6637789309) supplies the exact matrix and confirms its derived cells; it satisfies the issue's confirmation prerequisite. Cite [#460, amendment of 2 November, section 13](https://github.com/lorenzh/pulse-meta/issues/460#issuecomment-6589563362) and the self-hosted SH7 Team board as its sources, as instructed by that confirmation. Use the confirmed matrix below, without inventing a replacement.

Read #564's comments, #460 and all its comments, #563 and its empty comment list, the current native dependencies of #564, repository instructions, and the Console/API files identified below. Local design files contain website boards, not SH7/SH8; this review does not claim independent inspection of the original Console boards. The owner's supplied matrix and the amended decision record are sufficient authority. SH8 email and older SMTP requirements are superseded by #460 section 6.

The owner's remaining “Open questions” do not reopen the confirmed matrix: member/viewer role changes are owner only; members may edit maintenance but cannot delete it, including their own; Full access tokens remain A+, subject to the Console token's scopes. The code/docs verification questions are answered below.

## Inspected baseline

| Target | Read-only checkout HEAD | Relevant evidence |
| --- | --- | --- |
| console | `f320e5d59703b654e6cc573b7e7f636598e20624` | `src/database.ts`, `account-store.ts`, `server.ts`, `settings.ts`, `forms.ts`, `passwords.ts`, `pages.ts`, README, configuration docs, package manifest and AGENTS |
| api | `2bc5910c9c3e223a5a17e654ada9e1e98dd7a0d1` | `src/token-scopes.ts`, `token-routes.ts`, `audit-log.ts`, `docs/rest-api.md`, `docs/install.md` and AGENTS |

- Console has first-run owner setup, password sign-in/sign-out, SQLite sessions stored by digest, CSRF/Origin checks, raw-path routing and a landing page. Its route table has no team, invite, reset, security, Activity or product management routes. README explicitly assigns second factors and recovery to #563.
- Schema version 1 has instance, users and sessions tables. `role TEXT NOT NULL` is not constrained to the four roles; a partial unique index permits at most one owner, not at least one. `User.role` and `toUser` in account-store hard-code `owner`, and user SELECTs omit role entirely. Simply inserting non-owner rows would currently treat them as owners. Extend the store and add migrations; preserve existing owner/password/session data and do not rewrite migration 1.
- `signedInOf` reads the user from the store on every protected request. Keep live role/removal checks there or at an equivalent common authorization boundary; do not cache authorization indefinitely in sessions.
- Console currently has no TOTP, invitation/reset records or durable People log. Existing application log messages are not the append-only People log required by section 9.
- The existing public-origin setting is available for link generation, but optional when serving loopback. Forms already normalize email and enforce password/name rules. Maintain the existing security checks and no-secret logging rules.
- API `canGrant` checks every target scope against the caller, mapping target `probe` to caller `checks`. Token create/rotate/revoke routes actually call it. `docs/rest-api.md:374` matches this behavior. API audit actors are token ID/name, with no Console person identity. These are inspected facts, not assumptions from the earlier researchers.

## Confirmed permission matrix

Y means role permission, subject to resource restrictions and authentication/2FA. N means denied. The Owner settings cell is policy for a later feature, not a screen to build here.

| Role x action | Viewer | Member | Admin | Owner | Source |
|---|---|---|---|---|---|
| View status, checks, incidents, maintenance | Y | Y | Y | Y | design: #460 s13 "V+" |
| Create and edit console checks, export | N | Y | Y | Y | design: s13 "M+" |
| Delete console checks | N | N | Y | Y | design: s13 "A+" |
| Declare incidents, post updates, resolve manual incidents | N | Y | Y | Y | design: s13 "M+" |
| Delete manual incidents | N | N | Y | Y | design: s13 "A+" |
| Edit existing incident text | N | N | N | N | derived: no such action in s13 or boards |
| Plan maintenance (create) | N | Y | Y | Y | design: s13 "M+" |
| Edit maintenance window | N | Y | Y | Y | derived: same power as create |
| Delete maintenance window | N | N | Y | Y | derived: delete is designed (s14, SHMaintenance), role unset, nearest rows are A+ |
| Edit status and notify settings | N | N | N | Y (not built in v1) | design: s13 "settings: O"; s2(e) no screen |
| Create, rotate, revoke tokens | N | N | Y | Y | design: s13 "tokens: A+" |
| Add and rotate probe locations | N | N | Y | Y | design: s13 "A+" |
| Activity log, System page | N | N | Y | Y | design: s13 "A+" |
| Invite members and viewers | N | N | Y | Y | design: s13 "invites: A+" |
| Invite admins | N | N | N | Y | design: SHTeam "Only the owner invites admins"; s13 "Admin changes: O" |
| Remove member or viewer | N | N | Y | Y | design: s13 |
| Remove admin | N | N | N | Y | design: s13, SHTeam |
| Change role member <-> viewer | N | N | N | Y | derived: least privilege, no source for A |
| Change role to or from admin | N | N | N | Y | design: SHTeam "role changes ... of admins: O" |
| Password reset link, member or viewer | N | N | Y | Y | design: s6, s13 |
| Password reset link, admin | N | N | N | Y | design: s6 |
| Password reset, owner | N | N | N | N | design: s6, container command only |
| Reset 2FA of member or viewer | N | N | Y | Y | design: s5 |
| Reset 2FA of admin | N | N | N | Y | design: s5 |
| Transfer ownership | N | N | N | Y | design: s13 |
| Delete the organisation | N | N | N | N | derived: one organisation (#460 decision 1); no action exists |
| Own 2FA, password, sessions | Y | Y | Y | Y | design: s13 "V+" |

The all-N owner reset row means a team-issued reset, not normal self-service password changes with credentials. “No one acts on the owner” excludes other people's team administration of that account; own account security and the owner's confirmed ownership transfer remain allowed. Owner recovery is the separate container-only path from section 6. Mandatory TOTP cannot be disabled through the own-security row.

## Scope, dependencies and nonblocking points for the plan

1. **Repository and delivery boundary.** Console is the implementation target on present evidence. Roles and account links are Console-local; do not add API user identities, per-person API tokens, new wire roles, SMTP, hosted tenancy or unrelated management screens. Later #566/#567/#569/#572 and the Activity item must attach their real routes to this policy. Define a shared action/target policy and route registration rule now, with coverage of every matrix row, rather than implement all later screens merely to obtain tests. File-owned checks and automatic incidents remain read-only; the matrix never overrides source restrictions.

2. **Missing authentication prerequisite.** [#563](https://github.com/lorenzh/pulse-meta/issues/563) is open and absent from this checkout. #460 section 19 puts it before #564. The only native blocked-by relation currently returned for #564 is completed #562. The plan must state the dependency on #563's merged TOTP/recovery/session foundation and arrange a native blocked-by relation through the normal Factory/owner workflow; this review changes no provider metadata. Do not silently assume #563 code exists, rebuild its cryptography here, or ship password-only admins. Planning can proceed using its decided behavior, with an explicit implementation prerequisite and a recheck of merged main before task breakdown/build. If a self-contained foundation task is proposed instead, the plan must explicitly account for and avoid duplicate ownership with #563.

3. **People log before Activity UI.** Section 19 places the full Activity page after #564, but every team change must already persist an append-only event. Specify a minimal durable Console event store/append interface here, including time, actor, action, target and safe retained identity after removal; the later Activity item reads it and adds API audit viewing. Commit the account change and event atomically or define an equally durable guarantee. Include invite creation/acceptance/revocation, role changes, password/2FA resets, removal, ownership transfer and owner recovery. No secret URL/token, password, TOTP seed/code, recovery code, header value or body belongs in the event. Later token actions must use this same Console-person logging boundary; no API “on behalf of” change.

4. **Authorization semantics.** Specify role AND target constraints, not a simple ordered-role comparison: Admin cannot manage Admin or Owner, and cannot change Member/Viewer roles. Owner alone invites/promotes/changes/resets/removes Admin; no team action can target Owner. Decide whether self-removal is offered (recommend no separate leave flow in this item) and test self-target requests without letting them bypass the matrix. Treat team listing as A+ from section 13. Reject unknown roles and client-supplied owner assignment. Recheck actor and target at mutation time so stale forms or concurrent promotion/transfer cannot defeat policy. Demotion/removal must affect existing sessions promptly. Authenticated role denials render 403 naming the required role; missing authentication follows sign-in handling. All-N/unsupported actions have no valid required role: explain unavailability, not an invented permission.

5. **Invite lifecycle.** Email and role are fixed by the creator; accept at `/invite/<token>` with name and password (at least 12 characters). Use a cryptographically random 256-bit secret, digest at rest, seven-day absolute validity, revocation and atomic single use. Admin creates only Member/Viewer invites; Owner may also invite Admin; never invite Owner. Define normalized-email uniqueness, existing-account conflicts, duplicate pending invites and replacement behavior (recommend one live invite per email with explicit revoke/reissue), pending-list states, who may revoke an invite by its role, and whether a creator's demotion/removal revokes pending invites. No acceptance field can change the bound email/role. Define restart persistence, malformed/unknown/expired/revoked/used-link responses, invalid-form retry without consumption, and concurrent redemption. GET must not create an account or consume a link. Invited Admin enters mandatory TOTP enrolment before any privileged use; define the pending-account boundary so abandoned enrolment cannot bypass it.

6. **Reset lifecycle.** An Admin generates a copied link for Member/Viewer; Owner for Admin; no team reset for Owner and no anonymous “forgot password.” Use 24-hour absolute expiry and atomic one use, with strong random secret and digest storage as the same security baseline as invites. Specify issuance versus successful-use effects: the confirmed rule ends all target sessions on successful password reset and retains TOTP/recovery state; issuing a link alone need not log the user out. Define replacement/revocation of prior links (recommend replacing older outstanding links), removal/role/ownership changes after issue, concurrent redemption, invalid password retry and GET behavior. A link must not retain authority to reset someone who has since become Owner or Admin without the required authorization. No authenticated full session may bypass retained 2FA after reset.

7. **2FA administration.** Reuse #563's encrypted TOTP seed, hashed recovery-code, throttling and restricted-enrolment/session mechanisms. Owner and Admin require TOTP, including existing Owner upgrade, invite acceptance, promotion, and after an administrative 2FA reset. Members/Viewers may opt in, subject to the owner's organisation-wide requirement from section 5. Specify whether promotion revokes sessions or converts them into enrolment-only sessions; existing password sessions must never become usable Admin sessions merely by changing a database role. Resetting another user's 2FA must end or restrict their sessions and invalidate former recovery material; it cannot be a password-reset side effect. No team 2FA reset of Owner. The plan must assign the organisation-wide requirement control between #563 and #564 without dropping it or adding notify/status settings.

8. **Ownership and removal.** Transfer only to an existing Admin with required TOTP, and require the typed-name confirmation from section 14. Recommend the former Owner becomes Admin; specify this explicitly. Transfer must leave exactly one Owner atomically, including concurrent transfer/removal and old forms. Remove also requires the typed current name, revokes Console sessions and outstanding account links, and preserves People history. A removed Admin's independently usable API tokens remain valid because API tokens have no Console-person ownership. Say this in the removal dialog; do not suggest automatic revocation or purge audit entries.

9. **Owner recovery and own-account boundary.** #460 section 6 requires a container command producing a one-use Owner reset link valid 15 minutes; using it clears the Owner's second factors. #562 explicitly deferred this. The plan must assign it to #564 if #563 does not supply it, with session invalidation, hashed storage, People logging and mandatory TOTP re-enrolment before Owner use. This exceptional local recovery does not add an Owner row allowance to the team matrix. Reuse #563's own-security/session UI; identify where authenticated password change lives so the V+ own-account row has an owner, without adding self-service recovery.

10. **Link presentation and HTTP security.** Use `PULSE_CONSOLE_PUBLIC_URL` for absolute copied URLs, never an untrusted Host/Forwarded header; specify the behavior when it is absent in loopback mode (explicit configuration message or a documented safe local origin). Copy by hand must work without JavaScript; no SMTP configuration, email sending or implied verified-mail delivery. Treat links as bearer credentials: no-store, no secret-bearing path in logs/metrics/People events, no Referer leakage or cross-origin redirects. Protect every change, including anonymous redemption, with the existing Origin/CSRF/body/field validation order; add bounded throttling where appropriate. Invalid links cannot enumerate users or reveal secrets. Forms and typed confirmations remain usable without JavaScript; acceptance/reset flows must fit 390 px without horizontal scroll.

11. **API scopes and disclosure.** A Console Admin can mint any scopes held by the one server Console token under `canGrant`, including `admin`; Full access is A+, not Owner only. A holder may then use those scopes directly against the API outside Console role checks. Document this decided capability and distinguish it from Console role permissions. The Console token stays server-only in its file/environment. Retain API grant and last-admin rules; future token screens log the initiating Console user alongside the action/target, while API audit continues to identify the shared token. Do not promise person attribution or automatic token revocation in API storage.

12. **Test-contract limits.** “One allowed and one denied test per row” cannot literally choose two signed-in roles for all-Y or all-N rows. Retain the matrix: for V+ rows, assert all four authenticated roles are allowed and unauthenticated/cross-account access is refused; for all-N rows, assert all four roles denied and no mutation exists, recording that an allowed case is inapplicable. Owner settings policy may get policy-level coverage but no enabled route in v1. Cover other future-screen rows at the common authorization boundary now, and require actual route integration tests when those screens land. Do not claim a policy-only test proves a nonexistent CRUD route. Expand grouped rows to exercise each implemented operation and both Member/Viewer target variants. These are acceptance interpretations, not questions requiring a new matrix.

No additional runtime package is needed by these requirements: Bun password hashing, SQLite, node crypto and existing pinned kit/contract supply the decided primitives. Keep README/configuration/route/security docs current. Broaden target scope only if inspection of the merged prerequisites demonstrates a concrete integration need.

## Derived acceptance check

Done when the following observable scenario and automated checks pass:

1. An Owner sees and manages the team; an Admin can invite/reset/remove a Member or Viewer, but direct requests targeting an Admin/Owner, role changes, or Admin invitations fail. A Member and Viewer cannot perform team administration. All four roles can use their own account security, subject to mandatory 2FA, without acting on somebody else's account.
2. A table-driven suite covers every confirmed matrix row and every role. Mixed rows have at least one allowed and one denied case; all-Y/all-N and deferred rows follow the explicit interpretation above. Real HTTP requests cover existing protected pages and every new team GET/POST, with valid authentication/CSRF on role-denial tests; a denied mutation returns the role-aware 403, makes no state change and makes no upstream API write.
3. An invite fixes email/role, shows a copyable link without sending mail, survives restart, and creates the intended account exactly once. Fake-clock checks cover just before and exactly at seven days (604800000 ms); expired, revoked, malformed and reused links fail. GET and invalid form attempts do not consume it; two concurrent valid submissions produce only one account. Database scans find digests, not the plain invite secret.
4. A copied password reset works before 24 hours (86400000 ms), fails at expiry or after its first successful use, changes the password, ends every target session, and preserves the second factor. Old password and old cookies fail, and new-password sign-in still requires existing 2FA. Validate issuer/target roles, changed target role, replacement links, removed accounts, invalid-form retries and concurrent redemption.
5. Invited/promoted Admin and Owner without completed TOTP cannot use privileged pages with either a new or an existing cookie; proper enrolment unlocks only their permitted actions. Administrative 2FA reset obeys the target matrix, invalidates old second-factor/recovery credentials and forces required enrolment. Exercise any organisation-wide requirement on Member/Viewer invite acceptance.
6. Confirmed ownership transfer to a TOTP-enrolled Admin leaves exactly one Owner, demotes the previous Owner as specified, takes effect for existing sessions, and rejects non-Admin targets, missing/wrong confirmation and stale/concurrent mutations. Removal with the typed name ends Console access and account links immediately; a wrong name has no effect, no Owner can be removed, and People history survives.
7. The container-only Owner recovery path, supplied here or by the explicitly named prerequisite, expires at 15 minutes (900000 ms), succeeds once, clears former factors/sessions, logs recovery and requires TOTP enrolment again. The web team interface cannot issue an Owner reset.
8. Every successful team change has a persistent People event with actor/action/target/time and no secrets, including after restart/removal. Failed or rolled-back mutations cannot masquerade as completed changes. Test log durability with storage failure. Token-action hooks and later-screen handoff document person logging without altering API actors.
9. Policy/docs preserve Admin access to Full access tokens bounded by `canGrant`; a removed Admin's API token is still usable in an API fixture. The removal dialog explicitly states tokens remain valid. No claim of per-person API enforcement is made.
10. Server-rendered invite/reset/confirmation flows work without JavaScript, use configured-origin links, enforce CSRF/Origin validation and avoid secret disclosure in responses other than the intended one-time display, storage, logs or metrics. Browser checks at 390 px cover acceptance and reset, including invalid/expired states and required TOTP continuation.
11. Migration tests preserve a version-1 Owner and existing data, read actual roles instead of hard-coding Owner, reject invalid role input, and exercise owner invariants/concurrent changes. Console `bun run check` and its required real-service exercise pass in implementation, using temporary databases, injected clocks and local fixtures. Add equivalent checks only for any concretely justified additional target.

## Review verification

This state writes only this review artifact. No target files, provider comments or labels were changed; application tests and browser/Compose runs were not executed. The initial artifact-directory lookup found no #564 directory; adding this file creates it. A GitHub search initially rejected a query without `is:issue`; the corrected query succeeded. A config search with the wrong indentation found no matches; the corrected search found the target entries. These inspection issues are resolved. The written file was read back and Git reports its directory as untracked, not ignored; no ignore rule was added.

