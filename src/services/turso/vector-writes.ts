import type { MemoryRecord } from "./types.js";
import { vectorToJson } from "./vector-utils.js";
import type { TursoDb } from "./turso-db.js";
import type { Transaction } from "@libsql/client";

export class TursoVectorWrites {
  async insertVectorInTransaction(tx: Transaction, record: MemoryRecord): Promise<void> {
    const contentVector = vectorToJson(record.vector);
    const commonArgs = [
      record.containerTag,
      record.tags || null,
      record.type || null,
      record.createdAt,
      record.updatedAt,
      record.metadata || null,
      record.displayName || null,
      record.userName || null,
      record.userEmail || null,
      record.projectPath || null,
      record.projectName || null,
      record.gitRepoUrl || null,
    ];

    if (record.tagsVector) {
      await tx.execute({
        sql: `
        INSERT INTO memories (
          id, content, vector, tags_vector, container_tag, tags, type, created_at, updated_at,
          metadata, display_name, user_name, user_email, project_path, project_name, git_repo_url
        ) VALUES (?, ?, vector32(?), vector32(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        args: [
          record.id,
          record.content,
          contentVector,
          vectorToJson(record.tagsVector),
          ...commonArgs,
        ],
      });
      return;
    }

    await tx.execute({
      sql: `
      INSERT INTO memories (
        id, content, vector, tags_vector, container_tag, tags, type, created_at, updated_at,
        metadata, display_name, user_name, user_email, project_path, project_name, git_repo_url
      ) VALUES (?, ?, vector32(?), NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      args: [record.id, record.content, contentVector, ...commonArgs],
    });
  }

  async insertVector(db: TursoDb, record: MemoryRecord): Promise<void> {
    const contentVector = vectorToJson(record.vector);
    const commonArgs = [
      record.containerTag,
      record.tags || null,
      record.type || null,
      record.createdAt,
      record.updatedAt,
      record.metadata || null,
      record.displayName || null,
      record.userName || null,
      record.userEmail || null,
      record.projectPath || null,
      record.projectName || null,
      record.gitRepoUrl || null,
    ];

    if (record.tagsVector) {
      await db.execute(
        `
        INSERT INTO memories (
          id, content, vector, tags_vector, container_tag, tags, type, created_at, updated_at,
          metadata, display_name, user_name, user_email, project_path, project_name, git_repo_url
        ) VALUES (?, ?, vector32(?), vector32(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [record.id, record.content, contentVector, vectorToJson(record.tagsVector), ...commonArgs]
      );
      return;
    }

    await db.execute(
      `
      INSERT INTO memories (
        id, content, vector, tags_vector, container_tag, tags, type, created_at, updated_at,
        metadata, display_name, user_name, user_email, project_path, project_name, git_repo_url
      ) VALUES (?, ?, vector32(?), NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [record.id, record.content, contentVector, ...commonArgs]
    );
  }
}

export const tursoVectorWrites = new TursoVectorWrites();
