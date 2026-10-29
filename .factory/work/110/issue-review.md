# Issue review: demo profile (#110)

## Current state (read from the clones)
- The only Compose file is `.repos/api/compose.yaml` (pulse-api). The target for this feature is therefore `api`; its README holds the demo docs. Probe, status, notify, contract need no code change.
- Regular services `api`, `probe`, `status`, `notify` have no profile, so `docker compose --profile demo up` starts them too. `api` mounts `compose/checks.json` and `PULSE_CHECKS_FILE` is fixed; `probe` and `tokens` use `${PULSE_PROBE_TOKEN:?...}`, so without `.env` Compose aborts. Status binds host port 8080, probe/notify are built from `main` of their repos.
- The probe reads its checks once at startup. The API reads the checks file and the `maintenance` windows only at startup, and windows are absolute ISO timestamps (no relative times).
- An incident needs the combined status `down` (at least two locations down) on three consecutive evaluations; it resolves on the first `up` or `degraded`. Status page shows resolved incidents of the last 7 days, upcoming windows (start in future), current maintenance as state `maintenance`, TLS "N days left", `degraded` when latency exceeds `latencyObjectiveMs`.
- A TLS check judges only the leaf expiry (no chain or host check), so a self-signed cert works. The status theme is a JSON file via `PULSE_STATUS_THEME`; default is losoft.

## Open points and assumptions (none blocks the spec)
1. **Regular stack runs alongside the demo.** Assumption: demo services get their own names (`demo-api`, `demo-status`, `demo-probe-a`, `demo-probe-b`, ...), all with `profiles: [demo]`, and their own volumes and host ports (status e.g. 8081, API 127.0.0.1:3001), so they never clash with the regular stack. Preferred alternative for the plan to weigh: also make the regular stack not start with the demo profile, but moving it into a profile would break plain `docker compose up`, so do not.
   Cost: `--profile demo up` also starts the regular services. Plan must decide whether to avoid that (e.g. the README command is `docker compose --profile demo up demo-status ...` / a named service list) or accept it. Whatever is chosen, the `.env` requirement must not block the demo: demo services use fixed public demo tokens and locations in their own `configs:` entry, and the regular services' `:?` guards must not fail the demo run on a clean machine (plan to give `PULSE_PROBE_TOKEN` a non-failing path, or start only demo services by name and say so in the README). The Done-when ("clean machine, `docker compose --profile demo up`") means no `cp .env.example .env` step.
2. **Time-relative maintenance.** The API cannot take relative windows, so a one-shot init service (profile `demo`) generates the demo `checks.json` into a shared volume at start, with a window "now - 1 min .. now + ~4 min" for the maintenance check and one starting ~2-3 min after start for the upcoming window, then `demo-api` starts after it (`service_completed_successfully`). Requires a restart of the demo to refresh windows (`down -v` then up); document it. Current window must still be active at the time of the five-minute check, so the plan fixes the exact offsets.
3. **Upcoming maintenance** must be a different check or a later window of a check that is up, shown as upcoming only before it starts. Assumption: a separate check `Scheduled upgrade` with a window starting ~30 min after start and ending 1 h later, so it stays "upcoming" for the whole demo.
4. **Demo targets**: one small Node (alpine, inline script, no build, no product image) service serving the scheduled behaviours by path or port, driven by its own start time: `/up` always 200; `/slow` answers after a delay above `latencyObjectiveMs` but below `timeoutMs`; `/flaky` fails (500) from about t+30 s to about t+150 s then recovers, so an incident opens (3 evaluations at 5-10 s intervals, two locations) and resolves well inside five minutes; `/maintenance` target may fail, the window covers it. Retries must be 0 on the flaky check so the failure window is not hidden.
5. **TLS target**: a service generates a self-signed cert with `openssl` at start (valid for ~3 days, `warnDays` 14 so it is flagged) and serves HTTPS. The check state for `certDaysLeft < warnDays` must be verified in the probe/api README (down vs degraded) so the README shows the right word. Image: `alpine` with openssl and node, installed at start, or a plain `node:24-alpine` using `openssl` from the image; no network for packages if avoidable.
6. **Two probes**: `demo-probe-a` and `demo-probe-b` from the same probe image with `PULSE_LOCATION` `eu` and `us` and two tokens in the demo tokens config. Both must see the same demo target. Probes must start after the checks file exists and the API is healthy (they read checks once).
7. **Intervals**: short (5-10 s) so every state appears in under five minutes; the plan must check API retention/evaluation rules (window of 2 intervals) with these values and the "worst case fits in interval" rule for retries.
8. **Themes**: default losoft in the demo; the second theme is an example file (e.g. `compose/demo/theme-white-label.json`) not mounted by default; the README shows how to switch (`PULSE_STATUS_THEME` pointing at the mounted file, with the mount shown as a commented line or an override env var). Its content follows the theme file format in the pulse-status README (accent, fonts, radii; colours as hex). A name/logo via `PULSE_STATUS_*` settings is optional.
9. **Notify** is not required for the demo; not added unless trivial (a demo notify would duplicate the regular one). Assumption: omitted.
10. **Build source**: probe and status images are built from `main` of their repositories (github access needed), same as the regular stack. Demo reuses the images (`pulse-probe:local`, `pulse-status:local`) rather than building twice.
11. **Verification**: CI cannot run a five-minute Compose run cheaply. Assumption: the plan adds a script-free check (`docker compose --profile demo config` validates) plus a manual run recorded in the PR; unit tests only for any demo helper script that is deterministic (schedule function).
12. Public repository: demo tokens are public example values and must say so.

## Derived acceptance check
On a machine with Docker Compose >= 2.23 and no `.env`, run `docker compose --profile demo up` in pulse-api. Within five minutes http://localhost:<demo status port> shows:
- a check `up` (always healthy);
- a check `degraded` (slow);
- a check `down` with an open incident, which later resolves and then appears under resolved incidents;
- a check in `maintenance` with its note;
- an upcoming maintenance window listed;
- a TLS check with "N days left" (small N);
- check rows with locations from two probes (e.g. "eu" and "us"; "1/2 locations down" visible during the failure).
The page uses the losoft theme; the README documents the demo, each check's expected state and how to apply the example white-label theme. The demo targets are not in any service image. `docker compose config` (without the profile) stays unchanged for the regular stack, which still works with `.env`.

## Target
`api` only (compose file, demo files under `compose/demo/`, README). No change to contract, probe, status, notify.
