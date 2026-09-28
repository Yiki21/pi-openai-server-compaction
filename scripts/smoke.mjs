import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, lstatSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localNodeModules = join(repoRoot, "node_modules");

function packagePathSegments(packageName) {
  return packageName.split("/");
}

function npmGlobalRoot() {
  try {
    return execFileSync("npm", ["root", "-g"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function candidateRoots() {
  const roots = new Set();
  roots.add(localNodeModules);

  const globalRoot = npmGlobalRoot();
  if (globalRoot) roots.add(globalRoot);

  const voltaPiRoot = join(
    homedir(),
    ".volta",
    "tools",
    "image",
    "packages",
    "@earendil-works",
    "pi-coding-agent",
    "lib",
    "node_modules",
  );
  roots.add(voltaPiRoot);
  roots.add(join(voltaPiRoot, "@earendil-works", "pi-coding-agent", "node_modules"));

  return [...roots];
}

function resolveInstalledPackageDir(packageName) {
  const segments = packagePathSegments(packageName);
  for (const root of candidateRoots()) {
    const dir = join(root, ...segments);
    const packageJsonPath = join(dir, "package.json");
    if (existsSync(packageJsonPath)) {
      return dir;
    }
  }
  return undefined;
}

function ensureLocalPeerLink(packageName) {
  const localDir = join(localNodeModules, ...packagePathSegments(packageName));
  if (existsSync(join(localDir, "package.json"))) {
    return;
  }

  const targetDir = resolveInstalledPackageDir(packageName);
  if (!targetDir) {
    throw new Error(
      `Unable to locate peer dependency ${packageName}. Install Pi or add the package locally before running smoke.`,
    );
  }

  mkdirSync(dirname(localDir), { recursive: true });
  if (existsSync(localDir)) {
    const stat = lstatSync(localDir);
    if (stat.isSymbolicLink() || stat.isDirectory()) {
      rmSync(localDir, { recursive: true, force: true });
    }
  }
  symlinkSync(targetDir, localDir, "dir");
}

for (const packageName of [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
]) {
  ensureLocalPeerLink(packageName);
}

const { default: extensionFactory } = await import(pathToFileURL(join(repoRoot, "src", "index.ts")).href);
assert.equal(typeof extensionFactory, "function", "extension entrypoint should export a function");

const {
  buildCodexWebSocketHeaders,
  buildRemoteCompactionHeaders,
  buildRemoteCompactionDetails,
  buildRemoteCompactionRequestBody,
  buildRemoteCompactionV2History,
  extractRemoteCompactionDetails,
  normalizeResponseItemsForPrompt,
  parseRemoteCompactionV2Events,
  processCompactedHistory,
  reconstructRemoteCompactionStateFromBranch,
  remoteCompactionV2EndpointUrl,
} = await import(pathToFileURL(join(repoRoot, "src", "remote-compaction.ts")).href);
const {
  selectInputItemsForContinuation,
} = await import(pathToFileURL(join(repoRoot, "src", "openai-ws-stream.ts")).href);

const targetModelKey = "openai:openai-responses:gpt-5.4-nano";
const reconstructed = reconstructRemoteCompactionStateFromBranch({
  branchEntries: [
    {
      type: "compaction",
      id: "cmp-1",
      details: {
        remoteCompaction: {
          version: 1,
          provider: "openai-responses-compact",
          modelKey: targetModelKey,
          replacementHistory: [
            {
              type: "compaction",
              encrypted_content: "ENCRYPTED",
            },
          ],
        },
      },
    },
    {
      type: "message",
      id: "user-a1",
      message: {
        role: "user",
        content: [{ type: "text", text: "KEEP_ME_ONE" }],
      },
    },
    {
      type: "message",
      id: "assistant-a1",
      message: {
        role: "assistant",
        provider: "openai",
        api: "openai-responses",
        model: "gpt-5.4-nano",
        content: [{ type: "text", text: "KEEP_REPLY_ONE" }],
      },
    },
    {
      type: "message",
      id: "user-b1",
      message: {
        role: "user",
        content: [{ type: "text", text: "DROP_ME" }],
      },
    },
    {
      type: "message",
      id: "assistant-b1",
      message: {
        role: "assistant",
        provider: "anthropic",
        api: "anthropic-messages",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "DROP_REPLY" }],
      },
    },
    {
      type: "message",
      id: "user-a2",
      message: {
        role: "user",
        content: [{ type: "text", text: "KEEP_ME_TWO" }],
      },
    },
    {
      type: "message",
      id: "assistant-a2",
      message: {
        role: "assistant",
        provider: "openai",
        api: "openai-responses",
        model: "gpt-5.4-nano",
        content: [{ type: "text", text: "KEEP_REPLY_TWO" }],
      },
    },
  ],
});
assert.ok(reconstructed, "expected reconstructed remote compaction state");
const reconstructedJson = JSON.stringify(reconstructed.explicitHistory);
assert.match(reconstructedJson, /KEEP_ME_ONE/);
assert.match(reconstructedJson, /KEEP_REPLY_ONE/);
assert.match(reconstructedJson, /KEEP_ME_TWO/);
assert.match(reconstructedJson, /KEEP_REPLY_TWO/);
assert.doesNotMatch(reconstructedJson, /DROP_ME/);
assert.doesNotMatch(reconstructedJson, /DROP_REPLY/);

const requestBody = buildRemoteCompactionRequestBody({
  model: {
    id: "gpt-5.4-nano",
  },
  input: [{ type: "compaction", encrypted_content: "ENCRYPTED" }],
  instructions: "system",
  tools: [{ type: "function", name: "read" }],
  parallelToolCalls: true,
  reasoning: { effort: "high", summary: "auto" },
  text: { verbosity: "medium" },
});
assert.equal(requestBody.model, "gpt-5.4-nano");
assert.equal(requestBody.stream, true);
assert.equal(requestBody.store, false);
assert.equal(requestBody.tool_choice, "auto");
assert.deepEqual(requestBody.include, ["reasoning.encrypted_content"]);
assert.deepEqual(requestBody.input.at(-1), { type: "compaction_trigger" });
assert.deepEqual(requestBody.reasoning, { effort: "high", summary: "auto" });
assert.deepEqual(requestBody.text, { verbosity: "medium" });
assert.equal(
  remoteCompactionV2EndpointUrl({
    provider: "openai",
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
  }),
  "https://api.openai.com/v1/responses",
);
assert.equal(
  remoteCompactionV2EndpointUrl({
    provider: "openai-codex",
    api: "openai-codex-responses",
    baseUrl: "https://chatgpt.com/backend-api",
  }),
  "https://chatgpt.com/backend-api/codex/responses",
);

const parsedV2Events = parseRemoteCompactionV2Events([
  {
    type: "response.output_item.done",
    item: { type: "compaction", encrypted_content: "V2_ENCRYPTED" },
  },
  {
    type: "response.completed",
    response: { usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } },
  },
]);
assert.equal(parsedV2Events.compactionItem.type, "compaction");
const v2History = buildRemoteCompactionV2History(
  [
    { type: "message", role: "user", content: [{ type: "input_text", text: "retain user" }] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "summarize assistant" }] },
  ],
  parsedV2Events.compactionItem,
);
assert.deepEqual(v2History.map((item) => item.type), ["message", "compaction"]);
assert.equal(v2History[0].role, "user");

