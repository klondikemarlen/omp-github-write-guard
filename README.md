# OMP GitHub Write Guard

Opt-in OMP extension that requires one standard OMP Ask approval before a GitHub write leaves the active checkout's `origin` repository.

## What it guards

- `git push`, including configured and named remotes, is allowed when its resolved push URL matches the active checkout's `origin`.
- An external resolved target triggers one standard OMP Ask confirmation. Approval permits one exact retry; rejection, an unresolved target, or no UI blocks it.
- GitHub issue creation through `xd://github` or `gh issue create` follows the same rule.
- Normal same-origin pushes and issue creation are silent.

The extension holds only one in-memory, target-bound approval until its matching retry. An interrupted, malformed, or unrelated Ask clears the pending request; it never grants a write. It has no extension-owned dialog, timer, remembered approvals, allowlists, policies, or custom authorization tool.

It recognizes ordinary shell command sequences and static arguments. Shell substitutions, functions, aliases, and dynamically generated commands are outside its grammar; run a direct `git push` or `gh issue create` instead. It does not guard arbitrary network clients, GitHub API calls outside issue creation, or writes outside OMP.

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
