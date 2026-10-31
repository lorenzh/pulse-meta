# Spec #544: website: harden the docs renderer, cache, static server and config validator

## Goal

Fix six findings from the security audit `audits/security/website.md` (issue #539, report PR #540) in pulse-website:
- untrusted keys (a code-fence language, a `docs:bump` argument) never reach inherited `Object.prototype` members;
- every failure of the docs renderer and the docs config validator is a named error;
- the docs cache stays correct when a build is interrupted;
- the `check:a11y` static server stays up when a request carries a malformed escape.

Sources: the issue, the issue review `.factory/work/544/issue-review.md` (its assumptions are adopted below) and the website clone `.repos/website` at `dcb6162` (still `main`). Every line reference below was re-read in that clone.

## Scope

Only `website` (`lorenzh/pulse-website`): `src/docs/highlight.ts`, `src/docs/markdown.ts`, `src/docs/bump.ts`, `scripts/bump-docs.ts`, `src/docs/fetch.ts`, `src/build/static-server.ts`, `src/docs/config.ts`, their tests, and one README line.

## Non-goals

- The audit's notes N1 to N11 (link-check attributes, size caps, `REPO` accepting `..`, `isSafeUrl` input types, `dist/` atomicity, browser pin and the rest).
- A content hash or length check on a cache hit.
- No change to dependencies, CSP, `budget.json`, `biome.json`, the ESLint config, `tsconfig.json` or CI.
- No change to the rendered output of any language that is published today (`json`, `jsonc`, `yaml`, `yml`, `sh`, `bash`, `shell`, `text`, `console` and any other own-key or unknown language).
- No other target changes.

## Decisions on the review's open points

1. **Lookup form.** `LANGUAGES` (`highlight.ts:80`) and `LANGUAGE_LABEL` (`markdown.ts:43`) become `ReadonlyMap<string, …>`, read with `.get()`. `DOC_REPOS` (`bump.ts:4`) stays an exported plain object, because `bump.test.ts:58` reads `DOC_REPOS.api` and the key order is used for the sidebar order and the error message. Every lookup of `DOC_REPOS` by an untrusted key goes through `Object.hasOwn`.
2. **`withRepo`** (`bump.ts:53-63`): the `k in merged` / `k in DOC_REPOS` checks become `Object.hasOwn(merged, k)` / `Object.hasOwn(DOC_REPOS, k)`. A config key such as `constructor` (it passes `KEY = /^[a-z]+$/`, `config.ts:17`) then counts as an extra key and is kept, not dropped.
3. **SEC-6 testability.** New pure export in `src/docs/bump.ts`: `repoForKey(key: string): string`. It returns `DOC_REPOS[key]` when `Object.hasOwn(DOC_REPOS, key)`. Otherwise it throws `BumpError` with the message that is used today (`scripts/bump-docs.ts:40`): `unknown repo "<key>", expected one of api, probe, status, notify, contract, kit`. `scripts/bump-docs.ts` calls it instead of its inline lookup. The thrown class changes from `Error` to `BumpError`; the message stays.
4. **SEC-3 testability.** `loadDocFile` gets an optional `writeFile` dependency in `deps` (`deps: { fetch; cacheDir; writeFile?: (file: string, text: string) => Promise<void> }`), defaulting to `writeFile` of `node:fs/promises`. The cache write is:
   - write the text to a temp file in the same directory as the final file, named `<final basename>.<pid>.<random hex>.tmp`;
   - then `rename` it to the final path;
   - when the write or the rename fails, remove the temp file (best effort, `rm` with `force: true`) and re-throw the original error wrapped as `DocsFetchError("writing the docs cache <final path> failed", { cause })`.
   The read path stays as it is: only the final path counts as a hit. A `.tmp` file that a `kill -9` leaves behind is never read. It is not cleaned up either; `.cache/` is ignored by git.
5. **SEC-4.** `fileForUrl` (`static-server.ts:16-21`) catches only `URIError` from `decodeURIComponent` and returns `undefined`, so `handle` answers 404 with `404.html`. The `createServer` callback (`static-server.ts:42-44`) also replaces `void handle(req, res)` with `handle(req, res).catch(...)`. That catch answers 500 with `text/plain` "internal error" when headers are not yet sent (otherwise it ends the response) and writes the error to `console.error`. So no rejection is left unhandled and no error is silently dropped.
6. **SEC-5.** The rejection message for a bad `files` entry (`config.ts:41`) describes the entry without converting it:
   - a string: `repos.<key>.files: "<value>" is not a docs/*.md path`, with the value inserted with `JSON.stringify` of the string (a string cannot overflow);
   - anything else: `repos.<key>.files: <kind> is not a docs/*.md path`, where `<kind>` is one of `an array`, `null`, `an object`, `a number`, `a boolean`, `a bigint`, `a symbol`, `a function`, `undefined`.
   `String(value)` and `JSON.stringify(value)` are never called on a value that is not a string. `config.test.ts` checks no message text that contains the value, so this is safe.
7. **SEC-1/SEC-2 test scope.** "Every `Object.prototype` member name" means `Object.getOwnPropertyNames(Object.prototype)`. In Bun 1.4.0 that list includes `__proto__`, `constructor`, `toString`, `valueOf`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `toLocaleString`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__` and `__lookupSetter__`. The test iterates the runtime list, so it does not hard-code the names. As extra safety, the block label is passed through `escapeHtml` in `aria-label` (`markdown.ts:99`). All labels are fixed literals, so the output does not change.
8. **No working payload.** Tests use harmless markup only (`<b>x</b>`). There is no script, no foreign link and no meta refresh. Commits and the PR describe the class ("prototype-chain lookup"). They do not name the one member that returned text unescaped.
9. **Docs.** `README.md:55`: add that a cache file is written to a temp file and renamed into place, so an interrupted build leaves no partial cache hit.

## Required behavior

1. **Highlighter (SEC-1, SEC-2).** `highlight(code, language)` returns the tokenizer output only for an own key of the `LANGUAGES` map. For any other language, including every `Object.prototype` member name, it returns `escapeHtml(code)`. It never throws for a string `language`.
2. **Block label (SEC-2).** `codeLabel(lang)` returns the `LANGUAGE_LABEL` map value or `"Code"`. A fenced block in a prototype-member language renders `aria-label="Code"`, `class="language-<escaped name>"` and the escaped body. `renderMarkdown` does not throw.
3. **Bump keys (SEC-6).** `repoForKey` rejects every key that is not an own key of `DOC_REPOS` with the `BumpError` above. `docs:bump constructor` exits non-zero with that message, before any `git` or network call.
4. **Cache (SEC-3).** A cache file appears at its final path only after its full text has been written. A write that fails half-way leaves no file at the final path. The next `loadDocFile` call fetches again and returns the full text.
5. **Static server (SEC-4).** `fileForUrl(root, "/%")` returns `undefined`. A request with a malformed escape answers 404 with the `404.html` body, and the same server answers the next `GET /` with 200.
6. **Config validator (SEC-5).** `parseDocsConfig` throws only `DocsConfigError` for a `files` entry that is a 10,000-deep nested array or an `Object.create(null)` object. The message names `repos.<key>.files`.

## Risks

- `Map` lookups change the type of `LANGUAGES`/`LANGUAGE_LABEL`. Both are module-private (`grep -rn "LANGUAGES\|LANGUAGE_LABEL" .repos/website/src` finds only their own files), so no caller changes.
- The temp file plus rename doubles the filesystem calls per docs file on a cache miss. This is negligible at build time.
- `rename` across directories could fail with `EXDEV`. The temp file is in the same directory, so that cannot happen.
- Bun's `fetch` may normalise or reject a malformed path on the client side. The static-server test therefore sends the raw path with `node:http` `request({ host: "127.0.0.1", port, path: "/%" })`, not with `fetch`.
- On `main` the SEC-4 test fails because the unhandled rejection in the server ends the request with no answer (or ends the test process). Under the fix, it gets a 404.

## Performance impact

None expected. The change is in the pulse-website build tooling and its static docs output. It does not touch the api process, image, startup, load path or tests that `bench/budgets.json` in the api repository measures (`startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `test_cpu_s`, …). No A/B run is needed. The website's own `check:budget` (`budget.json`) must stay green. The rendered page bytes do not change for the pinned docs (see acceptance 7).

