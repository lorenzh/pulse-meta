# Approved packages

The pulse repositories may use a runtime dependency only when it is on this list. Pin every entry to an exact version, never a range. Use pulse-kit, pulse-contract, a Bun built-in (such as `bun:sqlite`), a `node:` module that Bun provides, or a package from this list before you write infrastructure code. To add a package, open a pull request to this file. The pull request names the licence, the state of maintenance, the runtime dependencies of the package, and why a few lines in pulse-kit are not enough.

## Approved

| Package | Version | Licence | Runtime deps | Use |
| --- | --- | --- | --- | --- |
| [zod](https://zod.dev) | `4.6.7` | MIT | none | Schemas and validation. The contract types come from the schemas through `z.infer`. Used by pulse-contract and through it by all services. The service config parsers move to it in #310. Exact pin. |
| [nodemailer](https://nodemailer.com) | `10.3.1` | MIT-0 | none | SMTP in pulse-notify only. Never use the `raw` option. Pin the latest patched version. |
| [@fontsource-variable/jetbrains-mono](https://fontsource.org/fonts/jetbrains-mono), [@fontsource-variable/space-grotesk](https://fontsource.org/fonts/space-grotesk) | `5.3.0` | OFL-1.1 | none | Font files that pulse-status serves itself (the CSP allows only same-origin fonts). Assets only, no code. Exact pin (status still uses `^`; to be fixed). |
| [react](https://react.dev), [react-dom](https://react.dev) | `19.3.1` | MIT | react: none; react-dom: scheduler | pulse-website only: renders every page to static HTML at build time. Never shipped to the browser (islands use preact/compat). Exact pin. |
| [preact](https://preactjs.com) | `11.1.0` | MIT | none | pulse-website only: hydrates the interactive islands in the browser through `preact/compat`. Exact pin. |
| [marked](https://marked.js.org) | `18.1.2` | MIT | none | pulse-website only, build time: renders the repos' Markdown docs. Raw HTML in the source is escaped. Exact pin. |
| [esbuild](https://esbuild.github.io) | `0.28.2` | MIT | none (platform binary as optional dependency) | pulse-website only, build time: compiles TSX and bundles the islands. Dev dependency. |
| [playwright](https://playwright.dev) | `1.64.1` | Apache-2.0 | playwright-core | pulse-website and pulse-status, tests only: accessibility and keyboard checks in Chromium. Dev dependency, never in the built site or the image. |
| [@axe-core/playwright](https://github.com/dequelabs/axe-core-npm) | `4.14.0` | MPL-2.0 | axe-core | pulse-website and pulse-status, tests only: axe WCAG 2.2 AA checks in the Playwright run. Dev dependency, never in the built site or the image. Same version in both repositories. |
| [@types/bun](https://www.npmjs.com/package/@types/bun) | `1.4.0` | MIT | bun-types | Types for the Bun runtime and `bun:test`. A dependency of pulse-config, which sets `"types": ["node", "bun"]`; also a dev dependency of contract, kit, api, probe, status and notify. Exact pin, same version as Bun. |
| [eslint](https://eslint.org) | `10.13.0` | MIT | 30 packages (ESLint core, espree, ajv and others) | pulse-config only: a `dependency` there because pulse-config is the shared lint and tsconfig package and ships the lint toolchain to every target (run through its `pulse-eslint` bin). Exact pin. |
| [@typescript-eslint/parser](https://typescript-eslint.io), [@typescript-eslint/eslint-plugin](https://typescript-eslint.io) | `8.72.1` | MIT | parser: 5, eslint-plugin: 8 (mostly `@typescript-eslint/*`) | pulse-config only: a `dependency` there because pulse-config is the shared lint and tsconfig package and ships the lint toolchain to every target (run through its `pulse-eslint` bin). Exact pin. The type-aware rules need it. |
| [eslint-plugin-sonarjs](https://github.com/SonarSource/SonarJS) | `4.2.2` | LGPL-3.0-only | 14 (includes typescript) | pulse-config only: a `dependency` there because pulse-config is the shared lint and tsconfig package and ships the lint toolchain to every target (run through its `pulse-eslint` bin). Exact pin. SonarJS rules, cognitive complexity limit 15. |
| [typescript](https://www.typescriptlang.org) | `6.0.3` | Apache-2.0 | none | pulse-config only: a `dependency` there because pulse-config is the shared lint and tsconfig package and ships the lint toolchain to every target (run through its `pulse-eslint` bin). Exact pin. Type information for the ESLint rules only; targets typecheck with TypeScript 7 as `typescript7`. |
| pulse-contract | Git SHA | MIT | zod | Internal. `github:lorenzh/pulse-contract#<sha>`. |
| pulse-kit | Git SHA | MIT | none | Internal. `github:lorenzh/pulse-kit#<sha>`. |

## Runtime and CI

| Tool | Pin | Use |
| --- | --- | --- |
| Bun | `1.4.0` | Package manager, runtime and test runner of every pulse repository (`packageManager: bun@1.4.0`, `engines.bun: 1.4.0`, `bun.lock`). |
| [oven-sh/setup-bun](https://github.com/oven-sh/setup-bun) | `0c5077e51419868618aeaa5fe8019c62421857d6` (v2.2.0) | Installs Bun in CI, in the reusable `check.yml` of pulse-config and in the `site` job of pulse-website. Pinned by commit SHA. |
| [oven/bun](https://hub.docker.com/r/oven/bun) | `1.4.0-alpine@sha256:07235578f79ef8c6f97d94aee7938e76f5cdba5f21ae5dbfdd3d3d38058437eb` | Base image of the api, probe, status and notify Dockerfiles. Pinned by digest. |

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
| pino | 11 direct dependencies; the kit logger is enough. |
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
