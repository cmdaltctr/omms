import type { CONFIG } from "../../config.js";
import type { ModelPort } from "../../core/profile-analysis.js";
import { log } from "../logger.js";
import { completeStructured, resolveHostProfileModel } from "./profile-model.js";

/** The external API settings the model checks read. Callers pass CONFIG. */
export type ModelCheckConfig = Pick<typeof CONFIG, "memoryModel" | "memoryApiUrl" | "memoryApiKey">;

export async function checkSemanticDuplicate(
  descA: string,
  descB: string,
  config: ModelCheckConfig
): Promise<boolean> {
  const prompt = `Do these two descriptions refer to the same user behavior, preference, or pattern? Answer only whether they are semantically equivalent (same meaning, different wording).

A: "${descA}"
B: "${descB}"

Answer JSON only: { "duplicate": true|false, "reason": "one sentence explanation" }`;

  const hostModel = await resolveHostProfileModel();
  if (hostModel) {
    try {
      const { z } = await import("zod");
      const result: any = await Promise.race([
        completeStructured(
          hostModel,
          "You are a semantic duplicate detector. Output valid JSON.",
          prompt,
          z.object({ duplicate: z.boolean(), reason: z.string() })
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("dedup check timeout")), 30000)
        ),
      ]);
      return result.duplicate || false;
    } catch (e) {
      log("profile dedup check: native provider failed", { error: String(e) }, "warn");
    }
  }

  if (config.memoryModel && config.memoryApiUrl) {
    try {
      const response = await fetch(`${config.memoryApiUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.memoryApiKey || ""}`,
        },
        body: JSON.stringify({
          model: config.memoryModel,
          messages: [
            {
              role: "system",
              content: "You are a semantic duplicate detector. Output valid JSON.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) return false;
      const data: any = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) return false;
      const parsed = JSON.parse(content);
      return parsed.duplicate || false;
    } catch (e) {
      log("profile dedup check: external API failed", { error: String(e) }, "error");
    }
  }

  return false;
}

export async function checkConflict(
  descA: string,
  descB: string,
  config: ModelCheckConfig
): Promise<boolean> {
  const prompt = `Are these two user preferences contradictory (opposing, incompatible)?

A: "${descA}"
B: "${descB}"

Answer JSON only: { "conflict": true|false, "reason": "one sentence explanation" }`;

  const hostModel = await resolveHostProfileModel();
  if (hostModel) {
    try {
      const { z } = await import("zod");
      const result: any = await Promise.race([
        completeStructured(
          hostModel,
          "You are a preference contradiction detector. Output valid JSON.",
          prompt,
          z.object({ conflict: z.boolean(), reason: z.string() })
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("conflict check timeout")), 30000)
        ),
      ]);
      return result.conflict || false;
    } catch (e) {
      log("profile conflict check: native provider failed", { error: String(e) }, "warn");
    }
  }

  if (config.memoryModel && config.memoryApiUrl) {
    try {
      const response = await fetch(`${config.memoryApiUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.memoryApiKey || ""}`,
        },
        body: JSON.stringify({
          model: config.memoryModel,
          messages: [
            {
              role: "system",
              content: "You are a preference contradiction detector. Output valid JSON.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) return false;
      const data: any = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) return false;
      const parsed = (() => {
        try {
          return JSON.parse(content);
        } catch {
          const repaired = content
            .replace(
              /([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])"([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])/g,
              '$1\\"$2'
            )
            .replace(/([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])"(?=\s*[,}\]])/g, '$1\\"');
          return JSON.parse(repaired);
        }
      })();
      return parsed.conflict || false;
    } catch (e) {
      log("profile conflict check: external API failed", { error: String(e) }, "error");
    }
  }

  return false;
}

export async function callHostModel(
  model: ModelPort,
  systemPrompt: string,
  userPrompt: string
): Promise<string | null> {
  const { z } = await import("zod");
  const schema = z.object({ description: z.string() });

  const result: any = await Promise.race([
    completeStructured(model, systemPrompt, userPrompt, schema),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("evolve description timeout")), 120000)
    ),
  ]);

  return result.description || null;
}

export async function callExternalAPI(
  systemPrompt: string,
  userPrompt: string,
  config: ModelCheckConfig
): Promise<string | null> {
  const t0 = Date.now();
  const response = await fetch(`${config.memoryApiUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.memoryApiKey || ""}`,
    },
    body: JSON.stringify({
      model: config.memoryModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(60000),
  });

  log("profile description evolution: external API http done", {
    httpMs: Date.now() - t0,
    status: response.status,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`External API error: ${response.status} ${text}`);
  }

  const data: any = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("No content in API response");

  const parsed = JSON.parse(content);
  return parsed.description || null;
}