## Security impact

Security impact: yes
The change touches the validator of `docs.config.json` (a trust boundary), the renderer of fetched Markdown, file writes (docs cache), and error texts that carry external data.

Checklist items that apply:
- **Input validation:** own-key lookups for code-fence languages and `docs:bump` keys; `parseDocsConfig` throws only `DocsConfigError` on hostile `files` entries.
- **Accessor execution:** no lookup by an untrusted key may reach an inherited function, getter or `__proto__`. The error description of a non-string never calls `toString` or `toJSON`, and never walks the value.
- **Atomic, path-safe writes:** the cache is written to a temp file and renamed, in the same directory. The final path is built exactly as today (`fetch.ts:29`).
- **Secrets in errors, logs and responses:** the 500 answer of the static server is a fixed text; the error goes only to the server's stderr. No value from the request goes into the answer.
- **Body and size limits, SSRF and redirects, dependency pins, auth:** not touched.

## Rollout order

One repository: only pulse-website changes. Nothing consumes its code (it is a static site and its build scripts), so no older consumer needs to keep working.

## Counterexamples

- **Highlighter lookup:** language `constructor`, `toString`, `valueOf`, `__proto__` or `hasOwnProperty` with body `<b>x</b>`. A wrong implementation (plain-object index, or `key in LANGUAGES`) calls a built-in or throws. The correct output is `&lt;b&gt;x&lt;/b&gt;`. Language `json` must still give `tok-` spans, so a fix that drops all tokenizers is also wrong.
- **Label lookup:** a block in language `toString` must give `aria-label="Code"`, not native function text. A block in language `sh` must still give `aria-label="Shell commands"`.
- **`repoForKey`:** `constructor`, `__proto__` and `toString` must throw `BumpError` with the unknown-repo message. A wrong fix that checks only truthiness accepts them. `api` must return `lorenzh/pulse-api`. `API` (wrong case) must be rejected.
- **`withRepo`:** a config with a `constructor` repo key plus `api` must keep both. The `in` check today drops `constructor`.
- **Cache write:** a writer that writes `"# Inst"` to its path and then throws. A wrong fix that writes the final path first and renames afterwards, or writes in place, leaves `"# Inst"` at the final path. The next call would then return `"# Inst"` without fetching. Correct: the final path does not exist, and the next call fetches and returns `"# Install\n"`.
- **Temp name:** a temp file ending in `.md` in the same directory is wrong (it looks like a docs file). The name must end in `.tmp`.
- **Static server:** `/%`, `/%E0%A4%A` and `/a%zz` must give 404. `/docs/` must still give 200 and `/../etc/passwd` still `undefined` (`static-server.test.ts:36`). A fix that catches every error in `fileForUrl` is wrong if it also hides the root check. Only `URIError` is caught.
- **Config validator:** a `files` entry `[[[…10,000 levels…]]]` must throw `DocsConfigError`, not `RangeError`. `Object.create(null)` must throw `DocsConfigError`, not `TypeError`. The string `"docs/Bad.md"` must still throw `DocsConfigError` with the message containing `"docs/Bad.md"`. A duplicate path must still give `lists … twice`.

