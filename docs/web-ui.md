# Web UI

OMMS serves a web app at `http://127.0.0.1:4747`. Use it to browse and edit memories, manage your user profile, and change settings.

## Starting the web app

Three things can serve the page. They all use the same port, settings, and memory store.

- **OpenCode** starts it while OpenCode runs.
- **The login item** starts it when you sign in to your computer. Turn it on with `om-memory-system web install`, or on the Settings page. See [CLI: Web app commands](cli.md#web-app-commands).
- **`om-memory-system web`** starts it by hand in the terminal. Press Ctrl+C to stop it.

Pi does not serve the page. If OpenCode starts while another OMMS process serves the page, OpenCode uses that one instead of starting a second server.

### Port ownership and step-aside

One OMMS process owns the port. A process that finds the port busy waits and checks every 5 seconds. It takes the port only when the owner stops answering.

`om-memory-system web install` can ask an older owner to step aside. The request is `POST /api/web/step-aside`. It needs the local API token (`~/.omms/.auth-token`) and a loopback caller. The owner refuses with `409` when the caller is not newer than itself.

- A standalone web app (`om-memory-system web` or the login item) exits with code `0`.
- A web app inside an OpenCode or Pi session stops serving. The session keeps running. The web app waits 60 seconds before it can take the port back, so the login item can bind first.
- Each request writes one log record with the outcome (`stepped_aside`, `refused_not_newer`, or `refused_auth`) and both versions. The log never holds the token.

OMMS 3.5.0 and earlier have no step-aside route. Stop those web apps by hand.

A global install of the terminal command is optional but recommended. With it, the login item and the commands run without `npx`:

```bash
npm i -g om-memory-system      # or: bun add -g om-memory-system
om-memory-system --version
```

## Language

The sidebar footer shows the current language: EN, ZH, or AR. Select it to choose English, Chinese, or Arabic. The page remembers your choice for the next visit.

## Settings page

Open `http://127.0.0.1:4747/settings`, or select the cogwheel in the sidebar footer. The page has these sections:

- **External API.** Set up your own OpenAI- or Anthropic-compatible endpoint and its key, and test it.
- **Models.** Choose the capture model for each host.
- **Capture diagnostics.** See capture outcomes and failures, and manage debug traces.
- **Health.** Check that each part of OMMS works.
- **Import and backfill.** Import past chats by hand.
- **Automatic import.** Control the background import of past chats, watch its progress, and run, pause, or resume it.
- **Directory maps.** Tell OMMS where chats from deleted folders belong.
- **Web app.** Control the login item and check the installed version.
- **Log.** Read the latest OMMS log lines.

[Settings page](web-ui-settings.md) explains every part in detail.

## Opening the page through a terminal proxy

Some terminals send local addresses through their own proxy. For example, Orca opens links as `*.orca.localhost` addresses, not the `http://127.0.0.1:4747` address OMMS prints. Both reach the same server. If the proxied address does not load or asks for a token, open the printed `127.0.0.1` address.

## Network access

Keep `webServerHost` on `127.0.0.1` unless you mean to open the web app to other computers.

A non-loopback host, such as `0.0.0.0`, needs `webServerApiToken`. Loopback means your own computer only.

- Every `/api/*` request must then send `Authorization: Bearer <token>` or the `X-Omms-Token` header. The old `X-Opencode-Mem-Token` header still works.
- Open the page once with `?apiToken=<token>`. The browser stores the token and sends it.

## HTTP Basic Auth

On a network address, anyone on the network can reach the web app. Add a password with HTTP Basic Auth in the global config:

```jsonc
{
  "webServerHost": "0.0.0.0", // optional: reach the web app from your network
  "webServerAuthPassword": "pick-a-strong-one",
  "webServerAuthUsername": "admin", // optional, defaults to your user name
}
```

| Field                   | Default                    | Effect                                                                  |
| ----------------------- | -------------------------- | ----------------------------------------------------------------------- |
| `webServerAuthPassword` | empty                      | When set, every request needs the user name and password. Empty is off. |
| `webServerAuthUsername` | your operating system user | The user name the browser asks for.                                     |

`webServerAuthPassword` accepts the same formats as `memoryApiKey`:

- a literal value, which is fine on a personal computer;
- `env://SOME_VARIABLE`, read from the environment when OMMS starts;
- `file:///path/to/secret`, read from a file. Use `chmod 600`; OMMS warns when others can read the file.

The browser asks for the user name and password once, and forgets them when you close all its windows.

- OMMS compares the password in constant time.
- The "unauthorised" reply is never cached.
- With Basic Auth on, other tools on your network can use the API after they sign in.

Some Settings actions are refused on a network address without Basic Auth: turning on capture traces and saving a pasted API key.

## Re-embedding

Changing the embedding model's size migrates each memory store file safely:

1. OMMS makes every new embedding first.
2. It writes them into a temporary file and checks the row count.
3. Only then does it replace the original file.

A failed migration leaves the original file unchanged.
