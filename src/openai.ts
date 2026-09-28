/**
 * OpenAI/Azure/Codex model and payload helpers.
 *
 * Keeps provider-specific detection, request patching, endpoint classification,
 * and model-key logic out of the higher-level extension wiring.
 */
import type { ProviderHeaders } from "@earendil-works/pi-ai";
import type { ExtensionConfig, JsonRecord } from "./config.ts";
import type { ResponsesReasoningConfig, ResponsesTextConfig } from "./remote-compaction.ts";
import { isRecord, toPositiveInteger } from "./config.ts";

export type ModelLike = {
  api?: unknown;
  provider?: unknown;
  id?: unknown;
  baseUrl?: unknown;
  compat?: unknown;
  contextWindow?: unknown;
  reasoning?: unknown;
  input?: readonly unknown[];
};

type PreviousResponseIdConfig = Pick<ExtensionConfig, "includeAzure">;

type EligibilityConfig = { proxyProviders?: readonly string[] | undefined } | undefined;

/**
 * Pi >= 0.87 types provider headers as `Record<string, string | null>`, where a
 * `null` value means "delete this header". A raw `fetch` has no such convention,
 * so nulls are dropped instead of being sent as the string "null".
 */
export function sanitizeProviderHeaders(
  headers: ProviderHeaders | undefined,
): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(
    Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

type AssistantMessageLike = {
  role?: unknown;
  provider?: unknown;
  model?: unknown;
  responseId?: unknown;
  stopReason?: unknown;
};

export function hostnameFromBaseUrl(baseUrl: unknown): string | undefined {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) return undefined;
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function supportsStore(model: unknown): boolean {
  if (!isRecord(model)) return true;
  const compat = model.compat;
  if (!isRecord(compat)) return true;
  return compat.supportsStore !== false;
}

export function isOpenAIResponsesModel(model: unknown): model is ModelLike {
  return (
    isRecord(model) &&
    (
      model.api === "openai-responses" ||
      model.api === "azure-openai-responses" ||
      model.api === "openai-codex-responses"
    )
  );
}

export function isDirectOpenAIResponsesModel(model: ModelLike): boolean {
  if (model.api !== "openai-responses") return false;
  if (model.provider !== "openai") return false;
  const host = hostnameFromBaseUrl(model.baseUrl);
  return host === undefined || host === "api.openai.com";
}

export function isAzureOpenAIResponsesModel(model: ModelLike): boolean {
  if (model.api !== "azure-openai-responses" && model.api !== "openai-responses") return false;
  const provider = typeof model.provider === "string" ? model.provider : "";
  if (provider === "azure-openai" || provider === "azure-openai-responses") return true;
  const host = hostnameFromBaseUrl(model.baseUrl);
  return typeof host === "string" && host.endsWith(".openai.azure.com");
}

/**
 * A non-`openai` provider id that the user has declared Responses-compatible.
 *
 * Only two things follow from this: remote compaction, and replaying the
 * resulting opaque history. The direct-OpenAI request patches and the
 * WebSocket transport explicitly do NOT — see `proxyProviders` in config.ts.
 */
export function isProxiedOpenAIResponsesModel(
  model: unknown,
  cfg: EligibilityConfig,
): model is ModelLike {
  if (!isRecord(model)) return false;
  if (model.api !== "openai-responses") return false;
  const provider = typeof model.provider === "string" ? model.provider : "";
  if (!provider || provider === "openai" || provider === "azure-openai") return false;
  return (cfg?.proxyProviders ?? []).includes(provider);
}

export function isOpenAICodexResponsesModel(model: ModelLike): boolean {
  if (model.api !== "openai-codex-responses") return false;
  const provider = typeof model.provider === "string" ? model.provider : "";
  if (provider === "openai-codex") return true;
  const host = hostnameFromBaseUrl(model.baseUrl);
  return host === "chatgpt.com";
}

export function supportsPreviousResponseId(
  model: unknown,
  cfg: PreviousResponseIdConfig,
): model is ModelLike {
  if (!isOpenAIResponsesModel(model)) return false;
  if (isDirectOpenAIResponsesModel(model)) return true;
  return Boolean(cfg.includeAzure) && isAzureOpenAIResponsesModel(model);
}

export function supportsRemoteCompactionModel(
  model: unknown,
  cfg: EligibilityConfig,
): model is ModelLike {
  if (!isOpenAIResponsesModel(model)) return false;
  return Boolean(
    isDirectOpenAIResponsesModel(model) ||
    isOpenAICodexResponsesModel(model) ||
    isProxiedOpenAIResponsesModel(model, cfg),
  );
}

export function resolveCompactThreshold(
  model: ModelLike,
  cfg: Required<ExtensionConfig>,
): number {
  if (cfg.compactThreshold > 0) return Math.floor(cfg.compactThreshold);
  const contextWindow = toPositiveInteger(model.contextWindow);
  if (contextWindow) return Math.max(1000, Math.floor(contextWindow * cfg.thresholdRatio));
  return 80000;
}

export function looksLikeResponsesPayload(payload: JsonRecord): boolean {
  return "input" in payload || "model" in payload || "messages" in payload;
}

export function modelKey(model: ModelLike): string {
  return `${String(model.provider)}:${String(model.api)}:${String(model.id)}`;
}

export function applyPayloadPatch(params: {
  payload: JsonRecord;
  model: ModelLike;
  cfg: Required<ExtensionConfig>;
  previousResponseId?: string;
}): JsonRecord {
  const nextPayload: JsonRecord = { ...params.payload };

  if (supportsStore(params.model)) {
    nextPayload.store = true;
  }

  if (nextPayload.context_management === undefined) {
    nextPayload.context_management = [
      {
        type: "compaction",
        compact_threshold: resolveCompactThreshold(params.model, params.cfg),
      },
    ];
  }

  if (
    params.cfg.usePreviousResponseId &&
    params.previousResponseId &&
    nextPayload.previous_response_id === undefined
  ) {
    nextPayload.previous_response_id = params.previousResponseId;
  }

  return nextPayload;
}

export function thinkingLevelToResponsesReasoning(
  thinkingLevel: unknown,
): ResponsesReasoningConfig | undefined {
  if (thinkingLevel === "minimal") return { effort: "minimal", summary: "auto" };
  if (thinkingLevel === "low") return { effort: "low", summary: "auto" };
  if (thinkingLevel === "medium") return { effort: "medium", summary: "auto" };
  if (thinkingLevel === "high") return { effort: "high", summary: "auto" };
  if (thinkingLevel === "xhigh") return { effort: "xhigh", summary: "auto" };
  return undefined;
}

export function applyRemoteHistoryPayloadPatch(params: {
  payload: JsonRecord;
  explicitHistory: unknown[];
}): JsonRecord {
  const nextPayload: JsonRecord = {
    ...params.payload,
    input: params.explicitHistory,
  };
  delete nextPayload.messages;
  delete nextPayload.previous_response_id;
  return nextPayload;
}

/**
 * History replay for a gateway/reseller provider.
 *
 * Differs from the Codex patch above in one way that matters: the `openai-responses`
 * adapter keeps the system prompt as the *first item of `input`* (a `developer`
 * message) rather than in a top-level `instructions` field. Replacing `input`
 * wholesale therefore throws the system prompt away, which the backend accepts
 * without complaint. Keep the leading block and replace only what follows.
 *
 * `previous_response_id` is always dropped: a proxied backend may route each
 * request to a different upstream, so a response id captured here is not
 * guaranteed to resolve later.
 */
export function applyProxiedHistoryPayloadPatch(params: {
  payload: JsonRecord;
  explicitHistory: unknown[];
}): JsonRecord {
  const input = Array.isArray(params.payload.input) ? params.payload.input : [];
  const leadingBlock: unknown[] = [];
  for (const item of input) {
    if (!isRecord(item)) break;
    const role = item.role;
    if (role !== "developer" && role !== "system") break;
    leadingBlock.push(item);
  }

  const nextPayload: JsonRecord = {
    ...params.payload,
    input: [...leadingBlock, ...params.explicitHistory],
  };
  delete nextPayload.messages;
  delete nextPayload.previous_response_id;
  return nextPayload;
}

export function extractResponsesReasoningConfig(payload: unknown): ResponsesReasoningConfig | undefined {
  if (!isRecord(payload) || !isRecord(payload.reasoning)) return undefined;
  const effort = payload.reasoning.effort;
  const summary = payload.reasoning.summary;
  const normalized: ResponsesReasoningConfig = {
    ...(typeof effort === "string" ? { effort: effort as ResponsesReasoningConfig["effort"] } : {}),
    ...(
      summary === null || typeof summary === "string"
        ? { summary: summary as ResponsesReasoningConfig["summary"] }
        : {}
    ),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function extractResponsesTextConfig(payload: unknown): ResponsesTextConfig | undefined {
  return isRecord(payload) && isRecord(payload.text) ? payload.text : undefined;
}

export function extractAssistantResponseId(message: unknown): string | undefined {
  if (!isRecord(message)) return undefined;
  const msg = message as AssistantMessageLike;
  if (msg.role !== "assistant") return undefined;
  if (msg.stopReason === "error" || msg.stopReason === "aborted") return undefined;
  return typeof msg.responseId === "string" && msg.responseId.trim()
    ? msg.responseId
    : undefined;
}

export function messageMatchesModel(message: unknown, model: ModelLike): boolean {
  if (!isRecord(message)) return false;
  return message.provider === model.provider && message.model === model.id;
}