const normalizedPromptItems = normalizeResponseItemsForPrompt(
  [
    { type: "ghost_snapshot", data: "hidden" },
    {
      type: "message",
      role: "user",
      content: [{ type: "input_image", image_url: "data:image/png;base64,AAAA" }],
    },
    { type: "function_call", name: "read", call_id: "call-1", arguments: "{}" },
    { type: "function_call_output", call_id: "orphan", output: "drop" },
    { type: "image_generation_call", result: "base64" },
  ],
  { input: ["text"] },
);
assert.equal(normalizedPromptItems[0].type, "message");
assert.deepEqual(normalizedPromptItems[0].content, [
  { type: "input_text", text: "image content omitted because you do not support image input" },
]);
assert.deepEqual(normalizedPromptItems[2], {
  type: "function_call_output",
  call_id: "call-1",
  output: "aborted",
});
assert.equal(normalizedPromptItems[3].result, "");
assert.doesNotMatch(JSON.stringify(normalizedPromptItems), /orphan|ghost_snapshot/);

const compactedHistory = processCompactedHistory([
  { type: "message", role: "developer", content: [{ type: "input_text", text: "drop developer" }] },
  { type: "message", role: "user", content: [] },
  { type: "message", role: "user", content: [{ type: "input_text", text: "keep user" }] },
  { type: "message", role: "assistant", content: [{ type: "output_text", text: "keep assistant" }] },
  { type: "function_call", name: "read", call_id: "call-2", arguments: "{}" },
  { type: "compaction", encrypted_content: "keep" },
]);
assert.deepEqual(compactedHistory.map((item) => item.type), ["message", "message", "compaction"]);
assert.equal(compactedHistory[0].role, "user");
assert.equal(compactedHistory[1].role, "assistant");

const compactionHeaders = buildRemoteCompactionHeaders({
  model: {
    provider: "openai",
    api: "openai-responses",
    id: "gpt-5.4-nano",
  },
  apiKey: "sk-test",
  sessionId: "session-123",
  headers: { "x-extra": "yes" },
});
assert.equal(compactionHeaders.authorization, "Bearer sk-test");
assert.equal(compactionHeaders.session_id, "session-123");
assert.equal(compactionHeaders["x-codex-window-id"], "session-123:0");
assert.match(compactionHeaders["x-codex-installation-id"], /^[0-9a-f-]{36}$/);
assert.equal(compactionHeaders["x-extra"], "yes");
assert.equal(compactionHeaders["x-codex-beta-features"], "remote_compaction_v2");
assert.equal(compactionHeaders.accept, "text/event-stream");

