# TDR-020: Trust git on PATH outside a project

- **Date:** 2026-10-01
- **Status:** Proposed
- **Deciders:** OMMS maintainers
- **Tags:** web app, git, user profile, login item

## Context

The User Profile page said "No profile found" while the store held a profile with 185 preferences. The login web app runs with `/` as its working directory.

### Root Cause Analysis

- **Symptom:** `GET /api/user-profile` returned `exists: false` with `userId: "unknown"`.
- **Cause:** `getGitEmail("/")` returned `null`. The git trust check finds the nearest `.git` folder or project marker above the directory. It refuses any `git` binary inside that folder, so a cloned repository cannot run its own `git`.
  - With no marker above `/`, `findUntrustedProjectRoot` returned `/` itself.
  - Every `git` on `PATH` is inside `/`, so the check refused all of them.
  - The profile handlers then used the fallback `"unknown"`.
- **Second cause:** the handlers read the email only from the working directory. A repository with its own `user.email` also made capture learn into a second profile.

## Decision

1. `findUntrustedProjectRoot` returns `null` when no `.git` or marker is above the directory. With no project, there is no untrusted root, and `git` on `PATH` is trusted. A `git` inside a repository root is still refused. `tests/tags.test.ts` covers both cases.
2. The web profile handlers use `resolveWebProfileUserId` (`src/services/profile-identity.ts`). Order: `userEmailOverride`, the working directory's git email, the global git email, then the only active profile.
3. The Settings page lists the profiles when more than one is active, and can set `userEmailOverride` or merge two profiles.

## Consequences

### Positive

- The profile page works from the login item without a config change.
- Split profiles can be seen and fixed from the page.

### Negative

- A merge cannot be undone from the page. The source profile stays stored and inactive.

### Neutral

- Outside a project, OMMS now runs the first `git` on `PATH`, as a shell would.

## Alternatives Considered

| Option                                      | Rejected Because                                                  |
| ------------------------------------------- | ----------------------------------------------------------------- |
| Run the login item with the home directory  | Hides the bug for other callers that run outside a project.       |
| Require `userEmailOverride` for the web app | Every user would have to set it by hand to see their own profile. |
