# OMP Git Push Authorization Guard

Opt-in OMP extension that keeps a direct `git push` inside the GitHub repository of the current checkout unless the user approves one external target.

## Authorization rule

The extension recognizes static, top-level `git push` commands sent through OMP's `bash` tool. It parses shell quoting and top-level command lists, accepts direct `git push [remote] [refspec...]` forms, and fail-closes ambiguous syntax—including potential pushes in newline-delimited commands—before it runs. It is not a shell sandbox: aliases, wrapper programs, and nested shell scripts are outside this deliberately narrow scope.

- A push is allowed only when its resolved GitHub target matches the session checkout's `origin`.
- An unqualified `git push` resolves the current branch upstream, then `origin`, matching Git's default destination rule.
- A resolved external direct push is blocked before execution and steers the agent to OMP's built-in `ask` form with `Approve push` and `Reject push` options.
- An approval grants `authorized_git_push` one push to that target. It resolves the remote again and runs `git push` without a shell. The tool declares normal OMP `exec` approval; rejection, cancellation, and unrelated answers grant nothing.
- The plugin owns no UI dialog and remembers no approvals. OMP's normal `ask` form waits until an answer unless the user configures `ask.timeout`.

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