No statistics are defined by this spec.

## Contract fields

No new names in contract or config. The only new exported name is `repoForKey` in `pulse-website/src/docs/bump.ts`, and `loadDocFile` gets a new optional `deps.writeFile`. Both are internal to website. Collision search:
- `grep -rn 'repoForKey' .repos/contract/src .repos/config .repos/website/src .repos/website/scripts` → no matches.
- `grep -rn 'writeFile' .repos/website/src/docs` → only the `node:fs/promises` import and call in `fetch.ts:1,48` that this change replaces. No other `deps.writeFile` exists.

## Repository: website

Files:
- `src/docs/highlight.ts`
- `src/docs/highlight.test.ts`
- `src/docs/markdown.ts`
- `src/docs/markdown.test.ts`
- `src/docs/bump.ts`
- `src/docs/bump.test.ts`
- `scripts/bump-docs.ts`
- `src/docs/fetch.ts`
- `src/docs/fetch.test.ts`
- `src/build/static-server.ts`
- `src/build/static-server.test.ts`
- `src/docs/config.ts`
- `src/docs/config.test.ts`
- `README.md`

Behavior change: yes
Unknown languages, bump keys, cache writes, malformed URLs and bad config entries get new, safe handling. If the code already behaves this way, request a hold instead of a review.

### Changes

- `src/docs/highlight.ts:80-94`: `LANGUAGES` becomes a `ReadonlyMap<string, (code: string) => string>` with the same seven entries. `highlight` uses `LANGUAGES.get(language)`.
- `src/docs/markdown.ts:43-53`: `LANGUAGE_LABEL` becomes a `ReadonlyMap<string, string>` with the same five entries. `codeLabel` returns `(lang && LANGUAGE_LABEL.get(lang)) || "Code"`. Line 99: `aria-label="${escapeHtml(label)}"`.
- `src/docs/bump.ts`: add `repoForKey` (decision 3); `withRepo` uses `Object.hasOwn` (decision 2).
- `scripts/bump-docs.ts:37-40`: `const repo = repoForKey(key);` in place of the inline lookup and `throw`. Nothing else in the script changes.
- `src/docs/fetch.ts:22-50`: optional `deps.writeFile`; temp file plus `rename` plus cleanup (decision 4).
- `src/build/static-server.ts:16-21, 42-44`: `URIError` → `undefined`; `.catch` on `handle` that answers 500 and logs (decision 5).
- `src/docs/config.ts:39-42`: describe a rejected entry by kind (decision 6). Add a small private `describe(value: unknown): string` helper.
- `README.md:55`: one sentence on the atomic cache write (decision 9).

### Tests

