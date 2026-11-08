# ADR-044: New memory spaces get random folder ids

- **Date:** 2026-11-07
- **Status:** Proposed
- **Deciders:** Aizat Hawari
- **Change:** [`space-folder-ids`](../../openspec/changes/archive/space-folder-ids/proposal.md)

## Context

A space's folder id came from its name through `spaceIdFromName`. The folder kept the id of the first name the space ever had. Three problems followed:

- A name that gave an unsafe or taken id needed refusal rules. The rules existed to protect the folder, not the user.
- After `Work` was renamed to `Tech`, the folder stayed `~/.omms/spaces/work/` and the name `Work` stayed taken. Creating a new `Work` failed with "gives the same folder id".
- A person browsing `~/.omms/spaces/` saw folder names that matched no display name. The edit dialog needed the note "Only the name changes. The folder keeps its name." to explain the mismatch, and users read it as a contradiction.

## Decision

1. **A new space gets a random id: `space-` plus 10 lowercase letters and digits**, drawn with `crypto.randomInt`. A draw that is taken or fails the id rules is drawn again. The id never comes from the name. The result fits the existing id pattern, so an older OMMS reads the newer registry unchanged.
2. **Ids never change.** A rename changes the display name only, and the freed name can be used by a new space.
3. **Existing spaces and Default keep their ids and folders.** Nothing on disk is moved or renamed.
4. **The display name is free of folder concerns.** Length (1 to 60 characters) and uniqueness without regard to case are the only naming rules.

## Alternatives rejected

- **A readable id with a `-2` suffix on clash.** It fixes the clash but keeps folder names tied to old display names, which is the problem the user raised.
- **A UUID.** It fits the id rules, but 36 characters read badly in paths, backup folder names and logs.

## Consequences

Positive:

- A folder id can never disagree with a space name, so no name is refused for id reasons.
- A `space.json` file in each folder labels it with the id, the display name and the creation time. OMMS writes it on create and rename and adds or fixes it at start-up. A folder on disk can be identified without OMMS.
- The **Open folder** button on a space card answers where a space is stored.
- ADR-041's one-folder-per-space model is unchanged.

Negative:

- Folder ids are less readable in `~/.omms/spaces/`, in backup folder names and in logs. Accepted: `space.json` names each folder, and CLI and tool output prints the name first with the id in brackets.
- Two id styles now coexist, readable ids from older spaces and random ids from new ones. Accepted: both match the same id pattern, and nothing parses the id.
- An older OMMS that renames a space leaves `space.json` stale. Accepted: the next start-up of a newer OMMS rewrites it.
