# Approved packages

The pulse repositories may use a runtime dependency only when it is on this list. Dev dependencies are listed too, in their own table below. Pin every entry to an exact version, never a range. Use pulse-kit, pulse-contract, a Bun built-in (such as `bun:sqlite`), a `node:` module that Bun provides, or a package from this list before you write infrastructure code. To add a package, open a pull request to this file. The pull request names the licence, the state of maintenance, the runtime dependencies of the package, and why a few lines in pulse-kit are not enough.

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
| [@playwright/test](https://playwright.dev), [playwright](https://playwright.dev) | `1.64.1` | Apache-2.0 | @playwright/test: playwright; playwright: playwright-core | Tests only: accessibility and keyboard checks in Chromium. `@playwright/test` in pulse-website, `playwright` (library API) in pulse-status. Dev dependency, never in the built site or the image. Exact pin, same version for both. |
| [@axe-core/playwright](https://github.com/dequelabs/axe-core-npm) | `4.14.0` | MPL-2.0 | axe-core | pulse-website and pulse-status, tests only: axe WCAG 2.2 AA checks in the Playwright run. Dev dependency, never in the built site or the image. Same version in both repositories. |
| [@types/bun](https://www.npmjs.com/package/@types/bun) | `1.4.0` | MIT | bun-types | Types for the Bun runtime and `bun:test`. A dependency of pulse-config, which sets `"types": ["node", "bun"]`; also a dev dependency of contract, kit, api, probe, status, notify and console. Exact pin, same version as Bun. |
| [eslint](https://eslint.org) | `10.13.0` | MIT | 30 packages (ESLint core, espree, ajv and others) | pulse-config only: a `dependency` there because pulse-config is the shared lint and tsconfig package and ships the lint toolchain to every target (run through its `pulse-eslint` bin). Exact pin. |
| [@typescript-eslint/parser](https://typescript-eslint.io), [@typescript-eslint/eslint-plugin](https://typescript-eslint.io) | `8.72.1` | MIT | parser: 5, eslint-plugin: 8 (mostly `@typescript-eslint/*`) | pulse-config only: a `dependency` there because pulse-config is the shared lint and tsconfig package and ships the lint toolchain to every target (run through its `pulse-eslint` bin). Exact pin. The type-aware rules need it. |
| [eslint-plugin-sonarjs](https://github.com/SonarSource/SonarJS) | `4.2.2` | LGPL-3.0-only | 14 (includes typescript) | pulse-config only: a `dependency` there because pulse-config is the shared lint and tsconfig package and ships the lint toolchain to every target (run through its `pulse-eslint` bin). Exact pin. SonarJS rules, cognitive complexity limit 15. |
| [typescript](https://www.typescriptlang.org) | `6.0.3` | Apache-2.0 | none | pulse-config only: a `dependency` there because pulse-config is the shared lint and tsconfig package and ships the lint toolchain to every target (run through its `pulse-eslint` bin). Exact pin. Type information for the ESLint rules only; targets typecheck with TypeScript 7 as `typescript7`. |
| pulse-contract | Git SHA | MIT | zod | Internal. `github:lorenzh/pulse-contract#<sha>`. |
| pulse-kit | Git SHA | MIT | none | Internal. `github:lorenzh/pulse-kit#<sha>`. |

## Dev dependencies

Never in a built image or site. Exact pin, same version in every repository that uses them. Playwright, axe-core, esbuild and @types/bun are listed above.

| Package | Version | Licence | Use |
| --- | --- | --- | --- |
| [@biomejs/biome](https://biomejs.dev) | `2.6.3` | MIT OR Apache-2.0 | Format and lint in every repository. |
| [lefthook](https://github.com/evilmartians/lefthook) | `2.2.2` | MIT | Git hooks in every repository. |
| [@types/node](https://www.npmjs.com/package/@types/node) | `26.6.6` | MIT | Node types in every repository. |
| typescript7 (`npm:typescript@7.0.2`) | `7.0.2` | Apache-2.0 | Typecheck with TypeScript 7 under the alias `typescript7`. |
| [@types/nodemailer](https://www.npmjs.com/package/@types/nodemailer) | `8.0.2` | MIT | pulse-notify only. |
| [@types/react](https://www.npmjs.com/package/@types/react), [@types/react-dom](https://www.npmjs.com/package/@types/react-dom) | `19.3.0` | MIT | pulse-website only. |

## Runtime and CI

| Tool | Pin | Use |
| --- | --- | --- |
| Bun | `1.4.0` | Package manager, runtime and test runner of every pulse repository (`packageManager: bun@1.4.0`, `engines.bun: 1.4.0`, `bun.lock`). |
| [oven-sh/setup-bun](https://github.com/oven-sh/setup-bun) | `0c5077e51419868618aeaa5fe8019c62421857d6` (v2.2.0) | Installs Bun in CI, in the reusable `check.yml` of pulse-config and in the `site` job of pulse-website. Pinned by commit SHA. |
| [actions/checkout](https://github.com/actions/checkout) | `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` (v5.1.0) | Checkout in the pulse-meta workflows, always with `persist-credentials: false`. Pinned by commit SHA. |
| [actions/checkout](https://github.com/actions/checkout) | `3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1) | Checkout in the target repositories (`check.yml` and `release.yml` of pulse-config, the service `ci.yml` jobs, the pulse-deploy `ci.yml`), always with `persist-credentials: false`. Pinned by commit SHA. |
| [actions/attest](https://github.com/actions/attest) | `1e69f48acb82d1966a394da916b4c1698aa569d6` (v4.2.2) | GitHub artifact attestation (SLSA build provenance) of the released images, in the `publish` job of the reusable `release.yml` of pulse-config only (#527). `push-to-registry: true`, `create-storage-record: false`. Pinned by commit SHA. |
| [actions/setup-node](https://github.com/actions/setup-node) | `249970729cb0ef3589644e2896645e5dc5ba9c38` (v6.5.0) | Node for the Factory CLI in the pulse-meta workflows. Pinned by commit SHA. |
| [actions/upload-pages-artifact](https://github.com/actions/upload-pages-artifact) | `7b1f4a764d45c48632c6b24a0339c27f5614fb0b` (v4.0.0) | Factory report build in pulse-meta. Pinned by commit SHA. |
| [actions/deploy-pages](https://github.com/actions/deploy-pages) | `d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e` (v4.0.5) | Factory report publish in pulse-meta. Pinned by commit SHA. |
| [oven/bun](https://hub.docker.com/r/oven/bun) | `1.4.0-alpine@sha256:07235578f79ef8c6f97d94aee7938e76f5cdba5f21ae5dbfdd3d3d38058437eb` | Base image of the api, probe, status, notify and console Dockerfiles. Also the helper image of the pulse-deploy setups (`secrets-init`, demo init and targets, e2e target), pinned once in its `common/services.yaml` (#528). Pinned by digest. |
| [alpine/openssl](https://hub.docker.com/r/alpine/openssl) | `@sha256:1c361a204e9791bec6202bccbd1065eafaa65cb5a1a9a06ae000238569fba6a2` | Self-signed TLS target of the Compose demo (`openssl s_server`). Moved from pulse-api's `compose.yaml` to pulse-deploy's `common/services.yaml` (#528). Demo only. Pinned by digest. |
| [axllent/mailpit](https://github.com/axllent/mailpit) | `v1.32.0@sha256:0790692be935ea4420d085694f7985b1f692ca6a8771ab0e0bd8ba75ac180498` | MIT. Mail catcher of the pulse-deploy `demo` setup only (#528): receives notify's email channel over SMTP without login on the Compose network, UI and API on `127.0.0.1` only. Multi-arch index (linux/amd64, linux/arm64). Pinned by digest. |
| [moby/buildkit](https://hub.docker.com/r/moby/buildkit) | `v0.34.1@sha256:99368f3e46177c6405b9740e4461d91cee004128daeecca78d4ceac50ec1da5c` | BuildKit for the `docker-container` builder (`docker buildx create --driver-opt image=…`) in the build jobs of the reusable `release.yml` of pulse-config (#527). Multi-arch index. Pinned by digest. |
| GitHub-hosted runners | `ubuntu-24.04`, `ubuntu-24.04-arm` | `ubuntu-24.04-arm` builds and checks the arm64 image natively (PR `docker` job and `release.yml`); no QEMU (#527). |

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
