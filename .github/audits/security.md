Periodic security audit of `main` in [pulse-{repo}](https://github.com/lorenzh/pulse-{repo}). Opened by `factory-audit.yml`, which starts the `audit` workflow at once (label `factory/audit/audit`). To stop it, cancel its `Factory run` workflow run and remove the `factory/audit/` label.

## Task

Audit the current `main` of pulse-{repo}, not one change. Run the service or the package locally and attack it with hostile inputs. For every item that applies, record the test name or the command and its output. Items that do not apply get one line with the reason.

- Secrets and server texts (tokens, header values, SMTP or upstream replies, file contents) in errors, logs and responses.
- Authentication before any other check; status codes and their order on admin routes.
- Body and size limits on every method, also before any write.
- Input validation at every trust boundary; validators never throw on any input type.
- No accessor or getter of untrusted input runs.
- SSRF: allowed targets, environment lookups, redirects (cross-origin, https to http), forwarded headers.
- File writes atomic and path-safe.
- Dependencies, Docker base images and CI actions pinned and approved (`docs/approved-packages.md`).

## Result

The `audit` workflow writes `audits/security/<date>-{repo}.md` and `.json` in pulse-meta and opens one report pull request. Every checklist item is `checked`, `not applicable` or `blocked` with its reason. Each finding has a severity (P1-P3), the command, its exit code and output, and the examined commit; at most 5 are marked as issue candidates. The repositories are public: a P1 or P2 finding names location, class, impact and fix direction, but no exploit or payload. `audit-review` reproduces every P1 and P2 finding. Merging the pull request accepts the report; the owner then decides which candidates become issues. The agent opens no issues and fixes nothing.
