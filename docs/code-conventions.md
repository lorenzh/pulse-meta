# Code conventions: easy and reusable code

These rules apply to every pulse repository and to every kind of code: UI, services, scripts,
tests and config. Each target's `AGENTS.md` adds its own rules; it may make a rule stricter, never
weaker.

## Rules

1. **Reuse before you write.** Before you write a helper, component, query, check or test setup,
   search the repository for one that does the job. Use it the way the surrounding code uses it.
   A second copy of something that already exists is a defect.
2. **Extract on the second use.** When a second place needs the same markup, query, check or
   logic, move it into a shared module in the same change, with its own test. Never copy it.
3. **Keep what code shows apart from what it does.** Presentation (rendering, formatting,
   serialization) is a pure function of its input. Data access, validation, authorization and side
   effects live in their own small functions. Handlers, routes and controllers only call these in
   order; they build no markup and hold no business logic inline.
4. **Small units, one job, plain names.** If you need "and" to describe a function, it is two
   functions. Pass plain data in and return plain data out. No hidden state.
5. **Extend before you fork.** When a shared unit almost fits, add a parameter or a small helper.
   Do not add a variant copy.
6. **Shared modules say what they own.** A shared module starts with one line that says what it
   owns, and it has a test for each variant it supports.
7. **How a reviewer checks it.** Each of these is a should-fix finding, with the locations as proof:
   - a second copy of a helper, markup or logic that already exists (name both locations);
   - hand-written markup or logic that a shared helper already covers (name the code and the helper);
   - a new shared helper without a test (name the helper).

## Examples

UI helper: one field-error renderer instead of a copy per screen.

```ts
// before, in every form: `<p class="field-error" id="${id}-error">${esc(msg)}</p>`
// after, in the shared UI module:
export const fieldError = (id: string, msg: string) =>
  `<p class="field-error" id="${id}-error">${esc(msg)}</p>`;
```

Validation helper: one check, used by every route that needs it.

```ts
// before: if (typeof b.name !== "string" || b.name.trim() === "") return bad("name");
export const requiredText = (v: unknown): v is string =>
  typeof v === "string" && v.trim() !== "";
// after: if (!requiredText(b.name)) return bad("name");
```

Test helper: one fixture builder instead of an object literal in every test.

```ts
// before: const m = { id: "m1", url: "https://a.test", intervalS: 60, enabled: true };
export const monitor = (over: Partial<Monitor> = {}): Monitor =>
  ({ id: "m1", url: "https://a.test", intervalS: 60, enabled: true, ...over });
// after: const m = monitor({ enabled: false });
```

## Per repository

Each target's `AGENTS.md` names its shared modules: where UI helpers, validators, data access and
test helpers live. Agents search there first (rule 1) and add new shared code there (rule 2).
