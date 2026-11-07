import { z } from "zod";

/** Discriminator of a space export file, so an import can tell it from a v1 project export. */
export const SPACE_EXPORT_FORMAT = "omms-space-export" as const;
/** Schema version of the space export file. Bump on any breaking shape change. */
export const SPACE_EXPORT_SCHEMA_VERSION = 1 as const;

/**
 * One memory of an exported space. Holds no vector (the importing machine
 * embeds again) and none of the identity columns of the source row. A
 * project-scope memory keeps its machine-local project tag, which is a hash;
 * a user-scope memory carries none, because import re-tags it to the
 * importing user.
 */
export const SpaceExportMemorySchema = z
  .object({
    id: z.string().min(1),
    content: z.string().min(1),
    scope: z.enum(["project", "user"]),
    /** Present only for project scope: the `omms_project_<hash>` container tag. */
    projectTag: z.string().min(1).optional(),
    type: z.string().optional(),
    tags: z.array(z.string()).optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    isPinned: z.boolean(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((memory) => memory.scope === "project" || memory.projectTag === undefined, {
    message: "a user-scope memory carries no project tag",
  });

/**
 * One learned profile item. Keeps the human-readable fields and the times;
 * loses the centroid, the anchor and every other vector or sampling field.
 * `category` is absent on workflows, which carry `steps` instead.
 */
export const SpaceExportProfileItemSchema = z.object({
  category: z.string().optional(),
  description: z.string().min(1),
  steps: z.array(z.string()).optional(),
  confidence: z.number(),
  frequency: z.number().int().nonnegative(),
  evidence: z.array(z.string()),
  lastSeen: z.number().int().nonnegative(),
  firstSeen: z.number().int().nonnegative().optional(),
});

export const SpaceExportLearningPathSchema = z.object({
  topic: z.string(),
  chain: z.array(z.string()),
  description: z.string(),
});

/** The learned profile of the exported space, present only on the opt-in. */
export const SpaceExportProfileSchema = z.object({
  preferences: z.array(SpaceExportProfileItemSchema),
  patterns: z.array(SpaceExportProfileItemSchema),
  workflows: z.array(SpaceExportProfileItemSchema),
  learningPaths: z.array(SpaceExportLearningPathSchema).optional(),
  version: z.number().int().positive(),
  lastAnalyzedAt: z.number().int().nonnegative(),
  totalPromptsAnalyzed: z.number().int().nonnegative(),
});

/** The whole export file: one space, no space name, no vectors, no identity fields. */
export const SpaceExportDocumentSchema = z.object({
  format: z.literal(SPACE_EXPORT_FORMAT),
  schemaVersion: z.literal(SPACE_EXPORT_SCHEMA_VERSION),
  exportedAt: z.string().min(1),
  ommsVersion: z.string().min(1),
  embedding: z.object({
    model: z.string(),
    dimensions: z.number().int().positive(),
  }),
  memories: z.array(SpaceExportMemorySchema),
  profile: SpaceExportProfileSchema.optional(),
});

export type SpaceExportMemory = z.infer<typeof SpaceExportMemorySchema>;
export type SpaceExportProfileItem = z.infer<typeof SpaceExportProfileItemSchema>;
export type SpaceExportLearningPath = z.infer<typeof SpaceExportLearningPathSchema>;
export type SpaceExportProfile = z.infer<typeof SpaceExportProfileSchema>;
export type SpaceExportDocument = z.infer<typeof SpaceExportDocumentSchema>;
