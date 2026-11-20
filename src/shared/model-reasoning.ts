/**
 * The reasoning level of the external API model: which field each endpoint reads,
 * which levels the card offers, and how to read a saved field back as a level.
 * Pure and free of imports, so the server writes with it and the web app shows
 * choices with it (as `$shared`).
 */

/** The `memoryExtraParams` members that carry a reasoning setting. */
export const REASONING_KEYS = ["reasoning", "reasoning_effort", "thinking"] as const;

export type ReasoningFamily = "openrouter" | "deepseek" | "responses" | "chat" | "none";
export type ReasoningLevel =
  "default" | "off" | "on" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** What OpenRouter's model list says about a model's reasoning. Every member is optional. */
export type ReasoningFacts = {
  supported_efforts?: string[];
  default_effort?: string;
  mandatory?: boolean;
};

export type ReasoningChoices = {
  levels: ReasoningLevel[];
  /** The model's own default effort, for the Default choice. */
  defaultEffort?: string;
  /** `nearest`: OpenRouter maps to the closest level. `may-ignore`: the endpoint may ignore or refuse the field. */
  note?: "nearest" | "may-ignore";
};

export type ExtraParams = Record<string, unknown> | undefined;

/** Effort levels in the order the card lists them. `none` is Off and is handled apart. */
const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];
const isEffort = (value: unknown): value is Effort => EFFORTS.includes(value as Effort);
const SIMPLE_EFFORTS = ["low", "medium", "high"] as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/** The endpoint family. Only `openai-chat` and `openai-responses` get a control. */
export function reasoningFamily(
  url: string | undefined,
  provider: string | undefined
): ReasoningFamily {
  const kind = provider ?? "openai-chat";
  if (kind !== "openai-chat" && kind !== "openai-responses") return "none";
  const host = hostOf(url);
  if (host === "openrouter.ai") return "openrouter";
  if (host === "api.deepseek.com") return "deepseek";
  return kind === "openai-responses" ? "responses" : "chat";
}

/** True when the list gave any reasoning fact for the model. */
export function hasReasoningFacts(facts: ReasoningFacts | undefined): facts is ReasoningFacts {
  return (
    facts !== undefined &&
    (facts.mandatory !== undefined ||
      facts.default_effort !== undefined ||
      (facts.supported_efforts?.length ?? 0) > 0)
  );
}

/** The levels to offer. Default is always first. */
export function reasoningChoices(
  family: ReasoningFamily,
  facts?: ReasoningFacts
): ReasoningChoices {
  if (family === "none") return { levels: [] };
  if (family === "deepseek") return { levels: ["default", "off", "on"] };
  if (family === "responses") return { levels: ["default", ...SIMPLE_EFFORTS] };
  if (family === "chat") return { levels: ["default", ...SIMPLE_EFFORTS], note: "may-ignore" };
  if (!hasReasoningFacts(facts)) {
    return { levels: ["default", "off", ...SIMPLE_EFFORTS], note: "nearest" };
  }
  const listed = facts.supported_efforts ?? [];
  const efforts = EFFORTS.filter((effort) => listed.includes(effort));
  const canOff = facts.mandatory !== true;
  const defaultEffort = facts.default_effort;
  // An explicit list, even one that holds only `none`, never offers On.
  if (listed.length === 0) {
    return {
      levels: ["default", ...(canOff ? (["off"] as const) : []), "on"],
      ...(defaultEffort ? { defaultEffort } : {}),
    };
  }
  return {
    levels: [
      "default",
      ...(canOff && listed.includes("none") ? (["off"] as const) : []),
      ...efforts,
    ],
    ...(defaultEffort ? { defaultEffort } : {}),
  };
}

/**
 * The one `memoryExtraParams` member a level writes, `{}` for Default, and
 * `undefined` for a level the family does not accept. `toggle` is for an
 * OpenRouter model that has reasoning but no effort list: it takes on and off.
 */
export function reasoningFields(
  family: ReasoningFamily,
  level: ReasoningLevel,
  toggle = false
): Record<string, unknown> | undefined {
  if (level === "default") return {};
  if (family === "openrouter") {
    if (toggle && (level === "on" || level === "off")) {
      return { reasoning: { enabled: level === "on" } };
    }
    if (level === "off") return { reasoning: { effort: "none" } };
    return isEffort(level) ? { reasoning: { effort: level } } : undefined;
  }
  if (family === "deepseek") {
    if (level !== "on" && level !== "off") return undefined;
    return { thinking: { type: level === "on" ? "enabled" : "disabled" } };
  }
  if (family === "responses" || family === "chat") {
    if (!SIMPLE_EFFORTS.includes(level as never)) return undefined;
    return family === "responses" ? { reasoning: { effort: level } } : { reasoning_effort: level };
  }
  return undefined;
}

function fromOpenRouter(value: unknown): ReasoningLevel | "custom" {
  if (!isObject(value)) return "custom";
  const keys = Object.keys(value);
  if (keys.length !== 1) return "custom";
  if (keys[0] === "effort") {
    if (value.effort === "none") return "off";
    return isEffort(value.effort) ? value.effort : "custom";
  }
  if (keys[0] === "enabled" && typeof value.enabled === "boolean") {
    return value.enabled ? "on" : "off";
  }
  return "custom";
}

/** The level a saved field holds, `default` when none is saved, `custom` when it cannot be shown. */
export function savedLevel(family: ReasoningFamily, extra: ExtraParams): ReasoningLevel | "custom" {
  const params = extra ?? {};
  if (family === "openrouter" || family === "responses") {
    if (params.reasoning === undefined) return "default";
    const level = fromOpenRouter(params.reasoning);
    if (family === "responses") {
      return SIMPLE_EFFORTS.includes(level as never) ? level : "custom";
    }
    return level;
  }
  if (family === "deepseek") {
    if (params.thinking === undefined) return "default";
    if (!isObject(params.thinking) || Object.keys(params.thinking).length !== 1) return "custom";
    const type = params.thinking.type;
    return type === "disabled" ? "off" : type === "enabled" ? "on" : "custom";
  }
  if (family === "chat") {
    if (params.reasoning_effort === undefined) return "default";
    return SIMPLE_EFFORTS.includes(params.reasoning_effort as never)
      ? (params.reasoning_effort as ReasoningLevel)
      : "custom";
  }
  return "default";
}

/** The saved field that the endpoint ignores, if any: `thinking` on OpenRouter, `reasoning` on DeepSeek. */
export function ignoredReasoningField(
  family: ReasoningFamily,
  extra: ExtraParams
): "thinking" | "reasoning" | undefined {
  if (family === "openrouter" && extra?.thinking !== undefined) return "thinking";
  if (family === "deepseek" && extra?.reasoning !== undefined) return "reasoning";
  return undefined;
}
