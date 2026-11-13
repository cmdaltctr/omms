import { beforeEach, expect, it } from "bun:test";
import {
  installFetch,
  installReact,
  resetRender,
  settle,
  text,
  type Node,
  type Request,
} from "./space-kit.tsx";

installReact();

const { OpenRouterRouting, ProviderRows } =
  await import("../src/lib/components/settings/OpenRouterRouting.tsx");
const { ExternalApiSection } =
  await import("../src/lib/components/settings/ExternalApiSection.tsx");

const MODELS = "/api/settings/external-api/openrouter-models";
const own = [ExternalApiSection, OpenRouterRouting, ProviderRows];
const models = [
  { id: "deepseek/deepseek-chat", name: "DeepSeek V3" },
  { id: "openai/gpt-5-mini", name: "GPT-5 Mini" },
];

const snapshot = (url: string) => ({
  revision: "rev-1",
  settings: {
    memoryApiUrl: { globalValue: url },
    memoryModel: { globalValue: "deepseek/deepseek-chat" },
    memoryProvider: { globalValue: "openai-chat" },
  },
  openrouterProvider: null,
});

const modelInput = (tree: Node[]) => tree.find((node) => node.props.placeholder === "glm-5-turbo")!;
const datalists = (tree: Node[]) => tree.filter((node) => node.type === "datalist");

let requests: Request[] = [];
const install = (url: string, modelsReply: { status?: number; body: unknown }) => {
  requests = installFetch((request) => {
    if (request.path === MODELS) return modelsReply;
    if (request.path.startsWith("/api/settings/external-api/openrouter-providers"))
      return { body: { ok: true, providers: [] } };
    return { body: snapshot(url) };
  });
};

beforeEach(() => {
  resetRender();
  requests = [];
});

it("offers the model list on the Model field when the URL is OpenRouter", async () => {
  install("https://openrouter.ai/api/v1", { body: { ok: true, models } });
  const tree = await settle(<ExternalApiSection />, own);
  expect(modelInput(tree).props.list).toBe("openrouter-models");
  const [datalist] = datalists(tree);
  expect(datalist.props.id).toBe("openrouter-models");
  const options = [datalist.props.children].flat().filter((node): node is Node => !!node);
  expect(options.map((node) => node.props.value)).toEqual(models.map((model) => model.id));
  expect(options.map((node) => text(node.props.children))).toEqual(models.map((m) => m.name));
});

it("shows no datalist and sends no model request for another URL", async () => {
  install("https://api.example.com/v1", { body: { ok: true, models } });
  const tree = await settle(<ExternalApiSection />, own);
  expect(modelInput(tree).props.list).toBeUndefined();
  expect(datalists(tree)).toHaveLength(0);
  expect(requests.some((request) => request.path === MODELS)).toBe(false);
});

it("shows no datalist when the model request answers ok false", async () => {
  install("https://openrouter.ai/api/v1", { body: { ok: false, error: "down" } });
  const tree = await settle(<ExternalApiSection />, own);
  expect(modelInput(tree).props.list).toBeUndefined();
  expect(datalists(tree)).toHaveLength(0);
});

it("shows no datalist when the model request fails", async () => {
  install("https://openrouter.ai/api/v1", { status: 500, body: { error: "boom" } });
  const tree = await settle(<ExternalApiSection />, own);
  expect(modelInput(tree).props.list).toBeUndefined();
  expect(datalists(tree)).toHaveLength(0);
});

it("keeps free text in the Model field", async () => {
  install("https://openrouter.ai/api/v1", { body: { ok: true, models } });
  let tree = await settle(<ExternalApiSection />, own);
  (modelInput(tree).props.onChange as (event: unknown) => void)({
    target: { value: "my/custom-model" },
  });
  tree = await settle(<ExternalApiSection />, own);
  expect(modelInput(tree).props.value).toBe("my/custom-model");
});

it("loads the model list once, however often the section renders", async () => {
  install("https://openrouter.ai/api/v1", { body: { ok: true, models } });
  let tree = await settle(<ExternalApiSection />, own);
  (modelInput(tree).props.onChange as (event: unknown) => void)({ target: { value: "a" } });
  tree = await settle(<ExternalApiSection />, own);
  (modelInput(tree).props.onChange as (event: unknown) => void)({ target: { value: "ab" } });
  await settle(<ExternalApiSection />, own);
  expect(requests.filter((request) => request.path === MODELS)).toHaveLength(1);
});
