/**
 * Configuration loading for the extension.
 *
 * Reads global/project JSON config files plus environment overrides and exposes
 * a normalized, fully-populated runtime config object.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type JsonRecord = Record<string, unknown>;

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

const REASONING_EFFORTS: readonly ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh"];

export type ExtensionConfig = {
  enabled?: boolean;
  includeAzure?: boolean;
  compactThreshold?: number;
  thresholdRatio?: number;
  notify?: boolean;
  usePreviousResponseId?: boolean;
  /**
   * Extra provider ids that speak the OpenAI Responses wire format but are not
   * `openai` itself — typically a gateway or reseller in front of it.
   *
   * These get remote compaction and history replay only. `store: true`,
   * `context_management`, `previous_response_id`, and the WebSocket transport
   * stay off: they are direct-OpenAI optimizations whose failure mode on a
   * third-party backend is silent context corruption rather than an error.
   */
  proxyProviders?: string[];
  /**
   * Reasoning effort for the remote compaction request only. `null` keeps the
   * upstream behavior of mirroring the last observed turn, which under a high
   * session thinking level makes compaction the slowest request of the run.
   */
  compactionReasoningEffort?: ReasoningEffort | null;
};

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonFile(path: string): JsonRecord | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function toPositiveNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

export function toStringList(value: unknown): string[] | undefined {
  const parts = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : undefined;
  if (!parts) return undefined;
  const cleaned = parts
    .filter((part): part is string => typeof part === "string")
    .map((part) => part.trim())
    .filter(Boolean);
  return cleaned.length > 0 ? [...new Set(cleaned)] : undefined;
}

export function loadConfig(cwd: string): Required<ExtensionConfig> {
  const globalPath = join(homedir(), ".pi", "agent", "openai-server-compaction.json");
  const projectPath = join(cwd, ".pi", "openai-server-compaction.json");
  const globalCfg = readJsonFile(globalPath) ?? {};
  const projectCfg = readJsonFile(projectPath) ?? {};
  const merged = { ...globalCfg, ...projectCfg };

  return {
    enabled:
      toBoolean(process.env.PI_OPENAI_SERVER_COMPACTION_ENABLED) ??
      toBoolean(merged.enabled) ??
      true,
    includeAzure:
      toBoolean(process.env.PI_OPENAI_SERVER_COMPACTION_AZURE) ??
      toBoolean(merged.includeAzure) ??
      false,
    compactThreshold:
      toPositiveNumber(process.env.PI_OPENAI_SERVER_COMPACTION_THRESHOLD) ??
      toPositiveNumber(merged.compactThreshold) ??
      0,
    thresholdRatio:
      toPositiveNumber(process.env.PI_OPENAI_SERVER_COMPACTION_RATIO) ??
      toPositiveNumber(merged.thresholdRatio) ??
      0.7,
    notify:
      toBoolean(process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY) ??
      toBoolean(merged.notify) ??
      false,
    usePreviousResponseId:
      toBoolean(process.env.PI_OPENAI_SERVER_COMPACTION_PREVIOUS_RESPONSE_ID) ??
      toBoolean(merged.usePreviousResponseId) ??
      true,
    proxyProviders:
      toStringList(process.env.PI_OPENAI_SERVER_COMPACTION_PROXY_PROVIDERS) ??
      toStringList(merged.proxyProviders) ??
      [],
    compactionReasoningEffort:
      toReasoningEffort(process.env.PI_OPENAI_SERVER_COMPACTION_REASONING_EFFORT) ??
      toReasoningEffort(merged.compactionReasoningEffort) ??
      null,
  };
}

function toReasoningEffort(value: unknown): ReasoningEffort | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return (REASONING_EFFORTS as readonly string[]).includes(normalized)
    ? (normalized as ReasoningEffort)
    : undefined;
}

export function toPositiveInteger(value: unknown): number | undefined {
  const numeric = toPositiveNumber(value);
  return numeric ? Math.floor(numeric) : undefined;
}