Each test below must fail on `dcb6162` and pass after the change. Expected values are literals in the test, not values read from the code under test:
1. `highlight.test.ts`: for each `name` of `Object.getOwnPropertyNames(Object.prototype)`, `highlight("<b>x</b>", name)` equals the literal `"&lt;b&gt;x&lt;/b&gt;"`.
2. `markdown.test.ts`: for each such `name`, `renderMarkdown("```" + name + "\n<b>x</b>\n```\n", resolve)` does not throw. Its `html` contains `aria-label="Code"` and `&lt;b&gt;x&lt;/b&gt;`, and does not contain `<b>`. Use the test's existing `resolve` helper.
3. `bump.test.ts`: for each such `name`, `repoForKey(name)` throws `BumpError` with message `unknown repo "<name>", expected one of api, probe, status, notify, contract, kit` (the literal list). Also `repoForKey("api") === "lorenzh/pulse-api"`. Also `withRepo` with a `constructor` key keeps it after the six known keys.
4. `fetch.test.ts`: a fresh `mkdtemp` cache directory and an injected `writeFile` that writes `"# Inst"` to the path it gets and then throws. `loadDocFile` rejects with `DocsFetchError`. The final path `<dir>/lorenzh__pulse-api/<sha>/docs/install.md` does not exist (`stat` gives `ENOENT`), and no `*.tmp` file is left in that directory. A second `loadDocFile` with the default writer and a fake fetch returning `"# Install\n"` returns `"# Install\n"` and records one fetch call. On `main` the injected writer is ignored, so the test fails: the call resolves instead of rejecting.
5. `static-server.test.ts`: `fileForUrl("/srv/dist", "/%")` is `undefined`. A raw `node:http` request with path `/%` to the running test server gets status 404 and body `missing`. Then `fetch(\`${origin}/\`)` gets 200 and body `home`.
6. `config.test.ts`: a valid config whose `api.files` is `[deep]` throws `DocsConfigError` (`assert.throws(…, DocsConfigError)`). Here `deep` is built in a loop as 10,000 nested arrays. The same holds for `[Object.create(null)]`. Both messages match `/^repos\.api\.files: /`.

Existing tests stay unchanged in intent and green.

### Checks (tool facts, cited)

- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:25`). Lint is `biome check . && pulse-eslint .` (`package.json:22`). Typecheck is `tsc --noEmit` from `typescript7` (`package.json:20`, pinned `npm:typescript@7.0.2` at `package.json:47`). Biome is `@biomejs/biome` `2.6.3` (`package.json:38`).
- `biome.json:2` extends `@lorenzh/pulse-config/biome.json` and `biome.json:4` excludes `.build`, `.cache`, `.repos` and `src/styles/tokens.css`. The pinned config is at `86896e9ff02e6458e431aa3417ee81d3b1cbc335` (`package.json:39`). Its `biome.json` includes `**` minus `dist`, `node_modules`, `bun.lock`, `*.html` and `test/fixtures` (lines 8-17). It is identical to the config clone.
- `bunfig.toml:3-4`: `bun test` runs with coverage on and a line threshold of 0.8. `bunfig.toml:5` ignores `*.test.ts`, `test/**`, `.build/**` and `dist/**`.
- CI (`.github/workflows/ci.yml:16-17`): job `check` uses `lorenzh/pulse-config/.github/workflows/check.yml@86896e9ff02e6458e431aa3417ee81d3b1cbc335`. At that ref (read with `gh api`, identical to the clone), it runs on Bun `1.4.0` (lines 22-24): `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun run test` (lines 25-38). The build steps are off because `build` defaults to false.
- CI job `site` (`ci.yml:19-35`): Bun `1.4.0` (line 28), then `bun run build`, `check:links`, `check:budget`, `check:a11y` (lines 32-35). `check:site` runs the same four locally (`package.json:19`).
- Runtime: Bun `1.4.0` (`package.json:8-11`). `Object.hasOwn` and `Map` are available.

### Completion evidence

1. The six tests above fail on `dcb6162`. The PR states this and lists the failing assertion for each, from a local run of the new test files against `dcb6162`'s sources.
2. `bun run check` passes (lint, typecheck, tests, 80 % line coverage).
3. `bun run check:site` passes: build, `check:links`, `check:budget`, `check:a11y`.
4. `bash -c 'bun run docs:bump constructor; echo $?'` prints the unknown-repo message and a non-zero exit code (expected values are the literal message above and "not 0"), with no `git ls-remote` call.
5. CI jobs `check` and `site` are green on the PR.
6. The PR body names #544, the checks that ran and the known limits (leftover `.tmp` files after `kill -9` are not cleaned up). It names no member that returned text unescaped.
7. Unchanged output: build `dist/` on `dcb6162` and on the PR branch from the same `.cache/docs` and `docs.config.json`, then `diff -r` the two `dist/docs` trees. Expected: no difference. These are two independent builds, and none of the pinned docs uses a prototype-member language.
