# Approved packages

The pulse repositories may use a runtime dependency only when it is on this list. Pin every entry to an exact version, never a range. Use pulse-kit, pulse-contract, a Node built-in or a package from this list before you write infrastructure code. To add a package, open a pull request to this file. The pull request names the licence, the state of maintenance, the runtime dependencies of the package, and why a few lines in pulse-kit are not enough.

## Approved

| Package | Version | Licence | Runtime deps | Use |
| --- | --- | --- | --- | --- |
| [zod](https://zod.dev) | `4.6.7` | MIT | none | Schemas and validation. The contract types come from the schemas through `z.infer`. Used by pulse-contract and through it by all services, and by the config parsers of the services. Exact pin. |
| [nodemailer](https://nodemailer.com) | `10.3.1` | MIT-0 | none | SMTP in pulse-notify only. Never use the `raw` option. Pin the latest patched version. |
| pulse-contract | Git SHA | MIT | zod | Internal. `github:lorenzh/pulse-contract#<sha>`. |
| pulse-kit | Git SHA | MIT | none | Internal. `github:lorenzh/pulse-kit#<sha>`. |

## Built-ins before packages

| Need | Use | Instead of |
| --- | --- | --- |
| HTTP client with a timeout | `fetch` with `AbortSignal.timeout` and `AbortSignal.any` | ky |
| Human-readable durations | `Intl.DurationFormat` | pretty-ms |
| Close a server with open connections | `server.closeAllConnections()` from `node:http` | http-terminator |
| Escape HTML | a small own `escapeHtml` | he, escape-goat |

## Not approved now

These packages were checked in the pulse shared-code analysis (#166). Each one is not needed now.

| Package | Reason |
| --- | --- |
| pino | 11 transitive dependencies; the kit logger is enough. |
| @prometheus-io/client | Apache-2.0; the kit metrics registry is enough. |
| p-retry | Backoff is two lines. |
| ky | `fetch` with `AbortSignal` is enough. |
| close-with-grace | The kit has `runService`. |
| @t3-oss/env-core | zod alone is enough. |
| hono | Not now; v5 is at release candidate. |
| date-fns | Consider it later, and only narrowly for calendar validation. |
| dayjs, luxon | No calendar library is needed; dayjs is CommonJS. |
| Temporal polyfills | Temporal ships by default only from Node 26. |
| exponential-backoff | Apache-2.0 and CommonJS. |

Back to the [developer documentation](index.md).
