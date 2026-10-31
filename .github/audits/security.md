Periodic security audit of `main` in [pulse-{repo}](https://github.com/lorenzh/pulse-{repo}). Opened by `factory-audit.yml`. Nothing starts it: the lead decides how it runs.

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

One comment here with the checked items and their evidence. Each finding becomes its own issue with the label `security`, a reproduction (failing test or command with output) and a severity. Do not fix findings in this issue.
