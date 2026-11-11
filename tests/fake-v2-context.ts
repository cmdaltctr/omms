/**
 * A fake OpenCode V2 plugin context for tests that run `OmmsPluginV2.setup`.
 * It records what the plugin registers and calls, and lets a test push events
 * into `ctx.event.subscribe()`. Shapes follow the installed `@opencode/client`
 * 2.0.16 types (`generate.text` returns `{ text }`, `model.list` and
 * `model.default` return `{ data }`, `session.interrupt` returns `{ interrupted }`).
 */

export type FakeV2Message = Record<string, unknown> & { id: string; type: string };

export type FakeV2ContextOptions = {
  directory?: string;
  /** `ctx.session.context` result per session id. */
  messages?: Record<string, FakeV2Message[]>;
  /** `ctx.session.get` result per session id; the default is a root session in `directory`. */
  sessions?: Record<string, Record<string, unknown>>;
  /** `ctx.model.list` data. */
  models?: Array<Record<string, unknown>>;
  /** `ctx.model.default` data. */
  defaultModel?: Record<string, unknown>;
  /** Reply text for `ctx.generate.text`, or a function of the request. */
  generateText?:
    string | ((input: { prompt: string; model?: unknown }) => string | Promise<string>);
};

export function createFakeV2Context(options: FakeV2ContextOptions = {}) {
  const directory = options.directory ?? "/workspace/project";
  const tools = new Map<string, any>();
  const skills: any[] = [];
  const commands = new Map<string, any>();
  const hooks = new Map<string, (event: any) => Promise<void>>();
  const calls = {
    generate: [] as Array<{ prompt: string; model?: unknown }>,
    context: [] as string[],
    get: [] as string[],
    synthetic: [] as any[],
    prompt: [] as any[],
    interrupt: [] as string[],
    modelList: 0,
    modelDefault: 0,
    agentTransform: 0,
  };

  // Events pushed by `emit` reach every open subscription in order.
  const queue: unknown[] = [];
  let wake: (() => void) | null = null;
  let subscriptions = 0;
  let closed = 0;

  const ctx = {
    location: {
      directory,
      project: { id: "project", directory, canonical: "project" },
    },
    tool: {
      transform: async (callback: (editor: any) => void) => {
        callback({ add: (definition: any) => tools.set(definition.name, definition) });
      },
    },
    agent: {
      transform: async () => {
        calls.agentTransform++;
      },
    },
    skill: {
      transform: async (callback: (editor: any) => void) => {
        callback({
          get: (id: string) => skills.find((skill) => skill.id === id),
          add: (skill: any) => skills.push(skill),
        });
      },
    },
    command: {
      transform: async (callback: (editor: any) => void) => {
        callback({ add: (command: any) => commands.set(command.name, command) });
      },
    },
    session: {
      hook: async (name: string, callback: (event: any) => Promise<void>) => {
        hooks.set(name, callback);
      },
      get: async ({ sessionID }: { sessionID: string }) => {
        calls.get.push(sessionID);
        return (
          options.sessions?.[sessionID] ?? {
            id: sessionID,
            title: "User session",
            location: { directory },
          }
        );
      },
      context: async ({ sessionID }: { sessionID: string }) => {
        calls.context.push(sessionID);
        return options.messages?.[sessionID] ?? [];
      },
      synthetic: async (input: any) => {
        calls.synthetic.push(input);
        return { id: `synthetic-${calls.synthetic.length}` };
      },
      prompt: async (input: any) => {
        calls.prompt.push(input);
        return { id: `prompt-${calls.prompt.length}` };
      },
      interrupt: async ({ sessionID }: { sessionID: string }) => {
        calls.interrupt.push(sessionID);
        return { interrupted: true };
      },
    },
    generate: {
      text: async (input: { prompt: string; model?: unknown }) => {
        calls.generate.push(input);
        const reply =
          typeof options.generateText === "function"
            ? await options.generateText(input)
            : (options.generateText ?? "{}");
        return { text: reply };
      },
    },
    model: {
      list: async () => {
        calls.modelList++;
        return { location: { directory }, data: options.models ?? [] };
      },
      default: async () => {
        calls.modelDefault++;
        return { location: { directory }, data: options.defaultModel };
      },
    },
    event: {
      async *subscribe({ signal }: { signal?: AbortSignal } = {}) {
        subscriptions++;
        try {
          while (!signal?.aborted) {
            if (queue.length > 0) {
              yield queue.shift();
              continue;
            }
            await new Promise<void>((resolve) => {
              wake = resolve;
              signal?.addEventListener("abort", () => resolve(), { once: true });
            });
            wake = null;
          }
        } finally {
          closed++;
        }
      },
    },
  } as any;

  return {
    ctx,
    tools,
    skills,
    commands,
    hooks,
    calls,
    /** Push one raw V2 event into the subscription. */
    emit(event: unknown) {
      queue.push(event);
      wake?.();
    },
    /** Run a registered tool the way OpenCode V2 does. */
    runTool(name: string, args: unknown, toolContext: Record<string, unknown> = {}) {
      const definition = tools.get(name);
      if (!definition) throw new Error(`tool ${name} is not registered`);
      return definition.execute(args, {
        sessionID: "session-1",
        messageID: "message-1",
        agent: "build",
        ...toolContext,
      });
    },
    isSubscribed: () => subscriptions > closed,
  };
}
