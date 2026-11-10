# Performance audit: pulse-website (2026-11-10)

## Scope

- Issue: lorenzh/pulse-meta#951, periodic performance audit of `main` of pulse-website.
- Earlier runs: the issue has only the Factory claim comment. No earlier performance report of the website exists, so this report is new. (`audits/security/website.md` is a different kind of audit and was not used.)
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

All costs grow linearly with the Markdown size; none grows faster. `buildDocPages` costs 2.0x one `renderMarkdown` and 4.2x one lexer pass at both sizes (finding 4). The HTML budget has about 4x headroom over the largest page today.

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

Memory does not grow. Renderer PSS fell from 159.3 to 148.6 MiB (-6.7 %), and all Chrome processes from 415.0 to 401.5 MiB. The JS heap moves between 0.98 and 1.64 MiB in a GC sawtooth, and DOM nodes and listeners stay constant. No leak.

CPU does not stop, though. Over the 300 s Chrome used 30.09 s CPU, 10.0 % of one core (renderer 5.1 %, GPU process 4.9 %); the page's main-thread task time was 3.1 %. Baselines measured the same way:

| Page and setting | Duration | Chrome CPU, share of one core | Renderer PSS start → end |
| --- | --- | --- | --- |
| Home, animations on | 300 s | 10.0 % | 159.3 → 148.6 MiB |
| Home, animations on, scrolled to the end (y = 5778) | 60 s | 10.1 % | 160.8 → 146.8 MiB |
| Hosted, animations on, scrolled to the end (y = 3546) | 60 s | 11.0 % | 160.1 → 148.2 MiB |
| Home, reduced motion | 60 s | 0.3 % | 159.2 → 144.9 MiB |
| `/docs/api/rest-api/` (no animation) | 60 s | 0.3 % | 156.8 → 137.6 MiB |

The canvas animation costs about 10 % of a core for as long as Home or Hosted is open and visible, wherever the reader has scrolled to (finding 1). Headless Chrome on the runner renders with a software GPU, so the GPU share depends on the machine.

### 5. Tests: CPU time per test file; slowest files: `checked`

Whole suite: `bun run test` (with the coverage of `bunfig.toml`), 195 tests in 30 files, all pass, exit code 0. `bun cpu.ts <copy> 5 "bun run test" -- bun run test`: CPU median 609 ms (605, 609, 618, 588, 609), wall 435 ms. Runtime start alone (`bun -e 0`): 6 ms.

Per file: `bun cpu.ts <copy> 3 <file> -- bun test ./<file>`, 3 runs each. 21 files exit with 0. Nine files (`site`, `docs/page`, `docs/markdown`, `build/csp`, `build/budget`, `build/url-safety`, `docs/links`, `docs/nav`, `build/sitemap`) exit with 1 even though every test passes: run alone, they miss the 80 % line coverage gate of `bunfig.toml`. Each of the nine shows "0 fail" with exit code 1. For `src/site.test.ts`: "2 pass, 0 fail", line coverage 76.86 % ("All files" row), exit 1. With a copy of `bunfig.toml` without `coverageThreshold` (`bun --config=<copy> test ./src/site.test.ts`) the exit code is 0. Note 5.

| File | CPU median | Runs (ms) | Wall | Tests |
| --- | --- | --- | --- | --- |
| `src/site.test.ts` | 289 ms | 289, 287, 291 | 188 ms | 2 |
| `src/content/hosted.test.ts` | 200 ms | 201, 198, 200 | 138 ms | 15 |
| `src/build/hover-scan.test.ts` | 199 ms | 199, 210, 196 | 158 ms | 8 |
| `src/content/home.test.ts` | 198 ms | 195, 199, 198 | 138 ms | 19 |
| `src/docs/page.test.ts` | 87 ms | 84, 87, 89 | 67 ms | |
| `src/build/static-server.test.ts` | 64 ms | 67, 64, 63 | 59 ms | |
| `src/docs/markdown.test.ts` | 59 ms | 59, 59, 60 | 50 ms | |
| `src/build/csp.test.ts` | 51 ms | 49, 51, 51 | 39 ms | |
| `src/build/links-check.test.ts` | 44 ms | 44, 44, 46 | 36 ms | |
| `src/lib/network.test.ts` | 39 ms | 39, 40, 39 | 30 ms | |
| the other 20 files | 27-38 ms each | | 25-34 ms | |

