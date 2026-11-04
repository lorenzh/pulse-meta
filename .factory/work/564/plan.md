# Spec #564: console team roles and invitations

## Goal

The owner of a self-hosted pulse-console can share it with a team. Each person has one of four
roles: Owner, Admin, Member or Viewer. Every console route checks the role on the server. A
policy module holds the confirmed permission matrix, and every later screen attaches to it. An
Admin or the Owner creates an invite link for an email and a role. The link works once, is valid
7 days and is copied by hand. An Admin or the Owner creates a password reset link that works once
and is valid 24 hours. The Owner can change roles, transfer ownership and require two-factor
sign-in for everyone. An operator recovers a lost Owner account with a command in the container.
Each team change is written to an append-only People log in the console database.

## Sources and decisions this spec applies

The matrix and its rules come from the owner confirmation in the #564 comments (comment of
lorenzh, "Owner confirmation for the permission matrix"). It cites
[#460, amendment of 2 November, section 13](https://github.com/lorenzh/pulse-meta/issues/460#issuecomment-6589563362)
and the self-hosted SH7 Team board. That matrix replaces "the permission matrix from the design"
in the issue text. This spec uses it unchanged and adds no matrix row. The issue review
(`.factory/work/564/issue-review.md`) reads it the same way.

| Issue text | Applied rule | Source |
| --- | --- | --- |
| "permission matrix from the design" | The 27-row matrix below, with its derived cells as confirmed. | #564 owner comment; #460 s13 |
| "sent over SMTP or copied by hand" | Copied by hand only. The console sends no email and has no SMTP setting. | #460 s6 (supersedes the issue text and SH8) |
| "An admin can send a password reset link" | An Admin creates a link for a Member or Viewer, the Owner for an Admin. Nobody creates one for the Owner in the web UI. Valid 24 hours, one use. Using it ends all sessions of that person and keeps their second factor. | #460 s6; matrix rows 20 to 22 |
| new | TOTP is required for the Owner and every Admin, including an invited or promoted Admin before first use. The Owner can require it for everyone (off by default). | #460 s5 |
| new | The Owner recovers a lost account with a container command that prints a one-use link valid 15 minutes. Using it removes the Owner's second factors. | #460 s6 |
| new | Every team change goes to the People log. Removal and ownership transfer ask for the typed name. | #460 s9, s14 |
| new | Roles are console roles, not api scopes. The console keeps its one api token. | #460 s3; #564 owner comment rule 8 |

Engineering choices made here (the issue review lists them as open points; none is a hold):

1. **Owner recovery belongs to #564.** #562 deferred it and #563's issue does not name it. The
   #563 spec must not build it again.
2. **The organisation-wide 2FA requirement belongs to #564.** It only matters once Members and
   Viewers exist, which this item adds. It is an Owner-only control (#460 s5 "the owner can
   require it for everyone"; s13 "settings: O"). It is not the matrix row "Edit status and notify
   settings", which stays unbuilt.
3. **Own password change belongs to #564** (`/account/password`), as the password part of matrix
   row 27. Second factors and the session list of row 27 are #563's.
4. **No separate "leave team" flow.** Nobody acts on their own account through the team routes.
   That follows from the matrix (an Admin cannot act on an Admin; nobody acts on the Owner).
5. **One live invite per email.** A second invite for the same email answers `409` until the
   first is revoked, used or expired.
6. **Links keep the authority of their issuer only while the issuer still has it.** An invite or
   reset link fails when its issuer no longer exists or no longer may issue it, or when the
   target's role changed since the reset link was made.
7. **The former Owner becomes an Admin** after a transfer.
8. **Every role change ends all sessions of the changed person.** This holds for an ownership
   transfer too: it changes two roles, so it ends every session of the new Owner and every
   session of the former Owner, the session that made the request included. Removal deletes the
   account.

## Prerequisite: #563 merged in console main

[#563](https://github.com/lorenzh/pulse-meta/issues/563) (TOTP, recovery codes, sessions) comes
before #564 (#460 s19, wave 2 before wave 3). At the time of this spec it is open and absent
from console `main` (`f320e5d59703b654e6cc573b7e7f636598e20624`). This spec uses only the behavior
that #460 s5 decides for #563:

- a TOTP second factor per user (seed encrypted at rest) with ten hashed recovery codes;
- sign-in asks for the code or a recovery code after the password of a user with 2FA;
- a user who must have 2FA and has none can reach only the enrolment flow (#563 acceptance: "an
  owner without 2FA cannot reach admin pages");
- a session list with "sign out all";
- a way to remove all second factors of a user (seed and recovery codes).

#564 reuses these. It does not write TOTP, encryption, recovery codes or a session list itself.
It widens #563's "2FA required" rule from the Owner to the Owner, every Admin, and everyone when
the organisation-wide requirement is on.

The console task starts only on a console `main` that contains #563. If the implementer finds
that console `main` has no TOTP enrolment, it requests a `needs-input` hold and changes nothing.
#564 should carry a native "blocked by #563" relation. A person merges this spec after #563's
console pull request, or holds the console child until then.

## Scope

- console: roles in the database, the permission policy, role checks on every route, the 403
  page, the Team page (people, pending invites, invite, revoke, role change, remove, reset link,
  2FA reset, ownership transfer, the organisation-wide 2FA requirement), invite acceptance,
  password reset, own password change, the owner recovery command, the People log store, docs and
  CI.

## Non-goals

- Any api, contract, kit, config or deploy change. No per-person api token, no "on behalf of"
  field, no new api scope or wire role.
- Email, SMTP, verified mail delivery, self-service "forgot password".
- The screens of checks, incidents, maintenance, tokens, probe locations, Activity and System
  (#565, #566, #567, #569, #572, item C). They attach their routes to the policy of this item.
  The People log has no viewer here; item C adds the Activity page.
- Sign-in events in the People log (item C or #563).
- TOTP, recovery codes, passkeys, the session list (#563, #563b).
- Editing status or notify settings (matrix row 10: Owner, not built in v1; #570 is after the
  MVP).
- Hosted tenancy, more than one organisation, deleting the organisation.
- The shared app shell and navigation of item A. #564 adds plain links and its own 403 page text.
  Item A may restyle them.

## Required behavior

### Roles and the permission matrix

The four roles are `owner`, `admin`, `member` and `viewer`. There is exactly one `owner`.

The matrix (Y allowed, N denied). The row numbers are used in tests and in this spec.

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

Two console actions sit outside the matrix rows. They add no new permission; they name where an
existing rule applies:

- `team.view`: the Team page. Admin and Owner (s13 "team (invites, removal, resets for members
  and viewers): A+").
- `team.require-2fa`: the organisation-wide 2FA requirement. Owner only (s5, s13 "settings: O").

The derived cell "member deleting own items: no exception" applies to later screens: a Member
cannot delete a maintenance window, also not one they made.

### Target rules

A team action also depends on the role of the person it changes (the target):

- The Owner is never a target. No team action changes, resets, removes or demotes the Owner.
- Admin targets need the Owner: invite of an Admin (row 15), removal (17), any role change to or
  from `admin` (19), reset link (21), 2FA reset (24).
- Member and Viewer targets: removal (16), reset link (20) and 2FA reset (23) are A+. A role
  change between `member` and `viewer` is Owner only (18).
- Nobody is the target of their own team action. For an Admin or the Owner this follows from the
  rules above. A request that names the actor's own id gets the same answer as any other target
  of that role.
- Invites never carry the role `owner`. Ownership moves only by transfer (25), only to an Admin
  with TOTP enrolled.

The policy module maps (actor role, action kind, target role) to one matrix row and answers
allowed or denied. A target of `owner` maps to no row and is always denied.

### Where the role is checked

- Each app route in the route table declares how it is guarded: `public` (setup, sign-in,
  `/console.css`, invite and reset links), `signed-in` (sign-out, the #563 enrolment flow), or one
  action id. A route without a declaration is a test failure.
- The role is read from the database on every request (`signedInOf` reads the user already). It
  is never cached in the session row or a cookie. A demotion, a removal and a transfer take
  effect on the next request of every session.
- The order for a guarded GET: route and method (`404`, `405`), phase (before setup `303` to
  `/setup`), loopback `Host` (`421`), session (`303` to `/sign-in?next=<path>` when missing or
  expired), the #563 2FA gate (the enrolment flow when 2FA is required and missing), role (`403`).
- The order for a guarded POST: route and method, phase, loopback `Host`, `Origin` (`403`),
  content type (`415`), body size (`413`), repeated field (`400`), CSRF against the session's
  token (`403`; without a live session no token matches, so the answer is the same `403`
  "Request refused" page and nothing changes), the 2FA gate, the action's role (`403`), field
  format (`422`), target lookup (`404`), the target rule (`403`), the commit (`303`, `200`, `409`
  or `500`).
- The public link routes (`GET` and `POST` of `/invite/<token>` and `/reset/<token>`) have no
  session, 2FA or role step. A session cookie, valid or not, is neither needed nor read, and it
  does not change the answer.
  - The order for their GET: route and method (`404`, `405`; a malformed token is the plain
    `404 not found`), phase (before setup `303` to `/setup`), loopback `Host` (`421`), the link
    lookup (the invalid-link `404` page), then the `200` form. Every GET of these two routes
    calls the existing `ensureCsrf` (`src/server.ts:204-211`), as the sign-in page does
    (`src/server.ts:314`): it keeps the `pulse_console_csrf` cookie when the request carries
    one and sets a new one otherwise. The form holds that value in its `csrf` field. An
    invalid-link page sets no cookie.
  - The order for their POST: route and method, phase, loopback `Host`, `Origin` (`403`),
    content type (`415`), body size (`413`), repeated field (`400`), CSRF against the anonymous
    `pulse_console_csrf` cookie (`403` "Request refused"; this is the default expected value of
    the existing `readPostForm`, `src/server.ts:341-368`, which `postSignIn` uses at
    `src/server.ts:539`), the link lookup (invalid-link `404` page, before any KDF work), field
    format (`422`, the form shown again with the same `csrf` value), the password hash, the
    commit. They never compare the field with a session's CSRF token.
  - A link opened from another site is a cross-site navigation, so the browser does not send
    the `SameSite=Strict` cookie. The GET then sets a fresh cookie, and the same-site form POST
    sends it back. Because that fresh cookie replaces the old one, an open sign-in form in
    another tab of that browser then gets `403` "Request refused". This is accepted; a reload
    fixes it.
- The commit re-reads the actor and the target inside one `BEGIN IMMEDIATE` transaction and
  checks the role and target rules again. When the actor or target changed since the earlier
  checks, the answer is the result of the new check (`403` or `404`), or `409` where the form
  sent an expected state (below). A denied request changes no row and writes no People event.

### The 403 page

An authenticated request that the policy denies answers `403` with an HTML page titled
`Not allowed` and one of these texts:

| Case | Text |
| --- | --- |
| the lowest allowed role of the row is Member | `This needs the Member role.` |
| the lowest allowed role of the row is Admin | `This needs the Admin role.` |
| the lowest allowed role of the row is Owner | `This needs the Owner role.` |
| the target is the Owner | `No one can change the owner account in the console.` |

The page links to `/`. All-N rows have no route in v1, so their paths answer `404`. Row 22
(reset link for the Owner) is the one all-N case with a route: it answers `403` with the Owner
text above. The owner recovery command is the only Owner reset.

### Two-factor requirement

- A user must have TOTP when the role is `owner` or `admin`, or when the organisation-wide
  requirement is on. #564 changes #563's rule to this predicate. The predicate reads the role and
  the requirement live on every request.
- A user who must have TOTP and has none reaches only the #563 enrolment flow, sign-out and
  `/console.css`. Every other guarded route answers the way #563 answers for an Owner without 2FA.
  This holds for a new session and for an existing cookie, for example after a promotion that a
  stale session survived.
- Enrolment unlocks exactly the routes the role allows.
- The organisation-wide requirement is off by default. The Owner turns it on or off on the Team
  page (`POST /team/require-2fa`). When on, a Member or Viewer without TOTP reaches only the
  enrolment flow on the next request. Invite acceptance continues into enrolment then.

### Database

The console adds one migration after the latest one on console `main` at build start (`1` today;
#563 is expected to add `2`). Call it migration N. Earlier migrations are not edited. A version-1
or #563 database with its Owner, password hash, sessions and second factors keeps working.

Migration N:

- `users.role`: two triggers refuse a role outside `owner`, `admin`, `member`, `viewer` on
  `INSERT` and on `UPDATE OF role` (`RAISE(ABORT, 'invalid role')`). The existing unique partial
  index `users_one_owner` keeps "at most one owner".
- `instance`: new column `require_2fa_all INTEGER NOT NULL DEFAULT 0` (0 off, 1 on).
- `invites`:
  `invites(id INTEGER PRIMARY KEY, token_digest TEXT NOT NULL UNIQUE, email TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin','member','viewer')), created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, revoked_at INTEGER, accepted_user_id INTEGER)`.
- `reset_links`:
  `reset_links(id INTEGER PRIMARY KEY, token_digest TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK (kind IN ('team','owner-recovery')), user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, target_role TEXT NOT NULL, issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER)`.
- `people_events`:
  `people_events(id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user','container')), actor_user_id INTEGER, actor_email TEXT, actor_name TEXT, action TEXT NOT NULL, target_kind TEXT NOT NULL, target_id INTEGER, target_email TEXT, target_name TEXT, from_role TEXT, to_role TEXT, value TEXT)`.
  It has no foreign keys, so history stays after a removal. Two triggers make it append-only:
  `BEFORE UPDATE` and `BEFORE DELETE` raise `RAISE(ABORT, 'people_events is append-only')`.
  `action` and `target_kind` have no `CHECK`, so later items add values without a migration; the
  TypeScript type lists the allowed values.
- `SCHEMA_VERSION` becomes N. The "newer than this console" start error keeps its text with the
  new number.

The account store reads `role` from the row (today `toUser` hard-codes `owner` and the `SELECT`
omits `role`, `src/account-store.ts:14,59-70,82`). The triggers prevent any other role value. The
store still narrows the value and throws a named error on an unknown value instead of casting.

Never stored: a plain invite token, a plain reset token, a password, a TOTP code.

### People log

`appendPeopleEvent` writes one row inside the transaction of the change it records. If the
insert fails, the change rolls back and the request answers `500` "The change could not be
saved." So a row exists exactly for each committed change.

Actions written by #564 (names follow the api's `<kind>.<verb>` style; none equals an api audit
action):

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

The row stores the actor's and target's email and name as they were at that time. It never
stores a token, link, password, TOTP seed or code, recovery code, cookie, header value or request
body. Failed or denied attempts write no row.

Later items use the same function for console actions on api objects (for example `token.create`
with the initiating person, item #566). The api audit log keeps naming the console's shared token;
#564 changes nothing there.

### Routes

New routes. `user` and `invite` are decimal ids matching `^[1-9][0-9]{0,15}$`; any other value
answers `404`. Guarded POSTs follow the guarded POST order above. The public link routes follow
their own GET and POST order above, with the anonymous CSRF cookie.

| Route | Guard | Fields | Answer |
| --- | --- | --- | --- |
| `GET /team` | `team.view` | | `200` page: people, pending invites, forms allowed for the actor |
| `POST /team/invites` | row 14 | `email`, `role`, `csrf` | `200` page with the link once; `403`, `409`, `422` |
| `POST /team/invites/revoke` | row 14 or 15 by invite role | `invite`, `csrf` | `303` to `/team`; `403`, `404` |
| `POST /team/role` | row 18 or 19 | `user`, `role`, `from`, `csrf` | `303` to `/team`; `403`, `404`, `409`, `422` |
| `GET /team/remove?user=<id>` | row 16 or 17 | | `200` confirmation page |
| `POST /team/remove` | row 16 or 17 | `user`, `confirm_name`, `csrf` | `303` to `/team`; `403`, `404`, `422` |
| `POST /team/reset-link` | row 20, 21 or 22 | `user`, `csrf` | `200` page with the link once; `403`, `404` |
| `GET /team/reset-2fa?user=<id>` | row 23 or 24 | | `200` confirmation page |
| `POST /team/reset-2fa` | row 23 or 24 | `user`, `csrf` | `303` to `/team`; `403`, `404` |
| `GET /team/transfer?user=<id>` | row 25 | | `200` confirmation page |
| `POST /team/transfer` | row 25 | `user`, `confirm_name`, `csrf` | `303` to `/sign-in?transfer=done`; `403`, `404`, `409`, `422` |
| `POST /team/require-2fa` | `team.require-2fa` | `value` (`on` or `off`), `csrf` | `303` to `/team`; `403`, `422` |
| `GET /account/password` | row 27 | | `200` form |
| `POST /account/password` | row 27 | `current_password`, `password`, `password_confirm`, `csrf` | `303` to `/account/password?changed=1`; `401`, `422`, `429` |
| `GET /invite/<token>` | public | | `200` form or `404` invalid-link page |
| `POST /invite/<token>` | public | `name`, `password`, `password_confirm`, `csrf` | `303`; `404`, `409`, `422` |
| `GET /reset/<token>` | public | | `200` form or `404` invalid-link page |
| `POST /reset/<token>` | public | `password`, `password_confirm`, `csrf` | `303` to `/sign-in?reset=done`; `404`, `422` |

`<token>` is exactly 43 characters of `[A-Za-z0-9_-]` (32 random bytes as base64url). The raw path
must equal `/invite/` or `/reset/` plus such a token, compared on the raw path as today. A
trailing `/`, a percent-encoded character, 42 or 44 characters, or a second segment answer the
plain `404 not found`. The landing page links to `/team` for Admin and Owner and to
`/account/password` for everyone.

For a target-dependent route, the coarse check before field validation is the lowest role of the
route's rows (Admin for remove, reset link, 2FA reset and invite; Owner for role change and
transfer). The row of the actual target is checked after the target lookup.

### Invites

- **Create.** `email` uses the `checkEmail` rule (trimmed, lowercased). `role` is `admin`,
  `member` or `viewer`; anything else, also `owner`, answers `422` "Choose admin, member or
  viewer." An Admin choosing `admin` answers `403` "This needs the Owner role." Inside the
  transaction:
  1. An account with this email exists: `409` "An account with this email exists."
  2. A live invite for this email exists: `409` "An invite for this email is pending. Revoke it
     to make a new one."
  3. Insert the invite with the SHA-256 hex digest of the token, `expires_at = created_at +
     604800000`, and the People event.
- The answer is a `200` page with the full link in a read-only input and as text, the email,
  the role, and "It works once and expires on <YYYY-MM-DD HH:MM> UTC. It is shown only now." The
  page names no SMTP and sends no email. A reload of the POST makes no second invite (rule 2).
- **Live** means `used_at`, `revoked_at` are null and `now < expires_at`. At `now ==
  expires_at` the invite has expired.
- **Pending list** on `/team`: every invite that is not used and not revoked, with email, role,
  creator name (or "removed"), expiry and the state `pending` or `expired`. A Revoke button shows
  only where the actor may revoke.
- **Revoke.** Who may create an invite of that role may revoke it (Admin: member and viewer
  invites; Owner: all). Revoking a used or revoked invite answers `404`; an expired one is revoked
  (it leaves the list). It sets `revoked_at` and writes the event.
- **Accept, GET.** A live invite whose creator still exists and still may create an invite of
  that role shows a form with the bound email (read-only text, not a field), the role, `name`,
  `password`, `password_confirm`. GET never creates an account or consumes the invite. It sets the
  anonymous CSRF cookie like the sign-in page (public link GET order above).
- **Accept, POST.** The token is looked up before any KDF work. An invalid link answers the
  invalid-link page. Field errors answer `422` (name rule `checkName`, password rule
  `passwordText`) and leave the invite live. Then the password is hashed, then in one
  `BEGIN IMMEDIATE` transaction: the invite is still live and its creator still may create it;
  no account has the email (`409` "An account with this email exists."); insert the user with
  the bound email and role; set `used_at` and `accepted_user_id`; write `invite.accept`. Then a
  session starts as at sign-in (old session cookie row deleted). The answer is `303` to the #563
  enrolment flow when the role needs TOTP (Admin, or everyone when required), else to `/`.
- No field of the accept form can change the email or the role. Unknown fields are ignored.
- **Invalid-link page.** Unknown, malformed-but-routed, expired, revoked, used, and invites whose
  creator lost the authority all answer the same `404` page titled `Link not valid` with the text
  "This link is not valid. It may have expired or been used. Ask an admin for a new one." The page
  does not say which case applies and shows no email.

### Password reset links

- **Create** (`POST /team/reset-link`). Target Member or Viewer: row 20; Admin: row 21; Owner:
  row 22, always `403` with the Owner text. In one transaction: delete the target's unused `team`
  links, insert a new one (`target_role` = the target's current role, `expires_at = created_at +
  86400000`), write `user.reset-link`. The answer is a `200` page with the link once, "It works
  once and expires on <YYYY-MM-DD HH:MM> UTC. Using it signs <name> out everywhere." Making a link
  does not sign the target out.
- **Valid** means: unused, `now < expires_at`, the target exists and its role equals
  `target_role`, and for `team` links the issuer exists and may still issue it for that role
  (Owner for an Admin target; Admin or Owner for a Member or Viewer). For `owner-recovery` links
  the target is still the Owner.
- **GET** of a valid link shows a form with the target's email as text, `password` and
  `password_confirm`. GET changes no row. Like the invite GET, it sets the anonymous CSRF
  cookie when it is missing and puts its value in the form (public link GET order above). An
  invalid link answers the invalid-link page and sets no cookie.
- The reset POST checks its `csrf` field against the anonymous cookie, never against a session
  token. The person who uses the link usually has no session, and any session they have is
  deleted by the reset.
- **POST.** Field errors answer `422` and leave the link valid. Then the password is hashed, then
  in one `BEGIN IMMEDIATE` transaction: the link is still valid; update `password_hash`; set
  `used_at`; delete every other unused link of that user; delete every session of that user;
  write the event. A `team` link keeps the user's second factors. An `owner-recovery` link also
  removes the Owner's second factors through #563's function. The answer is `303` to
  `/sign-in?reset=done` ("Your password is set. Sign in."). It starts no session, so sign-in still
  asks for the second factor of a user who has one.

### 2FA reset of another person

`GET /team/reset-2fa?user=<id>` shows a plain confirmation: "Reset two-factor sign-in for
<name>? They sign in with their password only and set up two-factor sign-in again if their role
needs it." `POST` in one transaction: remove the target's TOTP and recovery codes through #563's
function, delete every session of the target, write `user.2fa-reset`. The Owner is never a
target. Resetting 2FA does not change the password.

### Role change

`POST /team/role` with `user`, `role` (`admin`, `member`, `viewer`) and `from` (the target's role
shown on the page). Owner only. `role` = `owner` or another value answers `422`. In the
transaction: the target's current role must equal `from`, else `409` "This person's role changed
since you opened the page." and nothing changes; `role` equal to the current role answers `422`
"Choose a different role." Then update the role, delete every session of the target, write
`user.role-change`. A promoted Admin without TOTP reaches only the enrolment flow after the next
sign-in.

### Removal

`GET /team/remove?user=<id>` shows the typed-name confirmation. It always says: "API tokens are
not tied to people. Tokens that <name> created or copied stay valid until someone revokes them in
pulse-api." `POST /team/remove` compares `confirm_name`, trimmed, with the stored name, case
sensitive and exact. A mismatch answers `422` "Type the name exactly as shown." and changes
nothing. In the transaction: write `user.remove` with the target's email, name and role, then
delete the user row. Sessions and reset links go by `ON DELETE CASCADE`; the second factors go
with the #563 rows (by cascade, or deleted in the same transaction when #563 has no cascade).
Invites the person created stay in the table with `created_by` null and stop working (creator
rule). The removed email can be invited again.

### Ownership transfer

`GET /team/transfer?user=<id>` shows the typed-name confirmation: "Make <name> the owner? You
become an admin." `POST /team/transfer`: the actor is the Owner; the target is an Admin
(`403` "Only an admin can become the owner." for a Member or Viewer target); the target has TOTP
enrolled (`409` "<name> has not set up two-factor sign-in yet."); `confirm_name` matches as for
removal. In one transaction: set the actor's role to `admin`, then the target's role to `owner`
(this order keeps `users_one_owner`), delete every session of the target and every session of
the former Owner (the current one too), write `owner.transfer`. A transfer changes two roles, so
under decision 8 it ends the sessions of both people; there is no exception. The answer is
`303` to `/sign-in?transfer=done` with the session cookie deleted. The sign-in page then shows
"Ownership is transferred. Sign in again." Both people sign in again with password and TOTP
(both have TOTP: the Owner by #460 s5, the target by the check above). The former Owner then
has the Admin role. Two concurrent transfers end with exactly one Owner: both passed the CSRF
step before the first commit, and the second commit re-reads an actor that is no longer Owner
and answers `403` "This needs the Owner role." and changes nothing.

### Own password

`GET /account/password` shows `current_password`, `password`, `password_confirm`. `POST` checks
the fields (`422`), then the sign-in throttle with the user's email as account key and the
client key (`429` as at sign-in), then verifies the current password (`401` "The current
password is wrong.", counted as a failure). Then in one transaction: update the hash, delete every
other session of the user (the current one stays), write `user.password-change`. The answer is
`303` to `/account/password?changed=1`, which shows "Your password is changed. Other sessions
are signed out."

### Owner recovery command

`bun --no-env-file src/owner-reset.ts` (in the image: `docker exec <container> bun --no-env-file
src/owner-reset.ts`).

- It reads only `PULSE_CONSOLE_DB` and `PULSE_CONSOLE_PUBLIC_URL` with the console's rules and
  error texts. It does not need `PULSE_API_URL` or the api token.
- It opens the database with `openDatabase` (same file mode and migrations).
- Not set up or no Owner row: exit `2`, stderr `pulse-console: no owner account: finish setup
  first`. A database error exits `2` with the existing `PULSE_CONSOLE_DB=<path>: …` text.
- Otherwise, in one transaction: delete unused `owner-recovery` links, insert a new link
  (`expires_at = created_at + 900000`, `issued_by` null), write `owner.recovery-link` with actor
  `container`. Then print exactly one stdout line and exit `0`:
  `pulse-console owner reset link: <link> (valid 15 minutes, one use)`.
- `<link>` is `<PULSE_CONSOLE_PUBLIC_URL origin>/reset/<token>`. Without a public URL it is
  `/reset/<token>` and the line ends `(valid 15 minutes, one use; open it on the console
  address)`.
- The link is valid 900000 ms. Using it follows "Password reset links" and also removes the
  Owner's TOTP and recovery codes and ends every Owner session. The next sign-in leads into the
  #563 enrolment, because the Owner must have TOTP. The event is `owner.recover`.
- The command is the only way to reset the Owner. It is documented in the README, not linked from
  any page.

### Link origin

Invite and reset links shown in the web UI start with the origin of `PULSE_CONSOLE_PUBLIC_URL`
when it is set. In loopback mode without it, they start with `http://<Host>` of the request that
made them; that `Host` already passed the loopback check (`421` otherwise). A `Forwarded` or
`X-Forwarded-*` header is never read. The README says that in loopback mode the invitee must open
the console on a loopback address (the same machine or an SSH tunnel); otherwise set
`PULSE_CONSOLE_PUBLIC_URL`.

### API tokens and console roles

- Roles are console rules. The console calls pulse-api with its one token from
  `PULSE_CONSOLE_ADMIN_TOKEN_FILE` or `PULSE_CONSOLE_ADMIN_TOKEN`. pulse-api cannot tell console
  users apart.
- An Admin may create, rotate and revoke api tokens (row 11, built in #566). pulse-api's grant
  rule (`canGrant`, api `src/token-scopes.ts:38-40`; documented in api `docs/rest-api.md:374`)
  lets the console's token create any token whose scopes it holds, including `admin` ("Full
  access" stays A+). A person who copies such a token can use those scopes directly against the
  api, outside console roles.
- A removed Admin's api tokens stay valid, because they belong to no person. The removal page
  says so (above).
- `docs/team.md` states these three points.

### Pages, metrics and logs

- Every page is server-rendered and works without JavaScript. Every value goes through kit
  `escapeHtml`. The CSP is unchanged. The link pages use a read-only input the user selects to
  copy; no script is added.
- The invite and reset pages (GET form, invalid link, `422`) and `/account/password` fit 390 px
  width without horizontal scroll.
- Every page keeps `cache-control: no-store` and `referrer-policy: same-origin`.
- `pulse_console_http_requests_total` gets the `path` labels `/team`, `/team/invites`,
  `/team/invites/revoke`, `/team/role`, `/team/remove`, `/team/reset-link`, `/team/reset-2fa`,
  `/team/transfer`, `/team/require-2fa`, `/account/password`, `/invite/:token` and
  `/reset/:token`. A token never appears in a label; an unrouted path stays `other`.
- `pulse_console_auth_attempts_total` gets the `kind` `password-change`.
- One log line per committed change: `info` `team change` with `action`, `actorId` and
  `targetId` (numbers or null). No log line holds an email, name, token, link, password or path
  with a token. A failed people-log insert logs `error` `team change could not be saved` with
  the error name only.

## Risks

- **#563 not merged.** The console child would build on a `main` without TOTP. The prerequisite
  section makes the implementer hold. If #563 lands with a different internal shape, #564
  adapts to it and does not duplicate it.
- **Overlap with #563.** Own password change, the organisation-wide requirement and owner
  recovery are assigned here. If #563 ships one of them anyway, the implementer reuses it and
  requests a hold for that part instead of building a second one.
- **Links in loopback mode** only work on a loopback address. Documented; a public URL fixes it.
- **Bearer links.** Anyone holding a link can use it until it expires or is used. Mitigations:
  one use, short validity, revocation, digest at rest, no-store, no logging.
- **Promotion and sessions.** If a promotion did not end sessions, an old password-only session
  could act as Admin. Ending sessions plus the live 2FA predicate closes this twice.
- **Removed Admin's api tokens** stay valid by design. The dialog and docs say it; revocation is
  manual in #566.
- **Policy-only rows.** Rows 2 to 13 have no routes yet. Their policy tests do not prove a route.
  Each later item must register its routes with an action id and add HTTP tests (the
  route-declaration test fails otherwise).
- **Migration on a live database.** Triggers and `ADD COLUMN` are cheap and run in one
  transaction. A downgrade to an older console stops at start with "schema version N is newer"
  instead of losing data.

## Acceptance evidence

Every expected value below is a literal written in the test or in this spec. No test reads its
expected value from the module under test.

1. **Matrix, policy level.** `src/permissions.test.ts` holds the 27 x 4 matrix of this spec as a
   literal table (copied from "Roles and the permission matrix", not imported) and asserts every
   one of the 108 cells, plus `team.view` (Viewer N, Member N, Admin Y, Owner Y) and
   `team.require-2fa` (N, N, N, Y). Every mixed row thus has allowed and denied cases. All-Y
   rows (1, 27) and all-N rows (6, 22, 26) record that the other case is inapplicable.
2. **Matrix, HTTP level.** For each implemented row, with a valid session and CSRF token, one
   allowed and one denied request of the lowest denied role (literal statuses):
   - row 1: `GET /` gives `200` for all four roles; without a session `303`.
   - row 14: Admin invites a Member `200`; Member `403` "This needs the Admin role."
   - row 15: Owner invites an Admin `200`; Admin `403` "This needs the Owner role."
   - row 16: Admin removes a Viewer `303`; Member `403`.
   - row 17: Owner removes an Admin `303`; Admin `403` "This needs the Owner role."
   - row 18: Owner changes Member to Viewer `303`; Admin `403`.
   - row 19: Owner promotes a Member to Admin `303`; Admin `403`.
   - row 20: Admin reset link for a Member `200`; Member `403`.
   - row 21: Owner reset link for an Admin `200`; Admin `403`.
   - row 22: Owner and Admin reset link for the Owner `403` "No one can change the owner account
     in the console."
   - row 23: Admin 2FA reset of a Viewer `303`; Member `403`.
   - row 24: Owner 2FA reset of an Admin `303`; Admin `403`.
   - row 25: Owner transfers to an enrolled Admin `303` with `location: /sign-in?transfer=done`;
     Admin `403`.
   - row 27: each role changes its own password `303`; without a session `403` on POST.
   - `team.view`: Admin `GET /team` `200`; Viewer `403` "This needs the Admin role."
   - `team.require-2fa`: Owner `303`; Admin `403`.
   Each denied mutation leaves the `users`, `invites`, `reset_links` and `people_events` row
   counts and contents unchanged, and sends 0 requests to the fake api.
3. **Route declarations.** A test lists every app route with the literal guard expected by this
   spec and fails on a route without a guard or with another one.
4. **Invites.** With an injected clock: accept at `created_at + 604799999` works; at
   `created_at + 604800000` the GET and POST give the `404` invalid-link page. A revoked, a used
   and a 42-character token give `404`. A GET then a `422` POST (11-character password) leave
   the invite live; a later valid POST makes the account. Two concurrent valid POSTs give exactly
   one `303` and one `404`, and `users` gains 1 row. After a restart (new server, same file) the
   link still works. Scanning the database file bytes for the plain token finds 0 matches; the
   digest column holds its SHA-256 hex.
4a. **Anonymous redemption and its CSRF.** Every request here carries no session cookie.
   - Invite: a GET of a live invite answers `200` and a `set-cookie` for `pulse_console_csrf`.
     A POST with that cookie and the same value in `csrf` answers `303` and makes the account.
   - Reset: a GET of a valid link answers `200` and a `set-cookie` for `pulse_console_csrf`. A
     POST with that cookie and value answers `303` with `location: /sign-in?reset=done`, and
     sign-in with the new password works.
   - For each of the two routes, these POSTs answer `403` "Request refused" and change no row:
     no `csrf` cookie; a `csrf` field that differs from the cookie; an `Origin` of another site.
     The link stays valid, and a later correct POST works.
   - A GET that already sends a `pulse_console_csrf` cookie gets no new `set-cookie` for it, and
     its form holds the sent value.
   - A POST that also carries a valid session cookie of another user, with that session's CSRF
     token in `csrf` and no anonymous cookie, answers `403`, because public links check only
     the anonymous cookie.
   - An invalid link GET answers the `404` page without `set-cookie`.
5. **Reset links.** A link works at `created_at + 86399999` and fails at `+ 86400000`. After one
   successful use a second POST gives `404`. After use: the old password fails sign-in, the new
   one works, both pre-existing session cookies of the target get `303` to sign-in, and the
   target's TOTP row still exists so sign-in asks for the code. A second issued link makes the
   first fail. A link for a Member who was promoted to Admin before use fails. A link of an Admin
   who was demoted to Member before use fails.
6. **2FA requirement.** An invited Admin, a promoted Admin (with an old cookie and a new
   sign-in), and a recovered Owner reach only the enrolment flow until TOTP is set; afterwards
   `GET /team` gives `200`. With the requirement on, a Viewer without TOTP is sent to enrolment;
   with it off, the Viewer gets `200` on `/`. An administrative 2FA reset removes the target's
   TOTP and recovery codes (an old recovery code fails) and ends its sessions.
7. **Transfer and removal.** After a transfer, `users` has exactly 1 `owner` and the former Owner
   has role `admin`. The `sessions` table holds 0 rows of either person: the former Owner's
   cookie that made the request and a second cookie of the former Owner get `303` to `/sign-in`
   on `GET /team`, and so does the new Owner's earlier cookie. After a new sign-in with password
   and TOTP, the former Owner gets `200` on `GET /team` and `403` "This needs the Owner role." on
   `POST /team/require-2fa`. The new Owner gets `303` on `POST /team/require-2fa`. A wrong typed
   name, a Member target,
   an Admin without TOTP give `422`, `403`, `409` and change nothing. Removal with the right name
   ends the target's sessions (old cookie gets `303` to sign-in) and deletes its reset links; the
   `user.remove` row keeps email and name.
8. **People log.** Each successful change in items 2 to 7 adds exactly 1 row with the action name
   of this spec. After a restart the rows are there. `UPDATE` and `DELETE` on `people_events` fail.
   With a test trigger that aborts inserts into `people_events`, an invite, a role change and a
   removal answer `500` and leave every other table unchanged. Sentinel scans: no token, link,
   password or TOTP secret in `people_events`, log lines, `/metrics` or any response other than
   the one link page.
9. **Owner recovery.** `src/owner-reset.test.ts` spawns `bun --no-env-file src/owner-reset.ts`
   on a temp database. Not set up: exit `2` with the literal text. Set up: exit `0`, one line
   matching `^pulse-console owner reset link: \S*/reset/[A-Za-z0-9_-]{43} \(valid 15 minutes, one use`.
   The link works at `+ 899999`, fails at `+ 900000`, works once, removes the Owner's
   TOTP, and the Team page offers no Owner reset.
10. **Migration.** A database file built with the previous schema (fixture created in the test
    with the previous migrations' SQL, an Owner, a session) opens with version N; the Owner signs
    in with the old password, `role` reads `owner`, the session cookie still works. Inserting
    role `superuser` fails.
11. **Pages.** HTTP tests check the CSP header is unchanged, that the link pages hold no
    `<script>`, and that all team forms have the CSRF field. A browser check at 390 px (Playwright
    or a manual check recorded in the PR with screenshots) covers the invite form, the reset form
    and the invalid-link page without horizontal scroll.
12. **CI and run.** `bun run check` passes. The docker job runs the recovery command in the
    container before setup and expects exit `2` and the literal "no owner account" text. The
    implementer runs `bun start` once, sets up, invites a Member, accepts in a second browser
    profile, issues and uses a reset link, and reports the commands and results in the PR.

## Performance impact

None expected for any key of `bench/budgets.json` in the api repository (sections `api`,
`probe`, `status`, `notify`, `contract`, `kit`, `config`; checked at api
`2bc5910c9c3e223a5a17e654ada9e1e98dd7a0d1`). The budgets have no console section, and this change
touches no code of those repositories. Startup CPU, load CPU, idle and peak RSS, test CPU, build
CPU, wall-clock startup, p95 latency, requests per second and image size stay unchanged.

The console's own costs, for the record (not gated): one argon2id hash per invite acceptance,
reset and password change (about 19 MiB for a short time, as at setup); one indexed user read per
request, as today; console test time grows with the new KDF runs. The implementer reports the
`bun run test` time before and after in the PR.

## Security impact

Security impact: yes. The change adds authorization on every route, new anonymous credential
flows (invite and reset links), password and second-factor resets, a container command that
issues an Owner credential, database writes, and a CI step.

Checklist items that apply:

- **Secrets in errors, logs and responses.** Invite and reset tokens appear only in the one link
  page of their creation (and the one stdout line of the recovery command) and in the request
  path of their use. They are never logged, never a metrics label, never in the People log,
  never in a `Location` header. Passwords, TOTP seeds and codes never appear anywhere. Tests scan
  logs, `/metrics`, `people_events`, the database file and responses for sentinels.
- **Auth order and status codes.** The fixed GET and POST orders above. Role denial `403` comes
  after CSRF and the 2FA gate; a missing session on POST gives the CSRF `403`; on GET it gives
  `303` to sign-in. The public invite and reset POSTs check CSRF against the anonymous
  `pulse_console_csrf` cookie, which their GET sets, and never against a session token.
  Redemption works without a session and is refused (`403`) without the matching cookie.
  Invalid links give one `404` page for every case, without KDF work. A transfer and every role
  change end all sessions of the changed people, with no exception for the requesting session.
- **Body and size limits.** Forms keep the 8192-byte cap; passwords 12 to 128 code points; names
  1 to 100; emails 3 to 254; ids at most 16 digits; tokens exactly 43 characters.
- **Input validation.** Role values (never `owner` from a client), ids, emails, names, typed
  confirmations, `value` of the 2FA switch, token shape on the raw path, `from` state.
- **Atomic, path-safe writes.** Every change and its People event commit in one
  `BEGIN IMMEDIATE` transaction with a re-check; single use of links is atomic. The recovery
  command takes its database path only from `PULSE_CONSOLE_DB`.
- **Dependency pins.** No new package; the contract and kit pins stay.

Not applicable: SSRF and redirects (no new outbound request), accessor execution (form fields are
read with `URLSearchParams`).

Hostile inputs for the security state: forged and replayed tokens, encoded paths
(`/invite/%41…`), a stale session after demotion, cross-role target ids (an Admin posting an
Admin's or the Owner's id), concurrent use of one link, a second `role=owner` field (repeated
field `400`), an `Origin` from another site, a missing CSRF token.

## Rollout order

One repository: console. pulse-api, pulse-contract, pulse-kit, pulse-config and pulse-deploy do
not change.

- Before: #563 merges in console (prerequisite).
- Then console merges #564. The console still pins contract
  `2c4e0e08201c6efcfff1cd1f7835616e1dff9de3` and talks to the api only as before, so every api
  version that worked with #562 keeps working.
- deploy `full` and `demo` run the published console image and are not affected until a person
  tags a console release and bumps the pin. deploy `dev` builds console `main`; the migration
  runs on its fresh volume, and `/readyz` stays `200`.
- An existing console database migrates at the first start of the new image. Its Owner, password
  and sessions stay. A rollback to an older image stops with "schema version N is newer", so a
  downgrade needs a backup restore (README).

## Counterexamples

- **Roles.**
  - `POST /team/invites` with `role=owner` from the Owner: `422`, no row.
  - `role=Admin` (capital A): `422`.
  - Admin posts `role=admin`: `403` "This needs the Owner role." (a wrong implementation that
    compares role order lets an Admin create an Admin).
  - Admin posts `/team/role` `user=<member>` `role=viewer`: `403` (row 18 is Owner only).
  - Admin posts `/team/remove` with its own id: `403` "This needs the Owner role.".
  - Owner posts `/team/remove` with its own id: `403` "No one can change the owner account in
    the console.".
  - Owner posts `/team/role` with `user=<owner id>` `role=admin`: `403` (owner target).
  - A body with `role=member&role=admin`: `400` repeated field.
- **Ids.** `user=01`, `user=1e3`, `user=-1`, `user=` and `user=12345678901234567` (17 digits):
  `404`. `user=<id of a removed user>`: `404`.
- **Stale state.**
  - The page showed a Member as `member`; another Owner tab promoted them. `POST /team/role` with
    `from=member` `role=viewer`: `409`, role stays `admin`.
  - An Admin is demoted to `member`, then posts an invite from a page opened before: `403`
    "Request refused", because the demotion deleted that session and no CSRF token matches. After
    a new sign-in as Member, the same invite answers `403` "This needs the Admin role."
  - An Admin's invite POST passes the role step, and the Owner demotes that Admin before the
    invite commits: the commit re-reads the actor and answers `403`, and no invite row is
    written (a wrong implementation trusts the role read at the start of the request).
  - The Owner opens the transfer page twice, transfers to Admin A, then submits the old form
    for Admin B: `403` "Request refused", because the transfer deleted every session of the
    former Owner. After a new sign-in as Admin, a transfer POST answers `403` "This needs the
    Owner role."
- **Transfer sessions.** A wrong implementation keeps the former Owner's current session. After a
  transfer, that cookie must get `303` to `/sign-in` on `GET /team`, not `200`.
- **Anonymous link CSRF.** A wrong implementation checks the public link POSTs against a
  session's token, so redemption without a session always fails. An invite or reset POST with
  no session cookie and a matching anonymous `pulse_console_csrf` cookie and field must answer
  `303`. The same POST without the anonymous cookie, or with a field that differs from it,
  must answer `403` "Request refused", even with a valid link and valid fields.
- **Invite time.** `created_at = 0`: valid at `604799999`, invalid at `604800000` (a `<=`
  comparison is wrong). Revoked at `t`, then GET at `t + 1`: `404`.
- **Invite reuse and concurrency.** Two POSTs at once: one account. The 2nd answers `404`, not
  `500` (a wrong implementation relies on the `email UNIQUE` error).
- **Invite email.** A pending invite for `ann@example.com`; a new invite for `Ann@Example.com `:
  `409` (normalized). An account `ann@example.com` exists: a new invite `409`.
- **Invite creator.** An Admin creates a Viewer invite, then is removed: the link answers `404`.
  The Owner creates an Admin invite and transfers ownership: the link answers `404`, because the
  creator is now an Admin.
- **Invite fields.** POST with `email=evil@example.com&role=admin` added to the accept form: the
  account gets the bound email and role (the extra fields are ignored).
- **Reset time and use.** `created_at = 0`: works at `86399999`, `404` at `86400000`. A `422` at
  t = 1 (password of 11 code points) then a valid POST: works. The second valid POST: `404`.
- **Reset authority.** Link for Member M made by Admin A; the Owner promotes M to Admin: `404`.
  Link made by Admin A for Viewer V; A is demoted to Member: `404`. Link for a user who is
  removed: `404` (row cascaded).
- **Reset effects.** After a reset, the target's other browser with a valid cookie: `303` to
  `/sign-in`. The target has TOTP: sign-in with the new password still asks for the code (a wrong
  implementation starts a session at the reset POST).
- **Owner recovery.** Works at `899999`, `404` at `900000`. A second command run makes the first
  link fail. Using it with TOTP set: the TOTP row is gone and the Owner's next sign-in leads to
  enrolment.
- **Promotion.** A Member signed in without TOTP is promoted. Its old cookie: `303` to sign-in
  (session ended). Its new sign-in: only the enrolment flow, `GET /team` does not answer `200`.
- **Transfer.** Target Admin without TOTP: `409`. Target Member: `403`. `confirm_name` `bob` for
  name `Bob`: `422`. `confirm_name` ` Bob ` for `Bob`: accepted (trimmed). After success:
  exactly one `owner` row.
- **Removal.** `confirm_name` empty: `422`, user stays. A removed user's cookie: `303` to
  sign-in.
- **People log.** A denied request (`403`) and a `422`: 0 new rows. A `409`: 0 new rows. With the
  insert failing: `500`, and the user's role is unchanged (a wrong implementation writes the
  event after the commit).
- **Paths.** `/invite/<43 chars>/`, `/invite/<42 chars>`, `/invite/<44 chars>`,
  `/invite/%2e%2e`, `//invite/<token>`: `404 not found`, path label `other`.
- **Own password.** Wrong current password 5 times in 15 minutes: the 6th attempt `429` even with
  the right password. A new password of 129 code points: `422`.

There are no statistics in this change.

## Contract fields

No contract or wire name changes. The console never sends any of the new names to another
service. The new names are console-local: routes, SQLite tables and columns, People action
names, metrics label values and the command file. Searches of the contract and config clones
(contract `176fb6ed14b2f14b730a9fd1757239f210f97a29`, config
`bc870498cc8e2539a132ce2aac35a09db1deabd8`) find no use of any of them:

| Name | `grep -rn '<name>' .repos/contract/src` | `grep -rn '<name>' .repos/config/src .repos/config/bin` |
| --- | --- | --- |
| `invite` (`invites`, `invite.create`, `/invite/`) | 0 | 0 |
| `people_event` | 0 | 0 |
| `reset_link`, `reset-link`, `reset/` | 0 | 0 |
| `/team` | 0 | 0 |
| `require_2fa`, `require-2fa` | 0 | 0 |
| `owner-reset`, `owner.recover` | 0 | 0 |
| `password-change`, `2fa-reset`, `role-change` | 0 | 0 |
| `transfer=done`, `reset=done` (sign-in notices) | 0 | 0 |
| `two-factor-rule`, `team-routes` (module names) | 0 | 0 |
| `/account` | 0 | 0 |

The People action names do not equal any api audit action (contract `src/audit.ts:6-23`:
`check.*`, `component.*`, `maintenance.*`, `manual-incident.*`, `token.*`). Later items reuse the
`token.*` names for console token actions on purpose.

## Repository: console

Files:

Every backticked item in this list is a file path. Symbols and routes in the notes are plain text.

- `src/database.ts` (migration N, the schema version constant)
- `src/database.test.ts`
- `src/account-store.ts` (role read, role update, removal, password update, session deletion per
  user, the transfer transaction)
- `src/account-store.test.ts`
- `src/permissions.ts` (new: roles, action ids, matrix, target rules, required-role text)
- `src/permissions.test.ts` (new)
- `src/two-factor-rule.ts` (new: the widened "must have TOTP" predicate of "Two-factor
  requirement"; the #563 2FA gate calls it instead of its owner-only rule)
- `src/two-factor-rule.test.ts` (new)
- `src/people-log.ts` (new: the append function and the event type)
- `src/people-log.test.ts` (new)
- `src/account-links.ts` (new: token creation, digest, raw-path parsing of the invite and reset
  link paths, link building from the origin)
- `src/account-links.test.ts` (new)
- `src/team-store.ts` (new: invites and reset links in SQLite, with the transactions above; it
  calls #563's factor-removal function)
- `src/team-store.test.ts` (new)
- `src/server.ts` (route table with guards, the GET/POST orders, the anonymous CSRF step for
  the public link routes, the call of the 2FA predicate)
- `src/team-routes.ts` (new: the handlers of the team, account-password, invite and reset routes)
- `src/pages.ts` (403 page, landing-page links)
- `src/team-pages.ts` (new: Team, confirmation, link, invite, reset, password and invalid-link
  pages)
- `src/styles.ts` (layout for the new pages at 390 px)
- `src/forms.ts` (id, role and typed-name checks)
- `src/metrics.ts` (path labels, auth kind)
- `src/owner-reset.ts` (new: the recovery command)
- `src/owner-reset.test.ts` (new)
- `src/server.team.test.ts` (new)
- `src/server.invite.test.ts` (new)
- `src/server.reset.test.ts` (new)
- `src/server.roles.test.ts` (new)
- `src/server.security.test.ts` (sentinel scans for tokens)
- `README.md`
- `docs/configuration.md`
- `docs/team.md` (new)
- `docs/index.md`
- `.github/workflows/ci.yml` (one docker step)

If #563 puts its 2FA gate or its factor-removal function in a module not listed here, the
implementer changes that module only to call `src/two-factor-rule.ts` or to export the removal
function, and names the module in the PR.

Behavior change: yes. It adds roles, team routes, account links, the recovery command and a
migration.

### Prerequisite check

Before any edit, the implementer checks console `main` for #563's TOTP enrolment (a TOTP table in
the migrations and an enrolment route). If it is missing, request a `needs-input` hold that names
#563, and change nothing. If own password change, the organisation-wide requirement or owner
recovery already exist on `main`, reuse them and request a hold for that part instead of
building a duplicate.

### Behavior

Implement "Required behavior" of this spec in console:

- the migration, the role-aware store and `require_2fa_all`;
- the policy module with the 27 rows, the two extra actions and the target rules;
- route guards for every route, existing and new; the guarded GET and POST orders; the public
  link GET and POST orders, with the anonymous CSRF cookie set by the GET and checked by the
  POST; the 403 page;
- the widened 2FA predicate and the organisation-wide switch;
- invites, reset links, 2FA reset, role change, removal, transfer (it ends every session of both
  people), own password change;
- the People log with atomic writes;
- the owner recovery command;
- metrics labels and log lines as specified.

Existing behavior stays: setup, sign-in, sign-out, the throttles, cookies, CSP, the POST order
up to CSRF, `/healthz`, `/readyz`, `/metrics`, the start errors and their texts.

### Tool facts (verified)

- Bun 1.4.0: `package.json:9` (`engines.bun`) and `package.json:32` (`packageManager`); CI sets
  up Bun 1.4.0 in pulse-config `.github/workflows/check.yml:22-24` at the pinned ref
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`.github/workflows/ci.yml:18`). The pinned file is
  identical to the config clone.
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:18`).
  `lint` is `biome check . && pulse-eslint . && pulse-workflows` (`package.json:15`); `typecheck`
  is `tsc --noEmit` through `typescript7` (`package.json:13`); `test` is `bun test`
  (`package.json:14`).
- CI runs lint, typecheck and test in that order (pinned `check.yml:27-38`).
- Coverage: `bunfig.toml:2-4`, at least 80 % lines; test files and `test/**` are not counted.
- Biome 2.6.3 (`package.json:21`); `biome.json` extends `@lorenzh/pulse-config/biome.json`,
  whose `files.includes` is `**` minus `dist`, `node_modules`, `bun.lock`, `*.html` and
  `test/fixtures` (pinned `biome.json:8-16`, identical to the clone). New files under `src/` are
  linted and formatted.
- The docker job builds the image and runs checks against the container
  (`.github/workflows/ci.yml:32` onward); the setup-code step is at `ci.yml:81-88`.

### Checks

- Every item of "Acceptance evidence" as a `bun:test` test with injected `now`, temp databases
  (`mkdtemp`) and the hand-written fake api, servers on `127.0.0.1` port `0`.
- The 27 x 4 literal matrix table in `src/permissions.test.ts`.
- One docker CI step after the setup-code step:
  `docker exec console bun --no-env-file src/owner-reset.ts` exits `2` and its stderr contains
  `pulse-console: no owner account: finish setup first`.
- A browser check at 390 px of the invite form, the reset form and the invalid-link page
  (Playwright run or screenshots in the PR).
- `bun run check` passes.

### Documentation

- `README.md`: roles in one paragraph with a link to `docs/team.md`; new endpoints in the
  endpoint table; the owner recovery command replaces the "Reset (destructive)" paragraph as the
  first way (the destructive reset stays as the last resort); loopback-mode link limit.
- `docs/configuration.md`: schema version N, new tables, POST order with the role step, new
  metrics labels and log lines, the recovery command's settings and texts.
- `docs/team.md` (new): the matrix of this spec, target rules, invite and reset rules, 2FA
  requirement, ownership transfer, People log contents, and "API tokens and console roles".
- `docs/index.md`: a link to `docs/team.md`.

### Completion evidence

- The PR lists `bun run check` output, the docker CI result, the browser check, and the manual
  `bun start` run (commands and results).
- The PR states the #563 commit it builds on, and the migration number N it used.
