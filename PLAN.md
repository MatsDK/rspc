# rspc v2 — plan to a usable, released library

**Status: plan. Agreed intent, not shipped code.** Where this disagrees with the code, the
code wins.

## Current work

| | |
| --- | --- |
| **Branch** | `feat/v2-framework-clients` off `3dfc6ee` |
| **State** | Core is sound, all three framework clients are on v2, CI green across the feature matrix |
| **Next** | Real `meta.name()` — which unblocks `cache` and `invalidation` (SFM) |

**What still stands between this and a working library.** Docs and publishing are out of
scope here — the docs site is its own repo, and releasing is gated on the naming decision
(§2) rather than on code.

1. `rspc/src/procedure.rs:80,93` — `meta.name()` is the literal `"todo"`. This makes
   `crates/cache` **actively wrong** (its key is also `"todo"`, so every cached procedure
   shares one slot) and forces `crates/invalidation` to hardcode `"sfmPost"`.
2. `flush()` is a public no-op — finish the backpressure mechanism or delete the function.
3. WebSockets no longer exist at all: the JSON-RPC integration was deleted, so reviving them
   means a fresh implementation against the v2 wire format (`D-2` is now moot).
4. `fetchExecute`'s batch loader is still module-global, and a throw inside its `setTimeout`
   leaves every queued caller hanging.

**Verified green:** `cargo check --workspace`; the feature matrix (`legacy` on/off,
`--no-default-features`); `pnpm build`; `pnpm typecheck`; `cargo check -p aion` downstream.
**Not verified:** `cargo test --workspace`, which CI runs — `cargo test` is off-limits in
this workspace and an axum assertion changed (`__rspc` → `~rspc`).

## Why this document exists

