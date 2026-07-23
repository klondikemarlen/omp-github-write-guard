# OMP Repository Boundary Guard

Opt-in OMP extension that requires one standard OMP Ask approval before a mutation crosses the active repository boundary.

## What it guards

- Local `write` and structured `edit` operations, including both endpoints of an `edit` move.
- `git push`, including default, configured, named, SSH, and HTTPS remotes.
- `gh issue` creation and updates, `gh pr` creation and updates, and mutating `gh api` requests.
- Supported `xd://github` issue and pull-request writes. Registered internal dispatch targets `xd://lsp` and `xd://report_issue` pass through their handlers; unknown URI targets remain unresolved and blocked. Known read-only operations remain silent; unsupported device operations block without a target.

The active boundary is the invoking session's normalized GitHub `origin`, or its canonical Git root when no GitHub origin exists. Local targets resolve through their containing checkout with the same identity. Tool `cwd`, a shell `cd … &&`, and Git `-C` resolve a mutation target, but never redefine the active boundary. Nested directories, worktrees, and separate local clones of the same repository stay inside the boundary.

Mutations inside the active repository stay silent. For GitHub writes, a target matching the active checkout's `origin` stays silent. A local target in another repository—including a path through an escaping symlink—or a different GitHub repository triggers one standard OMP Ask. New local files resolve through their nearest existing parent; moves validate source and destination. A canonical non-Git local target beneath the operating system temporary directory is allowed; symlink escapes and temporary paths inside another repository remain protected. Other non-Git paths and unknown URI targets receive no inferred exception.

Approval permits one exact retry; rejection or no UI blocks. An unresolved target blocks. The extension holds one in-memory, target-bound approval until its matching retry. An interrupted, malformed, unrelated, or session-directory-changing Ask clears the pending request; it never grants a write. It has no extension-owned dialog, timer, remembered approvals, policies, or custom authorization tool.

It recognizes static local paths, structured edit patches, ordinary shell command sequences, and static GitHub arguments. Shell substitutions, functions, aliases, dynamically generated commands, arbitrary network clients, GitHub API calls outside `gh api`, and writes outside OMP are outside its grammar; run a direct supported command instead.

## Ask handoff

`bun run handoff` reads `{"event":{"toolName":…,"input":…},"cwd":"…"}` from standard input and writes one JSON packet. Its `decision` is `allow`, `block`, or `ask`; an `ask` packet includes the exact standard OMP Ask payload, active repository when applicable, mutation target, action, and exact-retry fingerprint.

```bash
printf '%s\n' '{"event":{"toolName":"bash","input":{"command":"git push https://github.com/elsewhere/example.git HEAD"}}}' | bun run handoff
```

## Install

```bash
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

```bash
bun run release:check
```

After `main` is pushed:

```bash
bun run reinstall
```

`bun run reinstall` is the normal release install path; it uses the generic GitHub reference so the latest merged `main` release is selected. Use an exact commit hash with `--force` only when reproducing a specific release or diagnosing a stale cached install:

```bash
omp plugin install github:klondikemarlen/omp-repository-boundary-guard#<full-commit-hash> --force
```
