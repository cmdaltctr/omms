import { expect, it } from "bun:test";
import { credentialStates, type CredentialInput } from "../src/lib/credential-states.ts";

const base: CredentialInput = {
  secrets: {},
  externalUsed: false,
  claudeCodeInUse: false,
  access: {
    host: "127.0.0.1",
    authEnabled: false,
    tokenAvailable: false,
    embeddingApiUrl: null,
  },
};

it("marks a local setup: the external key set, the rest not needed", () => {
  expect(
    credentialStates({
      ...base,
      secrets: { memoryApiKey: { set: true } },
      externalUsed: true,
      access: { ...base.access, embeddingApiUrl: "http://localhost:11434/v1" },
    })
  ).toEqual({
    memoryApiKey: "set",
    embeddingApiKey: "not-needed",
    apiTokens: "not-needed",
    webPassword: "not-needed",
  });
});

it("needs the external key when a host uses the external API or Claude Code is in use", () => {
  expect(credentialStates({ ...base, externalUsed: true }).memoryApiKey).toBe("missing");
  expect(credentialStates({ ...base, claudeCodeInUse: true }).memoryApiKey).toBe("missing");
  expect(credentialStates(base).memoryApiKey).toBe("never-used");
});

it("needs the embedding key only for a server on another machine", () => {
  const hosted = { ...base.access, embeddingApiUrl: "https://openrouter.ai/api/v1" };
  expect(credentialStates({ ...base, access: hosted }).embeddingApiKey).toBe("missing");
  expect(
    credentialStates({ ...base, access: hosted, secrets: { embeddingApiKey: { set: true } } })
      .embeddingApiKey
  ).toBe("set");
  for (const url of ["http://127.0.0.1:8080/v1", "http://[::1]:8080/v1", "http://localhost/v1"]) {
    expect(
      credentialStates({ ...base, access: { ...base.access, embeddingApiUrl: url } })
        .embeddingApiKey
    ).toBe("not-needed");
  }
});

it("needs an API token only on a network bind without a password", () => {
  const network = { ...base.access, host: "0.0.0.0" };
  expect(credentialStates({ ...base, access: network }).apiTokens).toBe("missing");
  expect(credentialStates({ ...base, access: { ...network, authEnabled: true } }).apiTokens).toBe(
    "not-needed"
  );
  expect(
    credentialStates({ ...base, access: { ...network, tokenAvailable: true } }).apiTokens
  ).toBe("set");
});

it("never marks the browser password as needed", () => {
  const network = { ...base.access, host: "0.0.0.0" };
  expect(credentialStates({ ...base, access: network }).webPassword).toBe("not-needed");
  expect(
    credentialStates({ ...base, secrets: { webServerAuthPassword: { set: true } } }).webPassword
  ).toBe("set");
});
