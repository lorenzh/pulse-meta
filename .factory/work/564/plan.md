# Spec #564: console team roles and invitations

## Goal

The owner of a self-hosted pulse-console can share it with a team. Each person has one of four
roles: Owner, Admin, Member or Viewer. A policy module holds the owner-confirmed permission
matrix, and every console route takes its required role from it. An Admin or the Owner makes an
invite link for one email and one role; the link is copied by hand, works once and is valid
7 days. An Admin or the Owner makes a password reset link that works once and is valid 24 hours.
The Owner changes roles, transfers ownership and can require two-factor sign-in for everyone. An
operator recovers a lost Owner account with a command in the container. Every team change is
written to an append-only People log in the console database, in the same transaction as the
change.

This is a re-plan. The first spec (closed spec PR #712) was written before the console app shell
(#718) and two-factor sign-in (#563) were on console `main`. Both are merged now. This spec is
written against console `main` `fa9205431678dd7907bdbaa75f3891d4d990c600` and deploy `main`
`7d27011`, reuses what they built, and keeps the rules of the first spec that the owner comment
of 5 November names.

## Sources and decisions this spec applies

The matrix comes from the owner confirmation in the #564 comments (comment of lorenzh, "Owner
confirmation for the permission matrix"). It cites
[#460, amendment of 2 November, section 13](https://github.com/lorenzh/pulse-meta/issues/460#issuecomment-6589563362)
and the self-hosted SH7 Team board. It replaces "the permission matrix from the design" in the
issue text. This spec uses its 27 rows, derived cells included, unchanged. The issue review
(`.factory/work/564/issue-review.md`, restored unchanged from the head `dea9f8d` of the closed
spec PR #712, because this branch started without it) reads it the same way.

| Issue text | Applied rule | Source |
| --- | --- | --- |
| "permission matrix from the design" | The 27-row matrix below, with its derived cells as confirmed. No cell changes. | #564 owner comment; #460 s13; owner comment of 5 Nov |
| "sent over SMTP or copied by hand" | Copied by hand only. The console sends no email and has no SMTP setting. | #460 s6 (supersedes the issue text and SH8) |
| "An admin can send a password reset link" | An Admin makes a link for a Member or Viewer, the Owner for an Admin. Nobody makes one for the Owner in the web UI. Valid 24 hours, one use. Using it ends all sessions of that person and keeps their second factor. | #460 s6; matrix rows 20 to 22 |
| new | TOTP is required for the Owner and every Admin, also an invited or promoted Admin before first use. The Owner can require it for everyone (off by default). | #460 s5; #563 spec (`.factory/work/563/plan.md:19`, `:115`) |
| new | The Owner recovers a lost account with a container command that prints a one-use link valid 15 minutes. Using it removes the Owner's second factors. | #460 s6; #563 spec assigns it here (`.factory/work/563/plan.md:32`) |
| new | Every team change goes to the People log. Removal and ownership transfer ask for the typed name. | #460 s9, s14 |
| new | Roles are console roles, not api scopes. The console keeps its one api token. | #460 s3; #564 owner comment rule 8 |
| owner comment of 5 Nov | Use the app shell, the shared states and the confirmations of #718; the form-token rules for every new POST; extend the single 2FA predicate of #563; migration on the real next number (3). | #564 comment of 5 Nov |

### What this spec builds on (do not redo)

Every item is on console `main` `fa92054`. #564 calls or extends it; it does not write a second
one.

| Built by | What | Where | How #564 uses it |
| --- | --- | --- | --- |
| #718 | Shell page, navigation registry with `team` entry (`minRole: "admin"`, `isAvailable: false`) | `src/shell.ts`, `src/navigation.ts:43` | Team pages render in the shell; #564 sets the `team` entry to available. |
| #718 | Protected-route dispatcher: setup phase, loopback `Host`, full-session gate, POST form with session CSRF, `requiredRole` (`403` shell page), form token, handler | `src/server.ts:880-916`, `src/protected-route.ts` | Every new team route is a `ProtectedRoute`. Its `requiredRole` comes from the policy. The dispatcher order is unchanged. |
| #718 | `ConsoleRole`, `hasRole`, `roleLabel` | `src/roles.ts:1-6` | The stored role uses this type. |
| #718 | Shared states: `forbiddenState`, `notFoundState`, `staleState`, `alreadySubmittedState`, form-expired notices | `src/states.ts:57`, `:68`, `:73`, `:99` | 403, 404, 409 answers of team routes. `forbiddenState` gets one extra form (below). |
| #718 | Typed-name and plain confirmation pages with `revision`, `isTypedNameConfirmed`, `typedNameError` | `src/confirm.ts:36-78` | Removal and transfer (typed); revoke invite, reset link, 2FA reset (plain). |
| #718 | Single-use form tokens, `a:` (anonymous CSRF) and `s:` (session) bindings, the `/console.js` busy button | `src/form-tokens.ts`, `src/server.ts:260-294`, `src/http-context.ts:200-228`, `src/console-script.ts` | Every new POST form carries `form_token` after `csrf`. No new script. |
| #563 | Session stages `factor`, `enrol`, `full`; one access gate; a `full` row of a user who must have 2FA and has none counts as `enrol`; a password sign-in of such a user starts stage `enrol` and answers `303` to `/account/authenticator` | `src/server.ts:193-254`, `:729-748`, `src/account-store.ts:23-62` | An invited Admin's first session is `enrol`. A promoted Admin and a recovered Owner have no session left (the role change or the reset ended them), so their old cookie goes to `/sign-in?next=…`; their next password sign-in starts `enrol`. A live `full` session of a Member or Viewer counts as `enrol` once the switch is on. |
| #563 | The one 2FA predicate `isSecondFactorRequired` and `signInStage` | `src/two-factor-policy.ts:6`, `:11` | Widened to every Admin and to the organisation switch. |
| #563 | TOTP with sealed seeds, recovery codes, enrolment, factor sign-in, session list, sign out all, `recheckPassword`, `deleteOtherSessions` | `src/factor-store.ts`, `src/account-routes.ts:134-172`, `src/account-store.ts:91-92` | 2FA reset deletes these rows; own password change uses `recheckPassword` and ends other sessions. New codes, authenticator setup and sign out all call guarded store variants (section 17); the flows are otherwise unchanged. |
| #563 / deploy | The secret key file, provisioned by deploy (`deploy/README.md:62-66`) | `PULSE_CONSOLE_SECRET_KEY_FILE` | Unchanged. Admin enrolment needs it as Owner enrolment does. |

### Engineering choices

These close the open points of the issue review and keep the rules of the first spec. None needs
a hold.

1. **Owner recovery belongs to #564** (#563 spec, `.factory/work/563/plan.md:32`).
2. **The organisation-wide 2FA requirement belongs to #564** (#563 spec non-goals,
   `.factory/work/563/plan.md:99`). It is an Owner-only control (#460 s5 "the owner can require
   it for everyone"; s13 "settings: O"). It is not matrix row 10, which stays unbuilt.
3. **Own password change belongs to #564** (`/account/password`), as the password part of matrix
   row 27. #563 left the rule: it must call `deleteOtherSessions` in the transaction that writes
   the new hash (`docs/configuration.md` "Second factor"; README line 35).
4. **No "leave team" flow.** Nobody is the target of their own team action.
5. **One live invite per email.** A second invite for the same email answers `409` until the
   first is revoked, used or expired.
6. **Links keep their issuer's authority only while the issuer still has it.** An invite or reset
   link fails when its issuer no longer exists or no longer may issue it, or when the target's
   role changed after a reset link was made.
7. **The former Owner becomes an Admin** after a transfer.
8. **Every role change ends all sessions of the changed person**, with no exception. A transfer
   changes two roles, so it ends every session of both people, the requesting one included.
9. **Action links, not row forms, on the Team page.** Each per-person action is a link to its own
   confirmation or form page. The Team page itself holds only the invite form and, for the
   Owner, the 2FA switch. Reason: a form token store keeps at most 100 unused tokens per session
   (`src/form-tokens.ts:8`, `FORM_TOKEN_BINDING_MAX`). A page with one form per person and
   action would evict its own tokens on a team of about 25 people.
10. **Target checks run in the route handler**, after the dispatcher's role and form-token steps,
    as the #718 confirmation fixtures do (`test/fixture-routes.ts:214-275`). The form token is
    "used up when the action starts, whatever its outcome" (#718 spec Decision 11). The
    dispatcher keeps its order and gains no new step.
11. **`roleOf` stays a test hook.** Its default now returns the stored role. `main.ts` still never
    sets it (`AGENTS.md`, "This repository"). New tests use real stored roles and do not set it.

## Scope

- console: roles in the database (migration 3), the permission policy, the required role of every
  protected route from the policy, the extra 403 form, the widened 2FA predicate and the
  organisation switch, the Team page and its actions (invite, revoke, role change, removal, reset
  link, 2FA reset, ownership transfer), invite acceptance, password reset, own password change,
  the sign-in revalidation, the owner recovery command, the People log, metrics, logs, docs,
  browser checks and one CI step.

## Non-goals

- Any api, contract, kit, config or deploy change. No per-person api token, no "on behalf of"
  field, no new api scope or wire role.
- Email, SMTP, verified mail delivery, self-service "forgot password".
- The screens of checks, incidents, maintenance, tokens, probe locations, Activity and System
  (#565, #566, #567, #569, #572, item C). They take their required role from the policy of this
  item. The People log has no viewer here; item C adds the Activity page.
- Sign-in events in the People log.
- Any change to TOTP, recovery codes, enrolment, the session list or the factor throttle (#563),
  apart from the predicate widening, the 2FA reset of another person and the commit guards of
  section 17 (new recovery codes, authenticator setup, sign out all).
- A copy button. Links are selected and copied by hand from a read-only input; `/console.js` is
  not changed.
- Editing status or notify settings (matrix row 10: Owner, not built in v1).
- Hosted tenancy, more than one organisation, deleting the organisation.

## Required behavior

### 1. Roles and the permission matrix

The four roles are `owner`, `admin`, `member` and `viewer` (`ConsoleRole`, `src/roles.ts:1`).
There is exactly one `owner`.

The matrix (Y allowed, N denied). The row numbers and action ids are used in code, tests and this
spec.

| # | Action id | Role x action | Viewer | Member | Admin | Owner | Source |
|---|---|---|---|---|---|---|---|
| 1 | `overview.view` | View status, checks, incidents, maintenance | Y | Y | Y | Y | #460 s13 "V+" |
| 2 | `check.write` | Create and edit console checks, export | N | Y | Y | Y | s13 "M+" |
| 3 | `check.delete` | Delete console checks | N | N | Y | Y | s13 "A+" |
| 4 | `incident.write` | Declare incidents, post updates, resolve manual incidents | N | Y | Y | Y | s13 "M+" |
| 5 | `incident.delete` | Delete manual incidents | N | N | Y | Y | s13 "A+" |
| 6 | `incident.edit-text` | Edit existing incident text | N | N | N | N | derived, confirmed |
| 7 | `maintenance.create` | Plan maintenance (create) | N | Y | Y | Y | s13 "M+" |
| 8 | `maintenance.edit` | Edit maintenance window | N | Y | Y | Y | derived, confirmed |
| 9 | `maintenance.delete` | Delete maintenance window | N | N | Y | Y | derived, confirmed |
| 10 | `settings.edit` | Edit status and notify settings | N | N | N | Y (not built in v1) | s13 "settings: O"; s2(e) |
| 11 | `token.write` | Create, rotate, revoke tokens | N | N | Y | Y | s13 "tokens: A+" |
| 12 | `probe.write` | Add and rotate probe locations | N | N | Y | Y | s13 "A+" |
| 13 | `activity.view` | Activity log, System page | N | N | Y | Y | s13 "A+" |
| 14 | `invite.member` | Invite members and viewers | N | N | Y | Y | s13 "invites: A+" |
| 15 | `invite.admin` | Invite admins | N | N | N | Y | SH7 Team; s13 "Admin changes: O" |
| 16 | `remove.member` | Remove member or viewer | N | N | Y | Y | s13 |
| 17 | `remove.admin` | Remove admin | N | N | N | Y | s13, SH7 Team |
| 18 | `role.member-viewer` | Change role member <-> viewer | N | N | N | Y | derived, confirmed |
| 19 | `role.admin` | Change role to or from admin | N | N | N | Y | SH7 Team |
| 20 | `reset-link.member` | Password reset link, member or viewer | N | N | Y | Y | s6, s13 |
| 21 | `reset-link.admin` | Password reset link, admin | N | N | N | Y | s6 |
| 22 | `reset-link.owner` | Password reset, owner | N | N | N | N | s6, container command only |
| 23 | `2fa-reset.member` | Reset 2FA of member or viewer | N | N | Y | Y | s5 |
| 24 | `2fa-reset.admin` | Reset 2FA of admin | N | N | N | Y | s5 |
| 25 | `owner.transfer` | Transfer ownership | N | N | N | Y | s13 |
| 26 | `org.delete` | Delete the organisation | N | N | N | N | derived, confirmed |
| 27 | `account.self` | Own 2FA, password, sessions | Y | Y | Y | Y | s13 "V+" |

Every row with a Y is monotonic in the role order viewer < member < admin < owner, so each such
row has one lowest allowed role, and `hasRole` (`src/roles.ts:6`) decides it. Rows 6, 22 and 26
have no allowed role.

Two console actions sit outside the matrix rows. They add no permission; they name where an
existing rule applies:

- `team.view`: the Team page. Admin and Owner (s13 "team (invites, removal, resets for members
  and viewers): A+").
- `team.require-2fa`: the organisation-wide 2FA requirement. Owner only (s5; s13 "settings: O").

The derived cell "member deleting own items: no exception" applies to later screens: a Member
cannot delete a maintenance window, also not one they made.

`src/permissions.ts` (new) exports the action id union, the matrix as data, `minimumRole(action):
ConsoleRole | undefined` (undefined for rows 6, 22, 26), `isAllowed(role, action): boolean`, and
the target rule of section 2. A production `ProtectedRoute` sets
`requiredRole` from `minimumRole` of its action; creating the server with an action that has no
minimum role throws a named error. The Overview (`src/server.ts:330-349`) uses `overview.view`
(lowest role `viewer`, as today). The navigation registry's `minRole` values
(`src/navigation.ts:24-45`) already match rows 1, 11, 12, 13 and `team.view`; a test pins them.

### 2. Target rules

A team action also depends on the role of the person it changes (the target):

- The Owner is never a target. No team action changes, resets, removes or demotes the Owner.
- Admin targets need the Owner: invite of an Admin (row 15), removal (17), any role change to or
  from `admin` (19), reset link (21), 2FA reset (24).
- Member and Viewer targets: removal (16), reset link (20) and 2FA reset (23) are A+. A role
  change between `member` and `viewer` is Owner only (18).
- Nobody is the target of their own team action. For an Admin or the Owner this follows from the
  rules above; a request naming the actor's own id gets the answer for a target of that role.
- Invites never carry the role `owner`. Ownership moves only by transfer (25), only to an Admin
  with an authenticator.

The policy maps (actor role, action kind, target role) to one matrix row and answers allowed, or
denied with the lowest allowed role of that row, or denied because the target is the Owner.

### 3. Where the role is checked

- **Protected routes.** The dispatcher order of `src/server.ts:880-916` stays: route and method
  (`404`, `405`), phase (before setup `GET` `303` to `/setup`, `POST` `404`), loopback `Host`
  (`421`), the full-session gate (`303` to `/sign-in?next=<target>`, no body read; an `enrol`
  stage goes to `/account/authenticator`), for `POST` Origin (`403`), content type (`415`), body
  size (`413`), repeated field (`400`), the session CSRF token (`403`), the route's
  `requiredRole` (`403` shell page `Access denied`), for `POST` the form token (`409`), then the
  handler. The handler of a target route then runs: field format and id format (`422` or `404`),
  target lookup (`404` shell page `Page not found`), the target rule (`403` shell page), the
  revision check (`409` with `staleState`), the typed name (`422`), the commit.
- **The commit re-checks.** Every team mutation runs in one `BEGIN IMMEDIATE` transaction that
  re-reads the actor's role and the target row and evaluates the rule again. Actor no longer
  allowed: `403`. Target gone: `404`. Target's revision changed: `409`. A denied or refused
  request changes no row and writes no People event.
- **Role source.** The role is read from the `users` row on every request (`currentSession`,
  `src/server.ts:193-205`, reads the user already). It is never cached in the session row or a
  cookie. A demotion, a removal and a transfer take effect on the next request of every session.
- **Account routes** (`/account/*`, access `full`, `src/server.ts:102-127`): matrix row 27 allows
  every role, so they keep the stage gate and add no role step. `/account/password` is added
  there.
- **Public link routes** (`/invite/<token>`, `/reset/<token>`) have access `public` and no
  session, 2FA or role step.
  - Matching: a raw path that is exactly `/invite/` or `/reset/` plus 43 characters of
    `[A-Za-z0-9_-]` (32 random bytes as base64url, as `newToken`, `src/http-context.ts:115-117`).
    A trailing `/`, a percent-encoded character, 42 or 44 characters or a second segment answer
    the plain `404 not found`. Methods `GET`, `HEAD`, `POST`; another method `405`.
  - GET order: route and method, phase (before setup `404`, as the account routes,
    `src/server.ts:798-802`), loopback `Host` (`421`), the link lookup (invalid-link page, `404`),
    then the `200` form. A valid-link GET calls `ensureCsrf` (`src/http-context.ts:124-130`), as
    the sign-in page does, and issues a form token with the `a:` binding of that CSRF value and
    the raw link path. An invalid-link page sets no cookie and issues no token.
  - POST order: route and method, phase, loopback `Host`, Origin (`403`), content type (`415`),
    body size (`413`), repeated field (`400`), CSRF against the anonymous `pulse_console_csrf`
    cookie (`403` "Request refused"; the default of `readPostForm`, `src/http-context.ts:180-192`,
    as `postSignIn` uses it), the link lookup (invalid-link page `404`, before any KDF work),
    field format (`422`, the form again with a fresh form token), the form token (`409`: replay
    `Already submitted`, else the form again with `This form has expired. Send it again.`), the
    password hash, the commit.
  - **Precedence of a replay.** The link lookup runs before the form token, so a used, expired,
    revoked or otherwise invalid link answers the `404` invalid-link page whatever the form token
    is. In particular, sending a POST again after it committed (the link is used now) answers
    `404`, not `409`, and logs no `form token refused` line. `409` `Already submitted` comes only
    while the link is still valid and the form token was already used: a second POST with the
    same token after the first one used the token but did not use the link (the invite commit
    refused with `409` `An account with this email exists.`, or the first POST is still in its
    password hash). If that first POST then commits, its own answer is `303`. A link POST whose
    link becomes invalid between the lookup and the commit answers the `404` invalid-link page
    from the commit. The `Already submitted` page of a link route links to `/sign-in`, never to
    the link path, so no response but the link's own form holds the token.
  - No step before the commit reads the session cookie: a valid, expired, unknown or foreign
    session cookie never changes the status or the CSRF check. One exception comes after an
    invite commit: the session rotation deletes the row that the session cookie names, exactly
    as sign-in does (`startSession`, `src/server.ts:752-761`). The reset POST never reads the
    session cookie; it deletes every session of the link's user.
  - A link opened from another site is a cross-site navigation, so the browser does not send the
    `SameSite=Strict` CSRF cookie; the GET sets a fresh one and the same-site POST sends it back.
    The fresh cookie replaces the old one, so an open sign-in form in another tab then gets `403`
    "Request refused" once. This is accepted; a reload fixes it.

### 4. The 403 answer

Role denials keep the dispatcher's shell page `Access denied` with `forbiddenState`
(`src/states.ts:57-65`): "This page needs the <Role> role or higher. Your role is <Role>." A
target-rule denial in a handler answers the same page with the lowest allowed role of the
target's row (for an Admin target: Owner). `forbiddenState` gains one more form with a fixed
text instead of the role sentence, for two cases: an Owner target (`No one can change the owner
account in the console.`) and a transfer to a Member or Viewer (`Only an admin can become the
owner.`). The existing output for a role denial stays byte-identical. Rows 6 and 26 have no route; row 22 is reachable only as an Owner target of
`/team/reset-link` and answers the Owner-target text. The owner recovery command is the only
Owner reset.

### 5. Two-factor requirement

- `isSecondFactorRequired` (`src/two-factor-policy.ts:6`) stays the one rule. It becomes
  `isSecondFactorRequired(user: { role: ConsoleRole }, organisation: { isRequiredForAll: boolean
  }): boolean` and returns true for `owner`, for `admin`, and for every role when
  `isRequiredForAll` is true. Both callers (`currentSession`, `src/server.ts:200-203`;
  `passwordStage`, `src/server.ts:729-734`) pass the instance flag, read live.
- So a user who must have TOTP and has none reaches only `/account/authenticator`, sign-out and
  the assets. This is the existing #563 gate; no new gate is written. How each case gets there:
  - Invited Admin: the accept POST starts a session of stage `enrol` and answers `303` to
    `/account/authenticator`.
  - Promoted Admin: the role change deleted every session (section 13), so the old cookie is
    anonymous and gets `303` to `/sign-in?next=<path>`. The next password sign-in starts stage
    `enrol` and answers `303` to `/account/authenticator` (`passwordStage` and `stageTarget`,
    `src/server.ts:729-748`).
  - Recovered Owner: the recovery link removed the factors and every session and answers `303`
    to `/sign-in?reset=done` (section 11). The next password sign-in leads into enrolment as for a
    promoted Admin.
  - Switch turned on: no session ends; a live `full` session of a Member or Viewer without an
    authenticator counts as `enrol` on its next request (`currentSession`,
    `src/server.ts:193-205`).
- The switch is off by default. The Owner turns it on or off on the Team page
  (`POST /team/require-2fa`). When on, a Member or Viewer without TOTP reaches only enrolment on
  the next request. Turning it on or off ends no session.

### 6. Database: migration 3

Console `main` has schema version 2 (`src/database.ts:4`, migrations at `:105-125`). #564 adds
migration 3 in its own `BEGIN IMMEDIATE` transaction, run when `user_version <= 2`, and sets
`SCHEMA_VERSION = 3`. Migrations 1 and 2 are not edited. A schema-2 database keeps its Owner,
password hash, sessions, authenticators and recovery codes.

Migration 3:

- `users.role`: triggers `users_role_insert` (`BEFORE INSERT`) and `users_role_update`
  (`BEFORE UPDATE OF role`) raise `RAISE(ABORT, 'invalid role')` for a role outside `owner`,
  `admin`, `member`, `viewer`. The unique partial index `users_one_owner` keeps "at most one
  owner".
- `instance`: new column `require_2fa_all INTEGER NOT NULL DEFAULT 0 CHECK (require_2fa_all IN
  (0, 1))`.
- `invites(id INTEGER PRIMARY KEY AUTOINCREMENT, token_digest TEXT NOT NULL UNIQUE, email TEXT NOT
  NULL, role TEXT NOT NULL CHECK (role IN ('admin','member','viewer')), created_by INTEGER
  REFERENCES users(id) ON DELETE SET NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT
  NULL, used_at INTEGER, revoked_at INTEGER, accepted_user_id INTEGER)`.
- `reset_links(id INTEGER PRIMARY KEY AUTOINCREMENT, token_digest TEXT NOT NULL UNIQUE, kind TEXT
  NOT NULL CHECK (kind IN ('team','owner-recovery')), user_id INTEGER NOT NULL REFERENCES users(id)
  ON DELETE CASCADE, target_role TEXT NOT NULL, issued_by INTEGER REFERENCES users(id) ON DELETE
  SET NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER)`.
- `people_events(id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor_kind TEXT NOT
  NULL CHECK (actor_kind IN ('user','container')), actor_user_id INTEGER, actor_email TEXT,
  actor_name TEXT, action TEXT NOT NULL, target_kind TEXT NOT NULL, target_id INTEGER,
  target_email TEXT, target_name TEXT, from_role TEXT, to_role TEXT, value TEXT)`. No foreign
  keys, so history stays after a removal. Triggers `people_events_no_update` and
  `people_events_no_delete` raise `RAISE(ABORT, 'people_events is append-only')`. `action` and
  `target_kind` have no `CHECK`, so later items add values without a migration; the TypeScript
  type lists the allowed values.
- `token_digest` is the SHA-256 hex digest of the 43-character link token.

The account store reads `role` from the row (today `User.role` is `"owner"`,
`src/account-store.ts:14`; `toUser` hard-codes it, `:137-147`; the SELECT omits it, `:160`). It
narrows the value with a role check and throws a named error on an unknown value instead of
casting. `Instance` gains `isTwoFactorRequiredForAll`. The "newer than this console" start error
keeps its text with the number 3.

Never stored: a plain invite or reset token, a password, a TOTP code.

### 7. People log

`appendPeopleEvent` (`src/people-log.ts`, new) writes one row inside the transaction of the
change it records. If the insert fails, the change rolls back and the request answers `500`
with `The change could not be saved.` So a row exists exactly for each committed change.

| Action | Actor | Target | Extra |
| --- | --- | --- | --- |
| `invite.create` | the user | `invite` id, email | `to_role` |
| `invite.revoke` | the user | `invite` id, email | `to_role` |
| `invite.accept` | the new user | `user` id, email, name | `to_role` |
| `user.role-change` | Owner | `user` | `from_role`, `to_role` |
| `user.remove` | the user | `user` (email and name kept) | `from_role` |
| `user.reset-link` | the user | `user` | |
| `user.password-reset` | the target (link used) | `user` | `value` = `team` |
| `user.password-change` | the user | `user` (self) | |
| `user.2fa-reset` | the user | `user` | |
| `owner.transfer` | former Owner | `user` (new Owner) | `from_role` `admin`, `to_role` `owner` |
| `owner.recovery-link` | `container` | `user` (Owner) | |
| `owner.recover` | `container` | `user` (Owner) | `value` = `owner-recovery` |
| `team.require-2fa` | Owner | `instance` | `value` = `on` or `off` |

The row stores actor and target email and name as they were then. It never stores a token, link,
password, TOTP seed or code, recovery code, cookie, form token, header value or request body.
Failed or denied attempts write no row. Later items use the same function for console actions on
api objects (for example `token.create` with the initiating person in #566). The api audit log
keeps naming the console's shared token.

### 8. Routes

`user` and `invite` are decimal ids in the query, matching `^[1-9][0-9]{0,15}$`; any other value
answers the shell `404`. A form's `action` carries the same query (`/team/remove?user=7`); the
form token binds to the raw path without the query, as for every route. `revision` is
`<created_at>-<role>` of the target user row as rendered (for example `1700000000000-member`), so
a removed and re-used id or a changed role is a stale form. Every POST form carries `csrf`, then
`form_token`.

| Route | Kind | Required role (action) | Fields | Answer |
| --- | --- | --- | --- | --- |
| `GET /team` | shell | Admin (`team.view`) | | `200` Team page |
| `POST /team/invites` | shell | Admin (row 14) | `email`, `role` | `200` link page; `403`, `409`, `422` |
| `GET`/`POST /team/invites/revoke?invite=<id>` | plain confirmation | Admin (row 14; Owner for an admin invite, row 15) | | `303` to `/team`; `403`, `404` |
| `GET`/`POST /team/role?user=<id>` | shell form | Owner (rows 18, 19) | `role`, `revision` | `303` to `/team`; `403`, `404`, `409`, `422` |
| `GET`/`POST /team/remove?user=<id>` | typed confirmation | Admin (rows 16, 17) | `revision`, `confirm_name` | `303` to `/team`; `403`, `404`, `409`, `422` |
| `GET`/`POST /team/reset-link?user=<id>` | plain confirmation | Admin (rows 20, 21, 22) | `revision` | `200` link page; `403`, `404`, `409` |
| `GET`/`POST /team/reset-2fa?user=<id>` | plain confirmation | Admin (rows 23, 24) | `revision` | `303` to `/team`; `403`, `404`, `409` |
| `GET`/`POST /team/transfer?user=<id>` | typed confirmation | Owner (row 25) | `revision`, `confirm_name` | `303` to `/sign-in?transfer=done`; `403`, `404`, `409`, `422` |
| `POST /team/require-2fa` | shell | Owner (`team.require-2fa`) | `value` (`on`, `off`) | `303` to `/team`; `403`, `422` |
| `GET`/`POST /account/password` | account (stage `full`) | every role (row 27) | `password`, `new_password`, `new_password_confirm` | `303` to `/account/password?changed=1`; `401`, `409`, `422`, `429` |
| `GET`/`POST /invite/<token>` | public | none | `name`, `password`, `password_confirm` | `303`; `404`, `409`, `422` |
| `GET`/`POST /reset/<token>` | public | none | `password`, `password_confirm` | `303` to `/sign-in?reset=done`; `404`, `422` |

The #563 routes `POST /account/recovery-codes`, `POST /account/authenticator` (`action=start`)
and `POST /account/sessions/sign-out-all` keep their routes and answers and gain one: `409` when
the guard of section 17 fails.

The required role in the table is the route's coarse `requiredRole` (the lowest role of its rows,
from `minimumRole`). The row of the actual target is checked in the handler (section 3). The
navigation `team` entry becomes available. `/account/security` (`src/account-pages.ts:144-160`)
gains a link `Change password` to `/account/password`.

### 9. Team page

`GET /team` in the shell (`navId` `team`):

- **People**: name, email, role, `2FA: on` or `2FA: off`, and the action links that the actor may
  use on that person (section 2): `Change role`, `Reset link`, `Reset 2FA`, `Remove`,
  `Make owner`. The Owner's row has none. An Admin sees no link on Admin rows. A link only opens
  a page; it never acts.
- **Pending invites**: every invite that is not used and not revoked, with email, role, creator
  name (or `removed`), expiry (`YYYY-MM-DD HH:MM UTC`, `utcMinute`, `src/account-pages.ts:18`)
  and the state `pending` or `expired`, and a `Revoke` link where the actor may revoke it.
- **Invite form**: `email` and `role` (`member`, `viewer`, and `admin` only for the Owner).
- **Organisation 2FA** (Owner only): the current state and one form with `value` `on` or `off`.
- The People list shows every user. No pagination: one organisation is small; the page is one
  SQL read of `users` and `invites`.

### 10. Invites

- **Create.** `email` uses `checkEmail` (`src/forms.ts:62`; trimmed, lowercased). `role` is
  `admin`, `member` or `viewer`; anything else, also `owner`, answers `422` `Choose admin, member
  or viewer.` An Admin choosing `admin` answers `403` (row 15, "needs the Owner role"). Inside the
  transaction, after the actor re-check:
  1. An account with this email exists: `409` `An account with this email exists.`
  2. A live invite for this email exists: `409` `An invite for this email is pending. Revoke it
     to make a new one.`
  3. Insert the invite with the token digest, `expires_at = created_at + 604800000`, and the
     People event.
- The answer is a `200` shell page with the full link in a read-only input and as text, the
  email, the role, and `It works once and expires on <YYYY-MM-DD HH:MM UTC>. It is shown only
  now.` It names no SMTP and sends no email. A browser reload re-sends the used form token and
  gets `409` `Already submitted`, so the link is never shown twice.
- **Live** means `used_at` and `revoked_at` are null and `now < expires_at`. At `now ==
  expires_at` the invite has expired.
- **Revoke.** Who may create an invite of that role may revoke it (Admin: member and viewer
  invites; Owner: all). Revoking a used or revoked invite answers `404`; an expired one is revoked
  (it leaves the list). It sets `revoked_at` and writes the event.
- **Accept, GET.** A live invite whose creator still exists and still may create an invite of that
  role shows a plain-document form (as sign-in, `src/pages.ts:70-89`) with the bound email as
  text (not a field), the role, `name`, `password`, `password_confirm`. GET never creates an
  account or uses the invite.
- **Accept, POST.** Order of section 3. Field errors answer `422` (`checkName`, `passwordText`,
  `src/forms.ts:78`, `:88`) and leave the invite live. After the form token and the hash, one
  `BEGIN IMMEDIATE` transaction: the invite is still live and its creator still may create it
  (else the invalid-link page); no account has the email (`409` `An account with this email
  exists.`); insert the user with the bound email and role; set `used_at` and
  `accepted_user_id`; write `invite.accept`. Then a session starts as at sign-in
  (`startSession`, which deletes the row the request's session cookie names). Its stage is
  `signInStage({ isRequired, hasAuthenticator: false })`: `enrol` for an Admin or when the switch
  is on (`303` to `/account/authenticator`, as Finish setup does, `src/server.ts:616-618`), else
  `full` (`303` to `/`).
- No field of the accept form can change the email or the role. Unknown fields are ignored.
- **Invalid-link page.** Unknown, expired, revoked, used, and invites whose creator lost the
  authority all answer the same plain-document `404` page `Link not valid` with `This link is not
  valid. It may have expired or been used. Ask an admin for a new one.` (`messagePage`,
  `src/pages.ts:96`). It does not say which case applies and shows no email.

### 11. Password reset links

- **Create** (`/team/reset-link?user=<id>`). GET: plain confirmation `Make a password reset link
  for <name>? Using it signs <name> out everywhere.` POST: target Member or Viewer row 20, Admin
  row 21, Owner row 22 (always `403`, Owner-target text). In one transaction: delete the target's
  unused `team` links, insert a new one (`target_role` = the target's role, `expires_at =
  created_at + 86400000`), write `user.reset-link`. The answer is a `200` shell page with the link
  once: `It works once and expires on <YYYY-MM-DD HH:MM UTC>. Using it signs <name> out
  everywhere.` Making a link signs nobody out.
- **Valid** means unused, `now < expires_at`, the target exists and its role equals
  `target_role`; for `team` links the issuer exists and may still issue it for that role; for
  `owner-recovery` links the target is still the Owner.
- **GET** of a valid link: plain-document form with the target's email as text, `password` and
  `password_confirm`. GET changes no row.
- **POST.** Order of section 3. Field errors answer `422` and leave the link valid. After the form
  token and the hash, one `BEGIN IMMEDIATE` transaction: the link is still valid; update
  `password_hash`; set `used_at`; delete every other unused link of that user; delete every
  session of that user (their pending setup keys go by cascade); write the event. A `team` link
  keeps the user's authenticator and recovery codes. An `owner-recovery` link also deletes the
  Owner's `authenticators`, `pending_authenticators` and `recovery_codes` rows. The answer is
  `303` to `/sign-in?reset=done`, which shows `Your password is set. Sign in.` It starts no
  session, so sign-in still asks for the second factor of a user who has one.

### 12. 2FA reset of another person

GET: plain confirmation `Reset two-factor sign-in for <name>? Their authenticator and recovery
codes stop working and they are signed out. They set up two-factor sign-in again if their role
needs it.` POST in one transaction: delete the target's `authenticators`, `recovery_codes` and
`pending_authenticators` rows (tables of migration 2, `src/database.ts:51-70`), delete every
session of the target, write `user.2fa-reset`. The password stays. The Owner is never a target.

### 13. Role change

GET `/team/role?user=<id>`: a shell form with the target's name and current role, a choice of the
other roles among `admin`, `member`, `viewer`, and `revision`. POST: `role` = `owner` or another
value answers `422` `Choose admin, member or viewer.`; `role` equal to the current role answers
`422` `Choose a different role.`; `revision` different from the current row answers `409` with
`staleState`. In the transaction: update the role, delete every session of the target, write
`user.role-change`. A promoted Admin without an authenticator reaches only enrolment after the
next sign-in.

### 14. Removal

GET: `typedConfirmPage` (`src/confirm.ts:63`) with the consequence `<name> loses access to the
console now. Their invites stop working. API tokens are not tied to people: tokens that <name>
created or copied stay valid until someone revokes them in pulse-api.` POST: `confirm_name`
through `typedNameError` (`src/confirm.ts:41`; `422` with its texts), `revision` (`409`). In the
transaction: write `user.remove` with the target's email, name and role, then delete the user
row. Sessions, authenticators, pending setup keys, recovery codes (migration 2 cascades) and reset
links (cascade) go with it. Invites the person created stay with `created_by` null and stop
working (decision 6). The removed email can be invited again.

### 15. Ownership transfer

GET: `typedConfirmPage` with `Make <name> the owner? You become an admin. Both of you are signed
out and sign in again.` POST: the target is an Admin (`403` with the text `Only an admin can
become the owner.` for a Member or Viewer); the target has an authenticator (`409` `<name> has not
set up two-factor sign-in yet.`); `revision` and `confirm_name` as for removal. In one
transaction: set the actor's role to `admin`, then the target's to `owner` (this order keeps
`users_one_owner`), delete every session of both people (the current one included), write
`owner.transfer`. The answer is `303` to `/sign-in?transfer=done` with the session cookie deleted;
the sign-in page shows `Ownership is transferred. Sign in again.` Two concurrent transfers end
with exactly one Owner: the second commit re-reads an actor that is no longer Owner and answers
`403`.

### 16. Own password

`GET /account/password`: plain document (as `src/account-pages.ts`) with `password` (current),
`new_password`, `new_password_confirm`. `POST` after the session CSRF:

1. `passwordText(new_password, new_password_confirm)` (`422` with its text).
2. `recheckPassword` (`src/account-routes.ts:134-172`): current-password format (`422`), the
   sign-in throttle (`429`), verification against `current.user.passwordHash` = H0 (`401` `Wrong
   password.`; `password-confirm` metrics kind).
3. The form token (`acceptSessionForm`, `409`).
4. Hash the new password.
5. One `BEGIN IMMEDIATE` compare-and-set: continue only when the request's session row still
   exists and the user's `password_hash` still equals H0. Then set the new hash, delete every
   other session of the user (`deleteOtherSessions` semantics, `src/account-store.ts:239-240`) and
   write `user.password-change`. Answer `303` to `/account/password?changed=1`, which shows `Your
   password is changed. Other sessions are signed out.`
6. When the compare fails: `409` `Your password or session changed while this was saved. Nothing
   was changed.`; no row changes and no event is written.

A pending reset link of the user stays valid after an own password change; its later use sets the
password again.

### 17. Credential changes during password work

`deps.hashPassword` and `deps.verifier` (`src/http-context.ts:46-48`) are asynchronous
(`Bun.password`, `src/main.ts:61-67`); other requests run while one waits. Today `postSignIn`
reads the user, awaits verification and then calls `startSession` with no re-check
(`src/server.ts:693-726`). A reset that commits during that wait would leave a session made with
the old password. So:

- **Sign-in** (changed by #564). The password step creates its session through a new store
  function in one `BEGIN IMMEDIATE` transaction: delete the old cookie's row and expired rows,
  re-read the user by id, and insert the session only when the row exists and its `password_hash`
  equals the hash that was verified. Otherwise no session: `401` with `Wrong email or password.`,
  a counted throttle failure, `warn` `sign-in failed` with reason `credentials`, and no session
  `set-cookie`.
- **The second-factor step** needs no change: a reset, removal, role change or 2FA reset deletes
  the user's sessions, and `completeTotpSignIn`, `completeRecoverySignIn` and
  `confirmAuthenticator` already abort when their session or pending row is gone
  (`src/factor-store.ts:144-164`).
- **Own password change**: the compare-and-set of section 16.
- **Reset and recovery POST**: the commit re-checks validity; a reset deletes every other unused
  link of the user, so two links of one user never both commit.
- **Invite accept**: the commit re-checks that the invite is live and the email is free.

The same rule covers the #563 account writes that run after an `await`. Today they write without a
re-check: `postNewCodes` awaits `recheckPassword` and then calls `replaceRecoveryCodes`
(`src/account-routes.ts:322-338`); `createPending` awaits `recheckPassword` in stage `full` and
then calls `savePendingAuthenticator` (`:174-204`, the call at `:188` and the write at `:203`); `postSignOutAll` awaits the body read
and then calls `deleteOtherSessions` (`:359-372`). A reset, a 2FA reset, a role change, a removal or an own
password change from another session can commit during that wait and delete the request's
session. Then a paused new-codes request would still write and show fresh codes. So each of these
writes gets a guarded store function. All use one guard type, `CredentialGuard = { sessionId,
userId, passwordHash?: string }`:

- **The guard.** In one `BEGIN IMMEDIATE` transaction, the write runs only when a `sessions` row
  with the digest of `sessionId` and `user_id = userId` still exists. When `passwordHash` is set,
  the user's stored `password_hash` must also still equal it. That value is H0 =
  `current.user.passwordHash`, the hash that `recheckPassword` verified. Otherwise the function
  writes nothing and returns `{ ok: false }`.
- **New recovery codes.** `factorStore.replaceRecoveryCodesFor(guard, digests)` with
  `passwordHash` = H0. When the guard fails, `POST /account/recovery-codes` answers `409` with the
  new-codes page and the error `Your password or session changed while this was saved. Nothing
  was changed.` The body holds no recovery code and no `id="recovery-codes"` list
  (`src/account-pages.ts:238`). The `recovery codes created` log line is not written, and the
  stored codes stay as they were.
- **Authenticator setup.** `factorStore.savePendingAuthenticatorFor(guard, secret, now)`. In
  stage `full`, `passwordHash` = H0. In stage `enrol` there is no password step, so the guard has
  no `passwordHash` and checks only the session row. When the guard fails, `POST
  /account/authenticator` (`action=start`) answers `409` with the start page and the same error,
  and no `pending_authenticators` row is written. Today the foreign key makes this a `500`.
- **Sign out all.** `store.deleteOtherSessionsFor(guard)` without `passwordHash`. When the guard
  fails, `POST /account/sessions/sign-out-all` answers `409` with the confirmation page and the
  same error. No session row is deleted, so a session started after the reset (for example the
  person's own new sign-in) stays.
- The guarded functions run the guard before the write in the same transaction. A new function
  is added because the current ones keep their behavior and their tests
  (`src/factor-store.test.ts:65-308`, `src/account-store.test.ts:217-234`). Their routes call only
  the guarded ones. `confirmAuthenticator`, `completeTotpSignIn` and `completeRecoverySignIn`
  already abort when their pending or session row is gone, so they need no guard.

Every new hash has a fresh random salt (argon2id through `Bun.password.hash`), so a reset to the
same text gives a different hash and H0 never matches by accident. The check never compares
password texts.

### 18. Owner recovery command

`bun --no-env-file src/owner-reset.ts`. In the image (`Dockerfile` copies `src`, runs as `bun`):
`docker exec <container> bun --no-env-file src/owner-reset.ts`; in a deploy stack:
`docker compose -f <setup>/compose.yaml exec console bun --no-env-file src/owner-reset.ts`.

- It reads only `PULSE_CONSOLE_DB` (default `./console.db`) and `PULSE_CONSOLE_PUBLIC_URL` with
  the console's rules and error texts. It does not need `PULSE_API_URL`, the admin token or the
  secret key.
- It opens the database with `openDatabase` (same file mode and migrations).
- Not set up or no Owner row: exit `2`, stderr `pulse-console: no owner account: finish setup
  first`. A setting or database error exits `2` with the existing `pulse-console: <message>` text.
- Otherwise, in one transaction: delete unused `owner-recovery` links, insert a new one
  (`expires_at = created_at + 900000`, `issued_by` null), write `owner.recovery-link` with actor
  `container`. Then print exactly one stdout line and exit `0`:
  `pulse-console owner reset link: <link> (valid 15 minutes, one use)`.
- `<link>` is `<public origin>/reset/<token>`. Without a public URL it is `/reset/<token>` and the
  line ends `(valid 15 minutes, one use; open it on the console address)`.
- Using it follows section 11 and also removes the Owner's second factors and ends every Owner
  session. The next sign-in leads into enrolment, because the Owner must have TOTP. The event is
  `owner.recover`.
- The command is the only Owner reset. The README documents it; no page links to it.

### 19. Link origin

Links in the web UI start with the origin of `PULSE_CONSOLE_PUBLIC_URL` when set
(`deps.publicOrigin`). In loopback mode without it they start with `http://<Host>` of the request
that made them; that `Host` already passed the loopback check (`421` otherwise). `Forwarded` and
`X-Forwarded-*` are never read. The README says that in loopback mode the invitee must open the
console on a loopback address (the same machine or an SSH tunnel), or the operator sets
`PULSE_CONSOLE_PUBLIC_URL`.

### 20. API tokens and console roles

- Roles are console rules. The console calls pulse-api with its one token from
  `PULSE_CONSOLE_ADMIN_TOKEN_FILE` or `PULSE_CONSOLE_ADMIN_TOKEN`; pulse-api cannot tell console
  users apart.
- An Admin may create, rotate and revoke api tokens (row 11, built in #566). pulse-api's grant
  rule (`canGrant`, api `src/token-scopes.ts:38`; documented in api `docs/rest-api.md:366`) lets
  the console's token create any token whose scopes it holds, including `admin` ("Full access"
  stays A+). A person who copies such a token can use those scopes directly against the api,
  outside console roles. #566 logs token actions with the console person through
  `appendPeopleEvent`.
- A removed Admin's api tokens stay valid, because they belong to no person. The removal page
  says so (section 14).
- `docs/team.md` states these three points.

### 21. Pages, metrics and logs

- Every page is server-rendered and works without JavaScript; every value goes through kit
  `escapeHtml`. Team pages are shell pages (one `/console.js`, no new script). Link pages and
  `/account/password` are plain documents without script. The CSP is unchanged.
- Every response keeps `cache-control: no-store` and `referrer-policy: same-origin`.
- The invite and reset forms, the invalid-link page, the Team page, the removal confirmation and
  `/account/password` fit 390 px without horizontal scroll.
- `pulse_console_http_requests_total` gets the `path` labels `/team`, `/team/invites`,
  `/team/invites/revoke`, `/team/role`, `/team/remove`, `/team/reset-link`, `/team/reset-2fa`,
  `/team/transfer`, `/team/require-2fa`, `/account/password`, `/invite/:token` and
  `/reset/:token`. A token never appears in a label.
- No new auth kind: the current-password check of `/account/password` counts as
  `password-confirm`.
- One log line per committed change: `info` `team change` with `action`, `actorId` and `targetId`
  (numbers or null). A failed People-log insert logs `error` `team change could not be saved`
  with the error name only.
- `info` `form token refused` on a link route logs `path` `/invite/:token` or `/reset/:token`,
  never the raw path (today it logs `ctx.path`, `src/server.ts:273-275`). No log line holds an
  email, name, token, link, password or a path with a token.

## Risks

- **No secret key.** Without `PULSE_CONSOLE_SECRET_KEY_FILE`, an invited or promoted Admin cannot
  enrol (`503`), as the Owner cannot today. deploy provisions the key in every stack.
- **Links in loopback mode** work only on a loopback address. Documented; a public URL fixes it.
- **Bearer links.** Anyone holding a link can use it until it expires or is used. Mitigations:
  one use, short validity, revocation, digest at rest, no-store, no logging.
- **Promotion and sessions.** Ending sessions on every role change and the live 2FA predicate
  both stop an old password-only session from acting as Admin.
- **Removed Admin's api tokens** stay valid by design; the dialog and docs say it.
- **Policy-only rows.** Rows 2 to 13 have no routes yet. Their policy tests do not prove a route;
  each later item takes its `requiredRole` from `minimumRole` and adds HTTP tests.
- **Downgrade.** An older console image stops with "schema version 3 is newer"; a downgrade needs
  a backup restore (README).
- **Form-token budget.** Decision 9 keeps the Team page at two forms plus sign-out.

## Acceptance evidence

Every expected value below is a literal in the test or in this spec. No test reads its expected
value from the module under test.

1. **Matrix, policy level.** `src/permissions.test.ts` holds the 27 x 4 matrix of this spec as a
   literal table (copied from section 1, not imported) and asserts all 108 cells, plus
   `team.view` (N, N, Y, Y) and `team.require-2fa` (N, N, N, Y). Each mixed row has allowed and
   denied cases. All-Y rows (1, 27) record that a denied role case is inapplicable; all-N rows
   (6, 22, 26) record that an allowed case is inapplicable. It also asserts the literal
   navigation minimum roles: Overview, Checks, Incidents, Maintenance `viewer`; Tokens, Probes,
   Team, Activity, System `admin`.
2. **Matrix, HTTP level** (`src/server.roles.test.ts`). For each row with a route, with a full
   session and valid CSRF and form tokens, one allowed request and one denied request of the
   highest denied role (literal statuses):
   - row 1: `GET /` `200` for all four roles; without a session `303` to `/sign-in?next=%2F`.
   - row 14: Admin invites a Member `200`; Member `403`.
   - row 15: Owner invites an Admin `200`; Admin `403`, body `needs the Owner role`.
   - row 16: Admin removes a Viewer `303`; Member `403`.
   - row 17: Owner removes an Admin `303`; Admin `403`.
   - row 18: Owner changes Member to Viewer `303`; Admin `403`.
   - row 19: Owner promotes a Member to Admin `303`; Admin `403`.
   - row 20: Admin reset link for a Member `200`; Member `403`.
   - row 21: Owner reset link for an Admin `200`; Admin `403`.
   - row 22: Owner and Admin reset link for the Owner `403` with `No one can change the owner
     account in the console.`
   - row 23: Admin 2FA reset of a Viewer `303`; Member `403`.
   - row 24: Owner 2FA reset of an Admin `303`; Admin `403`.
   - row 25: Owner transfers to an enrolled Admin `303` with `location: /sign-in?transfer=done`;
     Admin `403`.
   - row 27: each role changes its own password `303`; without a session `303` to
     `/sign-in?next=%2Faccount%2Fpassword` and the hash is unchanged.
   - `team.view`: Admin `GET /team` `200`; Member `403`.
   - `team.require-2fa`: Owner `303`; Admin `403`.
   Each denied mutation leaves `users`, `invites`, `reset_links`, `sessions`, `authenticators`
   and `people_events` unchanged (row counts and contents compared before and after) and sends 0
   requests to the fake api.
3. **Route table.** A test lists every production protected and account route with the literal
   required role or stage of section 8 and fails on any other value or a missing route.
4. **Invites** (`src/server.invite.test.ts`). With an injected clock: acceptance at `created_at +
   604799999` works; at `created_at + 604800000` GET and POST answer the `404` invalid-link page.
   A revoked, a used and a 42-character token answer `404`. A GET and then a `422` POST
   (11-character password) leave the invite live; a later valid POST makes the account. Two
   concurrent valid POSTs (each with its own GET's form token) give one `303` and one `404`, and
   `users` gains 1 row. After a restart (new server, same file) the link still works. A scan of
   the database file bytes for the plain token finds 0 matches; `token_digest` equals the SHA-256
   hex of the token, computed in the test with `node:crypto`.
4a. **Anonymous redemption, CSRF and form token.** Unless named, the request carries no session
   cookie.
   - A GET of a live invite or valid reset link answers `200` with `set-cookie` for
     `pulse_console_csrf` and a `form_token` field. A POST with that cookie, the same `csrf` value
     and the form token answers `303`.
   - For both routes these POSTs answer `403` `Request refused` and change no row: no CSRF
     cookie; a `csrf` field that differs from the cookie; an `Origin` of another site. The link
     stays valid and a later correct POST works.
   - Replay precedence (section 3). The same successful POST sent again (same cookie, `csrf`
     and form token) answers `404` with `Link not valid`, for the invite and the reset route; no
     `form token refused` log line is written. A second POST with an already used form token
     while the link is still valid answers `409` `Already submitted`: (a) an invite POST that
     got `409` `An account with this email exists.` (an account with that email was made after
     the invite), sent again with the same form token, answers `409` `Already submitted` and the
     invite stays live; (b) a reset POST held in its password hash by the gated fake of item 5a,
     and a second POST with the same form token: the second answers `409` `Already submitted`,
     then the first is released and answers `303`. Both `Already submitted` bodies contain
     `href="/sign-in"` and not the token.
   - A POST with a valid session cookie of another user, that session's CSRF token in `csrf` and
     no anonymous cookie answers `403`.
   - An invalid-link GET answers `404` without `set-cookie`.
   - The log of a refused form token on a link route holds `/invite/:token`, not the token.
4b. **Invite acceptance with an existing session.** An Admin with session S creates a Member
   invite. In the same browser (S's cookie and the anonymous cookie both sent) GET answers `200`
   and POST answers `303`. Then `sessions` has 0 rows with S's digest and exactly 1 row of the new
   Member, whose digest is that of the `session` value in the answer's `set-cookie`. The same POST
   with an unknown session cookie also answers `303`. A reset POST for user U carrying a live
   session cookie of user V answers `303`; V's row remains and U has 0 session rows.
5. **Reset links** (`src/server.reset.test.ts`). A link works at `created_at + 86399999` and fails
   at `+ 86400000`. After one use a second POST answers `404`. After use: the old password fails
   sign-in, the new one gives `303` to `/sign-in/factor` for a user with an authenticator, both
   earlier session cookies of the target get `303` to `/sign-in?next=...`, and the target's
   `authenticators` row still exists. A second issued link makes the first fail. A link for a
   Member promoted to Admin before use fails. A link of an Admin demoted to Member before use
   fails.
5a. **Credential races, deterministic** (`src/server.races.test.ts`, `src/server.sign-in.test.ts`).
   Tests inject a hand-written gated `hashPassword` and verifier: the n-th fake hash of text p is
   the literal `fake$<n>$<p>`, the verifier accepts p for a hash ending in `$<p>`, and each call
   can be held and released by the test, without timers.
   - Sign-in vs reset: a sign-in with P0 is held in verification; a reset sets P1 (`303`); on
     release the sign-in answers `401` `Wrong email or password.`, has no session `set-cookie`,
     and `sessions` has 0 rows of the user. Sign-in with P1 then answers `303`.
   - Sign-in vs removal: held sign-in, the user is removed (`303`); on release `401`, not `500`.
   - Own change vs reset: `POST /account/password` (P0 to P2) held while hashing P2; a reset sets
     P1; on release `409` with the text of section 16; `password_hash` equals the reset's fake
     hash; `people_events` has 1 new `user.password-reset` and 0 `user.password-change` rows. The
     same with the change held at the current-password verification gives the same result.
   - Two own changes from one session (P0 to P2, P0 to P3), both held while hashing, each with
     its own form token: released in turn, the first `303`, the second `409`.
   - Own change vs role change: the change is held, the Owner changes the user's role; on release
     `409`, hash unchanged.
   - Reset first, then own change: a reset held while hashing P1; the own change to P2 commits
     (`303`); the reset is released and answers `303`; the stored hash is the reset's.
   - New codes vs reset link: an Admin with an authenticator and 10 recovery codes (written by the test through the
     unguarded `replaceRecoveryCodes`) posts `POST
     /account/recovery-codes`, held in the current-password verification. The Owner makes a reset
     link for that Admin and the link is used (`303`). On release the request answers `409` with
     `Your password or session changed while this was saved. Nothing was changed.`, its body has
     no `id="recovery-codes"`, the Admin's `recovery_codes` digests equal the 10 from before, and
     no `recovery codes created` log line was written.
   - New codes vs 2FA reset: the same held request, and the Owner resets the Admin's 2FA (`303`).
     On release it answers `409` and the Admin has 0 `recovery_codes` and 0 `authenticators`
     rows.
   - New codes vs own password change from another session: the held request's session S1; the
     same Admin changes the password from session S2 (`303`, which deletes S1). On release `409`
     and the codes are unchanged.
   - Authenticator setup vs reset: a Member without an authenticator (switch off), held at the
     password step of `POST /account/authenticator` `action=start`. An Admin's reset link for the
     Member is used. On release `409` (not `500`) and 0 `pending_authenticators` rows of the
     Member.
   - Sign out all vs reset: the test opens a raw connection to the server, sends the headers of
     `POST /account/sessions/sign-out-all` for a Member's session S1 and half of the body. The
     Member's reset link is used and the Member signs in again (session S2). Then the test sends
     the rest of the body. The answer is `409` and the S2 row still exists. No timer is used: the
     server cannot go on before the body is complete.
6. **2FA requirement.** Each case follows the sequence of section 5 (literal statuses and
   locations):
   - Invited Admin: the accept POST answers `303` to `/account/authenticator`; with that cookie
     `GET /team` answers `303` to `/account/authenticator`.
   - Promoted Admin (a Member without an authenticator, signed in, promoted by the Owner): the
     old cookie on `GET /team` answers `303` to `/sign-in?next=%2Fteam`; the password sign-in
     answers `303` to `/account/authenticator`; with the new cookie `GET /team` answers `303` to
     `/account/authenticator`.
   - Recovered Owner: the recovery POST answers `303` to `/sign-in?reset=done`; the old Owner
     cookie on `GET /team` answers `303` to `/sign-in?next=%2Fteam`; the password sign-in with
     the new password answers `303` to `/account/authenticator`; with the new cookie `GET /team`
     answers `303` to `/account/authenticator`.
   - In all three, the enrolment confirmation (`POST /account/authenticator`, `200` recovery
     codes page) sets a new `full` session cookie (`commitConfirmation`,
     `src/account-routes.ts:264-294`); with that cookie `GET /team` answers `200`.
   - With the switch on, a Viewer with a live `full` session and no authenticator gets `303` to
     `/account/authenticator` on `GET /` with the same cookie; with it off, `200`. After a 2FA reset of a
   Member who had an authenticator: the Member has 0 `authenticators`, 0 `recovery_codes` and 0
   `sessions` rows, the earlier cookie gets `303` to `/sign-in?next=%2F`, and with the switch off
   the password sign-in answers `303` to `/` with no factor step. The same reset of an Admin
   (by the Owner) makes the Admin's next password sign-in answer `303` to
   `/account/authenticator`.
7. **Transfer and removal** (`src/server.team.test.ts`). After a transfer `users` has exactly 1
   `owner` row and the former Owner has `admin`; `sessions` holds 0 rows of either person; the
   requesting cookie gets `303` to `/sign-in?next=%2Fteam` on `GET /team`. After signing in again
   with password and TOTP, the former Owner gets `200` on `GET /team` and `403` on `POST
   /team/require-2fa`. A wrong typed name, a Member target and an Admin without an authenticator
   answer `422`, `403` and `409` and change nothing. Removal with the right name ends the target's
   sessions (old cookie `303` to sign-in), deletes its reset links, and the `user.remove` row
   keeps email and name.
8. **People log** (`src/people-log.test.ts`, server suites). Each successful change of items 2 to
   7 adds exactly 1 row with the action name of section 7. Rows survive a restart. `UPDATE` and
   `DELETE` on `people_events` fail with `people_events is append-only`. With a test trigger that
   aborts inserts into `people_events`, an invite, a role change and a removal answer `500` and
   leave every other table unchanged. Sentinel scans: no token, link, password or TOTP secret in
   `people_events`, log lines, `/metrics` or any response other than the one link page and the
   link's own form pages (GET `200`, `422`, expired form).
9. **Owner recovery** (`src/owner-reset.test.ts`). It spawns `bun --no-env-file
   src/owner-reset.ts` on a temp database. Not set up: exit `2` with the literal text. Set up:
   exit `0` and one line matching `^pulse-console owner reset link: \S*/reset/[A-Za-z0-9_-]{43}
   \(valid 15 minutes, one use`. The link works at `+ 899999`, fails at `+ 900000`, works once,
   removes the Owner's `authenticators` and `recovery_codes` rows, and the Team page offers no
   Owner reset.
10. **Migration** (`src/database.test.ts`). A schema-2 file built in the test with the SQL of
    migrations 1 and 2, an Owner, a full session and an authenticator opens with `user_version`
    `3`; the Owner signs in with the old password, `role` reads `owner`, the session cookie still
    works. Inserting role `superuser` fails with `invalid role`.
11. **Pages.** HTTP tests check that the CSP header is unchanged, that link pages and
    `/account/password` hold no `<script>`, and that every new POST form holds `csrf` directly
    followed by `form_token`. The browser suite (`e2e/run.ts`, CI job `browser`) loads the invite
    form, the reset form, the invalid-link page, the Team page, the removal confirmation and
    `/account/password` at 390 x 844 and finds no horizontal scroll and no axe violation.
12. **Production wiring** (`src/main.startup.test.ts`). The test spawns `bun src/main.ts` on a
    temp database: one start creates and migrates the file, the test marks setup complete (the
    existing `completeSetup` helper, `src/main.startup.test.ts:64-68`), then a second start
    listens. On the port of its `pulse-console listening` line, `GET /invite/` plus 43 `A`
    answers `404` with a body that contains `Link not valid`, and `GET /reset/` plus 43 `A`
    answers the same. Expected values are the literals of section 10; the process exits `0` on
    `SIGTERM`. Opening that database after the stop gives `PRAGMA user_version` `3`.
13. **CI and run.** `bun run check` passes. The docker job runs the recovery command in the
    container before setup and expects exit `2` and `no owner account`. The CI job `deploy-dev`
    (deploy `main`'s two-factor flow) stays green. The implementer runs `bun start` once, sets up,
    invites a Member, accepts in a second browser profile, makes and uses a reset link, and
    reports commands and results in the PR.

## Performance impact

None expected for any key of `bench/budgets.json` in the api repository (sections `api`,
`config`, `contract`, `kit`, `notify`, `probe`, `status`; api clone `e8832af`). The budgets have no
console section, and this change touches no code of those repositories. Startup CPU, load CPU,
idle and peak RSS, test CPU, build CPU, wall-clock startup, p95 latency, requests per second and
image size of those services stay unchanged.

The console's own costs, for the record (not gated): one argon2id hash per invite acceptance,
reset and password change, as at setup; one indexed user read per request, as today; the console
image grows by a few source files. Console test time grows with the new KDF runs; the implementer
reports the `bun run test` time before and after in the PR.

## Security impact

Security impact: yes. The change adds authorization to every route, anonymous credential flows
(invite and reset links), password and second-factor resets, a container command that issues an
Owner credential, database writes and a CI step.

Checklist items that apply:

- **Secrets in errors, logs and responses.** Invite and reset tokens appear only in the one link
  page of their creation, the one stdout line of the recovery command, the request path of their
  use and the `action` of the link's own form (GET `200` and the `422` and expired-form answers).
  The `Already submitted` page of a link route links to `/sign-in`. They are never logged (the form-token refusal log uses the path label), never a
  metrics label, never in the People log, never in a `Location` header. Passwords, TOTP seeds and
  codes appear nowhere. Tests scan logs, `/metrics`, `people_events`, the database file and
  responses for sentinels.
- **Auth order and status codes.** The dispatcher order of #718 is unchanged; target rules,
  revision and typed name follow in the handler; the commit re-checks. A missing session on a
  protected POST gives `303` without reading the body. The public link POSTs check CSRF against
  the anonymous cookie that their GET sets, never a session token, and use the `a:` form token.
  Invalid links give one `404` page for every case, without KDF work. Every role change and a
  transfer end all sessions of the changed people. The session cookie never decides a public link
  answer; it is only rotated after a committed invite acceptance.
- **Credential races.** Sign-in creates a session only if the verified hash is still stored at
  commit. An own password change commits only if its session still exists and the stored hash is
  still the verified one. New recovery codes, authenticator setup and sign out all write only if
  the request's session row (and, after a password step, the verified hash) still exists at
  commit; a stale new-codes request returns no codes. Gated fakes and a held body test all of
  them (acceptance 5a).
- **Body and size limits.** Forms keep the 8192-byte cap; passwords 12 to 128 code points; names
  1 to 100; emails 3 to 254; ids at most 16 digits; tokens exactly 43 characters.
- **Input validation.** Role values (never `owner` from a client), ids, emails, names, typed
  confirmations, `value` of the 2FA switch, the token shape on the raw path, `revision`.
- **Atomic, path-safe writes.** Every change and its People event commit in one `BEGIN IMMEDIATE`
  transaction with a re-check; single use of links is atomic. The recovery command takes its
  database path only from `PULSE_CONSOLE_DB`.
- **Dependency pins.** No new package; the contract and kit pins stay.

Not applicable: SSRF and redirects (no new outbound request), accessor execution (form fields are
read with `URLSearchParams`).

Hostile inputs for the security state: forged and replayed link tokens, encoded paths
(`/invite/%41…`), a stale session after demotion, cross-role target ids (an Admin posting an
Admin's or the Owner's id), a reused user id with an old `revision`, concurrent use of one link, a
repeated `role` field, an `Origin` from another site, a missing CSRF token, a replayed form token.

## Rollout order

One repository: console. pulse-api, pulse-contract, pulse-kit, pulse-config and pulse-deploy do
not change.

- The console pins stay: contract `176fb6ed14b2f14b730a9fd1757239f210f97a29` (`package.json:32`)
  and kit `536133f3e8b708179fa01feeb02395a0e1961e07` (`package.json:33`). The console talks to the
  api only as before, so every api version that works with console `main` keeps working.
- deploy `full` and `demo` run the published console image and are unaffected until a console
  release and a pin bump. deploy `dev` builds console `main`; migration 3 runs on its volume and
  `/readyz` stays `200`. deploy's `e2e/console-setup.sh` two-factor flow uses only the Owner:
  Finish setup still answers `303` to `/account/authenticator` (`e2e/console-setup.sh:145-151`),
  the password step still `303` to `/sign-in/factor` (`:223-224`), and sign out all still `303`
  to `/account/sessions?signed-out=others` (`:313-315`). So the console CI job `deploy-dev`
  (`.github/workflows/ci.yml`, job `deploy-dev`) and deploy's daily `dev` job stay green without a
  deploy change.
- deploy's README reset text (`docker volume rm …`, `deploy/README.md:93`) stays true. The
  recovery command is documented in the console README; a deploy docs line can follow after the
  next console pin bump.
- An existing console database migrates at the first start of the new image; its Owner, password,
  sessions and second factors stay. A rollback to an older image stops with "schema version 3 is
  newer", so a downgrade needs a backup restore (README).

## Counterexamples

- **Roles.**
  - `POST /team/invites` with `role=owner` from the Owner: `422`, no row.
  - `role=Admin` (capital A): `422`.
  - Admin posts `role=admin`: `403` (a wrong implementation that compares role order with the
    target role lets an Admin create an Admin).
  - Admin posts `/team/role?user=<member>` with `role=viewer`: `403` (row 18 is Owner only;
    the dispatcher's required role for `/team/role` is Owner).
  - Admin posts `/team/remove?user=<own id>`: `403` (Admin target needs the Owner).
  - Owner posts `/team/remove?user=<own id>`: `403` with the Owner-target text.
  - Owner posts `/team/role?user=<owner id>` with `role=admin`: `403` (Owner target).
  - A body with `role=member&role=admin`: `400` repeated field.
- **Ids.** `user=01`, `user=1e3`, `user=-1`, `user=` and `user=12345678901234567` (17 digits):
  `404`. The id of a removed user: `404`.
- **Stale state.**
  - The page showed a Member; another Owner tab promoted them. `POST /team/role` with the old
    `revision` and `role=viewer`: `409`, role stays `admin`.
  - A user is removed and a new invitee gets the same id. A removal form opened before, with the
    old `revision`: `409`, the new user stays.
  - An Admin is demoted to Member, then posts an invite from a page opened before: `303` to
    `/sign-in?next=…`, because the demotion deleted that session (the gate runs before the body).
    After a new sign-in as Member the same invite answers `403`.
  - An Admin's invite passes the role step and the Owner demotes that Admin before the commit:
    the commit re-reads the actor, answers `403`, and writes no invite (a wrong implementation
    trusts the role read at the start of the request).
  - The Owner opens the transfer page twice, transfers to Admin A, then submits the old form for
    Admin B: `303` to sign-in (sessions ended). After a new sign-in as Admin: `403`.
- **Transfer sessions.** A wrong implementation keeps the former Owner's current session. After a
  transfer that cookie must get `303` to `/sign-in?next=%2Fteam` on `GET /team`, not `200`.
- **Anonymous link CSRF.** A wrong implementation checks the link POSTs against a session token,
  so redemption without a session always fails. An invite or reset POST with no session cookie,
  a matching anonymous CSRF cookie and field and a valid form token must answer `303`.
- **Form token on link routes.** A wrong implementation uses the form token before the field
  format check; then a `422` POST followed by a corrected POST with the same token must still
  work: the `422` answer carries a fresh token and the corrected POST with it answers `303`.
- **Link replay.** A wrong implementation checks the form token before the link lookup: then a
  successful invite or reset POST sent again answers `409` `Already submitted`. It must answer the
  `404` invalid-link page, because the link is used. A wrong implementation that puts the link
  path into the `Already submitted` page leaks the token into a second response; the page must
  link to `/sign-in`.
- **Invite time.** `created_at = 0`: valid at `604799999`, invalid at `604800000` (a `<=`
  comparison is wrong). Revoked at `t`, GET at `t + 1`: `404`.
- **Invite concurrency.** Two valid POSTs at once: one account; the second answers `404`, not
  `500` (a wrong implementation relies on the `email UNIQUE` error).
- **Invite email.** A pending invite for `ann@example.com`; a new invite for `Ann@Example.com `:
  `409`. An account `ann@example.com` exists: `409`.
- **Invite creator.** An Admin creates a Viewer invite and is removed: the link answers `404`. The
  Owner creates an Admin invite and transfers ownership: the link answers `404` (the creator is
  now an Admin).
- **Invite fields.** `email=evil@example.com&role=admin` added to the accept form: the account gets
  the bound email and role.
- **Reset time and use.** `created_at = 0`: works at `86399999`, `404` at `86400000`. A `422` at
  t = 1 then a valid POST: works. A second valid POST: `404`.
- **Reset authority.** Link for Member M by Admin A; M promoted to Admin: `404`. Link by Admin A
  for Viewer V; A demoted to Member: `404`. The target removed: `404`.
- **Reset effects.** After a reset the target has TOTP: sign-in with the new password answers
  `303` to `/sign-in/factor`, not to `/` (a wrong implementation starts a session or clears the
  factor).
- **Owner recovery.** Works at `899999`, `404` at `900000`. A second command run makes the first
  link fail. After use the `authenticators` row is gone and the next sign-in answers `303` to
  `/account/authenticator`.
- **Promotion.** A Member signed in without TOTP is promoted: the old cookie gets `303` to
  `/sign-in?next=%2Fteam`, not `/account/authenticator` (a wrong implementation keeps the session
  and relies on the gate alone); a new sign-in gets `303` to `/account/authenticator`, and
  `GET /team` never answers `200` before enrolment.
- **Wiring.** A wrong implementation adds `teamStore` to the test servers but not to `main.ts`;
  every server test passes and the real console answers `500` on the first link or team request.
  The spawned `bun src/main.ts` of the startup test must answer `404` `Link not valid` for an
  unknown invite token (acceptance 12).
- **2FA switch.** Switch on, a Viewer with a live full session and no authenticator: `GET /` `303`
  to `/account/authenticator` (a wrong implementation reads the switch only at sign-in).
- **Transfer.** Target Admin without an authenticator: `409`. Target Member: `403`. `confirm_name`
  `bob` for `Bob`: `422`. ` Bob ` for `Bob`: accepted (trimmed). Afterwards exactly one `owner`.
- **Removal.** `confirm_name` empty: `422` `Type the name to confirm.`, the user stays.
- **People log.** A `403`, a `409` and a `422`: 0 new rows. With the insert failing: `500`, and
  the role is unchanged (a wrong implementation writes the event after the commit).
- **Paths.** `/invite/<43 chars>/`, `/invite/<42 chars>`, `/invite/<44 chars>`,
  `/invite/%2e%2e`, `//invite/<token>`: `404 not found`, path label `other`.
- **Own password.** Wrong current password 5 times in 15 minutes: the 6th attempt `429` even with
  the right password. A new password of 129 code points: `422`.
- **Credential races.**
  - A wrong implementation creates the session right after verification resolves: a sign-in with
    the old password still verifying when a reset commits must answer `401` with 0 sessions.
  - A wrong implementation writes the own change with a plain `UPDATE`: a change held while a
    reset commits must answer `409`, and the reset's password remains.
  - A wrong implementation compares only the hash: a change whose session was deleted by a role
    change during the hash must answer `409`.
  - A wrong implementation guards only the password routes of #564: a new-codes request held in
    its password check while a 2FA reset commits writes 10 fresh codes for a user without an
    authenticator and shows them. It must answer `409` with no codes and 0 `recovery_codes`
    rows.
  - A wrong implementation checks the guard before the transaction: the check passes, the reset
    commits, and the write follows. The guard and the write must be in one `BEGIN IMMEDIATE`
    transaction.
- **Form-token budget.** A team of 60 users: the Team page renders 2 POST forms plus sign-out, so
  every form on it still submits (a wrong implementation with one form per action and row evicts
  its own tokens past 100 and answers `409` `This form has expired`).

There are no statistics in this change.

## Contract fields

No contract or wire name changes. The console never sends any of the new names to another
service. The new names are console-local: routes, SQLite tables, columns and triggers, People
action names, metrics label values, sign-in notices and module names. Searches of the contract
clone (`176fb6ed14b2f14b730a9fd1757239f210f97a29`, the console pin) and the config clone
(`bc870498cc8e2539a132ce2aac35a09db1deabd8`), run in `.repos`:

| Name | `grep -rn '<name>' contract/src` | `grep -rln '<name>' config` (source, json, yml) |
| --- | --- | --- |
| `invite` (`invites`, `invite.create`, `/invite/`) | 0 | 0 |
| `people_event` | 0 | 0 |
| `reset_link`, `reset-link` | 0 | 0 |
| `/team` | 0 | 0 |
| `require_2fa`, `require-2fa` | 0 | 0 |
| `owner-reset`, `owner_reset`, `owner.recover` | 0 | 0 |
| `password-change`, `2fa-reset`, `role-change` | 0 | 0 |
| `transfer=done`, `reset=done`, `changed=1` | 0 | 0 |
| `/account/password` | 0 | 0 |
| `team-store`, `account-links`, `team-routes`, `team-pages`, `link-routes`, `people-log`, `team-console` | 0 | 0 |
| `teamStore`, `createTeamStore` (server dependency and factory function) | 0 | 0 |
| `CredentialGuard`, `replaceRecoveryCodesFor`, `savePendingAuthenticatorFor`, `deleteOtherSessionsFor` (store type and functions) | 0 | 0 (also 0 in console `src`) |
| `permissions` | 0 | 17 matches, all GitHub workflow `permissions:` keys and their tests; no code name |

The People action names do not equal any api audit action (contract `src/audit.ts:6-23`:
`check.*`, `component.*`, `maintenance.*`, `manual-incident.*`, `token.*`). Later items reuse the
`token.*` names for console token actions on purpose. `revision` reuses the field name of the #718
confirmations (`src/confirm.ts`).

## Repository: console

Shared findings: none. `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/564`
answered HTTP 404 when this spec was written. This section asks no question that another
repository section also asks.

Files:

Every backticked item in this list is a file path.

- `src/database.ts` (migration 3, schema version 3)
- `src/database.test.ts` (schema version 3 at `:87` and `:227`; the new tables in the list at
  `:97-104` and their columns in the list after `:111`; the newer-version case at `:204-207`
  becomes `user_version = 4` and `schema version 4 is newer than this console (3)`)
- `src/server.upgrade.test.ts` (`:82` expects `user_version` `3` instead of `2`; the rest of the
  upgrade test stays)
- `src/main.startup.test.ts` (the newer-version case at `:191` and `:196` becomes `user_version =
  4` and `schema version 4 is newer than this console (3)`; acceptance 12)
- `src/account-store.ts` (stored role, instance switch, the verified-hash session start, role and
  password updates used by the team store, `deleteOtherSessionsFor`)
- `src/account-store.test.ts` (`:50` and `:85` expect the instance with
  `isTwoFactorRequiredForAll: false`; tests of the new functions)
- `src/factor-store.ts` (`replaceRecoveryCodesFor`, `savePendingAuthenticatorFor` and the
  `CredentialGuard` type)
- `src/factor-store.test.ts` (the guard: session row gone, hash changed, both present; the
  existing tests stay)
- `src/server.factor.test.ts` (`:34` calls the predicate with the organisation argument, `{
  isRequiredForAll: false }`; expected value unchanged)
- `src/roles.ts` (a role check for stored values)
- `src/roles.test.ts`
- `src/permissions.ts` (new: action ids, matrix, minimum roles, target rule)
- `src/permissions.test.ts` (new)
- `src/two-factor-policy.ts` (the widened predicate)
- `src/two-factor-policy.test.ts` (`:5` passes the organisation argument; new cases for Admin,
  Member, Viewer and the switch)
- `src/people-log.ts` (new: the append function and event type)
- `src/people-log.test.ts` (new)
- `src/account-links.ts` (new: link token creation, digest, raw-path matching, link building from
  the origin)
- `src/account-links.test.ts` (new)
- `src/team-store.ts` (new: invites, reset links, role change, removal, 2FA reset, transfer, the
  organisation switch and the own password compare-and-set, each in one transaction with its
  People event)
- `src/team-store.test.ts` (new)
- `src/team-routes.ts` (new: the protected team routes)
- `src/team-pages.ts` (new: Team page, role form, link pages, invite and reset forms)
- `src/link-routes.ts` (new: GET and POST of the invite and reset links)
- `src/states.ts` (the Owner-target form of the 403 state)
- `src/states.test.ts`
- `src/navigation.ts` (the `team` entry becomes available)
- `src/navigation.test.ts` (7 unavailable entries; Admin and Owner see Overview and Team)
- `src/server.ts` (route table and path labels for the new routes, the link-route matching, the
  team routes in `protectedRoutesOf`, the predicate call, the verified-hash sign-in, the sign-in
  notices, the form-token refusal path label)
- `src/http-context.ts` (the required `teamStore` dependency of `ConsoleServerDeps`, beside
  `factorStore` at `:39`)
- `src/main.ts` (creates the team store from the opened database, `createTeamStore(db)`, and
  passes it as `teamStore` to `createConsoleServer`, as `store` and `factorStore` are made and
  passed at `src/main.ts:34-38` and `:69-86`; `main.ts` still never sets `roleOf` or
  `testRoutes`)
- `src/server.test.ts` (server deps add `teamStore: createTeamStore(db)` beside `factorStore`
  at `:61`; no expected value changes)
- `src/server.setup.test.ts` (the same at `:114`)
- `src/server.form-token.test.ts` (the same at `:116`)
- `src/two-factor-harness.ts` (the same at `:111`)
- `test/signed-in-console.ts` (the same at `:91`)
- `src/account-routes.ts` (own password change; new codes, authenticator setup and sign out all
  call the guarded store functions and answer `409` when the guard fails)
- `src/account-pages.ts` (the password page, the `Change password` link)
- `src/metrics.ts` (path labels)
- `src/styles.ts` (layout of the new pages at 390 px)
- `src/owner-reset.ts` (new: the recovery command)
- `src/owner-reset.test.ts` (new)
- `src/server.team.test.ts` (new)
- `src/server.invite.test.ts` (new)
- `src/server.reset.test.ts` (new)
- `src/server.roles.test.ts` (new)
- `src/server.password.test.ts` (new)
- `src/server.races.test.ts` (new)
- `src/server.sign-in.test.ts` (sign-in versus a reset or removal during verification; its server
  deps add `teamStore` at `:123`)
- `src/server.security.test.ts` (sentinel scans for link tokens; its server deps add `teamStore`
  at `:95`)
- `test/team-console.ts` (new: a signed-in console with one user per role, each Admin and the
  Owner with a fixture authenticator, as `test/signed-in-console.ts:65-78` does for the Owner)
- `e2e/run.ts` (the 390 px and axe checks of the new pages)
- `README.md`
- `docs/configuration.md`
- `docs/team.md` (new)
- `docs/index.md`
- `AGENTS.md` (the end-to-end test file list and the new modules)
- `.github/workflows/ci.yml` (one docker step)

Behavior change: yes. It adds roles, team routes, account links, the recovery command, a
migration and the sign-in revalidation.

Existing tests change only where this spec changes their expected value or their inputs, and
nowhere else:

- the schema version (`2` to `3`) and the newer-version case (`3` to `4`, `(2)` to `(3)`):
  `src/database.test.ts:87`, `:204-207`, `:227`; `src/server.upgrade.test.ts:82`;
  `src/main.startup.test.ts:191`, `:196`;
- the table and column lists of migration 3: `src/database.test.ts:97-104` and the column list
  after `:111` (the new tables `invites`, `people_events`, `reset_links`, their columns and
  `instance.require_2fa_all`; no existing entry goes);
- the `Instance` value with `isTwoFactorRequiredForAll: false`: `src/account-store.test.ts:50`,
  `:85`;
- the predicate's new organisation argument: `src/two-factor-policy.test.ts:5`,
  `src/server.factor.test.ts:34` (expected values unchanged);
- the navigation entries and the role type (`src/navigation.test.ts`);
- server deps that gain `teamStore` (the files named above).

No other `expect` changes. A test that fails for another reason is a defect of the change.

### Order of work

The migration, `SCHEMA_VERSION = 3`, the `Instance` field and the predicate signature land in the
same step as every test update of the list above. So `bun run check` passes after the first step;
no later step leaves `src/server.upgrade.test.ts`, `src/main.startup.test.ts`,
`src/database.test.ts`, `src/account-store.test.ts`, `src/two-factor-policy.test.ts` or
`src/server.factor.test.ts` red. The startup test's acceptance 12 (link routes on the spawned
process) can come with the link routes; its newer-version case (`:191`, `:196`) moves with the
migration. The guarded store functions of section 17 and their `409` answers land with the
password work (sign-in revalidation, own password change), because their race tests share the
gated fakes of acceptance 5a.

### Prerequisite check

Before any edit, the implementer checks that console `main` still has schema version 2 and the
#563 and #718 pieces of "What this spec builds on". If `main` moved to a schema 3 from another
item, migration of this spec takes the next free number and the PR names it. If own password
change, the organisation switch or owner recovery already exist on `main`, the implementer reuses
them and requests a hold for that part instead of building a second one.

### Behavior

Implement "Required behavior" sections 1 to 21 in console:

- migration 3, the role-aware store and the instance switch;
- the policy module with the 27 rows, the two named actions and the target rules; every
  production protected route takes `requiredRole` from it;
- the Team page and its routes as protected routes with shared states and confirmations;
- the public link routes with their GET and POST order, anonymous CSRF and `a:` form tokens;
- the widened 2FA predicate and the organisation switch;
- invites, reset links, 2FA reset, role change, removal, transfer, own password change;
- the People log with atomic writes;
- the sign-in revalidation, the own password compare-and-set and the guarded writes of new
  recovery codes, authenticator setup and sign out all;
- the owner recovery command;
- metrics labels and log lines as specified.
- the team store created in `src/main.ts` and passed to the server, proven by acceptance 12.

Existing behavior stays: setup, sign-in (except the revalidation before its session write), the
second-factor flows (except the `409` of the guards when the session or hash changed during the
request), sign-out, sign out all (same exception), the throttles, cookies, CSP, the dispatcher order,
the form-token rules, `/healthz`, `/readyz`, `/metrics`, the start errors and their texts.

### Tool facts (verified)

- Bun 1.4.0: `package.json:9` (`engines.bun`) and `package.json:35` (`packageManager`). CI sets
  up Bun 1.4.0 in pulse-config `.github/workflows/check.yml:22-24` at the pinned ref
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`.github/workflows/ci.yml:18`); the browser job also
  sets up Bun 1.4.0 (`.github/workflows/ci.yml`, job `browser`). The pinned `check.yml` is
  identical to the config clone `bc87049`.
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:18`).
  `lint` is `biome check . && pulse-eslint . && pulse-workflows` (`package.json:15`); `typecheck`
  runs `typescript7` `tsc --noEmit` for the project and for `e2e` (`package.json:13`); `test` is
  `bun test` (`package.json:14`); `check:browser` is `bun e2e/run.ts` (`package.json:19`).
- CI runs lint, typecheck and test in that order (pinned `check.yml:27-38`).
- Coverage: `bunfig.toml:1-4`, at least 80 % lines; test files and `test/**` are not counted.
- Biome 2.6.3 (`package.json:23`); `biome.json` extends `@lorenzh/pulse-config/biome.json`, whose
  `files.includes` is `**` minus `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures`
  (pinned `biome.json:10-17`, identical to the clone). New files under `src/`, `test/` and `e2e/`
  are linted and formatted.
- The docker job builds the image and checks the container; the setup-code log step is the step
  "Check the log holds one setup code line" (`.github/workflows/ci.yml:95-102`).

### Checks

- Every item of "Acceptance evidence" as a `bun:test` test with injected `now`, temp databases
  (`mkdtemp`), the hand-written fake api, servers on `127.0.0.1` port `0`.
- The 27 x 4 literal matrix table in `src/permissions.test.ts`.
- One docker CI step after "Check the log holds one setup code line":
  `docker exec console bun --no-env-file src/owner-reset.ts` exits `2` and its stderr contains
  `pulse-console: no owner account: finish setup first`.
- The browser checks of acceptance 11 in `e2e/run.ts`.
- `bun run check` passes.

### Documentation

- `README.md`: roles in one paragraph with a link to `docs/team.md`; the new endpoints in the
  endpoint table; the owner recovery command replaces "Reset (destructive)" as the first way to
  recover a lost password (the destructive reset stays as the last resort); the password-change
  sentence of "Sign out" (line 35) describes the built change; the loopback-mode link limit.
- `docs/configuration.md`: schema version 3 and the new tables; the role step and target checks
  in the protected order; the public link orders (anonymous CSRF, `a:` form token, session
  rotation only after an invite commit); the sign-in and own-password re-checks and the guarded
  writes of new recovery codes, authenticator setup and sign out all (`409`); the widened 2FA
  rule; new metrics labels and log lines; the recovery command's settings and texts.
- `docs/team.md` (new): the matrix of this spec, target rules, invite and reset rules, the 2FA
  requirement, transfer, People log contents, and "API tokens and console roles".
- `docs/index.md`: a link to `docs/team.md`.
- `AGENTS.md`: the new end-to-end test files in "End-to-end checks".

### Completion evidence

- The PR lists `bun run check` output, the docker, `browser` and `deploy-dev` CI results, and the
  manual `bun start` run (commands and results).
- The PR states the console `main` commit it builds on and the migration number it used.
