# OMP Git Push Authorization Guard

Opt-in OMP extension that allows direct `git push` only to the GitHub repository of the current checkout.

## Authorization rule

The extension observes executable `git push` commands sent through OMP's `bash` tool.

- A direct push is allowed only when its resolved GitHub target matches the session checkout's `origin`.
- An external or unresolved direct push is blocked before execution and tells the agent to call `authorized_git_push`.
- `authorized_git_push` accepts an explicit Git remote, optional refspecs, and optional working directory. It uses OMP's standard `exec` approval prompt, then runs `git push` without a shell after approval.
- The plugin owns no UI dialog and remembers no approvals. OMP's normal approval policy, including yolo/auto-approve behavior, remains in control.

Named Git remotes are resolved from the command working directory or a `git -C` checkout using their push URL. Git worktrees use their shared checkout origin.

The extension does not inspect `github`, `write`, `gh`, `curl`, or other tools. In particular, it does not intercept OMP Learner's structured GitHub writes.

## Install

Install the public Git repository:

```bash
omp plugin install github:klondikemarlen/omp-github-write-guard
```


The package root declares `index.ts` in `package.json` under `omp.extensions` for packaged installation.

## Development

```bash
bun test
```

## Release

Before releasing:

```bash
bun run release:check
```

After `main` is pushed:

```bash
bun run reinstall
```