Upstream rspc is discontinued — see the notice in `README.md` and
[discussion #351](https://github.com/specta-rs/rspc/discussions/351). Upstream had started
a v2 rewrite and abandoned it half-built, with the new code parked in `next/` folders
beside the v1 code it was meant to replace.

This fork picked that up. Read in order, the branch tells a clear story:

| Commit                             | What it did                                                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `8f46a9e` "Sadge"                  | Added the upstream-is-dead notice. Everything after is ours.                                                                        |
| `cffeabb` "axum sse, no websocket" | **The pivot.** Built a second, simpler transport — plain HTTP + SSE — and a new v2 client for it, setting the JSON-RPC/WS path aside. |
| `07a5e60`…`39e6796`                | Batching, streaming, flushing, and the first real integration tests.                                                                |
| `9038d26`…`a2e4ced`                | A working SolidJS + TanStack Query binding on the v2 client.                                                                        |

What follows is what it takes to go from "works for its author" to "a library someone else
can pick up, read the docs, install from a registry, and use without reading the source."

That gap is the subject of this document. It is not mostly a coding problem — it is roughly
a third correctness, a third completeness across transports and clients, and a third the
things libraries need that private forks skip: backward compatibility, docs, tests, CI,
releases, and a name.

### The governing constraint: we inherit upstream's users

rspc has existing users on 0.3.x. Upstream is gone, so **this fork is the only place they
can migrate to**. That makes backward compatibility a feature of the product, not
housekeeping:

- `crates/legacy` is *"the rspc 0.3.1 syntax implemented on top of the 0.4.0 core… allows
  incremental migration from the old syntax to the new syntax with minimal breaking
  changes"* (`crates/legacy/src/lib.rs:1-3`).
- `rspc/src/legacy.rs:21` implements `From<rspc_legacy::Router<TCtx>> for crate::Router<TCtx>`
  — a v1 router mounts straight into a v2 one, so a large app can migrate procedure by
  procedure rather than in one commit.
- Upstream deliberately made it a default feature (`72336dc "bring back legacy feature but
  make it default"`).

**Settled:** an in-flight change deleting `crates/legacy` was reverted. It was the right
call for a private consumer that never used v1 syntax and the wrong one for the library,
which would have lost the only bridge its inherited users have. `legacy` is now an opt-in
feature rather than a default.

That reasoning covers the *server syntax* only. The JSON-RPC/WebSocket transport was
deleted: v1-syntax procedures are served over v2's HTTP+SSE, so v1 syntax migrates but v1
**clients** must upgrade. The consequence is that `@rspc/client/legacy`, `query-core` and
the `*/legacy` bindings are now a client for a protocol nothing speaks — worth deciding on
deliberately (`D-9`).

---

## 1. Ground truth: where things actually stand

### 1.1 Feature matrix

This is the spine of "all use cases covered." Everything below is what the code does today,
not what it intends.

**Server — core**

| Capability                            | State | Evidence                                                                                    |
| ------------------------------------- | ----- | --------------------------------------------------------------------------------------------- |
| `query` / `mutation`                  | ✅    | `rspc/src/procedure/builder.rs:68-98`                                                        |
| `subscription`                        | ✅    | `builder.rs:113-129`                                                                         |
| `rspc::Stream` inside a query         | ✅    | Collects to a list client-side, documented at `rspc/src/stream.rs:16`                        |
| Router `procedure` / `nest` / `merge` | ✅    | `rspc/src/router.rs`; duplicate-key detection is the one thing with a test                   |
| v1 router → v2 router bridge          | ✅    | `rspc/src/legacy.rs:21`. **The migration path.** Behind the opt-in `legacy` feature          |
| Middleware on query/mutation          | 🟡    | Structurally complete, **zero tests or examples** exercise `.with()` end-to-end              |
| Middleware on subscriptions           | ❌    | `MiddlewareHandler` is Future-only (`middleware/middleware.rs:31-40`) — it can wrap the future that *produces* a stream, but cannot see, transform or short-circuit yielded items |
| Middleware context switching          | 🟡    | Wired through the generics, never tested                                                     |
| Error mapping across layers           | ❌    | One `TError` is fixed for the whole chain; a middleware cannot convert error types            |
| Procedure metadata (`meta.name()`)    | ❌    | Always returns the literal string `"todo"` (`rspc/src/procedure.rs:80,93`)                    |
| Backpressure / manual flush           | ❌    | `flush()` is a public no-op: `CAN_FLUSH` is never set true, `SHOULD_FLUSH` never read (`crates/procedure/src/stream.rs:17-37`) |
| Typed error → wire                    | ✅    | Framework errors all carry `~rspc: true`; user errors stay bare, so that flag discriminates |

**Server — type export**

| Target                 | State | Evidence                                                                                           |
| ---------------------- | ----- | ---------------------------------------------------------------------------------------------------- |
| TypeScript (v2)        | 🟡    | Correct for all three kinds; every `DataType`→string conversion is still an `.unwrap()` (`languages/typescript.rs:203,211,219`) |
| TypeScript (v1 shape)  | ✅    | `ProceduresLegacy` emission, `#[cfg(feature = "legacy")]` at `typescript.rs:67-82`. Part of the compat surface |
| TypeScript source maps | 🟡    | Behind a flag that prints "unstable feature" at runtime                                              |
| Rust                   | ❌    | `languages/rust.rs` is `//! TODO: Bring this back when published.` plus ~85 commented-out lines. Enabling the `rust` feature compiles an empty module |
| OpenAPI                | ❌    | `crates/openapi` serves a static Swagger page; all route generation is commented out (`lib.rs:101-232`) |

**Transports** — richer than it first looks; the issue is wiring, not absence.

| Transport                | State | Evidence                                                                                             |
| ------------------------ | ----- | -------------------------------------------------------------------------------------------------------- |
| HTTP single (v2)         | ✅    | `integrations/axum/src/endpoint.rs`                                                                      |
| HTTP batch (v2)          | 🟡    | Implemented, **untested** — `batch_query` is a commented-out stub at the end of `endpoint.rs`                  |
| HTTP batch + streaming   | 🟡    | Custom `\d+:[…]\n` line protocol, undocumented and untested                                               |
| HTTP single + streaming  | ✅    | `Accept: text/event-stream` on a one-off request, frames buffered into an array                            |
| SSE subscriptions (v2)   | ✅    | Teardown and browser-managed reconnect. No resume: a reconnect restarts the subscription, so servers should emit initial state on subscribe |
| **WebSocket**            | ❌    | Deleted with the JSON-RPC integration. Reviving it means a fresh implementation against the v2 wire format |
| JSON-RPC wire format     | ❌    | Deleted. Recoverable from git history if a compat transport is ever wanted                                 |
| Tauri IPC                | ✅    | `integrations/tauri` — the most complete integration in the repo, including abort support (`lib.rs:131-135`) |

**Clients**

| Package                | Targets | State | Notes                                                                                  |
| ---------------------- | ------- | ----- | ---------------------------------------------------------------------------------------- |
| `@rspc/client` (root)  | v1      | ✅    | `Transport` class with `FetchTransport` + `WebsocketTransport` (`transport.ts:76-132`), incl. reconnect. **Compat surface — keep** |
| `@rspc/client` (v2)    | v2      | 🟡    | Unsubscribe and abort landed; still no WS executor, and the batch loader is module-global (§1.4) |
| `@rspc/solid-query`    | v2      | ✅    | The only framework binding ported — and the reference architecture (§1.8)                 |
| `@rspc/react-query`    | v2      | ✅    | Options proxy + `useSubscription`; v1 at `./legacy`                                       |
| `@rspc/svelte-query`   | v2      | ✅    | `useSubscription` is a `readable`, so teardown is automatic; peer range now `^4 \|\| ^5` |
| `@rspc/query-core`     | v1      | 🟡    | Shared helpers for the **v1** bindings                                                    |
| `@rspc/tanstack-query` | —       | ❌    | Currently a byte-identical stale copy of `query-core`, imported by nothing. **The name is right and the slot is needed** — this should become the shared **v2** layer (§1.8) |
| `@rspc/tauri`          | both    | ✅    | v1 entrypoint wraps the v2 executor — the one place they're bridged cleanly               |
| `rspc-client` (Rust)   | —       | ❌    | Expects the JSON-RPC envelope `{"result":{"type":…,"data":…}}`; `endpoint.rs` returns the bare value. Wire-incompatible with the v2 HTTP transport (though it would work against the JSON-RPC one) |

**Satellite crates**

| Crate          | State | Notes                                                                                                    |
| -------------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| `validator`    | ✅    | Small, self-contained, exercised by `examples/core`                                                       |
| `tracing`      | 🟡    | `todo!()` for stream results (`traceable.rs:24`); imported by `examples/core` but never invoked           |
| `invalidation` | ❌    | Only `Invalidate::One` works; `Any`/`Many` are `todo!()`. Target name **hardcoded to `"sfmPost"`** with the comment *"Don't do this once `meta.name()` is correct"* |
| `cache`        | ❌    | Cache key is the literal `"todo"` (`lib.rs:47`) — every cached procedure shares one slot. `ttl` ignored (`memory.rs:18-21`) |
| `zer` (auth)   | ❌    | `.unwrap()`s on malformed/expired JWTs instead of returning `UnauthorizedError`; disables required claim validation with the comment *"This is very insecure!"* |
| `binario`      | ❌    | Blocked upstream: the `binario` crate returns non-`Send` futures. Currently stubbed to `todo!()`          |
| `devtools`     | ❌    | `mount()` is `todo!()`; implementation commented out                                                       |
| `openapi`      | ❌    | See above                                                                                                  |
| `client`       | ❌    | See above                                                                                                  |
| `legacy`       | ✅    | **The v1 compat layer.** Being deleted in the working tree — see §1.3                                     |

### 1.2 Correctness bugs (a) and (b) are fixed; kept as the record of what was wrong

**(a) Malformed input double-panics the server.** The chain, fully traced:

1. `rspc/src/procedure.rs:101` — `TInput::from_input(input).unwrap()  // TODO: Error handling`
2. `from_input` correctly returns `Err(ProcedureError::Deserialize)` (`resolver_input.rs:52`) — so the `.unwrap()` panics.
3. `crates/procedure/src/procedure.rs:47-50` — `catch_unwind` turns it into `ProcedureError::Unwind`.
4. `From<ProcedureError> for ProcedureStream` (`stream.rs:60-68`) → `Inner::Value(Some(err))`, `flush: None`.
5. The integration polls it → `stream.rs:382-389`:
   ```rust
   Inner::Value(v) => {
       if self.flush.is_none() {
           // Poll::Ready(v.take().map(Err))
           todo!();
   ```
   **Second panic, uncaught.**

The correct implementation is the commented-out line directly above it. And `endpoint.rs`
already has a `ProcedureError::Deserialize → 400` arm that **has never once executed**,
because the `.unwrap()` fires first. Any client sending a bad payload to any procedure kills
the request task.

**(b) Subscriptions export the wrong type.** `resolver_output.rs:88-90` returns
`<Vec<T>>::data_type(types)`. `ResolverOutput` is implemented once for `crate::Stream<S>`
and reused for both `rspc::Stream`-in-a-query (where `Vec` is correct and documented) and
real subscriptions (where it is wrong). A subscription yielding `T` exports as `T[]`; when
`T` is itself a list you get `string[][]`. Visible in this repo's own `examples/bindings.ts`:
`basicSubscription: { kind: "subscription", …, output: number[] }`.

The fix exists on the abandoned `origin/collect_procedure_types` branch —
`- <Vec<T>>::data_type(types)` / `+ T::data_type(types)`. That branch is stale (based on
`ab79d6e`, months behind) so it can't merge wholesale, but the change is directly portable.
`ProcedureKind` is in scope both where `ProcedureType` is built (`procedure.rs:111-116`) and
at export (`typescript.rs:191`).

**(c) Further reachable `todo!()`s.** `stream.rs:463` (mid-stream serialization failure);
`Debug` impls that are pure `todo!()` at `stream.rs:477`, `dyn_input.rs:75`,
`dyn_output.rs:62` — so any tracing or devtools layer that `{:?}`-prints them panics.

**(d) `State::get_mut` returns `&T`, not `&mut T`** (`crates/procedure/src/state.rs:54-58`)
— it calls `downcast_ref`. A copy-paste bug; the method is unusable as named.

**(e) `ProcedureError::NotFound` is never constructed anywhere**, and both integrations
handle it with `unimplemented!()` (`next.rs:496`). Unknown-procedure is handled out-of-band
by the HTTP layer. Either wire it up or delete the variant.

### 1.3 The workspace: how it broke, and what was done

An in-flight deletion of `crates/legacy/**` was half applied — the crate was gone but
`examples/legacy` still declared `rspc-legacy = { path = "../../crates/legacy" }` and
`features = ["legacy"]`. Cargo resolves the whole workspace manifest graph up front, so
**every `cargo` command failed**, including on unrelated crates.

Resolved by reverting the deletion, per §"The governing constraint" — `crates/legacy` is the
v1 migration bridge, not dead weight. Specifically:

- `crates/legacy/**` restored; `rspc-legacy` is an optional dependency again.
- The `legacy` feature is back, but **opt-in rather than default**. Enabling it emits the
  extra `ProceduresLegacy` type into generated bindings, which consumers who never used the
  0.3 syntax don't want; users migrating from 0.3 turn it on explicitly. This is the
  `D-1`-adjacent call flagged in Phase A.2, and it is a behaviour change from upstream's
  `default = ["legacy"]` — safe to make now, before republishing under a new name.
- Two members are **parked via `exclude`**, because they genuinely cannot compile yet:
  `examples/legacy` (calls `rspc_axum::endpoint`, commented out of the axum crate — returns
  in Phase E) and `crates/binario` + `examples/binario` (the `binario` crate returns
  non-`Send` futures — Phase G). Both are excluded with a written reason rather than deleted.

The lesson worth keeping: this repo has enough feature-gated and commented-out code that a
change can look complete and still break the graph. CI building **across the feature matrix**
(Phase A.4) is what prevents a recurrence, not care.

### 1.4 Client-side gaps (v2 client)

**Fixed since:** subscriptions can now be torn down, and `sseExecute` closes the
`EventSource` while letting the browser reconnect. The batch loader below is still open.

**Subscriptions can never be torn down.** *(fixed)* `client.ts:27-30` declares
`subscribe: (…) => Unsubscribable`, but `UntypedClient.subscription()` has no `return`
statement, and neither does `observable.ts`'s `subscribe()` — the callback signature
`(observer) => void` never captures a teardown function. `grep -rn "unsubscribe"
packages/client/src/next` finds only the two type declarations. Calling
`.subscribe(x).unsubscribe()` throws. Downstream, `solid-query/src/useSubscription.ts:22-60`
subscribes inside a `createEffect` with no `onCleanup` — because there is nothing to call.

Note the v1 client does **not** have this problem, which makes it a useful reference.

**SSE never closes on error.** `sseExecute.ts:51-53` calls `o.error(e)` but not
`sse.close()`. The observable marks itself done and drops later events, while the native
`EventSource` keeps auto-reconnecting to a stream nobody reads — holding a slot against the
browser's ~6-connections-per-origin cap.

**The batch loader is global.** `fetchExecute.ts:9-12` — `batchLoaders` is module-scope state
keyed only by `"query"`/`"mutation"`, not by URL or client instance. Two clients pointing at
different backends in the same tick: the second one's requests go to the first one's URL.
And a throw inside the `setTimeout` callback (including the literal `throw new Error("invalid
stream content!")` at `:123`) is an unhandled rejection in a timer — **every queued caller
hangs forever**.

**No cancellation, and no WS executor.** No `AbortController` is passed to any `fetch()`, and
`next/index.ts` exports only `fetchExecute` and `sseExecute` — so a v2 app cannot use the
WebSocket transport even once the server side is re-enabled.

### 1.5 Documentation

There is effectively none for v2.

- `README.md` still shows the **v1** API (`.query("version", |t| t(|ctx, input| …))`).
  Combined with everything else, it is the most misleading file in the repo — though note
  that with `crates/legacy` kept, that syntax does still work, which makes precision about
  "v1 syntax, supported via the legacy feature" more important, not less.
- The docs site is a **separate repo** and still describes v1. It is not built from this
  repo, so nothing here keeps it honest — see Phase H for the split between crate-level docs
  that ship with the code and content owed to that repo.
- Rustdoc is a field of stubs: ~100 `TODO` markers, most literally `/// TODO` in place of a
  doc comment. `middleware.rs:51-81` has 8 in a single doc block admitting the generics are
  undocumented. Every `ProcedureStream` constructor is `/// TODO`.
- `procedure.rs:12-14`: `TODO: Request flow overview` / `TODO: Explain, what a procedure is`.
- No migration guide — the single document every inherited user needs.

### 1.6 Tests, CI, release

- **Rust: 9 real tests.** 8 in `integrations/axum/src/next.rs` (single-procedure + SSE), 1
  router duplicate-key test. All 3 in `rspc/tests/typescript.rs` are commented out.
- **TypeScript: zero.** No `vitest.config.*` anywhere. `@rspc/client` has no `test` script
  and lists `vitest` as a runtime `dependency`. `next/index.test.ts` has **no assertions**.
- **CI: none.** No `.github/workflows` directory at all. `dependabot.yml` has `# TODO: Rust`
  and `# TODO: npm` as unfilled entries.
- **`publish.sh` is broken** — it `cd`s into `crates/legacy/` (fine again if the deletion is
  reverted) and publishes **zero** TypeScript packages.
- **Versions are a mishmash**: `rspc` 0.4.1, `rspc-axum` 0.3.0, `tauri-plugin-rspc` 0.2.2,
  `rspc-procedure` 0.0.1, eight satellites at 0.0.0 with `publish = false`; all TS packages
  at 0.3.1.
- **`specta` is pinned to `=2.0.0-rc.22`** — an exact pre-1.0 release candidate that the
  entire type-generation story rests on. A genuine blocker for claiming stability.

### 1.7 Genuinely dead code (still present)

Narrower than it looks, once WS and legacy are kept:

- `integrations/axum/src/request.rs` (67 lines) — orphaned, and its `deserialize()` ignores
  the request body entirely.
- `rspc/src/mod.rs` — orphan module file referencing a non-existent `infallible` module.
- `rspc/src/languages/rust.rs` — entirely commented out.
- Committed `dist/` directories, already out of sync with both `HEAD` and the working tree.

`packages/tanstack-query`'s *contents* are dead, but the package is not — it is the slot the
shared v2 layer should occupy (§1.8).

`endpoint.rs`, `jsonrpc.rs` and `jsonrpc_exec.rs` are **not** in this list — they are the
WebSocket/JSON-RPC path, to be re-enabled (Phase E), not removed.

### 1.8 The client packages need a shared v2 layer, and it doesn't exist yet

`@rspc/solid-query` is the only v2 binding, and it is **self-contained** — it does not use
`@rspc/query-core` at all. That was the right call while it was the only one, and the wrong
shape to copy three more times. Measuring what is actually framework-bound:

| File                       | Lines | Framework-specific?                                                                 |
| -------------------------- | ----- | ------------------------------------------------------------------------------------- |
| `createOptionsProxy.ts`    | 181   | **Runtime: no. Types: yes.** See below                                                 |
| `useSubscription.ts`       | 63    | **Genuinely.** `createEffect` + `createStore` from `solid-js`. There is no framework-agnostic way to write this |
| `index.ts`                 | 11    | No — re-exports                                                                       |

An earlier draft of this section claimed the proxy was "barely" Solid-specific and only
needed its import re-pointed at `@tanstack/query-core`. **That was wrong**, and the reason
matters:

- `createOptionsProxy.ts:26` reads `Omit<ReturnType<tanstack.UndefinedInitialDataOptions<…>>, …>`.
  The `ReturnType<>` is there because **Solid's option types are accessor functions**. React's
  are plain objects, so the same line is wrong for React.
- `UndefinedInitialDataOptions`, `DefinedInitialDataOptions`, `UseMutationOptions` and the
  `queryOptions()` helper live in the **framework** packages, not `@tanstack/query-core`.

So the honest split is runtime-vs-types, not file-vs-file. The option *types* have to be
supplied per framework.

**And writing the React binding turned up one more difference the type analysis missed:**
Solid's proxy returns option *thunks* — `queryOptions: () => () => tanstack.queryOptions({…})`
— because Solid consumes accessors, while React returns the object directly. So even the
runtime is not identical; a shared layer has to parameterize "wrap or don't wrap" too. That
is two surprises from assuming Solid generalizes, which is the case for extracting only once
a second implementation exists rather than designing the abstraction up front.

The split the code is pointing at:

```
@rspc/tanstack-query   ← shared, framework-agnostic. Built on @tanstack/query-core.
  createRSPCOptionsProxy()  → queryOptions / mutationOptions / subscriptionOptions objects
  inferInput / inferOutput / inferError

@rspc/{react,solid,svelte}-query   ← thin. Only what needs the framework's reactivity:
  useSubscription()   React: useEffect + useSyncExternalStore
                      Solid: createEffect + createStore   (exists today)
                      Svelte 5: $effect + runes
  provider / context, if the framework wants one
```

This works because TanStack Query v5's `queryOptions()` objects are framework-agnostic by
design — every framework's `useQuery`/`createQuery` consumes the same option object. So
"framework-specific packages" remain necessary, but they shrink to the subscription hook and
the context plumbing, which is the part that genuinely cannot be shared.

**Consequence for the plan: `@rspc/tanstack-query` should be repurposed, not deleted.** The
package name is right and the slot is needed; only its current contents (a stale copy of the
v1 `query-core` — verified byte-identical with `diff`) are wrong.

**Sequencing, given the types don't generalize for free:** port React *first*, as a second
real implementation, and extract the shared runtime once two exist rather than guessing the
abstraction from one. Then Svelte 5 lands on the extracted layer. Deciding the shape from
Solid alone is how the `ReturnType<>` mistake above happened in the first place.

**Prerequisite, now done:** the v2 client could not unsubscribe (§1.4). Solid tolerated it;
React would not — StrictMode double-invokes effects, so every mount would open two SSE
connections that could never close, against a ~6-per-origin cap. `observable` now takes a
teardown, `UntypedClient.subscription` returns the handle its type always claimed,
`sseExecute` closes the `EventSource` (including on error, where it previously leaked a
retrying connection), and the non-batch `fetchExecute` aborts.

---

## 2. The blocking decision: what is this library called?

**Nothing about releasing can be planned until this is settled, so settle it first.**

- On crates.io, `rspc`, `rspc-axum`, `rspc-procedure` are **upstream's**. We cannot publish
  to them.
- On npm, the `@rspc` scope is **upstream's**. We cannot publish `@rspc/client`.

Three honest options:

| Option                                  | Consequence                                                                                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Never publish.** Keep the names.   | Consumers use git/path deps forever. Cheapest — but "other people can use it" is then false in practice: no `cargo add`, no `npm i`, no docs.rs, no semver. |
| **B. Rename and publish.**              | The only path to a genuinely usable library. Costs a rename pass and a one-time migration note. **Recommended.**                                          |
| **C. Ask upstream to transfer the names.** | Upstream is unmaintained, so realistically a long shot — but it costs one issue to ask before doing B, and inheriting the names would make migration far easier for existing users. **Worth trying first.** |

Two consequences to plan for now:

- **Version reset.** Publishing under a new name is a fresh `0.1.0`. Use the opportunity to
  put every crate and package on one synchronised version.
- **A migration guide is mandatory.** Anyone arriving has a v1 codebase and needs to know the
  new names, that `legacy` gives them the old syntax on the new core, which transports exist,
  and what the router API looks like now.

### Branch naming

`better-axum` describes the branch's *first* commit, not what it became — and now that
WebSockets are staying, it is doubly misleading. Rename to `v2` (not `clients-v2`: the client
rewrite is the most visible part but the branch also changes the core, the transport layer
and the integrations).

```bash
git branch -m better-axum v2
git push origin -u v2
# delete the old remote branch only after every consumer's dependency pin is updated
```

Once the release phase is green, **fast-forward `main` to it**. Upstream is dead; there's no
reason to keep finished work on a side branch. Do it last — a broken `main` is worse than a
stale one.

### Target layout: v2 at the root, v1 demoted to `legacy/`

`next/` is named for a migration whose "before" side we are **keeping**, which makes it an
actively confusing name — it reads as "unreleased" when it means "current". v2 is the future
main API, so it should live where the main API lives, and v1 should move out of its way
rather than out of the repo.

**TypeScript** — `packages/client/`:

```
src/
  index.ts          v2  (was src/next/index.ts)        →  "@rspc/client"
  client.ts         v2  (was src/next/client.ts)
  observable.ts     v2
  UntypedClient.ts  v2
  types.ts          v2
  executors/
    fetch.ts        v2  (was src/next/fetchExecute.ts)
    sse.ts          v2  (was src/next/sseExecute.ts)
    ws.ts           v2  (new — Phase E.3)
  legacy/
    index.ts        v1  (was src/client.ts + transport.ts + typescript.ts)
                                                       →  "@rspc/client/legacy"
```

So the export map inverts:

| Subpath                 | Before          | After           |
| ----------------------- | --------------- | --------------- |
| `@rspc/client`          | v1              | **v2**          |
| `@rspc/client/next`     | v2              | **removed**     |
| `@rspc/client/legacy`   | —               | **v1**          |

`@rspc/tauri` got the same treatment: `./next` → `.`, the v1 `TauriTransport` → `./legacy`.

**Rust** — same move: `integrations/axum/src/next.rs` becomes the crate's main endpoint
module, and the JSON-RPC/WebSocket path (`endpoint.rs`, `jsonrpc.rs`, `jsonrpc_exec.rs`)
moves under a `legacy/` module rather than sitting at the top level with its successor.
`rspc/src/legacy.rs` and `crates/legacy` keep their names — they are already honestly named.

**This inverts the default, which is a breaking change for v1 users** — `@rspc/client` stops
meaning v1. That is exactly why it should happen at the rename-and-republish moment (§2):
under a new package name at a fresh `0.1.0`, nothing changes under anyone silently, and the
migration guide can state the mapping in one table. Doing it later, after people have
depended on the new package, would cost a major version for no benefit.

**No deprecated `./next` alias.** It only ever existed in upstream's unreleased state and in
this fork, so there is no installed base to keep compatible — carrying it into a fresh
`0.1.0` would be shipping cruft on day one. Every in-repo importer and Aion were repointed in
the same change.

**Done, ahead of Phase G.** Moving first means the remaining Phase F work (React, Svelte 5)
gets written at final paths instead of being moved afterwards.

One knock-on worth recording: making `legacy` opt-in (Phase A) meant `examples/bindings.ts`
stopped emitting `ProceduresLegacy`, which `examples/tauri/src/App.tsx` imports. Both
examples that write that file — `examples/axum` and `examples/tauri` — now enable the
`legacy` feature, which also keeps the v1→v2 bridge exercised rather than merely present.
That file being written by two different examples is a pre-existing wart worth fixing in
Phase H.

---

## 3. The plan

Ten phases. Each leaves the tree in a working state and has an **exit criterion** — something
checkable, not a feeling. Sizes are S/M/L.

### Phase A — Build and CI ✅ done

Legacy restored as an opt-in feature, workspace resolves, dead files removed, CI added
covering the feature matrix. `examples/legacy` and `crates/binario` are parked via
`exclude` with a `continue-on-error` CI job so they fail loudly rather than rot.

### Phase B — Correctness (S, mostly done)

Done: deserialization errors propagate instead of `.unwrap()`ing; `poll_inner` yields the
error rather than hitting `todo!()` (those two were the double-panic); `Debug` for
`ProcedureStream`/`DynInput`/`DynOutput`; `State::get_mut` actually mutable;
`ProcedureError::NotFound` constructed and the `unimplemented!()` arms answered; one error
envelope (`~rspc: true` on framework errors, user errors bare).

Left:

1. **`integrations/axum/src/next.rs:508`** — `ProcedureError::Unwind(err) => panic!()`. A
   panicking procedure still takes down the request task; it should be a 500 carrying
   `err.message()` (`"resolver panic"`), which does not leak the payload.
2. **`crates/procedure/src/stream.rs:466`** — `todo!()` when the map closure fails.
   `ProcedureStreamMap`'s `Stream::Item` is `T`, so there is no channel for the error;
   this needs `Item` to become `Result<T, _>`.

**Exit:** no `todo!()`/`unimplemented!()`/`panic!()` reachable from a request.

### Phase C — Complete the server surface (L)

1. **Real procedure metadata.** Thread the key from `router.rs:146` into `ProcedureMeta`,
   deleting both `"todo"` literals. This unblocks `cache` and `invalidation`, which are
   broken *because* of it.
2. **Middleware on subscriptions.** Today it can only wrap the future that produces a stream.
   Decide and implement: a per-item hook, or an explicit documented statement that middleware
   sees stream creation only. Silently doing the latter while looking like the former is the
   worst option.
3. **Error mapping across middleware layers** — allow a layer to change `TError`, or document
   that the chain is monomorphic in its error type.
4. **Test middleware at all.** Context switching and stacking have zero coverage; these
   generics are intricate enough that "it compiles" is not evidence.
5. **Decide the fate of `flush()`.** A public API that does nothing. Either finish the
   backpressure mechanism — the `require_manual_stream()`/`flushable()` implementation exists
   on the abandoned `collect_procedure_types` branch and can be ported — or delete the public
   function and its dead `flush: Option<Waker>` plumbing.
6. **Router polish** — guard the `key.len() == 0` case flagged at `router.rs:150`, and make
   `DuplicateProcedureKeyError`'s fields accessible.

**Exit:** every public API either works or does not exist; no 🟡 left in "Server — core".

### Phase D — Complete the type-export story (M)

Done: subscriptions export `T` while `rspc::Stream`-in-a-query still exports `Vec<T>`, via a
defaulted `ResolverOutput::item_data_type`.

1. **Restore `rspc/tests/typescript.rs`** — uncomment, repair, add a subscription case, and
   cover the `ProceduresLegacy` output too so the compat bindings don't silently regress.
3. **Replace export-path `.unwrap()`s** (`typescript.rs:203,211,219`, plus the source-map
   writer) with real errors. Export usually runs in a build script; panicking there is a
   terrible failure mode.
4. **Decide on the Rust exporter.** Finish `languages/rust.rs` or delete the module and the
   feature — an advertised flag that does nothing is a bug report waiting to happen.
5. **Decide on OpenAPI.** Same call for `crates/openapi`.

**Exit:** bindings correct for all three procedure kinds in both v1 and v2 shapes, asserted
by test; no feature flag is a silent no-op.

### Phase E — Complete the transport layer (M)

The phase this plan originally got wrong. The WebSocket path is **present and v2-shaped**;
this is a port, not a rewrite.

1. **Re-enable `endpoint.rs`** — uncomment `mod endpoint;` at `lib.rs:9`, update axum-0.7
   path syntax (`"/:id"` → `"/{id}"`, `endpoint.rs:33`) and whatever else axum 0.8 moved,
   and replace the `.unwrap()` on the WS upgrade extractor (`endpoint.rs:47`).
2. **Decide the WS wire format** (`D-2`). `endpoint.rs` speaks JSON-RPC via `jsonrpc_exec`.
   Either keep that as the compatibility transport (v1 clients keep working unchanged), or
   also offer WS speaking the newer shape. Keeping JSON-RPC for WS and the new shape for
   HTTP+SSE is coherent, but must be documented rather than discovered.
3. **Add `wsExecute` to the v2 client** so v2 apps can use WebSockets. `transport.ts:76-132`'s
   `WebsocketTransport`, including its reconnect handling, is the reference implementation.
4. **Make the `ws` feature honest.** It currently compiles and does nothing because the module
   is commented out. After (1) it becomes real — and CI must build both with and without it.
5. **Document all four transports** side by side with their trade-offs: HTTP (no
   subscriptions), SSE (server→client only, ~6 connections per origin, no custom headers),
   WebSocket (bidirectional, reconnect complexity), Tauri IPC. Users currently have no way to
   choose.
6. **Finish batching and streaming.** These are referenced all over this document but were
   never one workstream, which is how they ended up half-built on both sides. Four modes are
   advertised by `fetchExecute.ts:14-26`; only three exist:

   | Mode | State | Owed |
   | --- | --- | --- |
   | `batch: false, stream: false` | ✅ | — |
   | `batch: true,  stream: false` | 🟡 | Server untested (`batch_query` is a commented-out stub at the end of `endpoint.rs`) |
   | `batch: false, stream: true`  | ❌ | Not implemented — the non-batch branch never reads `config.stream`. Build it or delete the option |
   | `batch: true,  stream: true`  | 🟡 | The `\d+:[…]\n` line protocol works but is undocumented and untested end to end |

   Concretely: test the server executor; make the batch loader per-client rather than
   module-global and reject queued callers when the batch throws (§1.4 — today they hang
   forever); decide the missing mode; write the wire format down (Phase H.7), since it exists
   only as a regex in one file and a formatter in another; and add a round-trip test per mode
   (Phase I.4). Streaming a query via `rspc::Stream` is the server half of the same story and
   is what `D-4` is about.

**Exit:** every transport in §1.1 is either ✅ or explicitly out of scope in the docs, and
every batch/stream mode either works and is tested, or no longer appears in the config type.

### Phase F — Complete the client story (M, mostly done)

Done: teardown throughout (`observable` takes a teardown, `UntypedClient.subscription`
returns the handle, `sseExecute` closes and lets the browser reconnect, non-batch
`fetchExecute` aborts); v2 promoted to each package root with v1 at `./legacy` and `./next`
removed; v2 bindings for React and Svelte 5 alongside Solid; a worked React example under
`StrictMode`.

Left:

1. **Extract the shared runtime** (§1.8). Three bindings now exist to extract *from*, and
   three real divergences to design around rather than guess at: Solid's accessor
   `ReturnType<>` wrapping, Solid returning option *thunks* where React/Svelte return
   objects, and Svelte naming it `CreateMutationOptions` vs React's `UseMutationOptions`.
   `@rspc/tanstack-query` is the slot for it.
2. **`fetchExecute`'s batch loader is still module-global** — keyed by `"query"`/`"mutation"`
   rather than per client, and a throw inside the `setTimeout` leaves every queued caller
   hanging forever.
3. **Unify the `infer*` helpers** — each binding currently ships its own copy.
4. **Decide the Rust client's fate** (`D-3`). It still expects the JSON-RPC envelope, so it
   cannot talk to the v2 HTTP transport.

**Exit:** one shared runtime, three thin bindings, no duplicated proxy logic.

### Phase G — Clean up (S)

Deliberately small, because most of what looked like dead code is compat surface.

1. Delete the §1.7 list, if not already done in Phase A.
2. **Triage the satellite crates.** Fix, or remove from the default workspace and say so in
   the README. Do not ship crates that panic on their only entry point.
   - `validator` — keep.
   - `tracing`, `invalidation`, `cache` — fixable, and the latter two become fixable *because
     of* Phase C.1.
   - `zer` — fix the `.unwrap()`s and the disabled claim validation, or park it. An auth crate
     that panics on a malformed token must not ship as-is.
   - `binario` — blocked upstream on non-`Send` futures. Park with a written reason; do not
     land the `todo!()` stub currently in the working tree.
   - `devtools`, `openapi`, `client` — finish or delete.
3. ~~**Move v2 to the root and demote v1 to `legacy/`**~~ — **done early**, in Phase F, so the
   remaining client work lands at final paths. Covers `@rspc/client` and `@rspc/tauri`.
   Still to do here: the Rust half — `integrations/axum/src/next.rs` → the crate's main
   endpoint module, JSON-RPC/WebSocket under `legacy/`.
4. **Clean the build outputs** — gitignore `dist/` and build on publish, or regenerate in CI.

**Exit:** every file is reachable from a public entry point, a test, or an example, and the
layout matches what the docs describe.

### Phase H — Documentation (L)

The phase most likely to be skipped and least likely to be forgiven.

**The docs site lives in its own repo**, so this phase does not build one. It splits into
what belongs in *this* repo and what is content owed to the docs repo — and the two have
different failure modes: in-repo docs rot silently against the code, site content rots
silently against the release.

**In this repo:**

1. **Rewrite `README.md`** — it currently shows v1 syntax with no indication that it is v1.
   With `legacy` kept, that syntax still works, which makes being precise about *which* API
   is being shown more important, not less.
2. **Fill in the rustdoc.** ~100 `TODO` markers, most standing in for the doc comment itself.
   Priorities: the request-flow overview (`procedure.rs:12-14`), the `Middleware` generics
   (`middleware.rs:51-81` — 8 TODOs in one block), and every `ProcedureStream` constructor.
   This is the documentation that ships with the crate and renders on docs.rs, so it is the
   part that cannot be delegated to the site.
3. **Fix the examples.** They are the de-facto integration tests *and* the code the docs will
   link to: `examples/client` (wire-incompatible), `examples/binario` (panics),
   `examples/core`'s cache/invalidation/tracing/zer usage, and `examples/legacy` — which
   becomes a *supported* example again rather than something to delete. Add one example per
   transport and per client binding.

**Owed to the docs repo** (write it here as drafts if that's easier, but it ships there):

4. **Migration guide.** The highest-value document we can produce, and the one every
   inherited user needs: the new names, how to turn on `legacy` and mount a v1 router inside a
   v2 one (`rspc/src/legacy.rs:21`), how to migrate procedure by procedure, which transport to
   pick, and what actually breaks.
5. **Getting started** — install, define a router, mount on axum, export bindings, call from a
   client. One page, copy-pasteable, and kept in sync with a real example from (3).
6. **A compatibility matrix** — which client versions talk to which transports and wire
   formats. Today this is knowable only by reading `jsonrpc_exec.rs` and `endpoint.rs` side by
   side.
7. **The wire formats** — JSON-RPC, v2 single, batch, batch+stream, SSE events, and the error
   envelope from Phase B.8. Anyone writing a non-JS client needs this; it exists nowhere.
8. **A guide per client package**, plus a recipe for "my framework has no binding" — which,
   after §1.8's split, is genuinely just a subscription hook over the shared proxy.

**Also:** point rspc.dev's successor at the right place, and make sure the archived upstream
docs are not the first search result people act on. A stale doc site that still describes v1
as current is worse than no site.

**Exit:** a stranger can install it, build a server and client, and migrate a v1 app without
reading the source. Every code sample in the docs repo corresponds to a compiling example in
this one.

### Phase I — Tests (M)

Runs alongside D–H, tracked separately so it doesn't get dropped.

1. Wire up TS testing at all — `vitest.config.ts`, `vitest` to `devDependencies`, `test`
   scripts, and real assertions in `next/index.test.ts` (it has none and would pass if every
   call silently failed).
2. Cover middleware end-to-end, including context switching (Phase C.4).
3. Cover the client: unsubscribe actually unsubscribes, SSE closes on error, batch failures
   reject rather than hang, abort works.
4. **Round-trip tests per transport** — a real server, a real client, every procedure kind,
   over HTTP, SSE and WebSocket. This is what would have caught the Rust client's wire
   incompatibility.
5. **A v1-compat regression test** — a v1-syntax router mounted via `legacy`, called by a v1
   client. Backward compatibility that isn't tested isn't backward compatibility.

**Exit:** every bug in §1.2 and §1.4 has a regression test.

### Phase J — Release (M)

1. **Settle the name** (§2) and apply it across crates, packages, docs and examples.
2. **Synchronise versions** — one version across all crates and packages, starting fresh.
3. **Address the `specta` RC pin.** `=2.0.0-rc.22` is an exact pre-1.0 pin under the whole
   type system. Wait for stable, relax the pin, or document that our stability is bounded by
   it.
4. **Rewrite `publish.sh`** — publish Rust crates in dependency order and TS packages via
   `pnpm publish -r`. It currently publishes zero TS packages.
5. **Automate release in CI**, with a dry-run on every PR.
6. **Add the crate metadata** every satellite is missing (`# TODO: Crate metadata & publish`):
   description, keywords, categories, repository, license, readme.
7. **Rename the branch to `v2`, then fast-forward `main`** (§2).
8. **Write a CHANGELOG** and state a support policy — what's stable, what's experimental,
   what MSRV, and **how long the v1 compat layer is supported**.

**Exit:** `cargo add <name>` and `npm i <scope>/client` work, and docs.rs renders.

---

## 4. Open decisions

**`D-7` — What is the error envelope?** *(now the blocking one)*
Three shapes go out on the wire today: a resolver error serializes as the user's bare value;
`ProcedureError`'s own `Serialize` emits `{"~rspc": true, "variant", "message"}`
(`crates/procedure/src/error.rs:108`); and `rspc-axum` emits `{"__rspc": "<string>"}` from its
own macro (`integrations/axum/src/next.rs:38`). Two markers, two shapes, same class of error.
**No client reads either** — `grep '__rspc\|~rspc' packages/*/src` is empty — so they are
write-only today and standardizing breaks nothing. This got sharper with `1140a84`: the 400
path now actually fires, so clients start receiving framework errors they never saw before,
and cannot tell them apart from a typed application error.
Recommendation: one envelope for framework errors, emitted from one place, with user errors
staying bare so typed errors remain ergonomic. That requires constructing
`ProcedureError::NotFound` (`D-8`) so axum's ad-hoc cases can flow through the real
serializer instead of the macro.

**`D-8` — Wire up or delete `ProcedureError::NotFound`?** Never constructed anywhere; both
integrations meet it with `unimplemented!()`. Folded into `D-7`: wiring it up is what lets
the envelope be produced in one place.

**`D-9` — Do the v1 TypeScript packages stay, now that no server speaks JSON-RPC?**
`@rspc/client/legacy`, `@rspc/query-core`, `@rspc/tanstack-query` and the `*/legacy` bindings
are a client for a wire format neither integration serves any more. Either delete them, or
revive a compat transport. Leaving them is the one option that misleads.

**`D-1` — Does the v1 compatibility layer stay?**
**Recommendation: yes, and it is close to non-negotiable.** Upstream is gone, so this fork is
the only migration target its users have; `crates/legacy` plus `rspc/src/legacy.rs`'s
`From<rspc_legacy::Router>` is what lets them move incrementally instead of rewriting in one
commit. The cost is real — it keeps `jsonrpc*.rs`, the v1 client, `ProceduresLegacy` export
and `examples/legacy` alive, and every one needs tests and docs. But deleting it converts
"upstream died, here's where to go" into "upstream died, rewrite from scratch." Separately
decide whether it stays a *default* feature; opt-in under a new package name is defensible.

**`D-2` — What wire format do WebSockets speak?**
`endpoint.rs` speaks JSON-RPC. Options: keep WS as the JSON-RPC/compat transport only; port
WS to the v2 shape; or support both. Keeping JSON-RPC on WS is the cheapest and preserves v1
clients unchanged — but then the v2 client's `wsExecute` must speak JSON-RPC too, which is
worth being explicit about before it's built.

**`D-3` — Does the Rust client survive?**
It cannot talk to the v2 HTTP transport but would work against JSON-RPC. Re-point, rewrite,
or delete — leaving it broken helps nobody.

**`D-4` — Is `rspc::Stream`-in-a-query worth keeping?**
It is the direct cause of the subscription type bug, because one `ResolverOutput` impl serves
two different semantics. A genuinely nice feature, but worth asking whether the complexity
earns its place before building more on it.

**`D-5` — What is the stability promise?**
Given the specta RC pin, `0.x` with a clear "expect breaking changes" note is more honest
than implying stability the dependency graph cannot back.

**`D-6` — Which frameworks are supported?**
React, Solid, Svelte 5 and Tauri is a defensible line, with a documented recipe for building
your own on `UntypedClient`. Decide explicitly rather than by which packages happen to exist.

---

## 5. Suggested order

```
A  compat decision + build + CI  ─→  B  correctness  ─→  C  server surface  ─→  D  type export
                                            │                    │
                                            │                    └─→ unblocks cache + invalidation
                                            ├─→  E  transports (port WS)  ─┐
                                            └─→  F  clients  ──────────────┴─→  G  cleanup
I  tests ─── runs alongside D–H, not after
                                                          H  docs  ─→  J  release
```

**A and B are the ones worth doing immediately.** They are small, and until they land the
repo does not build and the server panics on malformed input — no work elsewhere matters
while that is true. A also forces the compat decision, which changes the shape of E, F, G and
H, so it genuinely cannot be deferred.

**C through F are the bulk of "usable by other people."** F is the single largest piece,
because three framework bindings still need v2 ports and one of them cannot be installed by
Svelte 5 users at all.

**H is the phase most likely to be skipped.** A correct library whose README describes an API
the reader can't find reads, to a newcomer, exactly like a broken one — and with v1 syntax
still supported behind a feature flag, being precise about *which* API is which matters more
here than it would in most projects. The docs site being a separate repo makes this easier to
defer and harder to notice, which is a reason to schedule it, not a reason to relax.
