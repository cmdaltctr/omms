# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers who install the `om-memory-system` npm package and use one or more of three AI coding hosts: OpenCode, Pi and Claude Code. Many use more than one host on the same projects. They open the web UI (default `http://127.0.0.1:4747`) to check what OMMS has captured, import older chat history, fix project folders that moved, and change settings. The maintainer is one of these users, but design decisions target a developer meeting OMMS for the first time.

## Product Purpose

OMMS gives AI coding agents long-term project memory. It captures technical work, recalls relevant notes in later sessions and learns the user's working preferences. Success means a user can see, per host, what memory exists and what is still waiting to import, and can act on it without reading the docs.

## Positioning

One shared memory engine serves OpenCode, Pi and Claude Code, with one store per project. Each host can retrieve memories that the other hosts captured in the same project.

## Operating Context

- The web UI runs locally. `webServerHost` stays on loopback by default; a non-loopback host requires an API token.
- Each host has its own history source: OpenCode's database, Pi session files and Claude Code transcripts. OMMS reads them and never writes to them.
- History import and automatic backfill make model calls through the host model, an external API, or the session model, in that order. Claude Code uses only the external API.
- Embeddings run locally by default, or through a configured local or remote embedding API.
- Directory maps link a recorded project folder to its current folder. They apply to every host.

## Capabilities and Constraints

- Hosts: OpenCode (V1 and V2), Pi and Claude Code. Pi and OpenCode must keep the same user capabilities.
- Import and backfill states: running, paused, stopped, done and failed. A pause is stored and survives restarts.
- Capture and profile learning can send conversation content to the chosen model provider and cost money. The UI must keep saying so where it starts that work.
- Every user-visible string goes through the translation tables in `web/src/lib/i18n/`.
- Source files in `web/src/` stay at 500 lines or fewer.
- Stack: React and Vite in `web/`, `lucide-react` icons, shadcn-style primitives.

## Brand Commitments

- Name: OMMS (Opinionated Modular Memory System). npm package `om-memory-system`.
- Logo: `.github/screenshots/omms-logo.png`.
- Visual style: the OpenChamber-derived look defined by the `omms-design` skill. Category and type labels always carry their `keywordHue` colour.
- Voice: plain British English, short sentences.

## Evidence on Hand

- Screenshots under `.github/screenshots/`.
- User guides in `docs/`, including `web-ui.md`, `web-ui-memory.md` and `web-ui-settings.md`.
- No testimonials, user counts or benchmarks exist. Do not invent them.

## Product Principles

1. Local-first and private. Data lives in `~/.omms`; never imply cloud storage. Text in `<private>` tags never reaches storage.
2. One host at a time. A user who asks about one host sees only that host's state and actions; settings shared by all hosts stay in one place.
3. Every state explains itself. A paused, stopped or disabled control says why and what to do next.
4. Costs are visible before they happen. Any action that makes model calls says so first.

## Accessibility & Inclusion

WCAG 2.2 AA: full keyboard use, visible focus, AA contrast and screen reader labels. Check mobile layouts in a browser viewport; no device emulators.