const websocketHeaders = buildCodexWebSocketHeaders("session-123");
assert.equal(websocketHeaders["x-client-request-id"], "session-123");
assert.equal(websocketHeaders.session_id, "session-123");
assert.equal(websocketHeaders["x-codex-window-id"], "session-123:0");

const detailsRoundTrip = extractRemoteCompactionDetails({
  remoteCompaction: buildRemoteCompactionDetails(
    {
      provider: "openai",
      api: "openai-responses",
      id: "gpt-5.4-nano",
    },
    [{ type: "compaction", encrypted_content: "ENCRYPTED" }],
    {
      input: 10,
      output: 20,
      cacheRead: 30,
      cacheWrite: 40,
      totalTokens: 100,
      cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
    },
  ),
});
assert.ok(detailsRoundTrip, "expected remote compaction details round trip");
assert.equal(detailsRoundTrip.usage?.cacheWrite, 40);
assert.equal(detailsRoundTrip.usage?.cost.total, 10);

const incrementalInput = selectInputItemsForContinuation({
  context: {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "old user" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "old assistant" }],
      },
      {
        role: "user",
        content: [{ type: "text", text: "new user" }],
      },
    ],
  },
  model: { input: ["text"] },
  session: { lastContextLength: 2 },
  currentModelKey: targetModelKey,
  remoteCompactionState: undefined,
  previousResponseId: "resp_123",
});
assert.deepEqual(incrementalInput, [
  {
    type: "message",
    role: "user",
    content: "new user",
  },
]);

const {
  applyProxiedHistoryPayloadPatch,
  isProxiedOpenAIResponsesModel,
  isDirectOpenAIResponsesModel,
  supportsRemoteCompactionModel,
  sanitizeProviderHeaders,
} = await import(pathToFileURL(join(repoRoot, "src", "openai.ts")).href);
const {
  isDiscardedAssistantMessage,
  projectBranchMessageEntries,
} = await import(pathToFileURL(join(repoRoot, "src", "remote-compaction.ts")).href);

// ---------------------------------------------------------------------------
// Proxied-provider support
// ---------------------------------------------------------------------------

const proxyModel = {
  api: "openai-responses",
  provider: "example-gateway",
  id: "gpt-5.6-sol",
  baseUrl: "https://gateway.example.com/v1",
};
const directModel = {
  api: "openai-responses",
  provider: "openai",
  id: "gpt-5.6-sol",
  baseUrl: "https://api.openai.com/v1",
};
const cfg = { proxyProviders: ["example-gateway"] };
const emptyCfg = { proxyProviders: [] };

// A gateway is only eligible when the user named it, and never becomes a
// "direct OpenAI" model — that predicate gates store/context_management/WS.
assert.equal(isProxiedOpenAIResponsesModel(proxyModel, cfg), true, "declared gateway should be eligible");
assert.equal(isProxiedOpenAIResponsesModel(proxyModel, emptyCfg), false, "undeclared provider must stay ineligible");
assert.equal(isProxiedOpenAIResponsesModel(directModel, cfg), false, "the built-in openai provider is not a gateway");
assert.equal(isProxiedOpenAIResponsesModel({ ...proxyModel, api: "anthropic-messages" }, cfg), false, "wrong wire format must be rejected");
assert.equal(isDirectOpenAIResponsesModel(proxyModel), false, "a gateway must never take the direct-OpenAI path");
assert.equal(supportsRemoteCompactionModel(proxyModel, cfg), true);
assert.equal(supportsRemoteCompactionModel(proxyModel, emptyCfg), false);
assert.equal(supportsRemoteCompactionModel(directModel, emptyCfg), true);
assert.equal(
  remoteCompactionV2EndpointUrl(proxyModel, cfg),
  "https://gateway.example.com/v1/responses",
  "gateway endpoint should reuse the Responses path at its own base URL",
);

// null means "delete this header" in Pi's header map; it must not be sent as the
// literal string "null", and it must not reach buildRemoteCompactionHeaders' output.
assert.deepEqual(sanitizeProviderHeaders({ a: "1", b: null, c: undefined }), { a: "1" });
const gatewayHeaders = buildRemoteCompactionHeaders({
  model: proxyModel,
  apiKey: "sk-test",
  headers: { "x-custom": "yes", "x-delete": null },
  sessionId: "session-1",
  cfg,
});
assert.equal(gatewayHeaders.authorization, "Bearer sk-test");
assert.equal(gatewayHeaders["x-custom"], "yes");
assert.equal("x-delete" in gatewayHeaders, false, "null headers must be dropped");
assert.equal(
  "x-codex-installation-id" in gatewayHeaders,
  false,
  "gateway requests must not carry Codex machine identity headers",
);
assert.equal("x-codex-beta-features" in gatewayHeaders, false);

