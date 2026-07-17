# OMP Git Push Authorization Guard

Opt-in OMP extension that allows direct `git push` only to the GitHub repository of the current checkout.

## Authorization rule

The extension observes executable `git push` commands sent through OMP's `bash` tool.

- A direct push is allowed only when its resolved GitHub target matches the session checkout's `origin`.
- A resolved external direct push is blocked before execution and steers the agent to OMP's built-in `ask` form with `Approve push` and `Reject push` options.
- An approval grants `authorized_git_push` one push to that target; the tool resolves the remote again and runs `git push` without a shell. Rejection, cancellation, and unrelated answers grant nothing.
- The plugin owns no UI dialog and remembers no approvals. The built-in `ask` tool waits using OMP's configured timeout, which defaults to disabled.

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
