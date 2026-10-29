# Architecture

pulse has four services and two internal repositories.

| Repository | Role |
| --- | --- |
| pulse-api | Loads the checks file, stores results in SQLite, decides the state of each check, serves REST. |
| pulse-probe | Fetches the checks, runs them, posts the results. One probe is one location. |
| pulse-status | Status page. Reads pulse-api through its own `/api/*` proxy. |
| pulse-notify | Polls pulse-api and sends a notification when an incident opens or resolves. |
| pulse-contract | Shared TypeScript types. Types only. Used by api, probe, status and notify. |
| pulse-config | Shared Biome, tsconfig, ESLint and Lefthook configuration and the reusable CI workflow `check.yml`. |

## Data flow

```text
checks.json --> pulse-api <--GET /checks------ pulse-probe
                  ^   ^  <--POST /results----
                  |   |
                  |   +--GET /incidents, GET /checks--> pulse-notify --> webhook or file
                  |
                  +--/api/* proxy-- pulse-status --> browser
```

1. pulse-api reads `checks.json` and `tokens.json` at start.
2. Each probe gets `GET /checks` once at start, runs the checks on their interval and sends `POST /results` with its token.
3. pulse-api stores the result and evaluates the check. The rules for quorum and incidents are in the [pulse-api concepts page](https://github.com/lorenzh/pulse-api/blob/main/docs/concepts.md#quorum-and-incidents).
4. pulse-status and pulse-notify read the state and the incidents from pulse-api.

## pulse-contract and pulse-config

The other repositories depend on both as Git dependencies pinned to a commit SHA (`github:lorenzh/<name>#<sha>`). A type change goes into pulse-contract and reaches a service when its pin is updated. A tooling rule change goes into pulse-config and reaches a repository the same way, including the CI workflow (`uses: lorenzh/pulse-config/.github/workflows/check.yml@<sha>`).