// The Responses adapter keeps the system prompt as the first `input` item, so a
// replay that replaces the whole array silently drops it.
const proxiedPatch = applyProxiedHistoryPayloadPatch({
  payload: {
    model: "gpt-5.6-sol",
    input: [
      { role: "developer", content: "SYSTEM_PROMPT_TEXT" },
      { role: "user", content: "old turn" },
    ],
    store: false,
    context_management: [{ type: "compaction", compact_threshold: 1 }],
    previous_response_id: "resp_stale",
  },
  explicitHistory: [{ type: "compaction", encrypted_content: "OPAQUE" }],
});
assert.deepEqual(proxiedPatch.input, [
  { role: "developer", content: "SYSTEM_PROMPT_TEXT" },
  { type: "compaction", encrypted_content: "OPAQUE" },
]);
assert.equal(proxiedPatch.store, false, "gateway requests must not be switched to store: true");
assert.equal(
  proxiedPatch.context_management !== undefined,
  true,
  "pre-existing payload fields are left untouched by the replay patch",
);
assert.equal("previous_response_id" in proxiedPatch, false, "a stale response id must be dropped");

// context_edit omissions and exhausted-retry turns must not return to remote history.
const replayEntries = [
  {
    type: "compaction",
    id: "cmp-2",
    details: {
      remoteCompaction: {
        version: 2,
        provider: "openai-responses-compaction",
        implementation: "responses_compaction_v2",
        modelKey: targetModelKey,
        replacementHistory: [{ type: "compaction", encrypted_content: "OPAQUE" }],
      },
    },
  },
  {
    type: "message",
    id: "user-keep",
    message: { role: "user", content: [{ type: "text", text: "VISIBLE_USER" }] },
  },
  {
    type: "message",
    id: "assistant-omitted",
    message: {
      role: "assistant",
      provider: "openai",
      api: "openai-responses",
      model: "gpt-5.4-nano",
      content: [{ type: "text", text: "OMITTED_REPLY" }],
    },
  },
  { type: "context_edit", id: "edit-1", targetId: "assistant-omitted", replacement: null },
  {
    type: "message",
    id: "assistant-failed",
    message: {
      role: "assistant",
      provider: "openai",
      api: "openai-responses",
      model: "gpt-5.4-nano",
      stopReason: "error",
      content: [{ type: "text", text: "FAILED_REPLY" }],
    },
  },
  {
    // The retry that finally succeeded. Only this one may flush the pending user turn.
    type: "message",
    id: "assistant-retried",
    message: {
      role: "assistant",
      provider: "openai",
      api: "openai-responses",
      model: "gpt-5.4-nano",
      stopReason: "stop",
      content: [{ type: "text", text: "GOOD_REPLY" }],
    },
  },
];
const projectedReplay = projectBranchMessageEntries(replayEntries).map((entry) => entry.id);
assert.deepEqual(
  projectedReplay,
  ["user-keep", "assistant-retried"],
  "omitted and failed turns must be projected away",
);
assert.equal(
  isDiscardedAssistantMessage({ role: "assistant", stopReason: "aborted", content: [] }),
  true,
);
assert.equal(isDiscardedAssistantMessage({ role: "user", content: [] }), false);

const replayState = reconstructRemoteCompactionStateFromBranch({ branchEntries: replayEntries });
const replayStateJson = JSON.stringify(replayState?.explicitHistory ?? []);
assert.match(replayStateJson, /VISIBLE_USER/);
assert.match(replayStateJson, /GOOD_REPLY/);
assert.doesNotMatch(replayStateJson, /OMITTED_REPLY/, "a context-edited turn must not be replayed");
assert.doesNotMatch(replayStateJson, /FAILED_REPLY/, "a discarded attempt must not be replayed");
assert.equal(
  (replayStateJson.match(/VISIBLE_USER/g) ?? []).length,
  1,
  "the user turn must be flushed exactly once, by the successful retry",
);

// A content replacement is applied rather than ignored.
const replacedEntries = projectBranchMessageEntries([
  {
    type: "message",
    id: "u1",
    message: { role: "user", content: [{ type: "text", text: "ORIGINAL" }] },
  },
  {
    type: "context_edit",
    id: "e1",
    targetId: "u1",
    replacement: { content: [{ type: "text", text: "REPLACED" }] },
  },
]);
assert.equal(JSON.stringify(replacedEntries).includes("REPLACED"), true);
assert.equal(JSON.stringify(replacedEntries).includes("ORIGINAL"), false);

console.log("smoke ok");
