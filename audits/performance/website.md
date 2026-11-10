# Performance audit: pulse-website (2026-11-10)

## Scope

- Issue: lorenzh/pulse-meta#951, periodic performance audit of `main` of pulse-website.
- Earlier runs: this is the first performance report for the website. The audit-review also read the audit outcome and subsequent Factory comments on issue #951. (`audits/security/website.md` is a different kind of audit and was not used.)
- Examined commits:

| Repository | Commit | What was read |
| --- | --- | --- |
| pulse-website | `a3077ad6b5ae9c680c8032501c0320b7765da6e8` | `main` (newest commit 2026-11-09T00:53Z). Copied to a temporary directory, installed with `bun install --frozen-lockfile`, built, tested, profiled, served on 127.0.0.1 and measured there. |
| pulse-api | `8959e0469a7b7a16e2329e968a7c42e176d287c6` | `bench/budgets.json` (read only) |
| pulse-meta | `6a09e6e9a0e5724b232a34312075b67068007dcc` | audit base |

- Nightly bench that was read: run [42794619243](https://github.com/lorenzh/pulse-api/actions/runs/42794619243), the newest completed `bench.yml` run on `main` (`schedule`, 2026-11-10T09:54Z, api head `8959e04`, conclusion `failure`). Its artifact `bench-out` (`table.md`, `table.json`, `samples.json`) has tables for api, probe, status, notify, contract, kit and config. It has no website table and no website sample (`grep -c website` on the three files: 0, 0, 0). The failures in that run belong to api, probe, status and notify, not to the website.
- `bench/budgets.json` of pulse-api has no `website` entry. So no checklist item has a bench metric for the website, and no A/B with `bench/run.ts` was run. The website has its own size budget, `budget.json`: HTML 60,000 B, CSS 20,000 B, JS 30,000 B gzip per page, at most 2 font files per family. It has no budget for build CPU, test CPU, font bytes, Lighthouse metrics or runtime CPU.
- What "the website" is at run time: a static site. `bun run build` renders every page into `dist/`; only the Preact islands in `src/islands` run, in the browser. The site has no server process of its own and no database. `src/build/static-server.ts` serves `dist/` on 127.0.0.1 only for the checks (`check:a11y`) and is not a deployment (`site.config.ts`: "no deployment exists yet").
- Machine: GitHub-hosted runner, 4 vCPU, 16 GB RAM, Linux, Bun 1.4.0, Node 24.19.0, Google Chrome 156.0.8078.79 (headless), Lighthouse 13.6.0 (installed with npm into a temporary directory, not into the website copy). The build fetched the pinned docs from raw.githubusercontent.com once (the repository's own `bun run build`); every later build read the cache. No pulse system, shared system or production system was contacted.
- CPU of a command: user + system CPU of the child from `Bun.spawn(...).resourceUsage()`, the method of pulse-api `bench/measure.ts`, cross-checked once with `/usr/bin/time` (0.119 s against 0.11 s). It counts the child and the children it waited for. Browser memory and CPU come from `/proc/<pid>/smaps_rollup` (PSS) and `/proc/<pid>/stat` of every Chrome process, plus CDP `Performance.getMetrics` of the page.
- Helpers (not committed, kept outside the repository in a temporary directory and removed at the end):
  - `cpu.ts <cwd> <reps> <label> -- <cmd>`: runs a command N times; prints the exit codes, the child CPU of each run and the median.
  - `prof.ts <top> <files>`: sums the self time per function and per file over `.cpuprofile` files.
  - `growth.ts <copy> <scales>`: the docs part of the build at N times the pinned Markdown (item 3).
  - `serve.ts <copy> <plain|gzip>`: serves `dist/` with the repository's own static server (`plain`), or with the same file mapping plus gzip for text (`gzip`).
  - `lh.sh`, `lhsum.ts`: Lighthouse runs of `/` and `/hosted/`, and their medians.
  - `memrun.ts <copy> <path> <min> <step s> <motion>`: opens one page in Chrome and samples memory and CPU (item 4).
- Results: 5 findings, all `P3`. 4 are issue candidates. No `P1`, no `P2`. No item is blocked. Every size budget passes.

## Checklist

### 1. Queries: `EXPLAIN QUERY PLAN` for every query on the request path and at startup: `not applicable`

The website runs no SQL and has no request path of its own. `grep -rn "sqlite\|SELECT \|bun:sqlite\|createServer\|Bun.serve\|listen(" src scripts --include=*.ts --include=*.tsx | grep -v test` finds only `src/build/static-server.ts:2,48,61`, the local file server of the checks. `package.json` has no database dependency.

### 2. Startup: CPU profile (`bun --cpu-prof`), top functions by self time: `checked`

The website has no service start. Its only process start is the build, `bun run build` (`scripts/build.ts`), so this item profiles the build. The browser side of the start is in item 6 (Lighthouse `bootup-time`).

CPU of the build with a warm docs cache (`bun cpu.ts <copy> <n> <label> -- <cmd>`, exit code 0 in every run):

| Command | Runs | CPU median | Runs (ms) | Wall median |
| --- | --- | --- | --- | --- |
| `bun run build` | 5 | 1,054 ms | 1115, 1044, 1022, 1054, 1067 | 599 ms |
| `bun scripts/build.ts` | 5 | 1,013 ms | 998, 1007, 1027, 1055, 1013 | 576 ms |
| `bun scripts/build.ts`, interleaved with the next row | 10 | 1,002 ms | 971, 1004, 1031, 1037, 1042, 978, 1050, 1000, 994, 953 | |
| `NODE_ENV=production bun scripts/build.ts`, interleaved | 10 | 855 ms | 807, 817, 845, 856, 857, 828, 859, 867, 894, 854 | |
| `/usr/bin/time -v bun run build` (first build, fetches the docs) | 1 | 1.10 s (0.97 user + 0.13 sys) | | 0.82 s, max RSS 126 MiB |

Output of the build: `built 45 files, 39 docs pages, into dist/`. With `NODE_ENV=production` the `dist/` is byte-identical (`diff -r dist-dev dist-prod`, exit code 0).

Profile: `bun --cpu-prof --cpu-prof-interval=100 --cpu-prof-dir=<tmp> --cpu-prof-name=build-<i>.cpuprofile scripts/build.ts`, 5 runs, exit code 0 each. `bun prof.ts 20 build-*.cpuprofile`: 14,280 samples, 3,779.1 ms sampled.

| Self time (5 runs) | Share | Function |
| --- | --- | --- |
| 713.2 ms | 18.9 % | marked's setext-heading regex (`/^(?! {0,3}(?:[*+-]\|\d{1,9}[.)]) …\n {0,3}(=+\|-+) *(?:\n+\|$)/`, native) |
| 180.5 ms | 4.8 % | `anonymous` (native) |
| 102.0 ms | 2.7 % | `DateTimeFormat` (native; `formatUpdated` builds one per docs page, `src/docs/page.ts:78`) |
| 100.7 ms | 2.7 % | marked's inline-text regex (native) |
| 88.9 ms | 2.4 % | `#e` `marked.esm.js:62` |
| 80.8 ms | 2.1 % | `ReactElement` `react-jsx-runtime.development.js:155` |
| 72.9 ms | 1.9 % | `react-dom-server-legacy.browser.development.js:37` |
| 69.5 ms | 1.8 % | `Error` (native) |
| 67.3 ms | 1.8 % | `next` (native) |
| 56.1 ms | 1.5 % | `list` `marked.esm.js:37` |
| 50.3 ms | 1.3 % | `validateProperties$2` `react-dom-server-legacy.browser.development.js:395` (development-only check) |
| 45.9 ms | 1.2 % | `validateProperty` (development-only check) |

By file: native 49.1 %, `marked/lib/marked.esm.js` 17.3 %, `react-dom-server-legacy.browser.development.js` 14.3 %, `react-jsx-runtime.development.js` 3.5 %, `esbuild/lib/main.js` 2.0 %, the compiled `site.mjs` 1.3-1.8 % per run, `src/docs/markdown.ts` 0.5 %.

Result: the build costs about 1.0 s CPU. Two things stand out. The server render runs the development builds of React (17.8 % of the self time; finding 2). Markdown lexing is the largest single cost, because every docs file is lexed four times (finding 4). The esbuild service process is not a waited child, so its CPU may be missing from these numbers; the profile shows only its JS side (2.0 %).

### 3. Costs that grow with data: `checked`

The website has no bench of its own and the pulse-api bench has no website metric. The data of the website is the docs Markdown (39 files, 415 KiB at the pinned SHAs). The docs navigation is a fixed list (`src/docs/nav.ts`), so the page count cannot grow without code changes. This item therefore grows the size of each file: the 10x set joins every file 10 times. `timeout 600 bun growth.ts <copy> 1 10`, exit code 0. Each value is the median of 5 timed repetitions after one warm-up.

| Part (`src/docs`, `src/site.tsx`) | 1x (415 KiB) | 10x (4,149 KiB) | Factor |
| --- | --- | --- | --- |
| one `marked.lexer` per file (the lower bound) | 47.1 ms (60, 47, 47, 46, 50) | 439.1 ms (439, 437, 438, 443, 447) | 9.3x |
| one `renderMarkdown` per file | 97.0 ms (103, 97, 100, 96, 94) | 928.6 ms (927, 929, 927, 929, 932) | 9.6x |
| `buildDocPages`, as the build calls it | 196.2 ms (197, 196, 196, 193, 192) | 1,857.3 ms (1817, 1859, 1850, 1864, 1857) | 9.5x |
| `renderSite`, all 43 HTML pages | 79.5 ms (89, 80, 83, 72, 71) | 185.5 ms (180, 185, 184, 190, 193) | 2.3x |
| total HTML written | 929 KiB | 5,688 KiB | 6.1x |
| largest page, gzip (`docs/contract/`) | 15,066 B | 116,483 B | 7.7x |
| pages over the 60,000 B HTML budget | 0 | 4 | |

In the original measurements across the two sizes, each cost grows by less than the 10x increase in Markdown; two sizes do not establish asymptotic complexity. In the original measurements, `buildDocPages` costs about 2.0x one `renderMarkdown` and 4.2x one lexer pass (finding 4). An identity-link render is a reference cost, not an output-equivalent optimized build. The HTML budget has about 4x headroom over the largest page today.

Per docs page, the docs sidebar (`<nav aria-label="Documentation">`) holds all 39 links: 2,903 B raw on `docs/kit/`. All navigation blocks together add 852 B gzip to that 6,228 B gzip page (`bun -e` that removes the `<nav>` blocks and gzips again). This part grows with the page count, not with the file size. Note 3.

Cost of the browser-side network animation: `buildNetwork` caps the nodes at 14 receivers and 40 senders (`src/lib/network.ts:96-97`), so the drawing does not grow with the viewport beyond that cap.

### 4. Memory over time: `checked`

The website has no server process, so "steady load" is the browser page that stays open: Home in Chrome at 1280 x 800, visible, with animations on (`reducedMotion: "no-preference"`). Its islands run all the time: the network canvas at about 30 frames per second (`src/lib/throttle.ts:2`) and the live preview with one tick per second. N = 5 minutes, one sample every 30 s. Command: `timeout 600 bun memrun.ts <copy> / 5 30 no-preference`, exit code 0.

| t | JS heap used | DOM nodes | Listeners | Renderer PSS | GPU PSS | All Chrome PSS | Chrome CPU (cumulative) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 s | 1.07 MiB | 908 | 12 | 159.3 MiB | 38.7 MiB | 415.0 MiB | 1.53 s |
| 60 s | 0.98 MiB | 908 | 12 | 148.3 MiB | 36.2 MiB | 401.4 MiB | 7.69 s |
| 120 s | 1.05 MiB | 908 | 12 | 145.8 MiB | 36.2 MiB | 397.7 MiB | 13.73 s |
| 180 s | 1.44 MiB | 908 | 12 | 147.4 MiB | 36.2 MiB | 399.4 MiB | 19.63 s |
| 240 s | 1.05 MiB | 908 | 12 | 149.5 MiB | 36.2 MiB | 401.6 MiB | 25.65 s |
| 300 s | 1.44 MiB | 908 | 12 | 148.6 MiB | 36.2 MiB | 401.5 MiB | 31.62 s |

Renderer PSS fell from 159.3 to 148.6 MiB (-6.7 %), and all Chrome processes from 415.0 to 401.5 MiB. The JS heap moves between 0.98 and 1.64 MiB in a GC sawtooth, and DOM nodes and listeners stay constant. The five-minute PSS endpoint is below its start; this does not exclude slower leaks. These original samples are PSS; the audit-review below adds the requested RSS measurement.

CPU does not stop, though. Over the 300 s Chrome used 30.09 s CPU, 10.0 % of one core (renderer 5.1 %, GPU process 4.9 %); the page's main-thread task time was 3.1 %. Baselines measured the same way:

| Page and setting | Duration | Chrome CPU, share of one core | Renderer PSS start → end |
| --- | --- | --- | --- |
| Home, animations on | 300 s | 10.0 % | 159.3 → 148.6 MiB |
| Home, animations on, scrolled to the end (y = 5778) | 60 s | 10.1 % | 160.8 → 146.8 MiB |
| Hosted, animations on, scrolled to the end (y = 3546) | 60 s | 11.0 % | 160.1 → 148.2 MiB |
| Home, reduced motion | 60 s | 0.3 % | 159.2 → 144.9 MiB |
| `/docs/api/rest-api/` (no animation) | 60 s | 0.3 % | 156.8 → 137.6 MiB |

The canvas animation costs about 10 % of a core for as long as Home or Hosted is open and visible, wherever the reader has scrolled to (finding 1). Headless Chrome on the runner renders with a software GPU, so the GPU share depends on the machine.

**Audit-review: requested RSS measurement.** `timeout 480 bun memory.ts <copy>`, exit 0. Home stayed visible at 1280 x 800 in headless Chrome 156, with animations on, for N = 5 minutes; 11 samples were taken every 30 seconds. Requests outside the local server were blocked. CDP `SystemInfo.getProcessInfo` supplies process IDs and CPU counters; `Rss` in `/proc/<pid>/smaps_rollup` supplies RSS; page metrics are from CDP `Performance.getMetrics`.

| Time | Sum of renderer RSS | Sum of all Chrome RSS | JS heap | Nodes | Listeners |
| --- | --- | --- | --- | --- | --- |
| 0 s | 516.8 MiB | 1115.3 MiB | 1.49 MiB | 934 | 12 |
| 60 s | 509.5 MiB | 1106.0 MiB | 1.81 MiB | 908 | 12 |
| 120 s | 515.0 MiB | 1111.7 MiB | 1.14 MiB | 908 | 12 |
| 180 s | 517.8 MiB | 1114.8 MiB | 1.61 MiB | 908 | 12 |
| 240 s | 519.2 MiB | 1117.0 MiB | 1.05 MiB | 908 | 12 |
| 300 s | 519.8 MiB | 1117.9 MiB | 1.53 MiB | 908 | 12 |

Renderer values sum all CDP-reported renderer processes, including spare renderers. Summed RSS double-counts shared pages and must not be compared directly with PSS. Total Chrome RSS changed by +2.6 MiB (+0.23%); it ranged from 1,106.0 to 1,117.9 MiB. This five-minute window cannot rule out slow leaks or distinguish allocator retention from a leak. CPU was 10.44% of one core; the single 60-second reduced-motion baseline was 0.22%, corroborating finding 1. The full review samples are in `review.memory` in the JSON.

### 5. Tests: CPU time per test file; slowest files: `checked`

The original audit measured `bun run test` at 609 ms CPU (median of 5, 195 pass, 0 fail, 30 files). The audit-review ran it twice: 665.699 and 669.854 ms CPU, exit code 0, with 195 pass and 0 fail each time. Coverage settings were unchanged.

The audit-review also ran `bun test ./<file>` once for each of the 30 files below. CPU is child user + system from `Bun.spawn(...).resourceUsage()`, in milliseconds; it may omit the esbuild service CPU. All tests pass. Nine single-file commands exit 1 because of the unchanged 80 % line-coverage gate; those are measurement exit codes, not test failures. This table supplies the individual values omitted by the original report's grouped range and corrects the Home, Hosted and hover-scan test counts.

| File | CPU (ms), 1 run | Exit code | Passing tests |
| --- | --- | --- | --- |
| `src/site.test.ts` | 327.206 | 1 | 2 |
| `src/build/hover-scan.test.ts` | 271.216 | 0 | 7 |
| `src/content/home.test.ts` | 250.243 | 0 | 11 |
| `src/content/hosted.test.ts` | 232.838 | 0 | 9 |
| `src/docs/page.test.ts` | 92.306 | 1 | 15 |
| `src/build/static-server.test.ts` | 80.797 | 0 | 3 |
| `src/docs/markdown.test.ts` | 65.408 | 1 | 12 |
| `src/build/csp.test.ts` | 53.011 | 1 | 13 |
| `src/build/links-check.test.ts` | 48.674 | 0 | 10 |
| `src/build/html-refs.test.ts` | 45.412 | 0 | 7 |
| `src/lib/network.test.ts` | 42.377 | 0 | 10 |
| `src/build/url-safety.test.ts` | 41.087 | 1 | 8 |
| `src/docs/fetch.test.ts` | 38.861 | 0 | 8 |
| `src/build/budget.test.ts` | 37.708 | 1 | 6 |
| `src/build/theme-script.test.ts` | 36.242 | 0 | 4 |
| `src/docs/links.test.ts` | 34.845 | 1 | 7 |
| `src/docs/nav.test.ts` | 34.037 | 1 | 5 |
| `src/docs/highlight.test.ts` | 33.812 | 0 | 5 |
| `src/build/tokens-css.test.ts` | 33.628 | 0 | 4 |
| `src/build/contrast.test.ts` | 33.427 | 0 | 3 |
| `src/build/sitemap.test.ts` | 32.472 | 1 | 2 |
| `src/docs/config.test.ts` | 32.453 | 0 | 4 |
| `src/content/facts.test.ts` | 32.170 | 0 | 10 |
| `src/lib/commands.test.ts` | 31.886 | 0 | 11 |
| `src/docs/bump.test.ts` | 31.622 | 0 | 7 |
| `src/build/meta.test.ts` | 31.143 | 0 | 4 |
| `src/docs/slug.test.ts` | 29.664 | 0 | 2 |
| `src/lib/preview-clock.test.ts` | 29.448 | 0 | 1 |
| `src/lib/throttle.test.ts` | 29.295 | 0 | 2 |
| `src/islands/theme.test.ts` | 27.930 | 0 | 3 |

The slowest files remain `src/site.test.ts`, `src/build/hover-scan.test.ts`, `src/content/home.test.ts` and `src/content/hosted.test.ts`; all four call `loadSite()`. There is no website test CPU budget. Each suite run leaves four compiled site directories in `.build/` (finding 5): the review observed 4 directories / 340 KiB after run 1 and 8 / 676 KiB after run 2. The test wrapper was `timeout 180 bun review.ts <copy> tests`, exit 0; it removed `.build/` before the suite runs and then measured each file serially.

### 6. pulse-website only: JS and CSS size against the budget, and Lighthouse of Home and Hosted: `checked`

**Size against `budget.json`.** `timeout 300 bun run check:budget` after `bun run build`, exit code 0, `budget ok`:

| Page | HTML gzip | CSS gzip | JS gzip | Font files | Font bytes (raw) |
| --- | --- | --- | --- | --- | --- |
| `index.html` (Home) | 7,277 B | 6,334 B | 12,647 B | Space Grotesk 1, JetBrains Mono 2 | 105,656 B |
| `hosted/index.html` | 4,379 B | 6,334 B | 12,736 B | Space Grotesk 1, JetBrains Mono 2 | 105,656 B |
| worst page | 15,108 B (`docs/contract/`) | 6,334 B | 12,736 B (`hosted/`) | | |
| budget | 60,000 B | 20,000 B | 30,000 B | at most 2 per family | none |
| use of the budget | 25 % | 32 % | 42 % | 2 of 2 for JetBrains Mono | |

Every one of the 43 pages is within budget. Docs pages load 9,768-10,281 B gzip of JS. `dist/` holds 61 files and 1.4 MiB. JetBrains Mono is at its limit of 2 font files.

**Lighthouse.** Lighthouse 13.6.0, `--only-categories=performance`, headless Chrome 156, default simulated throttling. The pages were served from `dist/` on 127.0.0.1, 3 runs per page and setting, every run exit code 0:
`CHROME_PATH=/usr/bin/google-chrome lighthouse <origin><page> --only-categories=performance --output=json --chrome-flags="--headless=new --no-sandbox" [--preset=desktop] [--blocked-url-patterns='*.woff2']`.
The repository's static server sends no compression, which a static host would add, so the mobile runs were repeated behind gzip (`serve.ts gzip`). Values are medians, with the 3 runs in brackets.

| Page, setting, server | Score | FCP | LCP | TBT | CLS | Transfer |
| --- | --- | --- | --- | --- | --- | --- |
| Home, mobile, plain | 99 (93, 99, 99) | 904 ms | 2,256 ms (2106, 2256, 2261) | 0 ms (278, 0, 0) | 0.000 | 195,937 B |
| Home, mobile, gzip | 100 (100, 100, 100) | 756 ms | 1,809 ms (1809, 1808, 1811) | 0 ms | 0.000 | 134,945 B |
| Home, desktop, plain | 100 (100, 100, 100) | 247 ms | 528 ms | 0 ms | 0.053 (0.053, 0.053, 0.000) | 195,937 B |
| Hosted, mobile, plain | 100 (100, 100, 100) | 1,387 ms (1509, 1387, 905) | 1,387 ms | 0 ms (30, 0, 0) | 0.033 (0.033, 0.033, 0.005) | 183,732 B |
| Hosted, mobile, gzip | 100 (100, 100, 100) | 755 ms | 755 ms | 0 ms (0, 1, 0) | 0.033 (0.033, 0.033, 0.033) | 132,136 B |
| Hosted, desktop, plain | 100 (100, 100, 100) | 245 ms | 245 ms | 0 ms | 0.014 (0.014, 0.014, 0.014) | 183,732 B |
| Home, mobile, gzip, fonts blocked | 100 | 1,055 ms | 1,209 ms (1235, 1205, 1209) | 0 ms | 0.000 | 28,779 B |
| Hosted, mobile, gzip, fonts blocked | 100 | 1,380 ms | 1,380 ms | 0 ms | 0.000 | 25,970 B |

There is no Lighthouse budget in the website. Every median passes the stated LCP 2.5 s and CLS 0.1 reference limits. TBT is a Lighthouse lab metric, not a Core Web Vital; its medians are 0 ms. The one outlier is TBT 278 ms in the first Home mobile run on the plain server; that run had a lower Lighthouse benchmark index (1961 against 2331-2477 in the others).

What the runs show:
- Home's LCP comes after the web fonts. The LCP element is the lead paragraph (`main#main > section.hero > div.hero-copy > p.t-lead`). Its observed LCP (123-133 ms) comes after the three font files finished loading (76-78 ms), while the observed FCP is 81-83 ms. With the fonts blocked, the LCP element becomes the `h1.t-display` and LCP falls from 1,809 to 1,209 ms, and every CLS falls to 0. Lighthouse names "Web font loaded" as the cause of each layout shift: `span.t-accent` on Hosted, `div.hero-side` on Home desktop (finding 3).
- Fonts are 106,166 B of the 134,945 B Home transfer on gzip (78.7 %). The italic JetBrains Mono file (43,134 B) is loaded only for the `.t-accent` words in the hero heading (`src/styles/tokens.css:256-262`). Note 1.
- JavaScript costs little: `bootup-time` 82-88 ms on simulated mobile, script evaluation 136 ms. In the mobile main-thread time of Home (1,111 ms simulated), 577 ms are attributed to `network-canvas-*.js` (72 ms of it scripting); this is the frame loop of finding 1.

## Issue candidates

All findings are `P3`: each is a measured cost with no budget or a passing budget, and none breaks documented behavior. The candidates are the four that are most worth a fix, ordered by how many readers they reach.

1. **performance-website-2026-11-10-1 (P3): the network canvas animation costs about 10 % of a CPU core for as long as Home or Hosted is visible, wherever the reader has scrolled to.**
   Location: `src/islands/network-canvas.ts:85-108` (frame loop), `:146-149` (the off-screen stop), `src/styles/components.css:397-404` (`.net-canvas { position: fixed; inset: 0 }`).
   Command: `timeout 600 bun memrun.ts <copy> / 5 30 no-preference` (Chrome 156 headless, 1280 x 800), plus 60 s runs with `SCROLL=1` on `/` and `/hosted/`, with `reduce`, and on `/docs/api/rest-api/`. All exit code 0.
   Excerpt: `CPU over 300 s: renderer 5.1 %, gpu 4.9 %, all chrome 10.0 % of one core; page task time 3.1 %`. Scrolled to the end: `all chrome 10.1 %` (Home, y = 5778), `11.0 %` (Hosted, y = 3546). Reduced motion: `0.3 %`. Docs page: `0.3 %`.
   Value 10.0 % of one core (300 s, 11 samples; 10.1 % and 11.0 % in 60 s repeats). Baseline 0.3 % (the same page with reduced motion). Budget: none.
   The canvas is fixed and covers the viewport, so the `IntersectionObserver` never reports it off screen. The loop runs at about 30 fps until the tab is hidden. Each frame clears the canvas and redraws every link and node of the static network (`drawNetwork()` at `:106`) before it draws the pulses. Direction: draw the static network once (for example on a second canvas or a cached bitmap) and redraw only the pulses; or stop the loop once the hero has scrolled out of view, or after some time.

2. **performance-website-2026-11-10-2 (P3): the build renders every page with the development builds of React; production React gives byte-identical output for 15 % less CPU.**
   Location: `src/build/load-site.ts:17-25` (esbuild of `src/site.tsx` with `packages: "external"` and no `NODE_ENV`), `scripts/build.ts:40-41`. The islands are already built with `define: { "process.env.NODE_ENV": '"production"' }` (`src/build/assets.ts:76`).
   Command: `bun cpu.ts <copy> 2 <label> -- bun scripts/build.ts` and `-- env NODE_ENV=production bun scripts/build.ts`, alternated 5 times (10 runs per side), exit code 0 in all 20. `diff -r dist-dev dist-prod`, exit code 0. Profile: `bun --cpu-prof … scripts/build.ts`, 5 runs.
   Excerpt: default 971, 1004, 1031, 1037, 1042, 978, 1050, 1000, 994, 953 ms. Production 807, 817, 845, 856, 857, 828, 859, 867, 894, 854 ms. Profile: `react-dom-server-legacy.browser.development.js` 14.3 %, `react-jsx-runtime.development.js` 3.5 % of the self time, including `validateProperties$2`, `validateProperty` and `warnUnknownProperties`.
   Value 1,002 ms CPU per build (median of 10). Baseline 855 ms with `NODE_ENV=production` (median of 10, -147 ms, -14.7 %). Budget: none for the website build.
   Direction: set `NODE_ENV=production` for the server render of the build (for example in `scripts/build.ts`, or with a `define` in `load-site.ts` for the build only), so tests can keep the development checks.

3. **performance-website-2026-11-10-3 (P3): Home's simulated mobile LCP is about 0.6 s lower with fonts blocked; font-related layout shifts remain below 0.1.**
   Location: `src/styles/fonts.css:23-32` (`"Space Grotesk Fallback"` with `local("Arial")` and `"JetBrains Mono Fallback"` with `local("Courier New")`, both only `size-adjust: 100%`, with no ascent, descent or line-gap override). The fonts are not preloaded (`grep -rn preload src` finds nothing).
   Command: `lighthouse <origin>/ --only-categories=performance` (mobile, gzip server), 3 runs with fonts and 3 with `--blocked-url-patterns='*.woff2'`, and the same for `/hosted/` and with `--preset=desktop`. Exit code 0 in all runs.
   Excerpt: Home mobile LCP 1809, 1808, 1811 ms with fonts against 1235, 1205, 1209 ms without. LCP element `p.t-lead` with fonts, `h1.t-display` without. Hosted mobile CLS 0.033, 0.033, 0.033 with fonts, 0 without. Home desktop CLS 0.053 in 2 of 3 runs. `layout-shifts` causes: `Web font loaded` (all three font files).
   Value: Home mobile LCP 1,809 ms (median of 3; 2,256 ms on the uncompressed repository server), CLS 0.033 (Hosted mobile) and 0.053 (Home desktop). Repetitions 3 per setting. Baseline: the same pages with the fonts blocked, LCP 1,209 ms and CLS 0. Budget: none in `budget.json`; Core Web Vitals "good" limits LCP 2.5 s and CLS 0.1, which pass.
   Blocking fonts changes both transfer bytes and text geometry, including the LCP element. This comparison does not isolate font-display swap or establish the savings from metric-matched fallbacks; these are synthetic lab results. The runner has no Arial and no Courier New (`fc-list | grep -i -E "arial|courier"` is empty; `fc-match Arial` gives Liberation Sans), so the size of the shift depends on the reader's system fonts. Direction: give the fallback faces metric overrides (`ascent-override`, `descent-override`, `line-gap-override` and a measured `size-adjust`) for the fonts they stand in for, and consider a preload for the Space Grotesk file that the hero text uses.

4. **performance-website-2026-11-10-4 (P3): the build runs four lexer passes per docs source, including a full render used only to collect heading ids.**
   Location: `src/docs/page.ts:38` (first pass: a full `renderMarkdown` only to collect heading ids) and `:47` (second pass); `src/docs/markdown.ts:141-142` (`marked.parse(source)`, then `marked.lexer(source)` again to find the first paragraph).
   Command: `timeout 600 bun growth.ts <copy> 1 10`, exit code 0; build profile as in item 2.
   Excerpt: `scale 1x: 39 sources, 415 KiB Markdown … marked.lexer once per source 47.1 ms … renderMarkdown once per source 97.0 ms … buildDocPages (as the build) 196.2 ms`; `scale 10x: … 439.1 ms … 928.6 ms … 1857.3 ms`. Profile: marked's setext-heading regex is the top function by self time (713.2 ms of 3,779.1 ms over 5 builds, 18.9 %).
   Value 196.2 ms at 1x and 1,857.3 ms at 10x (median of 5 each). Baseline: one `renderMarkdown` per file, 97.0 ms and 928.6 ms. Budget: none.
   The measurements and source show duplicate work, but do not prove a fixed 2x overhead or the savings of an optimized build. Direction: consider reusing tokens for the heading ids, HTML and first paragraph, while preserving cross-document anchor validation.

## Notes

Findings that are not issue candidates:

- **performance-website-2026-11-10-5 (P3, note): each `bun run test` leaves 4 compiled site copies (84 KiB each) in `.build/` that no test removes, so the directory grows with every run.** Location: `src/build/load-site.ts:13-15` (`mkdtemp(path.join(root, ".build", "site-"))`, never removed). Only `scripts/build.ts:47` clears `.build/`. Command: `rm -rf .build; for i in 1 2 3; do bun run test; ls .build | wc -l; du -sk .build; done`, exit code 0. Excerpt: `after run 1: 4 dirs, 340 KiB`, `after run 2: 8 dirs, 676 KiB`, `after run 3: 12 dirs, 1012 KiB`. Value 336 KiB per run (3 runs). Baseline 0 after `bun run build`. Budget: none. The repository's AGENTS.md asks that "each test writes only to its own `mkdtemp` directory". These are `mkdtemp` directories, but inside the repository and never cleaned. Developer disk only; it does not affect the site.

Other notes (no finding):

1. Fonts are 78.7 % of Home's transfer behind gzip (106,166 of 134,945 B). The italic JetBrains Mono (43,134 B) is used only for the `.t-accent` words of the hero headings. `budget.json` limits the number of font files per family, not their bytes; `check:budget` prints 105,656 B of fonts per page but cannot fail on them.
2. The repository's static server (`src/build/static-server.ts`) sends no `content-encoding` and no cache headers. It serves only the checks, but Lighthouse numbers taken with it overstate the transfer: Home moves 195,937 B plain against 134,945 B with gzip, and its mobile LCP is 2,256 against 1,809 ms. The real host is not chosen yet (`site.config.ts`).
3. The docs sidebar repeats all 39 links on every docs page (2,903 B raw; all `<nav>` blocks together are 852 B gzip of a 6,228 B gzip page). This grows linearly with the page count and is far from the HTML budget.
4. `formatUpdated` (`src/docs/page.ts:77-80`) builds a new `Intl.DateTimeFormat` per docs page: 102.0 ms of self time over 5 profiled builds, about 20 ms per build.
5. Run alone, nine test files exit with code 1 although all their tests pass, because the coverage gate of `bunfig.toml` (80 % lines) applies to each single-file run. This changes the exit code of `bun test <file>`, which the AGENTS.md table names as the command for one file.
6. The pulse-api nightly bench does not measure the website. If the website should get build, test or Lighthouse budgets, they would have to be added to pulse-api `bench/budgets.json` or to the website's own `budget.json`. That is a decision for the owner, not a finding.
7. Measurement limits: the build CPU from `resourceUsage()` may miss the esbuild service process, which is not a waited child. Headless Chrome renders with a software GPU, so the GPU share in finding 1 (4.9 %) depends on the machine; all CPU shares and timings are specific to the runner and Chrome settings.

## Audit-review (2026-11-10)

Started at 15:29:34 UTC. The website and API clone HEADs match the examined SHAs. The meta audit base `6a09e6e` is the parent of the report commit `24b9e59`; the later HEAD contains this report. The JSON parses and the two reports agree on all five finding IDs, all severities and candidates, and all six checklist statuses. Every required performance field is present. There are no P1/P2 findings to reproduce. All five P3 findings were spot-checked; none was removed or regraded, and four remain candidates.

The review fills the requested RSS measurement and reports all 30 test-file CPU times in the checklist above. It corrects the original Home/Hosted/hover-scan test counts to 11/9/7. Finding 3 now separates the observed font comparison from claims about its cause. Finding 4 retains the four lexer passes while removing claims of a fixed 2x overhead or proven optimization savings.

Commands re-run in the temporary website copy (all wrapper commands exit 0):

| Command | Review evidence |
| --- | --- |
| `jq . audits/performance/website.json`; source/metadata checks | JSON valid; six matching statuses; website/API commits match; required fields complete; four candidates. |
| `gh run list --repo lorenzh/pulse-api --workflow bench.yml --branch main --status completed --limit 3 --json databaseId,event,createdAt,headSha,conclusion`; `gh run download 42794619243 --repo lorenzh/pulse-api --name bench-out --dir <tmp>/bench-out` | The named run is the latest completed scheduled bench; no website metric in its three artifact files or API budgets. Both commands exit 0. |
| `bun run build && bun run check:budget` | Exact original worst-page gzip sizes: HTML 15,108 B, CSS 6,334 B, JS 12,736 B; `budget ok`. |
| `timeout 180 bun review.ts <copy> cpu`; `diff -r dist-dev dist-prod` | Two serial rounds per side: development CPU 1,075.055 / 1,083.612 ms; production 885.541 / 915.473 ms (16.6% lower mean). Every child exits 0; dist is byte-identical, diff exits 0. |
| `bun --cpu-prof --cpu-prof-interval=100 --cpu-prof-dir=<tmp>/profiles --cpu-prof-name=review.cpuprofile scripts/build.ts` | One profile, exit 0: 2,914 samples, 790.138 ms sampled. Aggregated top self times: marked setext-heading regex 142.129 ms (18.0%), anonymous 71.899 ms, DateTimeFormat 24.072 ms, Error 23.029 ms, marked #e 22.654 ms. Development React frames are present. |
| `timeout 180 bun review.ts <copy> growth` | Two timed rounds per case and size after warm-up. buildDocPages: 228.259 / 219.482 ms at 1x, 1,584.801 / 1,604.342 ms at 10x; one identity-link render: 109.499 / 125.843 ms and 1,040.800 / 1,367.276 ms. The ratio varies, supporting the narrower duplicate-work finding. |
| `timeout 180 bun review.ts <copy> tests` | Two suites: 195 pass / 0 fail, exit 0 each; 4 then 8 compiled directories, 340 then 676 KiB. The 30 per-file commands and their actual exit codes appear above and in JSON `review.testFiles`; nine exit 1 solely on coverage. |
| `timeout 480 bun memory.ts <copy>` | Five-minute RSS run and 60-second reduced-motion baseline, exit 0; full values and method above and in `review.memory`. |
| `timeout 420 bun lighthouse.ts <copy>` | Five CLI runs with Lighthouse 13.6.0, exit 0 each; metrics below. |

The review CPU wrapper uses child user + system CPU from `Bun.spawn(...).resourceUsage()`; the growth wrapper uses `performance.now()`. The browser wrapper uses CDP process IDs/CPU counters plus Linux smaps RSS and page metrics. The Lighthouse wrapper serves the same dist file mapping with gzip for text on 127.0.0.1. Its CLI is `lighthouse <origin><page> --only-categories=performance --output=json --chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage"`, adding `--blocked-url-patterns='*.woff2'` on the blocked side. The CPU, test, growth, steady-load and Lighthouse measurements ran serially.

| Mobile page, gzip | Round | Score | LCP | TBT | CLS | Exit |
| --- | --- | --- | --- | --- | --- | --- |
| Home | 1 | 100 | 1808.0 ms | 0 ms | 0.0000 | 0 |
| Home, fonts blocked | 1 | 100 | 1213.1 ms | 0 ms | 0.0000 | 0 |
| Home | 2 | 100 | 1809.5 ms | 0 ms | 0.0000 | 0 |
| Home, fonts blocked | 2 | 100 | 1210.3 ms | 0 ms | 0.0000 | 0 |
| Hosted | 1 | 100 | 752.5 ms | 0 ms | 0.0326 | 0 |

The review confirms `p.t-lead` as Home's LCP element with fonts and `h1.t-display` without them; Hosted's `layout-shifts` names web fonts as the cause. Blocking fonts changes both transfer bytes and text geometry, including the LCP element. This comparison does not isolate font-display swap or establish the savings from metric-matched fallbacks; these are synthetic lab results. Desktop Lighthouse results remain those of the original audit.

Limits: the five-minute memory window cannot exclude slower leaks; all timings are runner-specific, including Chrome's software GPU and potentially uncounted esbuild service CPU. No website nightly-bench metric or CPU/Lighthouse budget exists. Temporary helpers, measurement outputs, installed tooling and copies were removed, and local services were stopped. No product code, issues, comments or labels were changed.
