# OMP GitHub Write Guard

Opt-in OMP extension that requires one standard OMP Ask approval before a recognized GitHub write leaves the active checkout's `origin` repository.

## What it guards

- `git push`, including default, configured, named, SSH, and HTTPS remotes.
- `gh issue` creation and updates, `gh pr` creation and updates, and mutating `gh api` requests.
- Supported `xd://github` issue and pull-request writes. Known read-only operations remain silent; unsupported device operations block without a target.

The current checkout is resolved independently for each invoking command: tool `cwd`, a leading `cd … &&`, and Git `-C` paths are supported. Directory changes do not carry into later tool calls. Nested directories and Git worktrees resolve through Git.

A resolved external target triggers one standard OMP Ask confirmation. Approval permits one exact retry; rejection or no UI blocks. An unresolved target blocks. Same-origin writes are silent.

The extension holds only one in-memory, target-bound approval until its matching retry. An interrupted, malformed, unrelated, or session-directory-changing Ask clears the pending request; it never grants a write. It has no extension-owned dialog, timer, remembered approvals, allowlists, policies, or custom authorization tool.

It recognizes ordinary shell command sequences and static arguments. Shell substitutions, functions, aliases, dynamically generated commands, arbitrary network clients, GitHub API calls outside `gh api`, and writes outside OMP are outside its grammar; run a direct supported command instead.

## Ask handoff

`bun run handoff` reads `{"event":{"toolName":…,"input":…},"cwd":"…"}` from standard input and writes one JSON packet. Its `decision` is `allow`, `block`, or `ask`; an `ask` packet includes the exact standard OMP Ask payload, resolved source and target repositories, action, and exact-retry fingerprint.

```bash
printf '%s\n' '{"event":{"toolName":"bash","input":{"command":"git push https://github.com/elsewhere/example.git HEAD"}}}' | bun run handoff
```

## Install

```bash
omp plugin install github:klondikemarlen/omp-github-write-guard
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
