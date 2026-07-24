# OMP Repository Boundary Guard

Opt-in OMP extension that requires one standard OMP Ask approval before a mutation crosses the active repository boundary.

## What it guards

- Local `write` and structured `edit` operations, including both endpoints of an `edit` move.
- `git push`, including default, configured, named, SSH, and HTTPS remotes; help, version, and dry-run modes remain read-only.
- `gh issue` creation and updates, `gh pr` creation and updates, and mutating `gh api` requests.
- Supported `xd://github` issue and pull-request writes. Registered internal dispatch targets `xd://github`, `xd://browser`, `xd://lsp`, `xd://report_issue`, `xd://recall`, `xd://retain`, `xd://reflect`, `xd://memory_edit`, and `xd://learner_file_ticket`, plus the `skill://` namespace, pass through their handlers; unknown URI targets do not emit an unanswerable confirmation. Known read-only operations remain silent; unsupported or malformed `xd://github` device operations with no actionable target pass through, while unrelated unsupported operations are outside this guard.

The active boundary is the invoking session's normalized GitHub `origin`, or its canonical Git root when no GitHub origin exists. Local targets resolve through their containing checkout with the same identity. Tool `cwd`, a shell `cd … &&`, and Git `-C` resolve a mutation target, but never redefine the active boundary. Nested directories, worktrees, and separate local clones of the same repository stay inside the boundary.

Mutations inside the active repository stay silent. For GitHub writes, a target matching the active checkout's `origin` stays silent. A local target in another repository—including a path through an escaping symlink—or a different GitHub repository triggers one standard OMP Ask. New local files resolve through their nearest existing parent; moves validate source and destination. A canonical non-Git local target beneath the operating system temporary directory is allowed; symlink escapes and temporary paths inside another repository remain protected. `file:` URLs are normalized before applying these rules. Local file or URI targets that cannot be resolved to a concrete path do not emit a confirmation because there is no actionable approval decision; unresolved GitHub targets remain confirmation-gated.

Approval permits one exact retry; a prior standard external GitHub approval for the same action and target may authorize one boundary-equivalent retry so duplicate gates do not deadlock. A rejected confirmation does not authorize a retry. When no OMP UI is available, the guard does not block the call or consume approval because it cannot ask. The extension holds one in-memory, target-bound approval until its matching retry; an explicit `OMP_REPOSITORY_BOUNDARY_GUARD_ALLOW_EXTERNAL_MUTATION=1` prefix (or `boundaryOverride: "allow-external-mutation"` on a direct local `write`/`edit`) allows one resolved external mutation without an Ask. Overrides never resolve unknown targets; unresolved local file/URI mutations pass through without emitting an unanswerable Ask.

Optional process-level exemptions use `OMP_REPOSITORY_BOUNDARY_GUARD_EXEMPT_CATEGORIES`, a comma-separated allowlist of categories: `local`, `git`, and `github`. For example, launch OMP with `OMP_REPOSITORY_BOUNDARY_GUARD_EXEMPT_CATEGORIES=github`; this is configuration for the guard process, not an inline prefix for an individual `gh` command. Exemptions apply only after a supported target is resolved; unresolved local file/URI mutations pass through without confirmation and are never exempted, while unresolved GitHub mutations remain confirmation-gated. Invalid category values grant no exemptions. The default is to enforce every category.

It recognizes static local paths, structured edit patches, ordinary shell command sequences, and static GitHub arguments. Shell substitutions, functions, aliases, dynamically generated commands, arbitrary network clients, GitHub API calls outside `gh api`, and writes outside OMP are outside its grammar; run a direct supported command instead. A compound shell sequence containing multiple GitHub mutations, such as `gh pr ready 123 && gh pr merge 123`, is not one exemptible mutation; unresolved local file/URI writes pass through without an unanswerable confirmation, while unresolved GitHub mutations follow the normal confirmation path. Run each supported command separately when using `OMP_REPOSITORY_BOUNDARY_GUARD_EXEMPT_CATEGORIES=github`; otherwise the recognized operation follows the normal confirmation path when its target is resolved.

## Ask handoff

`bun run handoff` reads `{"event":{"toolName":…,"input":…},"cwd":"…"}` from standard input and writes one JSON packet. Its `decision` is `allow`, `block`, or `ask`; an `ask` packet includes the exact standard OMP Ask payload, active repository when applicable, mutation target, action, and exact-retry fingerprint.

```bash
printf '%s\n' '{"event":{"toolName":"bash","input":{"command":"git push https://github.com/elsewhere/example.git HEAD"}}}' | bun run handoff
```

## Install

```bash
omp plugin install github:klondikemarlen/omp-repository-boundary-guard
```

After installing or reinstalling, start a new OMP process (or reload its extensions) before retesting. Existing OMP processes retain extension modules loaded at startup.

If `omp-github-write-guard` is installed from the historical package name, remove it before installing this replacement. Running both guards creates competing confirmation flows.

```bash
omp plugin uninstall omp-github-write-guard
omp plugin install github:klondikemarlen/omp-repository-boundary-guard
```

For development:

```bash
omp --extension .
```

The package root declares `index.ts` under `omp.extensions` for packaged installation.

## Development

```bash
bun test
```

## Release

Release policy:

- Patch versions cover merged behavior fixes, documentation, and maintenance changes.
- Minor versions cover new user-visible capabilities or supported policy changes.
- Every release must advance `package.json` beyond the latest semantic Git tag; `release:check` rejects an unchanged version.

```bash
bun run release:check
```

After `main` is pushed:

```bash
bun run reinstall
```

`bun run reinstall` is the normal release install path; it uses the generic GitHub reference and follows the repository's default branch. Use an exact commit hash with `--force` only when reproducing a specific release or diagnosing a stale cached install:

```bash
omp plugin install github:klondikemarlen/omp-repository-boundary-guard#<full-commit-hash> --force
```
