import { cosineSimilarityNumbers, l2Normalize } from "../../utils/math.js";
import { EmbeddingService } from "../embedding.js";
import { log } from "../logger.js";
import { resolveHostProfileModel } from "./profile-model.js";
import { ensureArray, minEvidenceForEvolve, normalizeDescription } from "./profile-confidence.js";
import type { ModelCheckConfig } from "./profile-model-checks.js";
import { callExternalAPI, callHostModel } from "./profile-model-checks.js";
import type { ProfileHost } from "./profile-host.js";

const DIRECTION_VALIDATION_TOLERANCE = 0.03;

export async function evolveDescription(
  config: ModelCheckConfig,
  item: any,
  itemType: "preference" | "pattern" | "workflow",
  profileId?: string
): Promise<string | null> {
  if (!profileId) {
    log("profile description evolution blocked: no profileId");
    return null;
  }

  const evidence = item.evidence;
  if (!Array.isArray(evidence) || evidence.length < minEvidenceForEvolve(itemType)) {
    if (Array.isArray(evidence) && evidence.length > 0) {
      log("profile description evolution skipped: insufficient evidence", {
        type: itemType,
        evidenceCount: evidence.length,
        required: minEvidenceForEvolve(itemType),
      });
    }
    return null;
  }

  log("profile description evolution attempt", {
    type: itemType,
    desc: (item.description || "").substring(0, 40),
    frequency: item.frequency,
    evidenceCount: evidence.length,
  });

  const evidenceList = evidence.map((e: string, i: number) => `${i + 1}. ${e}`).join("\n");

  const systemPrompt = `You are a user profile description optimizer. Return ONLY a JSON object with a single "description" field: {"description": "..."}
Based on multiple independent observations of the same user behavior, generate a more precise description.
Rules:
- Describe the user's behavioral tendency in general terms
- Natural length — not artificially shortened or inflated
- Same language as the observations
- Do not over-infer beyond what the evidence shows
- Do not include technical implementation details, parameter values, algorithm names, tool names, product names, library names, file paths, error messages, or transient conversation content`;

  const userPrompt = `Current description: ${item.description}

Independent observations:
${evidenceList}

Generate a concise, abstract description of the user's general behavioral tendency.`;

  let newDescription: string | null = null;

  const hostModel = await resolveHostProfileModel();
  if (hostModel) {
    try {
      newDescription = await callHostModel(hostModel, systemPrompt, userPrompt);
    } catch (e) {
      log(
        "profile description evolution: native provider failed, trying external API",
        {
          error: String(e),
        },
        "error"
      );
    }
  }

  if (!newDescription && config.memoryModel && config.memoryApiUrl) {
    try {
      newDescription = await callExternalAPI(systemPrompt, userPrompt, config);
    } catch (e) {
      log("profile description evolution: external API failed", { error: String(e) }, "error");
      return null;
    }
  }

  if (!newDescription || newDescription === item.description) {
    if (!newDescription) {
      log("profile description evolution blocked: no provider available");
    } else {
      log("profile description evolution skipped: no change", { type: itemType });
    }
    return null;
  }

  return newDescription;
}

export async function evolveAndUpdate(
  host: ProfileHost,
  item: any,
  itemType: string,
  profileId?: string
): Promise<void> {
  // The rewrite describes a general tendency, which turns a workflow into a persona summary.
  if (!profileId || itemType === "workflow") return;
  try {
    const evolved = await host.evolveDescription(item, itemType as any, profileId);
    if (evolved && evolved !== item.description) {
      const embed = EmbeddingService.getInstance();

      if (embed.isWarmedUp) {
        const evidence = ensureArray(item.evidence)
          .filter((e: any) => typeof e === "string" && e.length >= 10)
          .slice(0, 8);

        if (evidence.length >= 3) {
          const oldDesc = item.description;
          const evEmbs = await Promise.all(
            evidence.map((e: string) => embed.embed(normalizeDescription(e), { task: "document" }))
          );
          const sumVec = evEmbs.reduce(
            (acc: number[], e: any) => {
              const arr = Array.from(e) as number[];
              return acc.map((v, i) => v + (arr[i] ?? 0));
            },
            new Array((evEmbs[0] as any).length).fill(0) as number[]
          );
          const evCentroid = l2Normalize(sumVec);

          let adopted = false;
          const oldEmb = await embed.embed(normalizeDescription(item.description), {
            task: "document",
          });
          const newEmb = await embed.embed(normalizeDescription(evolved), { task: "document" });
          const cosOld = cosineSimilarityNumbers(Array.from(oldEmb) as number[], evCentroid);
          const cosNew = cosineSimilarityNumbers(Array.from(newEmb) as number[], evCentroid);

          if (cosNew < cosOld - DIRECTION_VALIDATION_TOLERANCE) {
            log("profile description evolution rejected: direction drift", {
              type: itemType,
              cosOld: Math.round(cosOld * 1000) / 1000,
              cosNew: Math.round(cosNew * 1000) / 1000,
            });
          } else {
            item.description = evolved;
            adopted = true;
          }

          if (adopted) {
            const newCentroid = evCentroid;
            const oldCentroid = (item as any).centroid as number[] | undefined;
            (item as any).centroid = newCentroid;
            (item as any).anchor = newCentroid;
            (item as any).driftBelowCount = 0;

            if (oldCentroid) {
              log("profile centroid rebuilt from evidence after evolve", {
                type: itemType,
                cosShift:
                  Math.round(cosineSimilarityNumbers(oldCentroid, newCentroid) * 1000) / 1000,
                evidenceCount: evidence.length,
                validated: evidence.length >= 3,
              });
            }
          }

          log("profile description evolved", {
            type: itemType,
            oldDescription: oldDesc,
            newDescription: item.description,
            adopted: oldDesc !== item.description,
            frequency: item.frequency,
          });
          return;
        }
      } else {
        log(
          "profile description evolution: embedding not warmed up, skipping validation",
          {
            type: itemType,
          },
          "warn"
        );
      }

      const oldDesc = item.description;
      item.description = evolved;
      log("profile description evolved", {
        type: itemType,
        oldDescription: oldDesc,
        newDescription: evolved,
        adopted: true,
        frequency: item.frequency,
      });
    }
  } catch (e) {
    log("profile description evolve error", { type: itemType, error: String(e) }, "error");
  }
}
