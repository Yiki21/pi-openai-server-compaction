/**
 * Transcript compatibility shim.
 *
 * Pi 1.0.0 replaced the provider-facing `Context` with `TranscriptContext`, which
 * carries only `messages`: the system prompt and tool declarations are folded into
 * a leading `system` message by `normalizeContext()`, and `Context.systemPrompt` /
 * `Context.tools` no longer exist.
 *
 * Reading the old fields on 1.0.0 yields `undefined` rather than throwing, so a
 * provider that keeps reading them silently sends neither instructions nor tools.
 * That silent failure is what this module prevents.
 *
 * Both shapes are supported, preferring the legacy fields when they are populated:
 *   0.8x — `context.systemPrompt` / `context.tools` (still populated)
 *   1.0+ — replayed from the transcript's `system` messages
 *
 * The replay is implemented here rather than imported from
 * `@earendil-works/pi-ai/utils/transcript` on purpose. That subpath exists on 1.0.x
 * but NOT on the 0.8x line, so a static import would fail to resolve at module load
 * on the older versions this package still supports. The logic is small and has
 * been stable across both lines: `content` accumulates, `sections` are patched by
 * name, and tools are applied as `toolsRemoved` then `toolsAdded` deltas in order.
 */
import type { Context, Tool } from "@earendil-works/pi-ai";

/** Any message list. Only `role: "system"` entries are read. */
type AnyMessages = readonly Record<string, unknown>[];

function messagesOf(context: Context): AnyMessages {
  const messages = (context as { messages?: unknown }).messages;
  return Array.isArray(messages) ? (messages as AnyMessages) : [];
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .join("");
}

/**
 * Replay transcript deltas into the current prompt text and tool set.
 *
 * Mirrors `getCurrentSystemMessage()`: later system messages append content and
 * patch `sections` by name (`null` removes), and tools resolve through ordered
 * `toolsRemoved` / `toolsAdded` deltas.
 */
function replay(messages: AnyMessages): { prompt: string; tools: Tool[] } {
  const texts: string[] = [];
  const sections = new Map<string, string>();
  const tools = new Map<string, Tool>();

  for (const message of messages) {
    if (!message || message.role !== "system") continue;

    const text = textOf(message.content);
    if (text.length > 0) texts.push(text);

    const declared = message.sections;
    if (declared && typeof declared === "object") {
      for (const [name, value] of Object.entries(declared as Record<string, unknown>)) {
        if (value === null) sections.delete(name);
        else if (typeof value === "string") sections.set(name, value);
      }
    }

    if (Array.isArray(message.toolsRemoved)) {
      for (const tool of message.toolsRemoved as { name?: unknown }[]) {
        if (tool && typeof tool.name === "string") tools.delete(tool.name);
      }
    }
    if (Array.isArray(message.toolsAdded)) {
      for (const tool of message.toolsAdded as Tool[]) {
        if (tool && typeof tool.name === "string") tools.set(tool.name, tool);
      }
    }
  }

  const prompt = [...texts, ...sections.values()].filter((part) => part.length > 0).join("\n\n");
  return { prompt, tools: [...tools.values()] };
}

/**
 * The tool declarations currently in effect.
 *
 * Prefers the legacy top-level field when present and non-empty, so 0.8x behaviour
 * is identical to before this shim. On 1.0.0 that field is absent and the tools are
 * replayed out of the transcript.
 */
export function contextTools(context: Context): Tool[] {
  const legacy = (context as { tools?: Tool[] }).tools;
  if (Array.isArray(legacy) && legacy.length > 0) return legacy;
  const replayed = replay(messagesOf(context)).tools;
  return replayed.length > 0 ? replayed : (Array.isArray(legacy) ? legacy : []);
}

/**
 * The system prompt currently in effect.
 *
 * Same preference order as {@link contextTools}. Returns `undefined` (never `""`)
 * when there is no prompt, so callers keep their `?? undefined` defaults and the
 * request omits `instructions` instead of sending an empty string.
 */
export function contextSystemPrompt(context: Context): string | undefined {
  const legacy = (context as { systemPrompt?: string }).systemPrompt;
  if (typeof legacy === "string" && legacy.length > 0) return legacy;
  const replayed = replay(messagesOf(context)).prompt;
  return replayed.length > 0 ? replayed : undefined;
}
