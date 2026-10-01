import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ApiTokensTable,
  revokeAfterConfirm,
} from "../src/lib/components/settings/ApiTokensTable.tsx";
import {
  CredentialRows,
  credentialInput,
} from "../src/lib/components/settings/KeysAccessSection.tsx";
import { credentialStates } from "../src/lib/credential-states.ts";

const token = { id: "t1", name: "ci", createdAt: 0, expiresAt: null, lastUsedAt: null };
const noop = () => {};

it("shows a new token value once, with a copy button and a warning", () => {
  const shown = renderToStaticMarkup(
    <ApiTokensTable
      tokens={[token]}
      newValue="omms_secret"
      busy={false}
      onGenerate={noop}
      onRevoke={noop}
    />
  );
  expect(shown).toContain("omms_secret");
  expect(shown).toContain("Copy");
  expect(shown).toContain("It will not be shown again.");
  const later = renderToStaticMarkup(
    <ApiTokensTable tokens={[token]} busy={false} onGenerate={noop} onRevoke={noop} />
  );
  expect(later).not.toContain("omms_secret");
  expect(later).toContain("ci");
});

it("revokes only after the user confirms", async () => {
  let revoked = 0;
  expect(
    await revokeAfterConfirm(
      () => false,
      async () => void revoked++
    )
  ).toBe(false);
  expect(revoked).toBe(0);
  expect(
    await revokeAfterConfirm(
      () => true,
      async () => void revoked++
    )
  ).toBe(true);
  expect(revoked).toBe(1);
});

it("marks each credential and never shows a value", () => {
  const html = renderToStaticMarkup(
    <CredentialRows
      states={credentialStates(
        credentialInput({
          revision: "r",
          secrets: { memoryApiKey: { set: true } },
          effective: { pi: { kind: "manual" } },
          access: {
            host: "0.0.0.0",
            authEnabled: false,
            tokenAvailable: false,
            embeddingApiUrl: null,
            authUsername: null,
            configTokenIgnored: false,
          },
        })
      )}
    />
  );
  expect(html).toContain("✅");
  expect(html).toContain("⛔️");
  expect(html).toContain("not needed");
});

it("hides the token and password controls when the page is not local", () => {
  const source = readFileSync(
    join(import.meta.dir, "../src/lib/components/settings/KeysAccessSection.tsx"),
    "utf8"
  );
  // The controls render only in the local branch.
  expect(source).toMatch(/!local \?[\s\S]*Open this page on the computer[\s\S]*<ApiTokensTable/);
});

it("drops the credentials line from the Models card", () => {
  const source = readFileSync(
    join(import.meta.dir, "../src/lib/components/settings/ModelsSection.tsx"),
    "utf8"
  );
  expect(source).not.toContain("Credentials (values hidden)");
});

it("counts Claude Code as in use only on evidence, not on the default folder", () => {
  const snapshot = (evidence: { attempts: boolean; folderSet: boolean }) => ({
    revision: "r",
    secrets: {},
    effective: {},
    claudeFolder: { exists: true },
    claudeCodeEvidence: evidence,
  });
  expect(credentialInput(snapshot({ attempts: false, folderSet: false })).claudeCodeInUse).toBe(
    false
  );
  expect(credentialInput(snapshot({ attempts: true, folderSet: false })).claudeCodeInUse).toBe(
    true
  );
  expect(credentialInput(snapshot({ attempts: false, folderSet: true })).claudeCodeInUse).toBe(
    true
  );
});

it("labels an unused external API key as never used before", () => {
  const html = renderToStaticMarkup(
    <CredentialRows
      states={{
        memoryApiKey: "never-used",
        embeddingApiKey: "not-needed",
        apiTokens: "not-needed",
        webPassword: "not-needed",
      }}
    />
  );
  expect(html).toContain("never used before");
});