The four slowest files are the four that call `loadSite()` (`src/site.test.ts:47`, `src/content/home.test.ts:8`, `src/content/hosted.test.ts:7`, `src/build/hover-scan.test.ts:48`). `loadSite` compiles `src/site.tsx` with esbuild and imports it: 70 ms CPU alone (`bun cpu.ts <copy> 7 … -- bun loadsite.ts`, 72, 69, 68, 71, 72, 69, 70). The rest of their cost is the React server render in development mode and the coverage. Together they are 886 ms of the 1,851 ms summed over the per-file runs, and each run pays its own runtime start.

There is no test CPU budget for the website (pulse-api `bench/budgets.json` has no `website` entry), so the suite is compared with nothing. Each `bun run test` leaves 4 compiled site copies in `.build/` that no test removes (finding 5).

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

There is no Lighthouse budget in the website. Against the Core Web Vitals limits for "good" (LCP 2.5 s, CLS 0.1, TBT 200 ms), every median passes. The one outlier is TBT 278 ms in the first Home mobile run on the plain server; that run had a lower Lighthouse benchmark index (1961 against 2331-2477 in the others).

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

3. **performance-website-2026-11-10-3 (P3): the web-font swap delays Home's LCP by about 0.6 s on simulated mobile and causes the only layout shifts of Home and Hosted; the fallback faces are not matched to the fonts.**
   Location: `src/styles/fonts.css:23-32` (`"Space Grotesk Fallback"` with `local("Arial")` and `"JetBrains Mono Fallback"` with `local("Courier New")`, both only `size-adjust: 100%`, with no ascent, descent or line-gap override). The fonts are not preloaded (`grep -rn preload src` finds nothing).
   Command: `lighthouse <origin>/ --only-categories=performance` (mobile, gzip server), 3 runs with fonts and 3 with `--blocked-url-patterns='*.woff2'`, and the same for `/hosted/` and with `--preset=desktop`. Exit code 0 in all runs.
   Excerpt: Home mobile LCP 1809, 1808, 1811 ms with fonts against 1235, 1205, 1209 ms without. LCP element `p.t-lead` with fonts, `h1.t-display` without. Hosted mobile CLS 0.033, 0.033, 0.033 with fonts, 0 without. Home desktop CLS 0.053 in 2 of 3 runs. `layout-shifts` causes: `Web font loaded` (all three font files).
   Value: Home mobile LCP 1,809 ms (median of 3; 2,256 ms on the uncompressed repository server), CLS 0.033 (Hosted mobile) and 0.053 (Home desktop). Repetitions 3 per setting. Baseline: the same pages with the fonts blocked, LCP 1,209 ms and CLS 0. Budget: none in `budget.json`; Core Web Vitals "good" limits LCP 2.5 s and CLS 0.1, which pass.
   The runner has no Arial and no Courier New (`fc-list | grep -i -E "arial|courier"` is empty; `fc-match Arial` gives Liberation Sans), so the size of the shift depends on the reader's system fonts. Direction: give the fallback faces metric overrides (`ascent-override`, `descent-override`, `line-gap-override` and a measured `size-adjust`) for the fonts they stand in for, and consider a preload for the Space Grotesk file that the hero text uses.

4. **performance-website-2026-11-10-4 (P3): the build lexes every docs file four times, so `buildDocPages` costs twice one render and four times one lexer pass, at every data size.**
   Location: `src/docs/page.ts:38` (first pass: a full `renderMarkdown` only to collect heading ids) and `:47` (second pass); `src/docs/markdown.ts:141-142` (`marked.parse(source)`, then `marked.lexer(source)` again to find the first paragraph).
   Command: `timeout 600 bun growth.ts <copy> 1 10`, exit code 0; build profile as in item 2.
   Excerpt: `scale 1x: 39 sources, 415 KiB Markdown … marked.lexer once per source 47.1 ms … renderMarkdown once per source 97.0 ms … buildDocPages (as the build) 196.2 ms`; `scale 10x: … 439.1 ms … 928.6 ms … 1857.3 ms`. Profile: marked's setext-heading regex is the top function by self time (713.2 ms of 3,779.1 ms over 5 builds, 18.9 %).
   Value 196.2 ms at 1x and 1,857.3 ms at 10x (median of 5 each). Baseline: one `renderMarkdown` per file, 97.0 ms and 928.6 ms. Budget: none.
   Cost grows linearly with the Markdown, at about twice the necessary cost. Direction: lex each source once and reuse the tokens, for the heading ids, for the HTML and for the first paragraph.

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
7. Measurement limits: the build CPU from `resourceUsage()` may miss the esbuild service process, which is not a waited child. Headless Chrome renders with a software GPU, so the GPU share in finding 1 (4.9 %) depends on the machine; the renderer share (5.1 %) and the main-thread task time (3.1 %) do not depend on the GPU.
