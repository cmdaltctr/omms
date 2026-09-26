## 1. GitHub identity

- [x] 1.1 Rename `cmdaltctr/opencode-mem` to `cmdaltctr/omms`, set its description to `OMMS - Opinionated Modular Memory System`, and verify the new GitHub URL responds. (gh repo view confirms name=omms, description set, url https://github.com/cmdaltctr/omms)
- [x] 1.2 Update each local worktree's `origin` URL to `https://github.com/cmdaltctr/omms.git` and verify `git remote -v`. (both main checkout and feature worktree updated and verified)

## 2. Repository branding

- [x] 2.1 Update package metadata, badges, and controlled repository links to the canonical OMMS repository URL; verify no controlled old URL remains. (package.json repository.url, README fork notice + Repository/Issues links, web sidebar GitHub link now point at cmdaltctr/omms; repo-wide search shows zero remaining cmdaltctr/opencode-mem or opencode-mem-icon references; upstream tickernelz links intentionally preserved)
- [x] 2.2 Rename the bundled web icon asset and its application reference; verify `npm pack --dry-run --json` includes only the new asset name. (git mv web/public/opencode-mem-icon.png -> omms-icon.png; AppSidebar src updated; pack shows dist/web/omms-icon.png and no old asset)
- [x] 2.3 Preserve legacy runtime identifiers required for compatibility; verify the targeted migration and web-auth tests pass. (22 pass / 0 fail across tag-prefix migration, portability, web-api-auth, XSS, and traversal tests; no changes to auth token path, env vars, or legacy config names)

## 3. Release checks

- [x] 3.1 Run typecheck, format check, and package dry-run; verify each command exits successfully. (typecheck EXIT 0, lint EXIT 0, format:check EXIT 0 after prettier fix, build EXIT 0, npm pack dry-run EXIT 0)
- [x] 3.2 Record npm publication prerequisites without publishing or creating a release tag. (prerequisites: 1) npm package name omms is unclaimed (verified E404 earlier this session); 2) add NPM_TOKEN secret to cmdaltctr/omms GitHub settings; 3) push tag v3.0.0 — must equal package.json version; the tag triggers .github/workflows/release.yml which publishes and creates the GitHub release; no publish or tag performed in this change)
