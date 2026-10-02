# Changelog

This changelog intentionally starts at **0.1.0**.

## 0.3.0 - 2026-10-02

### Fix the system prompt and every tool being dropped on Pi 1.0.0

Pi 1.0.0 replaced the provider-facing `Context` with `TranscriptContext`, which carries
only `messages`: `systemPrompt` and `tools` are folded into a leading `system` message
by `normalizeContext()`, and the top-level fields no longer exist.

Reading them returned `undefined` rather than throwing, so on the WebSocket path — the
**default** transport for direct `openai/*` Responses models — the extension requested
tools with `tools: undefined` and no `instructions`, and the folded `system` message was
discarded by `convertMessagesToInputItems` as well. The requests still succeeded, so the
symptom was a model that simply never called a tool and ignored its instructions.

New `src/transcript-compat.ts` resolves prompt and tools from either shape, preferring
the legacy fields when populated so 0.8x behaviour is unchanged. The replay is
implemented locally rather than imported from `@earendil-works/pi-ai/utils/transcript`
because that subpath does not exist on the 0.8x line.

### Fix a typecheck that could not see the break

`npm test` passed throughout, because `tsc` resolved `@earendil-works/*` from devDeps
pinned to `0.80.9` while the runtime API had moved on. The devDeps now track the current
Pi, so the typecheck fails where the behaviour would.

Also resolved the remaining errors against 1.0.0: `ToolCall.arguments` is now `JsonObject`,
`AgentMessage` widened so `provider`/`model` need narrowing, and two casts that suppressed
the `Context`/`TranscriptContext` mismatch were replaced with explicit, documented ones.

### Add regression coverage for the transcript shape

`scripts/smoke.mjs` now asserts that a 1.0.0 transcript is read correctly (tools replayed,
prompt and sections replayed, tool deltas applied in order), that the legacy shape still
takes precedence, and that an absent prompt stays `undefined` rather than becoming an
empty string. Reintroducing the old field reads makes the suite fail.

### Peer range

The `>=0.80.9 <0.88.0` upper bound is gone — it excluded the versions whose contract the
code was never updated to meet — and is now `>=0.80.9`.

### Upstream

- add a reproducible native-vs-text compaction benchmark, retained GPT-5.6 Sol evidence, and a standalone report
- add a fixed-context, information-density-calibrated product-defaults benchmark comparing Pi's real default compactor with the extension's real native replay policy

## 0.2.1 - 2026-09-28

### Fix global config path resolution

`loadConfig()` resolved the global config at a hardcoded `homedir()/.pi/agent/`,
ignoring `PI_CODING_AGENT_DIR`. Under a relocated agent directory it therefore
read the wrong file — or none — so `proxyProviders` and `compactionReasoningEffort`
silently fell back to defaults while the request still went through the gateway
path by env var. Now resolved through Pi's own `getAgentDir()`.

The import is safe at runtime because Pi aliases `@earendil-works/pi-coding-agent`
for extension modules (`dist/core/extensions/loader.js`), which is also how the
existing `src/remote-compaction.ts` imports `compact`/`convertToLlm`.

## 0.2.0 - 2026-09-28

First release of the `@yiki21/pi-openai-server-compaction` fork.

### Gateway / reseller provider support

- add `proxyProviders`: an opt-in list of non-`openai` provider ids that speak the
  Responses wire format, enabling remote compaction and opaque history replay for them
- keep `store`, `context_management`, `previous_response_id`, and the WebSocket transport
  disabled on that path; the failure mode of those optimizations on a third-party backend
  is silent context corruption rather than an error
- do not send Codex machine-identity headers (`x-codex-installation-id`,
  `x-codex-beta-features`) to a gateway
- preserve the leading `developer`/`system` item of `input` when replaying history: the
  `openai-responses` adapter keeps the system prompt there, not in `instructions`
- drop `context_edit`-omitted entries, apply `context_edit` content replacements, and
  exclude failed/aborted assistant attempts from replayed history, so an exhausted retry
  cannot re-enter context permanently
- add `compactionReasoningEffort` to lower the reasoning effort of the remote compaction
  request alone
- widen the Pi peer range to `>=0.80.9 <0.88.0` and live-test the gateway path on Pi 0.87.1
- extend the offline smoke test with gateway eligibility, header redaction, replay-shaped
  patching, and context-edit projection assertions

During local development on 2026-04-09, the project used temporary internal version bumps while features, tests, docs, and packaging were being assembled. Those local-only bumps were collapsed before the first public push so the repository does not imply a longer tracked public release history than it actually has.

## 0.1.0 - 2026-04-09
- initial public release
- added hybrid Codex-style remote compaction for direct OpenAI Responses models
- added OpenAI `POST /v1/responses/compact` integration
- persisted opaque replacement history in Pi compaction details
- reconstructed remote compaction state across resume/reload/tree navigation
- added WS-backed continuation and conservative `previous_response_id` reuse
- tightened direct OpenAI continuation so unchanged request shapes send only incremental post-turn deltas instead of replaying full input alongside `previous_response_id`
- fixed reconstructed post-compaction remote replay to exclude turns completed by other models after later resume/tree reconstruction
- kept portable Pi text summaries as the readable fallback and non-OpenAI portability path
- hardened cross-model runtime state handling and remote output validation
- mirrored observed Responses `reasoning` and `text` tuning into remote compaction requests when available, with thinking-level fallback for reasoning
- fixed the direct OpenAI WS path to carry reasoning configuration and encrypted-reasoning inclusion like Pi's normal HTTP Responses path
- persisted remote compaction usage metadata when the backend returns it
- added a reduced-plaintext live replay regression with tiny Pi `keepRecentTokens`
- added a live Pi RPC regression harness in `tests/live/openai-compaction-rpc-live.ts`
- added a local smoke harness that bootstraps Pi peer-package links and runs small regression checks
- added `ARCHITECTURE.md`, testing docs, packaging polish, and MIT licensing
