# Spec #570: status and notify settings editable from the console

Issue: [#570](https://github.com/lorenzh/pulse-meta/issues/570). Issue review:
`.factory/work/570/issue-review.md`.

## Goal

The console edits the status page settings and the notify channels. The edits are stored in the
pulse-api database. The status and notify services poll them over HTTP and apply them without a
restart. A value set in the service's own file or environment wins and is shown read-only, with
its origin. Channel secrets stay env or file references and are resolved only by notify. An Owner
can also resend a failed notify delivery from the console: notify takes the resend from the api
and sends it in the running process.

## Sources and decisions this spec applies

- Issue #570 and its comments. The only comments are Factory run notes: the review needs no owner
  decision, and the first plan run was cut short before it wrote this spec.
- #460, decision 7, and its amendment of 2 November (sections 2, 13, 19, 20), as quoted in the
  issue review. It is the authority on these points:
  - the console never writes service files;
  - settings live in the pulse-api database;
  - service file and environment values win and are shown read-only with their origin;
  - notify precedence is by whole channel id, and a shadowed database copy is kept and shown;
  - secrets are env or file references, never values typed into the console.
- #255 and `.factory/work/255/plan.md`: the history of the offline `failed` CLI. The current
  notify code is the authority for behavior.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/570` answered
  `HTTP 404` in this run, so there are no findings yet. That is normal for a feature with no
  children.
- Clone heads read for this spec:

  | Target | Head |
  | --- | --- |
  | api | `4b3e9b1` |
  | status | `8b6d431` |
  | notify | `c79f0b7` |
  | console | `fc2c166` |
  | contract | `ebf6bbc` (version `2.3.0`) |
  | deploy | `e754d46` |
  | kit | `536133f` |
  | config | `bc87049` |

  The config clone is shallow (one commit). Pinned config files must be read with `gh api` at
  their pin, as each repository section says.

### Current behavior (verified in the clones)

**api**
- Schema and migrations:
  - The schema is at version 8 (`src/migrations.ts:5-175`; step 8 is `maintenance_definitions`,
    `:163-174`).
  - The steps are append-only (`:1-4`), and `src/db.ts:115-155` applies them on open.
    `src/db.migrations.test.ts:400-410` pins step 8.
- Database checks:
  - They live in `check_definitions` with a `config_state` row (step 6, `migrations.ts:123-141`).
  - File checks win, and a database check with a file id goes to `shadowed`
    (`src/effective-checks.ts:25-52`).
  - The admin revision is `sha256-` over `<file revision>\n<generation>`
    (`src/config-reload.ts:52-58`). The ETag is that revision in quotes
    (`src/admin-routes.ts:107-109`).
  - `If-Match` must be one quoted revision: `400` when it is malformed, `428` when it is missing,
    `412` when it is stale (`admin-routes.ts:111-120`, `:243`).
  - A create of an id the file owns, or a PUT of a shadowed id, is `409` (`src/check-write.ts:176-204`).
  - One transaction holds the edit, the generation bump and the audit row (`check-write.ts:218-247`),
    under the shared promise lock (`src/write-lock.ts:1-16`).
- Admin routes:
  - They match `ADMIN_PATH = /^\/admin\/(config|checks|components|maintenance)(?:\/([^/]+))?$/`
    (`admin-routes.ts:63`). Metric labels come from `ADMIN_ROUTE` in `src/server.ts:205` and
    `routeOf` (`server.ts:224-249`).
  - The body limit is `ADMIN_MAX_BODY_BYTES` (1 MiB, contract `src/admin.ts:24`). No content-type
    check exists.
  - Error bodies are `{"error": string}`. Auth answers `401` with `www-authenticate: Bearer`,
    `403 forbidden`, and `429` with `retry-after` after 10 failures per client in 60 s
    (`src/admin-auth-throttle.ts:11-16`).
- Permissions (`src/token-scopes.ts:4-32`):
  - `config-write` needs `admin`+`checks`; `token-admin` and `audit-read` need `admin` alone.
  - `canGrant` counts `probe` as `checks` (`:38-40`).
  - A probe token on an admin route gets `403` (`src/admin-auth-failures.ts:19-36`).
- Audit: an entry's action prefix must equal its target kind (contract `src/audit.ts:6-108`).
- Backup copies the whole database with `VACUUM INTO` (`src/backup.ts:128`), so new tables are
  included.
- Callers: status and notify call only public reads, with no token. `PULSE_API_TOKEN` exists in
  no repository (`grep -rn PULSE_API_TOKEN status/src notify/src probe/src`: none). The probe sends
  `Bearer` to `/probe/checks` and `/results` (probe `src/client.ts:297-310`, `:401-403`).

**contract**
- Scopes: `TOKEN_SCOPES = ["read","checks","incidents","admin","probe"]` (`src/tokens.ts:5`), a
  strict `z.enum` (`:30-32`). `probe` must be alone (`:51-58`).
- `tokenMetadataSchema` is a `strictObject` whose scopes are that enum (`:93-127`). A token with an
  unknown scope therefore fails the whole `tokensResponseSchema` (`:131-134`).
- Admin views: `source` is `"file" | "database"` (`src/admin.ts:68-71`), and a sibling `shadowed`
  array holds shadowed entries (`:360-376`).
- `requestJson` is at `src/client.ts:331`, and `DEFAULT_MAX_BODY_BYTES` is 5 MiB (`:7`).
  `WIRE_VERSION = 1` (`src/version.ts:5`).
- `test/smoke.test.ts` checks the runtime export list (`:51-206`) and the `dist` freshness of
  listed modules (`:25-38`).

**status**
- Settings:
  - Every setting is env-only and read once (`src/settings.ts:60-78`): `PULSE_STATUS_NAME`,
    `PULSE_STATUS_LOGO`, `PULSE_STATUS_THEME` (file path), `PULSE_STATUS_HIDE_DETAILS`
    (default `true`) and `PULSE_STATUS_SHOW_CHECKS` (default `false`).
  - Booleans get their default at once, so "set" is not recorded.
- Theme:
  - 20 colour keys, 2 font keys and 3 radius keys (`src/theme-config.ts:6-29`).
  - Colours match `^#(rgb|rrggbb|rrggbbaa)$`; radii match `^\d+(\.\d+)?(px|rem|em)$`; fonts are at
    most 200 safe characters. The name is 1..60 characters (`:40-54`, `:155-160`).
  - Defaults are in `public/theme-default.json`.
- Fixed at start:
  - The theme is loaded once (`src/server.ts:689`), and `/theme.css` is memoized for good
    (`:317-328`).
  - The CSP (`img-src` plus the logo origin) is built once (`:693`).
  - The logo is an https URL or a local file served at `/logo` (`:145-161`).
- Caches:
  - Answer cache key: `"<isHidden><hasChecks>:<path>"` (`src/answer-cache.ts:29-31`).
  - ETag: `etagFor` over the same two flags and the body (`src/http-cache.ts:13-16`).
- Public filter:
  - `latencyObjectiveMs`, `slo` and the `/api/latency` days always pass (`src/api-filter.ts:68-102`,
    `:150`).
  - `showChecks=false` with components empties `/api/checks`, `/api/uptime` and `/api/latency`
    (`src/hidden-checks.ts:117-124`).
- Components: groups appear in order of their first component (`src/components-view.ts:53-61`).
- Browser: `public/client.js` reads `data-show-checks` once (`:30-32`).
- No latency, SLO or order setting exists.

**notify**
- Config file:
  - `PULSE_NOTIFY_CONFIG` is required (`src/config.ts:397-400`), and the file needs at least one
    channel (`:281-288`).
  - Secrets (`<x>Env`/`<x>File`, exactly one) are resolved once at start (`:65-93`;
    `src/index.ts:167-170`). Nothing reloads.
- Channel types:
  - webhook: a literal `url`, with an optional `secretEnv`/`secretFile`.
  - file: `path`.
  - slack and teams: `urlEnv`/`urlFile`, `statusUrl`, `hideReason`.
  - email: `smtp{host,port,tls,username,passwordEnv|passwordFile,clientName}`, `from`, `to`,
    `subjectPrefix`, `statusUrl`, `hideReason`.
  - Routing: `checks`, `excludeChecks`, `components`, `excludeComponents`, `alerts`,
    `sendIncidents`, `remindEverySeconds` (`src/channel-schema.ts:44-128`).
  - Ids have no pattern or length rule (`config.ts:264-266`).
- Notifier: the channel list is built once and is `readonly` (`src/notifier.ts:216-250`). A new
  channel is seeded quietly (`:584-664`). Pending entries are enqueued only in `start()` (`:322`).
- Ledger:
  - SQLite format 4 (`src/ledger.ts:31`).
  - `Ledger.resend` returns `resent`, `not-failed` or `no-payload`. It moves only a failed entry
    with a payload to pending and does not enqueue it (`:960-988`).
- Failed CLI: `failed list|resend` exits `2` while the service holds the lock (`index.ts:349-378`).
- API calls carry no token (`src/api.ts:153`).

**console**
- Permissions: `settings.edit` is `owner` and unused (`src/permissions.ts:50`; `docs/team.md:22`).
- Navigation:
  - It has nine `NavId`s (`src/navigation.ts:3-12`); `navigation.test.ts:11-80` pins them.
  - `navIcon` switches over every id (`src/icons.ts:31-32`).
- Writes:
  - They use `requestJson` with `Bearer` and a quoted `if-match`, a 5000 ms timeout and no retry
    (`src/check-write.ts:141-220`).
  - The outcome comes from the metadata alone (`src/check-outcome.ts:12-44`).
  - A `412` keeps the input (`src/check-routes.ts:307-345`).
- Form handling:
  - Order: Origin, content-type, size, repeated fields, CSRF (`src/http-context.ts:166-208`).
  - Form tokens are bound to session and action path, and a replay gives `409`
    (`src/form-tokens.ts:100-110`; `src/server.ts:981-999`).
- People log:
  - `PeopleAction` has no `CHECK` constraint (`src/people-log.ts:4-24`).
  - Target kinds are an exhaustive union (`:34-90`).
- Tokens:
  - The token list is validated strictly (`src/token-read.ts:53-101`).
  - Presets are `read`, `checks`, `incidents` and `full` (`src/token-view.ts:7-12`).
  - `missingScope` maps `probe` to `checks` (`:98-107`).

**deploy**
- No status or notify token exists. `scripts/secrets-init.mjs` writes probe tokens, one admin
  token and the console token.
- `full/compose.yaml:66` and `dev/compose.yaml:69` set `PULSE_STATUS_SHOW_CHECKS: "true"`.
- notify mounts `full/config/notify.json`, which holds one `file` channel.
- CI jobs `full` (`e2e/compose-e2e.sh`) and `e2e-dev` run the stack (`.github/workflows/ci.yml`).

## Decisions

These decisions settle the open points of the issue review.

1. **One spec, six repository sections.** contract → api → status, notify, console (in parallel)
   → deploy. Status, notify and console each implement their own side of the HTTP interface this
   spec defines.
2. **Precedence.**
   - Status, per field: environment > status settings file > database > built-in default. An env
     variable counts as set when it is present and non-empty after trim. An env value equal to the
     default still locks the field.
   - Notify, per whole channel id: a file channel wins and a same-id database channel is shadowed.
     No field is ever merged across the two sources.
3. **Storage and revisions in the api.** New tables in migration step 9:
   - `status_settings`: one row holding the settings JSON.
   - `notify_channels`: id, definition JSON, created and updated times.
   - `service_reports`: one row per service, holding the last report and its receive time.
   - `resend_commands`.
   - `runtime_state`: one row with `status_generation` and `notify_generation`.

   Each resource has its own revision: `sha256-` + hex SHA-256 of `status\n<status_generation>` or
   `notify\n<notify_generation>`. The check/config revision does not change, so check and
   maintenance writes and these writes never make each other stale.
4. **Access.**
   - Console routes `/admin/status/*` and `/admin/notify/*` need the `admin` scope alone. The new
     permission `runtime-admin` follows `token-admin`, so the console token works unchanged.
   - Service routes `/service/status/*` need a token whose only scope is `status`, and
     `/service/notify/*` one whose only scope is `notify`. Both new scopes are sole scopes like
     `probe`, with no location. `canGrant` counts `status` and `notify` as `admin`.
   - A `status` or `notify` token on any `/admin/*` route is `403`. An admin token on `/service/*`
     is `403`.
   - Console screens need Owner (`settings.edit`), including the failed list and resend.
5. **Feedback path.** Each service reports what it applied:
   - `PUT /service/<svc>/report` after every apply attempt, and at least every 60 s.
   - The api keeps the last report with its receive time.
   - A report older than 180 s, or none, is `stale`. The console then shows the origin as
     unknown, and every field stays editable as a database value. The console never treats a
     stale report as "no overrides": the page says that overrides cannot be shown.
6. **Polling.**
   - Status and notify read their settings or channels every 15 s, with `If-None-Match` and
     `304`.
   - Notify reads resend commands every 5 s.
   - The request timeout is 5000 ms. The answer limit is 1 MiB (`ADMIN_MAX_BODY_BYTES`).
   - A valid answer becomes active atomically when the poll that read it finishes. A malformed,
     oversized or wire-mismatched answer, or an api outage, keeps the last good snapshot. The
     report then names the rejection, and polling goes on.
7. **Status local file.** A new optional `PULSE_STATUS_SETTINGS_FILE` holds a JSON document of the
   same `StatusSettings` shape as the database.
   - A key that is present is file-origin. An absent key is not set.
   - The existing `PULSE_STATUS_THEME` file keeps working: its present tokens are file-origin.
     When both the theme file and a `theme` key in the settings file are set, start fails with
     exit `2`.
   - Status re-reads the settings file and the theme file at each settings poll. A changed, valid
     file applies live. An invalid or unreadable file keeps the last good values and is reported
     as rejected. The env stays fixed for the life of the process.
8. **Status live apply.**
   - One effective snapshot carries name, logo, theme CSS, CSP, order and the four flags. It has a
     `fingerprint`: the first 16 hex characters of the SHA-256 of its canonical JSON.
   - The fingerprint joins the answer cache key and the `etagFor` input, replacing the two-flag
     prefix.
   - `/theme.css` and the CSP come from the current snapshot.
   - The page carries `data-settings="<fingerprint>"`. The browser poller reads
     `GET /page-settings.json` (`{"fingerprint": "<16 hex>"}`, `cache-control: no-store`) on each
     poll cycle and reloads the page once when the value differs.
   - A raw answer whose read began under an older fingerprint is not stored under the new one.
     Filtering always uses the snapshot current at write time.
9. **Status fields and their effect.**
   - `name`: string 1..60 characters (current `NAME_MAX`).
   - `logoUrl`: a database or file value is an `https:` URL of at most 2048 characters, without
     userinfo. A local logo file is only possible through `PULSE_STATUS_LOGO`, as today.
   - `theme`: `{light?, dark?, "font-sans"?, "font-mono"?, "radius-sm"?, "radius-md"?,
     "radius-pill"?}`. The keys and value rules are those of `src/theme-config.ts:6-54`. They are
     merged per token, so a partial file theme leaves the other database tokens in force.
   - `componentOrder`: 0..500 unique non-empty ids, each at most 200 characters.
     - Status orders components by their position in the list; unlisted components follow in
       upstream order. Groups then appear in order of their first component.
     - At save time the api refuses an id that is not a current component (`422`). Status ignores
       an id that was removed later.
     - The order never changes `/components` of the api.
   - `showChecks` (default `false`) and `hideDetails` (default `true`) keep today's meaning.
   - `showLatency` (default `true`). With `false`:
     - no latency label, latency chart or daily latency values in SSR or the browser;
     - `/api/latency` and `/api/components/latency` answer `[]`;
     - `latencyObjectiveMs` is removed from `/api/checks` items, and `latencyMs` from result
       objects.
   - `showSlos` (default `true`). With `false`, the SLO block is not rendered and `slo` is removed
     from check and component items of public answers.
10. **Status startup.**
    - Without `PULSE_STATUS_API_TOKEN` or `PULSE_STATUS_API_TOKEN_FILE`, status behaves as today,
      with env and the local file only.
    - With a token, the public routes answer `503` `{"error":"settings not loaded"}` until the
      first settings read gives `200`, `304` or `404`. A `404` means an older api without the
      route, and the database layer is then empty.
    - The data comes from the same api, so nothing public is served from a guessed snapshot.
11. **Notify modes.**
    - With `PULSE_NOTIFY_API_TOKEN` or `PULSE_NOTIFY_API_TOKEN_FILE` set, `PULSE_NOTIFY_CONFIG` is
      optional, and a file with `"channels": []` is valid. That is the database-only mode.
    - Without a token, notify behaves exactly as today: the file is required and needs at least
      one channel.
    - Notify re-reads the channel file every 15 s by comparing a SHA-256 of its bytes. A changed,
      valid file reconciles. An invalid file keeps the last good set and is reported.
12. **Database channel shape.** Types `webhook`, `slack`, `teams` and `email`. A database channel
    of type `file` is refused.
    - The routing fields are the existing ones and keep their existing rules.
    - Secrets are references only:
      - `urlEnv`/`urlFile`, required for webhook, slack and teams. Webhook gains them in notify for
        both sources; a file webhook keeps its literal `url` too.
      - `secretEnv`/`secretFile` for webhook.
      - `smtp.passwordEnv`/`smtp.passwordFile` for email.
    - An env reference matches `^PULSE_NOTIFY_SECRET_[A-Z0-9_]{1,64}$`. A file reference is a
      basename matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`. Notify resolves it only inside
      `PULSE_NOTIFY_SECRET_DIR`, and without that variable file references of database channels
      are refused.
    - The contract rejects these keys as unknown fields: literal `url`, `password` and `secret`.
    - Id: `^[a-z0-9][a-z0-9_-]{0,63}$`.
    - At most 100 database channels. Every list has at most 200 entries and every string at most
      200 characters; references and `statusUrl` follow their own rules above.
13. **Notify reconcile.**
    - The effective set is the file channels plus the database channels whose id is not in the
      file. Each database channel is resolved on its own. A channel whose secret is missing,
      empty or unreadable is not installed: its last good version stays installed if one exists,
      and the problem is reported.
    - Per id:
      - Unchanged (same canonical definition and same digest of the resolved secrets): kept.
      - Changed: the old worker takes no new job, its in-flight send finishes or times out, and
        the new worker gets the waiting and pending keys. Pending events go to the new
        destination; old and new worker never hold the same key.
      - Removed: the worker stops. Its pending entries stay pending in the ledger and are enqueued
        again if the id returns.
      - Added: today's `hasChannel` seeding applies, so a re-added id is not seeded again and its
        recorded keys stay deduplicated.
      - Routing widened: today's quiet seeding of routing changes applies (`notifier.ts:729-799`).
      - Type changed: recipient progress is kept but used only by email.
    - Metric series per channel are created when a channel is installed.
    - The last applied database channel definitions (references only) are kept in the ledger
      (format 5). A cold start with the api down therefore still runs them.
14. **Resend.**
    - The console posts `POST /admin/notify/resends` with `{channelId, key, requestId}`.
      `requestId` matches `^[A-Za-z0-9_-]{16,64}$`; the console creates it when it renders the
      button.
    - Answers:
      - a new `requestId` creates a `queued` command: `202`;
      - the same `requestId` returns the same command: `200`;
      - while a `queued` or `claimed` command for the same `(channelId, key)` exists, a different
        `requestId` returns that open command: `200`.
    - Notify claims queued commands (`POST /service/notify/resends/claim`, at most 20). Each one
      becomes `claimed` with its claim time.
    - Notify keeps every command id it handled in a ledger table (format 5), with its result. A
      command id it already handled is reported with the stored result and never executed again.
    - Otherwise notify runs `Ledger.resend`:
      - `resent`: the entry is enqueued at once in the running worker, and the result is
        `admitted`;
      - `not-failed`;
      - `no-payload`;
      - an unknown channel: `channel-unavailable`.
    - After `admitted`, the final delivery result of that key is posted as `delivered`, `failed`
      or `dropped`.
    - A command `claimed` for more than 60 s without a result goes back to `queued`. The ledger
      table makes a second execution harmless.
    - The api keeps commands for 7 days and at most 1000; the oldest finished ones go first.
    - Notify's report carries the failed list: the 200 newest failed entries, each with
      `channelId`, `key`, `event`, `failedAt` and `hasPayload`, plus the total count. It never
      carries a payload or destination.
    - The delivery guarantee stays at least once. The webhook `idempotency-key` and the email
      Message-ID come from the unchanged event key.
15. **Audit and People log.**
    - New contract audit actions:
      - `status-settings.replace`;
      - `notify-channel.create`, `notify-channel.replace`, `notify-channel.delete`;
      - `notify-resend.create`.
    - New target kinds: `status-settings`, `notify-channel`, `notify-resend`.
    - New console People actions with the same names, plus targets `status-settings`,
      `notify-channel{id}` and `notify-resend{channelId}`.
    - No value, reference name or key of a setting enters an audit row. The target id is the
      channel id, or the command id for a resend.

## Scope

- contract: schemas and validators for the new shapes, two new scopes, new audit actions and
  kinds.
- api: storage, admin routes, service routes, reports, the resend queue, audit.
- status: the new settings, the local settings file, token, poll, live apply, report.
- notify: token, database-only mode, live reload and reconcile, webhook references, secret
  restrictions, live resend, ledger format 5, report.
- console:
  - Status page screen;
  - Notifications screen: channel list, editor, delete, failed list, resend;
  - token presets for the two service tokens;
  - People log, navigation, docs.
- deploy:
  - optional token and secret plumbing in `full` and `dev`;
  - an E2E scenario that runs only against images with the feature.

## Non-goals

- Component CRUD or a change of api component order or membership.
- Upload of a logo, theme or font. Arbitrary CSS.
- A delivery history dashboard, bulk resend or a test notification button.
- New transports, subscriber mail (#573), new warning kinds (#571).
- Multiple instances of status or notify. One of each per stack is assumed, and reports are
  per service, not per instance.
- Writing a service file or environment from the console or api.
- Exactly-once delivery.
- Moving the failed CLI to the api. It stays offline and keeps exit `2` while notify runs.

## Required behavior

### R1 Contract shapes

All objects are `strictObject`. "Absent" means not set; `null` is not accepted for a setting.

- **`StatusSettings`**:
  - fields: `name?`, `logoUrl?`, `theme?`, `componentOrder?`, `showChecks?`, `showLatency?`,
    `showSlos?`, `hideDetails?`, with the rules of Decision 9;
  - `theme.light` and `theme.dark` are objects of the 20 colour keys, each optional;
  - the `theme` object also holds the five font and radius keys of Decision 9;
  - the colour, radius and font rules move into the contract as exported constants
    (`STATUS_COLOR_KEYS`, `STATUS_FONT_KEYS`, `STATUS_RADIUS_KEYS`), so status and contract
    share one list.
- **Admin status view** `AdminStatusSettingsView`: `{revision, settings: StatusSettings,
  service: StatusServiceState}`.
  - `StatusServiceState`: `{state: "fresh"|"stale"|"never", receivedAt: number|null, report:
    StatusServiceReport|null}`.
- **`StatusServiceReport`**:
  - `{at, startedAt, appliedRevision: Revision|null, rejected: {source: "database"|"file",
    reason}|null, locked: LockedField[]}`;
  - `LockedField`: `{field, source: "env"|"file", via, value?}`;
  - `field` is a dotted path: `name`, `logoUrl`, `theme.light.bg`, `theme.font-sans`,
    `componentOrder`, `showChecks`, …;
  - `via` is the env variable name or `"settings file"` / `"theme file"`;
  - `value` is the local value, except for a local logo file path, which is left out;
  - `reason` is at most 300 characters.
- **`NotifyChannelDefinition`**: a discriminated union on `type` (`webhook|slack|teams|email`)
  with the fields of Decision 12, and `createdAt`/`updatedAt` in views.
- **Admin notify view** `AdminNotifyChannelsView`: `{revision, channels: NotifyChannelView[],
  shadowed: NotifyChannelView[], service: NotifyServiceState}`.
  - A view carries `source: "file"|"database"`.
  - A file view is a `NotifyFileChannelView`: `{source: "file", id, type, routing fields,
    refs: string[]}`, where `refs` are the reference names. `type` may be `file` here.
  - `channels` holds the file channels, then the unshadowed database channels in creation order.
  - `shadowed` holds the database channels whose id is in the last report's file ids.
- **`NotifyServiceReport`**: `{at, startedAt, appliedRevision|null, fileChannels:
  NotifyFileChannelView[], rejected: {channelId: string|null, reason}[] (≤100),
  failed: NotifyFailedDelivery[] (≤200), failedTotal}`.
  - `NotifyFailedDelivery`: `{channelId, key, event: "opened"|"resolved"|"reminder"|"manual"|
    "warning", failedAt, hasPayload}`;
  - `key` is 1..300 characters.
- **Resend**:
  - `ResendRequest` `{channelId, key, requestId}`.
  - `ResendCommand`: `{id, channelId, key, requestId, state:
    "queued"|"claimed"|"admitted"|"delivered"|"failed"|"dropped"|"not-failed"|"no-payload"|
    "channel-unavailable", createdAt, updatedAt}`.
  - `ResendResultInput` `{state}`. Only notify's states are accepted:
    - after claim: `admitted|not-failed|no-payload|channel-unavailable`;
    - after `admitted`: `delivered|failed|dropped`.
- **Tokens**: `TOKEN_SCOPES` gains `status` and `notify`, in that order after `probe`. The rule
  "probe must be the only scope" becomes "probe, status and notify must each be the only scope",
  with the message `"<scope> must be the only scope"`. A location is allowed only for `probe`.
- **Audit**: the actions and kinds of Decision 15.

### R2 Api routes

All new routes answer `405` with `Allow` for other methods. Bodies are JSON within 1 MiB (`413`
beyond). Writes need a quoted `If-Match` of the resource revision: `428` when missing, `400` when
malformed, `412` `the settings changed: reload them and retry` when stale. Success answers carry
the new `etag`.

| Method and path | Token | Answer |
| --- | --- | --- |
| `GET /admin/status/settings` | `admin` | `200` `AdminStatusSettingsView` |
| `PUT /admin/status/settings` | `admin` | body `StatusSettings`; `200` view; `422` invalid or unknown component id |
| `GET /admin/notify/channels` | `admin` | `200` `AdminNotifyChannelsView` |
| `POST /admin/notify/channels` | `admin` | `201` and `location`; `409` id exists in the database or in the last report's file ids; `422` over 100 or invalid |
| `PUT /admin/notify/channels/:id` | `admin` | `200`; `400` body id ≠ path id; `409` shadowed (only delete allowed) or file-only (`comes from the notify channel file`); `404` unknown |
| `DELETE /admin/notify/channels/:id` | `admin` | `204`; works on a shadowed copy; `409` file-only; `404` unknown |
| `GET /admin/notify/failed` | `admin` | `200` `{service: NotifyServiceState, failed, failedTotal}` |
| `POST /admin/notify/resends` | `admin` | Decision 14: `202`, or `200` for a repeat or an open command; `409` `not a failed delivery` when a fresh report does not list `(channelId, key)`; `503` `pulse-notify has not reported recently` when the report is stale or missing |
| `GET /admin/notify/resends/:id` | `admin` | `200` `ResendCommand`; `404` |
| `GET /service/status/settings` | `status` | `200` `{revision, settings}` with `etag`; `304` on a matching `If-None-Match` |
| `PUT /service/status/report` | `status` | `204` |
| `GET /service/notify/channels` | `notify` | `200` `{revision, channels: NotifyChannelDefinition[]}` (all database channels, shadowed ones included); `304` |
| `PUT /service/notify/report` | `notify` | `204` |
| `POST /service/notify/resends/claim` | `notify` | `200` `{commands: ResendCommand[]}`; requeues claims older than 60 s first |
| `POST /service/notify/resends/:id/result` | `notify` | `204`; `409` for a transition outside R1; `404` |

- Auth order is the existing one: throttle, then `401`, `403`, `413`, `400`, `428`, `412`, `422`,
  `409`, `404` (contract `ADMIN_STATUS_ORDER`, `admin.ts:30-46`).
- The `/service/*` routes use the same throttle as `/admin/*`.
- Metric labels:
  - `/admin/status/settings`, `/admin/notify/channels`, `/admin/notify/channels/:id`,
    `/admin/notify/failed`, `/admin/notify/resends`, `/admin/notify/resends/:id`;
  - `/service/status/settings`, `/service/status/report`, `/service/notify/channels`,
    `/service/notify/report`, `/service/notify/resends/claim`,
    `/service/notify/resends/:id/result`.
- Each write commits the record, the generation bump and the audit row in one transaction, under
  the existing write lock.

### R3 Console screens

- **Status page** at `/status-page`. Its nav entry `status-page` is labelled "Status page" with
  role Owner.
  - The form has name, logo URL, the 25 theme tokens (light and dark colour tables, two fonts,
    three radii), the four switches, and component order.
  - Component order is a list with "Move up" and "Move down" buttons and a "Reset order" control.
    Each button posts the form; no drag and no script are needed.
  - A boolean is a three-way select: "Not set (default: …)", "On", "Off". Every other field has
    an empty choice that means "not set".
  - A field in `report.locked` is shown read-only with "Set by `<via>` on pulse-status".
  - Banners:
    - a stale or missing report: "pulse-status has not reported; overrides are unknown";
    - `rejected`: the reason;
    - `appliedRevision` ≠ `revision`: "Saved, not yet applied".
- **Notifications** at `/notifications`. Its nav entry `notifications` is labelled
  "Notifications" with role Owner.
  - Pages:
    - `/notifications`: list. File channels are read-only with origin; shadowed database copies
      are marked "Shadowed by the channel file" and allow only Delete.
    - `/notifications/new`;
    - `/notifications/edit?id=`;
    - `/notifications/delete?id=`;
    - `/notifications/failed`: up to 200 rows, newest first, with channel, key, event, failure
      time, and a Resend button only when `hasPayload`;
    - `/notifications/resend?id=<command id>`: the command state, read on each load.
  - The editor:
    - shows the type-specific fields;
    - offers only reference names: an env name in a text field with the `PULSE_NOTIFY_SECRET_`
      prefix shown, or a file name with "a file in PULSE_NOTIFY_SECRET_DIR on pulse-notify";
    - never shows a field for a secret value;
    - has a "zero channels" first-use state.
- **Shared rules for both screens**:
  - The routes take `requiredRole` from `routeRole("settings.edit")`. A denied direct POST or GET
    is `403`.
  - Writes follow the check write pattern: the outcome comes from metadata, the input is kept on
    `412`, form tokens are used.
  - Token rejected, old api (`404` on `/admin/status/settings`), offline service (stale report)
    and apply-rejected each have a state.

## Risks

- **An older console fails on a token with a new scope.** Its strict token validator rejects the
  whole token list once a `status` or `notify` token exists (contract `tokens.ts:93-134`; console
  `src/token-read.ts:47-49`). Mitigation: the console section moves to the new contract, and the
  rollout says to create service tokens only after that console runs. Deploy creates them only in
  its E2E stack.
- **A remote edit sends a notify secret to an attacker destination.** Mitigation: the reference
  prefix and the secret directory are notify-local rules the api cannot widen (Decision 12), and
  database `file` channels are refused.
- **A visibility change serves an old permissive answer.** Mitigation: the fingerprint in the
  cache key and the ETag, and the in-flight rule (Decision 8).
- **A worker swap sends twice or floods old events.** Mitigation: the reconcile rules
  (Decision 13), and seeding by ledger channel id.
- **One click resends twice.** Mitigation: the command id ledger table, `Ledger.resend` admitting
  only failed entries, and the API idempotency on `requestId`.
- **Full/dev `PULSE_STATUS_SHOW_CHECKS=true` locks show checks.** This is intended and documented;
  the E2E checks an unlocked field as well.

## Performance impact

- **api** (`bench/budgets.json`, `api` section):
  - `startup_cpu_ms` and `startup_wall_ms`: + under 5 ms, for migration step 9 on an existing file
    and one more prepared statement set.
  - `idle_rss_mib`: + under 1 MiB.
  - `load_cpu_s`, `peak_rss_mib`, `p95_*`, `rps`: no change expected. The load runs no new route.
    The new polls are 2 reads per 15 s plus 1 per 5 s, outside the bench load.
  - `test_cpu_s`: + up to 0.5 s for the new tests.
  - `image_mb`: none.
  - Measure with `bun bench/run.ts --a <main sha> --b <branch sha>` (`bench/README.md:76`) and put
    the table in the PR.
- **status** (`status` section):
  - `idle_rss_mib`: + under 1 MiB (snapshot, CSS per snapshot).
  - `load_cpu_s`: + under 2 % (fingerprint lookup per request; the CSS is rebuilt only on change).
  - `startup_*`: + under 10 ms when a token is set (first settings read).
  - Measured by the same run with `--others-ref <status branch>`.
- **notify** (`notify` section):
  - `startup_cpu_ms`: + under 20 ms for the ledger format 5 migration.
  - `idle_rss_mib`: + under 1 MiB.
  - Same measurement method.
- **console and contract**: not in `bench/budgets.json`. None expected beyond the new pages.

## Security impact

Security impact: yes. The change adds admin and service routes and token scopes, changes parsers at
a trust boundary (contract), sends remote config into notify, and writes ledger data.

Checklist items that apply:

- **Secrets in errors, logs and responses.**
  - Only reference names cross the services. A resolved secret, destination URL or payload never
    enters an api or console row, response, audit row, log or metric.
  - Tests use sentinel secret values and assert they are absent everywhere.
- **Auth order and status codes.** As in R2. Sole scopes `status` and `notify`. `403` for a
  service token on `/admin/*` and for an admin token on `/service/*`. Console Owner-only, checked
  on every route and again just before the write (`writeGuardProblem`).
- **Body and size limits.**
  - Every new api route: 1 MiB.
  - The console forms: `MAX_FORM_BYTES` 8192 for resend and delete, and 65536 for the status and
    channel forms.
  - Service answers: 1 MiB in status and notify.
- **Input validation.** Contract validators at the api edge and again in status and notify. Ref
  patterns, secret directory basename rules, and no database `file` channel.
- **SSRF and redirects.**
  - Notify keeps today's transport rules: Slack and Teams https, or http on loopback; SMTP TLS
    rules.
  - Status `logoUrl` is https only and goes into CSP `img-src` as its origin only.
  - Service calls use `redirect: "manual"`, as today.
- **Atomic, path-safe writes.** Notify reads a secret file only inside the secret directory,
  rejecting `..`, `/` and symlinks that leave it (`realpath` check). Ledger writes stay SQLite
  transactions. No service file is ever written.
- **Dependency pins.** Contract pin updates in api, status, notify and console. No new runtime
  package.

## Rollout order

1. **contract `2.4.0`.** Additive: new modules and validators, two new scopes, new audit values.
   - Older consumers stay on their pins: api `c4a2eb5`, status and notify `9ab7e24`, console
     `66818a24`. Nothing changes for them until they move.
2. **api** with the contract pin `2.4.0`.
   - Older status and notify send no token and call no `/service/*` route, so they keep working on
     public reads.
   - The older console (contract `66818a24`) works until someone creates a `status` or `notify`
     token. Then its Tokens and Probes lists show "pulse-api sent an invalid answer." The api
     README and the release note say: update the console before creating service tokens.
3. **status, notify, console** in any order, each with the contract pin `2.4.0`.
   - Status and notify without a token behave as today. With a token against an api from before
     step 2, the settings read gets `404`: status runs on env and file, and notify on its file.
     Both log once that the api has no runtime settings.
   - The console against an older api: `/status-page` and `/notifications` show the "old api"
     state.
4. **deploy.** It adds optional env and volumes that older images ignore (unknown env variables
   are not read by any service). The E2E scenario detects the feature through `GET
   /admin/notify/channels` (`404` means skip) and runs only on images that have it.

## Counterexamples

- **Precedence:**
  - `PULSE_STATUS_SHOW_CHECKS=false` (equal to the default) and the database `showChecks: true`:
    the effective value is `false`, and the report locks `showChecks` with `via`
    `PULSE_STATUS_SHOW_CHECKS`. A wrong implementation that compares with the default shows
    checks.
  - `PULSE_STATUS_SHOW_CHECKS=""`: not set, so the database value applies.
  - Theme file sets only `light.accent=#112233`, and the database sets `light.accent=#445566` and
    `light.bg=#ffffff`: the CSS has `--accent:#112233` and `--bg:#ffffff`.
- **Reset:** the database has `name: "Acme"`, and a PUT without `name` gives `"pulse status"` (the
  default) on the next poll. A settings file with `name: "Local"` is then removed: the retained
  database value shows again; with no database value, the default.
- **Notify whole channel:** file channel `ops` (slack, `urlEnv: SLACK_OPS`) and database `ops`
  (webhook, `urlEnv: PULSE_NOTIFY_SECRET_HOOK`, `checks: ["api*"]`). The effective `ops` is the
  slack channel with the file routing. The webhook URL is never used, and the database copy is
  listed under `shadowed`.
- **Create collisions:** `POST` of id `ops` while the fresh report lists file `ops`: `409`.
  `POST` of `Ops` (upper case): `422` id pattern. `POST` of the 101st channel: `422`.
- **References:**
  - `urlEnv: "PULSE_API_TOKEN"` or `"PULSE_NOTIFY_API_TOKEN"`: `422`, wrong prefix.
  - `urlFile: "../api/token"`, `"a/b"`, `"."`: `422`.
  - `urlFile: "hook"` with `PULSE_NOTIFY_SECRET_DIR` unset on notify: the channel is not
    installed, and the report says `secret files are not enabled`.
  - A symlink `hook -> /etc/passwd` inside the directory: refused.
  - A body with `"url": "https://x"` on a database webhook: `422` `has an unknown field: url`.
  - `type: "file"`: `422`.
- **Revisions:** a `PUT /admin/status/settings` with the status revision after a channel write
  succeeds, because the revisions are separate. A PUT with a revision from before another status
  save: `412`. Without `If-Match`: `428`. With an unquoted value: `400`.
- **Component order:** `["a","a"]`: `422` duplicate. `["zzz"]` with no component `zzz`: `422`.
  - Components `[x(g1), y(g2), z(g1)]` with order `["y"]` give the list `y, x, z` and the groups
    `g2:[y]`, then `g1:[x, z]`. Without an order, `g1:[x, z]`, then `g2:[y]`, as today.
- **Visibility:**
  - `showLatency:false`: `/api/latency` is `[]` and `/api/checks[0]` has no `latencyObjectiveMs`
    key; the SSR HTML has no `ms · objective` text.
  - `showSlos:false`: no `slo` key in `/api/components` items.
  - A switch to `hideDetails:true` between the start of an upstream read and its store: the next
    `/api/checks` has `reason: null`, and its ETag differs from the one before.
- **Resend:**
  - Two `POST /admin/notify/resends` with the same `requestId`: one command, answers `202` then
    `200`, one claim, one receiver hit.
  - Two different `requestId`s while the first is `queued`: `200` with the first command.
  - A command claimed, notify killed before the result, requeued after 60 s and claimed again:
    notify finds the id in its ledger table and reports the stored result. No second send, even if
    the first resend failed again.
  - The same key `42:opened` failed in channels `a` and `b`: resend for `a` leaves `b` failed.
  - A key that is `delivered`: notify answers `not-failed`. A legacy entry without payload:
    `no-payload`. A channel no longer installed: `channel-unavailable`.
  - A stale reminder: admitted, then `dropped` by the existing stale-reminder rule.
- **Stale report:** the last notify report is 181 s old. `GET /admin/notify/channels` has
  `service.state: "stale"`, and the console shows origins as unknown. `POST /admin/notify/resends`
  gives `503`.
- **Statistics:** the spec adds none. Latency and SLO numbers stay as the api computes them; the
  switches only hide them.

## Contract fields

Search of the contract and config clones (`grep -rn -- '<name>' .repos/contract/src
.repos/config/src`, run for this spec). Count of hits per name:

- 0 hits:
  - `statusSettings`, `StatusSettings`;
  - `notifyChannel`, `NotifyChannel`;
  - `serviceReport`, `ServiceReport`;
  - `resend`, `Resend`;
  - `/service/`, `status-settings`, `notify-channel`, `notify-resend`;
  - `showLatency`, `showSlos`, `componentOrder`, `logoUrl`, `requestId`;
  - `PULSE_STATUS_SETTINGS_FILE`, `PULSE_STATUS_API_TOKEN`, `PULSE_NOTIFY_API_TOKEN`,
    `PULSE_NOTIFY_SECRET_DIR`, `PULSE_NOTIFY_SECRET_`.
- `"notify"`: 0 hits.
- `"status"`: 5 hits. All are incident status fields (`client.ts:366`, `schema.ts:970,1036,1041,
  1068`), not scopes or kinds. The new scope value `status` lives in `TOKEN_SCOPES` only.

The env names were also searched in the status, notify and deploy clones: none exist
(`grep -rln 'PULSE_NOTIFY_SECRET\|PULSE_STATUS_SETTINGS_FILE\|SHOW_LATENCY\|SHOW_SLOS'
.repos/status/src .repos/notify/src .repos/deploy`: no output).

New names:

- Token scopes: `status`, `notify`.
- Audit actions and kinds: as in Decision 15.
- Routes: as in R2.
- Contract exports:
  - validators: `validateStatusSettings`, `validateAdminStatusSettingsView`,
    `validateStatusServiceReport`, `validateNotifyChannelDefinition`,
    `validateAdminNotifyChannelsView`, `validateNotifyServiceReport`, `validateResendRequest`,
    `validateResendCommand`, `validateResendClaim`, `validateResendResultInput`,
    `validateServiceStatusSettings`, `validateServiceNotifyChannels`;
  - constants: `STATUS_COLOR_KEYS`, `STATUS_FONT_KEYS`, `STATUS_RADIUS_KEYS`,
    `NOTIFY_SECRET_ENV_PREFIX` (`"PULSE_NOTIFY_SECRET_"`), `NOTIFY_CHANNEL_MAX` (100),
    `RESEND_CLAIM_MAX` (20), `SERVICE_REPORT_STALE_MS` (180000), `NOTIFY_FAILED_REPORT_MAX` (200).
- Env:
  - status: `PULSE_STATUS_SETTINGS_FILE`, `PULSE_STATUS_SHOW_LATENCY`, `PULSE_STATUS_SHOW_SLOS`,
    `PULSE_STATUS_API_TOKEN`, `PULSE_STATUS_API_TOKEN_FILE`, `PULSE_STATUS_SETTINGS_POLL_MS`
    (default 15000, min 1000);
  - notify: `PULSE_NOTIFY_API_TOKEN`, `PULSE_NOTIFY_API_TOKEN_FILE`, `PULSE_NOTIFY_SECRET_DIR`,
    `PULSE_NOTIFY_CHANNELS_POLL_MS` (default 15000, min 1000), `PULSE_NOTIFY_COMMAND_POLL_MS`
    (default 5000, min 1000).
- Status route: `/page-settings.json`.
- Console paths:
  - `/status-page`;
  - `/notifications`, `/notifications/new`, `/notifications/edit`, `/notifications/delete`,
    `/notifications/failed`, `/notifications/resend`.
- Console `NavId`s: `status-page`, `notifications`.

## Repository: contract

Files:
- `src/runtime-settings.ts` (new: status settings, report and view schemas, theme key constants)
- `src/notify-channels.ts` (new: channel definition, file view, notify report, failed delivery,
  resend schemas, constants)
- `src/validate-runtime.ts` (new: the validators of "Contract fields")
- `src/tokens.ts` (scopes `status`, `notify`, sole-scope rule)
- `src/audit.ts` (actions, kinds)
- `src/index.ts` (exports)
- `test/runtime-settings.test.ts`, `test/notify-channels.test.ts` (new); `test/tokens.test.ts` or
  the existing token test file; `test/smoke.test.ts` (export list, dist module list);
  `test/types.fixture.ts`
- `dist/` (rebuilt and committed)
- `package.json` (`version` `2.4.0`), `README.md`, `docs/index.md`

Behavior change: yes. New shapes and validators, wider scope and audit enums.

Behavior: R1 exactly.
- Validators never throw and return the same object, as the existing ones do.
- Unknown keys give `has an unknown field: <key>`.
- The `componentOrder` duplicate message is `componentOrder[<i>]: must not repeat an id`.
- Database channels refuse `type: "file"` with `type: must be one of "webhook", "slack", "teams",
  "email"`.
- The file view accepts `file` too.

Checks:
- Accept and reject the Counterexamples' shapes. The expected values are literals in the tests:
  - duplicate order;
  - `urlEnv: "PULSE_API_TOKEN"`;
  - `urlFile: "../x"`;
  - `url` on webhook;
  - `type: "file"`;
  - id `Ops`;
  - a 61-character name;
  - colour `#12`;
  - radius `4pt`;
  - `null` for a setting;
  - `["status","read"]` scopes (`status must be the only scope`);
  - `status` with a location.
- `tokenMetadataSchema` accepts a `notify` token.
- Older scope lists stay valid.
- The audit entry `notify-channel.create` with kind `notify-channel` is accepted. The same action
  with kind `check` is rejected.
- `test/smoke.test.ts`:
  - the export list gains exactly the validators and constants listed in "Contract fields" as
    literals;
  - the dist module list gains `runtime-settings`, `notify-channels` and `validate-runtime`.

Tool facts:
- `check` is `bun run lint && bun run build && bun run typecheck && bun run test` (`package.json`
  scripts).
- Biome is `2.6.3`. `biome.json` extends `@lorenzh/pulse-config/biome.json`.
- The config pin is `51e95b0eb463b27a196a33b428607bd92443e4f0` (`package.json`).
- `bunfig.toml`: `coverage = true`, `coverageThreshold = { lines = 0.8 }`.
- CI is `.github/workflows/ci.yml:17` `uses:
  lorenzh/pulse-config/.github/workflows/check.yml@51e95b0…` with `build: true` (`:18-19`). It
  runs install, lint, typecheck, build, `git diff --exit-code -- dist` and test (config clone
  `check.yml:25-37`).
- The clone is at `bc87049`. The implementer reads the pinned `check.yml` with `gh api
  "repos/lorenzh/pulse-config/contents/.github/workflows/check.yml?ref=51e95b0…"` and states in
  the PR whether it differs.

Completion evidence: `bun run check` output; `git diff --exit-code -- dist` after `bun run
build`; the new tests fail on `ebf6bbc` (missing exports) and pass after.

## Repository: api

Files:
- `src/migrations.ts` (step 9: `status_settings`, `notify_channels`, `service_reports`,
  `resend_commands`, `runtime_state`)
- `src/runtime-store.ts` (new: SQL of the five tables, generations, revisions)
- `src/status-settings-routes.ts` (new: admin and service status routes, report)
- `src/notify-channel-routes.ts` (new: admin and service channel routes, report, failed list)
- `src/resend-routes.ts` (new: resend admin and service routes, claim, results, requeue)
- `src/token-scopes.ts` (permissions `runtime-admin`, `status-service`, `notify-service`;
  `canGrant` for `status`/`notify`)
- `src/admin-routes.ts`, `src/admin-auth-failures.ts` (dispatch of the new admin sections; a
  service token on `/admin/*` is `403`)
- `src/server.ts` (`/service/*` dispatch before the read paths, `routeOf` labels, `ADMIN_ROUTE`)
- `src/retention.ts`, `src/start.ts` (resend command retention)
- `src/main.ts` (wiring)
- tests:
  - `src/db.migrations.test.ts` (step 9);
  - `src/runtime-store.test.ts`;
  - `src/server.status-settings.test.ts`;
  - `src/server.notify-channels.test.ts`;
  - `src/server.resend.test.ts`;
  - `src/server.service-auth.test.ts`;
  - `src/token-scopes.test.ts`;
  - `src/server.allow.test.ts`;
  - `src/retention.test.ts`.
- `package.json`, `bun.lock` (contract pin to the merged `2.4.0` SHA)
- `README.md`, `docs/rest-api.md`, `docs/operation.md`, `docs/configuration.md`

Behavior change: yes. New tables, routes, scopes and audit actions.

Behavior: Decisions 3, 4, 5, 14 and 15 and R2.
- The component check of `componentOrder` reads the current applied components.
- The api never reads a notify reference or secret.
- It never validates the value of a reference beyond the contract patterns.
- `GET /admin/notify/channels` computes `shadowed` from the last report's `fileChannels` ids, even
  a stale one. With no report at all, `shadowed` is `[]` and `service.state` is `"never"`.
- Reports are replaced whole, and the stored report is validated before it is stored.

Checks (real server at `127.0.0.1:0`, `mkdtemp` database, injected `now`):
- Every R2 row has an allowed case and a denied case:
  - no token: `401`;
  - a `read` token: `403`;
  - a `status` token on `/admin/notify/channels`: `403`;
  - an admin token on `/service/notify/resends/claim`: `403`.
- Stale and missing `If-Match` give `412` and `428`.
- The separate revisions of Counterexamples: a status save does not stale a channel write, and a
  check write does not stale a status save.
- The create collision with a report file id gives `409`. Shadowed PUT and file-only PUT give
  `409`, and shadowed DELETE gives `204`.
- Resend idempotency, open-command reuse, `503` on a stale report, `409` for a key not in a fresh
  report, requeue after 60 s (fake clock), transitions outside R1 (`409`), retention at 7 days and
  1000 rows.
- Migration: a step-8 file with checks, tokens, incidents and windows opens at version 9 with all
  rows kept. A backup holds the new tables.
- Audit rows for each write hold the action, kind and target id, and no settings value. A sentinel
  reference name `PULSE_NOTIFY_SECRET_SENTINEL` appears in no audit row and no log line.
- Expected codes and texts are the literals of R2.
- The tests fail on `4b3e9b1` (routes `404`) and pass after.

Tool facts:
- `check` is `bun run lint && bun run typecheck && bun run test` (`package.json:20`).
- Biome `2.6.3` (`:23`); `biome.json:2` extends `@lorenzh/pulse-config/biome.json`.
- The config pin is `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`:24`), and the contract pin is
  `c4a2eb5` (`:31`).
- `bunfig.toml:1-4`: coverage on, lines `0.8`.
- CI is `.github/workflows/ci.yml:18` `check.yml@04108fa…`, plus `bench-selftest` (`:20-32`) and
  `docker` jobs.
- Read the pinned `check.yml` at `04108fa` with `gh api` and state whether it differs from the
  clone.

Completion evidence: `bun run check` output; the Performance impact A/B table; one manual run with
`bun start`, an admin token and a `status` token:

```sh
curl -X PUT /admin/status/settings
curl /service/status/settings
```

The output goes in the PR.

## Repository: status

Files:
- `src/settings.ts` (new env names and token; "set" recorded per field)
- `src/runtime-settings.ts` (new: precedence merge of env, file and database into the effective
  snapshot, fingerprint, locked list)
- `src/settings-poll.ts` (new: poll of `/service/status/settings`, re-read of local files, report)
- `src/theme-config.ts` (keys from the contract constants; build CSS from a snapshot)
- `src/server.ts` (snapshot in place of fixed options: CSS, CSP, logo, wordmark, flags; readiness
  `settings not loaded`; `/page-settings.json`)
- `src/answer-cache.ts`, `src/http-cache.ts` (fingerprint in the key and the ETag; in-flight rule)
- `src/api-filter.ts`, `src/hidden-checks.ts` (`showLatency`, `showSlos` filtering)
- `src/components-view.ts` (order)
- `src/sections.ts`, `src/render.ts`, `src/component-latency.ts` (latency and SLO switches)
- `public/client.js` (fingerprint poll and one reload)
- `src/start.ts`, `src/main.ts` (wiring)
- tests:
  - `src/runtime-settings.test.ts`, `src/settings-poll.test.ts`;
  - `src/server.runtime-settings.test.ts`;
  - `src/server.privacy.test.ts`, `src/server.cache.test.ts`;
  - `src/components-view.test.ts`, `src/settings.test.ts`.
- `e2e/run.ts` (browser convergence check)
- `package.json`, `bun.lock` (contract pin to the merged `2.4.0` SHA)
- `README.md`, `docs/configuration.md`, `docs/theming.md`, `docs/operation.md`

Behavior change: yes. New settings, live apply and new routes.

Behavior: Decisions 2 and 5–10.
- Without a token, the database layer is empty and nothing is reported. The status settings file
  and the new env names still work.
- Without either, the effective settings equal today's.
- The report goes to `PUT /service/status/report` after every apply attempt and at least every
  60 s.
- `docs/operation.md` names the full/dev `PULSE_STATUS_SHOW_CHECKS` lock.

Checks (fake api on `127.0.0.1:0`, fake clock and timers):
- A per-field matrix covers name, `logoUrl`, each theme token group (one colour per mode, one
  font, one radius), `componentOrder`, and each of the four flags in both directions. For each
  field:
  - the database value applies after one poll without a new server;
  - an env value, or a file value, wins and appears in `locked`;
  - removing the file key brings back the database value;
  - clearing the database key brings back the default.
- The Counterexamples' precedence, theme merge, order, visibility and in-flight cases. The
  expected values are literals.
- CSP `img-src` follows a new `logoUrl` origin.
- `/theme.css` changes its body and ETag after a theme change.
- `/page-settings.json` changes.
- Bad answers keep the last good snapshot and report `rejected`, then recover on the next good
  poll:
  - a `200` with an invalid body;
  - an oversized body;
  - a wire mismatch;
  - an api timeout;
  - an invalid settings file.
- `404` from an older api: the database layer is empty and the page is ready.
- A token is set and no read has succeeded yet: the page answers `503`.
- Browser (`e2e/run.ts`): an open page reloads once after a fingerprint change and shows the new
  name and no checks list.
- The tests fail on `8b6d431` and pass after.

Tool facts:
- `check` is `bun run lint && bun run typecheck && bun run test` (`package.json:19`).
- `check:a11y` is `bun e2e/run.ts` (`:18`).
- Biome `2.6.3` (`:23`); `biome.json:2` extends the config.
- Pins: config `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`:24`), contract `9ab7e24` (`:34`),
  kit `236df21` (`:35`).
- `bunfig.toml:1-4`: coverage lines `0.8`.
- CI is `.github/workflows/ci.yml:18` `check.yml@04108fa…`, plus the `a11y` job (`:51-68`).
- Read the pinned `check.yml` with `gh api` and state whether it differs.

Completion evidence: `bun run check` and `bun run check:a11y` output; one manual run against a
local api with a `status` token, changing `showChecks` in the database and showing the changed
`/api/checks` without a restart.

## Repository: notify

Files:
- `src/config.ts` (token, database-only mode, `PULSE_NOTIFY_SECRET_DIR`, poll settings, webhook
  `urlEnv`/`urlFile`, resolving one channel at a time)
- `src/channel-schema.ts` (webhook references)
- `src/remote-channels.ts` (new: poll of `/service/notify/channels`, database channel validation
  with the notify-local reference rules, secret directory resolution)
- `src/channel-set.ts` (new: effective set, shadowing, per-id diff)
- `src/notifier.ts`, `src/delivery.ts` (reconcile: install, replace, remove workers; live enqueue
  of a resent key; final result callback)
- `src/resend-commands.ts` (new: claim, execute, report)
- `src/service-report.ts` (new: report with file channel views, rejected list, failed list)
- `src/ledger.ts` (format 5: `remote_channels` snapshot table, `resend_commands` table; migration
  from 4)
- `src/metrics.ts` (series per installed channel)
- `src/api.ts`, `src/index.ts` (Bearer on `/service/*` only; wiring)
- tests:
  - `src/remote-channels.test.ts`, `src/channel-set.test.ts`;
  - `src/notifier.reconcile.test.ts`;
  - `src/resend-commands.test.ts`;
  - `src/ledger.test.ts` (format 5);
  - `src/config.test.ts`, `src/index.test.ts` or the existing start test.
- `package.json`, `bun.lock` (contract pin to the merged `2.4.0` SHA)
- `README.md`, `AGENTS.md` (ledger format), `docs/configuration.md`, `docs/channels.md`,
  `docs/operation.md`

Behavior change: yes. Live reload, database channels, live resend and a new ledger format.

Behavior: Decisions 2, 5, 6 and 11–14.
- The public reads stay without a token.
- The failed CLI still refuses with exit `2` while the service holds the lock. When notify is
  stopped, the CLI works offline on format 5 as before, and `docs/operation.md` describes both
  ways.
- A format-5 ledger opened by an older notify is refused by its version check, as today. The docs
  say downgrade is not supported.

Checks (fake api and fake receivers on `127.0.0.1:0`, fake clock and timers, `mkdtemp` ledger):
- Database-only start with zero channels:
  - a database webhook appears on the next poll;
  - a new matching incident is delivered once;
  - old incidents are seeded, not sent.
- Each routing field (`checks`, `excludeChecks`, `components`, `excludeComponents`, `alerts`,
  `sendIncidents`, `remindEverySeconds`) has a matching and a non-matching event after a live
  change. Widening the routing seeds quietly.
- File-over-database shadowing for the whole channel. Removing the file channel live unshadows
  the database copy. No field mixing: the receiver hit is at the file destination.
- Changed destination with a pending retrying job: the job goes to the new receiver only, once.
- Removed channel with a pending entry: not sent. Re-added: sent once.
- A slow channel does not block another channel or the poll.
- A missing secret reference keeps the last good version and reports a reason without the value.
- A sentinel secret value appears in no report body, log line or metric.
- Live resend:
  - a failed entry is resent through a claimed command;
  - the receiver gets exactly one more request with the same `idempotency-key`;
  - the command ends `delivered`;
  - a second claim of the same id posts the stored result and sends nothing.
- Partial SMTP failure: a resend retries only the refused recipients (fake SMTP).
- Ledger 4 → 5 migration keeps every entry.
- The tests fail on `c79f0b7` and pass after.

Tool facts:
- `check` is `bun run lint && bun run typecheck && bun run test` (`package.json:17`).
- Biome `2.6.3` (`:21`); `biome.json:2` extends the config.
- Pins: config `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`:22`), contract `9ab7e24` (`:30`),
  kit `236df21` (`:31`).
- `bunfig.toml:1-4`: coverage lines `0.8`.
- CI is `.github/workflows/ci.yml:18` `check.yml@04108fa…`.
- Read the pinned `check.yml` with `gh api` and state whether it differs.

Completion evidence: `bun run check` output; one manual run with a local api, a `notify` token and
a fake webhook receiver, showing a database channel added and a resend delivered without a restart.

## Repository: console

Files:
- `src/navigation.ts`, `src/icons.ts` (ids `status-page`, `notifications`)
- `src/status-page-pages.ts`, `src/status-page-routes.ts` (new)
- `src/notification-pages.ts`, `src/notification-routes.ts` (new: list, new, edit, delete, failed,
  resend)
- `src/runtime-read.ts`, `src/runtime-write.ts` (new: reads and writes of the R2 admin routes, in
  the check write pattern)
- `src/api-failure.ts` (`ApiCall` values `status-settings`, `notify-channels`, `notify-failed`,
  `notify-resend`)
- `src/people-log.ts` (actions and targets of Decision 15)
- `src/token-view.ts`, `src/token-pages.ts` (presets "Status service" `["status"]` and "Notify
  service" `["notify"]`; `missingScope` maps both to `admin`)
- `src/server.ts` (route registration)
- tests:
  - `src/navigation.test.ts`, `src/people-log.test.ts`, `src/token-view.test.ts`;
  - `src/server.status-page.test.ts`, `src/server.notifications.test.ts`;
  - `test/fake-api.ts`.
- `e2e/run.ts` (fixture pages, keyboard move controls)
- `package.json`, `bun.lock` (contract pin to the merged `2.4.0` SHA)
- `README.md`, `docs/configuration.md`, `docs/team.md` (`settings.edit` is now built),
  `docs/tokens.md`

Behavior change: yes. New screens, routes and token presets.

Behavior: R3, and Decision 14 for the resend button.
- A Resend form holds a `requestId` of 24 random base64url characters. A repeat after a lost
  answer posts the same `requestId`.
- The People log row is written for saved and unknown outcomes, as for checks.
- The token list accepts tokens with the new scopes.

Checks (real console server, fake api on `127.0.0.1:0`):
- Owner can save, delete and resend. Admin, Member and Viewer get `403` on direct GET and POST of
  every new route (literal `403`).
- A role change between read and write gives `403`.
- Invalid Origin, CSRF and replayed form tokens are refused (`403`, `403`, `409`).
- Locked fields are read-only, and a forged POST of a locked field is refused by the console with
  `422`, and nothing is sent.
- Each state: `412` keeps the input; token rejected; old api (`404`); stale report; rejected
  apply; zero channels.
- No secret value field exists in any form, and a forged `url` field is not forwarded (fake api
  sees no `url`).
- The token list with a `notify` token renders.
- Browser (`e2e/run.ts`): keyboard-only reorder of three components and save.
- The tests fail on `fc2c166` and pass after.

Tool facts:
- `check` is `bun run lint && bun run typecheck && bun run test`; `check:browser` is
  `bun e2e/run.ts` (`package.json:11-19`).
- Biome `2.6.3` (`:23`); `biome.json:2` extends the config.
- Pins: config `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`:24`), contract `66818a24` (`:33`).
- `bunfig.toml:1-4`: coverage lines `0.8`.
- CI is `.github/workflows/ci.yml:18` `check.yml@04108fa…`, plus `docker`, `deploy-dev` (`:231-289`,
  with deploy, api, probe, status and notify at `main`) and `browser` (`:291-308`).
- Read the pinned `check.yml` with `gh api` and state whether it differs.

Completion evidence: `bun run check` and `bun run check:browser` output; a manual run against a
local api with screenshots of both screens in the PR.

## Repository: deploy

Files:
- `full/compose.yaml`, `dev/compose.yaml` (optional `PULSE_STATUS_API_TOKEN_FILE`,
  `PULSE_NOTIFY_API_TOKEN_FILE` and `PULSE_NOTIFY_SECRET_DIR` with read-only secret volumes; no
  token is created by default)
- `e2e/compose.e2e.yaml`, `e2e/runtime-settings.sh` (new), `e2e/runtime-settings.test.sh` (new)
- `.github/workflows/ci.yml` (run the new scenario in `e2e-dev` and grep its `ok:` line)
- `README.md`, `full/README.md`, `dev/README.md`

Behavior change: yes. New compose settings and a CI scenario.

Behavior:
- The new compose settings point at files a person provides. `full/README.md` documents the
  steps:
  1. update the console first;
  2. create the two service tokens in the console Tokens page;
  3. write them to the secret volumes;
  4. restart status and notify once.
- `PULSE_STATUS_SHOW_CHECKS: "true"` stays and is documented as a lock of that field.
- `e2e/runtime-settings.sh` runs only when `GET /admin/notify/channels` with the admin token
  answers `200`, and otherwise prints `skip: runtime settings`. The steps:
  1. Create a `status` and a `notify` token with `POST /admin/tokens`.
  2. Start status and notify with them.
  3. Sign in as Owner, as `e2e/console-setup.sh` does.
  4. Save `name` and `showLatency=false` through the console form, and see the public page change
     within 30 s without restarting status.
  5. Create a database webhook channel to a fake receiver container, and see one delivery of a
     new incident.
  6. Make the receiver answer `500` until the delivery is `failed`, then switch it to `200`, press
     Resend once, and see exactly one more request with the same `idempotency-key`.
  7. Check that the status `showChecks` field shows "Set by PULSE_STATUS_SHOW_CHECKS".
  8. Print `ok: runtime settings`.

Checks:
- `e2e/runtime-settings.test.sh` runs the script's parsing helpers on fixed fixture answers.
- CI `e2e-dev` greps `ok: runtime settings` on images built from `main`, after the four services
  merged.
- The existing jobs stay green on the current pins: the feature check prints `skip`.

Tool facts:
- `check` is `bun run lint && bun run typecheck && bun run test` with `test` = `bun test
  --coverage cli` (`package.json`).
- The config pin is `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`.
- CI `check` uses `check.yml@04108fa…` (`.github/workflows/ci.yml:17`). The `lint` job runs
  shellcheck and the `e2e/*.test.sh` files (`:19-67`). `full` runs `e2e/compose-e2e.sh`
  (`:124-126`). `e2e-dev` greps `ok:` lines (`:305-306`).

Completion evidence: CI `e2e-dev` log with `ok: runtime settings`; `bun run check` output.

## Acceptance evidence (feature)

1. contract `bun run check` and the dist diff.
2. api, status, notify and console `bun run check`, plus the status `check:a11y` and the console
   `check:browser`, each with tests that fail on the cited heads.
3. Per-setting live tests in status and notify:
   - a database change reaches the running service without a restart;
   - a file value overrides the database value.

   The expected values are literals in the tests (Counterexamples).
4. The notify resend test: exactly one more receiver request with the same key, from a single
   command. Expected count `1`, a literal.
5. deploy `e2e-dev` prints `ok: runtime settings`. This is the integrated check across console,
   api, status, notify and a fake receiver.
