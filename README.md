# OMP Repository Boundary Guard

Opt-in OMP extension that requires one standard OMP Ask approval before a mutation crosses the active checkout boundary.

## What it guards

- Local `write` and structured `edit` operations, including both endpoints of an `edit` move.
- `git push`, including default, configured, named, SSH, and HTTPS remotes.
- `gh issue` creation and updates, `gh pr` creation and updates, and mutating `gh api` requests.
- Supported `xd://github` issue and pull-request writes. Known read-only operations remain silent; unsupported device operations block without a target.

The active boundary is the invoking session's Git root, canonicalized with `realpath`. Tool `cwd`, a shell `cd … &&`, and Git `-C` resolve a mutation target, but never redefine the active boundary. Nested directories and Git worktrees resolve through Git.

Mutations inside the active checkout stay silent. For GitHub writes, a target matching the active checkout's `origin` stays silent. A canonical local target outside the root—including a path through an escaping symlink—or a different GitHub repository triggers one standard OMP Ask. New local files resolve through their nearest existing parent; moves validate source and destination. `/tmp`, non-Git paths, and unknown URI targets receive no inferred exception.

Approval permits one exact retry; rejection or no UI blocks. An unresolved target blocks. The extension holds one in-memory, target-bound approval until its matching retry. An interrupted, malformed, unrelated, or session-directory-changing Ask clears the pending request; it never grants a write. It has no extension-owned dialog, timer, remembered approvals, policies, or custom authorization tool.

It recognizes static local paths, structured edit patches, ordinary shell command sequences, and static GitHub arguments. Shell substitutions, functions, aliases, dynamically generated commands, arbitrary network clients, GitHub API calls outside `gh api`, and writes outside OMP are outside its grammar; run a direct supported command instead.

## Ask handoff

`bun run handoff` reads `{"event":{"toolName":…,"input":…},"cwd":"…"}` from standard input and writes one JSON packet. Its `decision` is `allow`, `block`, or `ask`; an `ask` packet includes the exact standard OMP Ask payload, active repository when applicable, mutation target, action, and exact-retry fingerprint.

```bash
printf '%s\n' '{"event":{"toolName":"bash","input":{"command":"git push https://github.com/elsewhere/example.git HEAD"}}}' | bun run handoff
```

## Install

```bash
omp plugin install github:klondikemarlen/omp-github-write-guard
```

The distribution slug remains `omp-github-write-guard` to preserve existing installations; the product name now describes its repository-boundary behavior.

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
