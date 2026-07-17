# OMP Git Push Authorization Guard

Opt-in OMP extension that authorizes `git push` only to the GitHub repository of the current checkout.

## Authorization rule

The extension observes executable `git push` commands sent through OMP's `bash` tool.

- A push is allowed only when its resolved GitHub target matches the session checkout's `origin`.
- An external or unresolved target, or an unresolved session checkout, is hard-blocked.
- There is no confirmation UI, timeout, remembered approval, allowlist, or override.

To push another repository, start OMP from that repository's checkout.

The extension does not inspect `github`, `write`, `gh`, `curl`, or other tools. In particular, it does not intercept OMP Learner's structured GitHub writes.

Named Git remotes are resolved from the command working directory using their push URL. Git worktrees use their shared checkout origin.

## Install

Install the public Git repository:

```bash
omp plugin install github:klondikemarlen/omp-github-write-guard
```

For development, run the repository directly:

```bash
omp --extension .
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
