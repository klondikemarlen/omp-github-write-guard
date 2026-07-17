# OMP GitHub Write Guard

Opt-in OMP extension that protects GitHub writes outside the current checkout.

It resolves the current GitHub project from the checkout's `origin` remote. Writes to that project proceed. A resolved external target requires an OMP confirmation for that single write; approvals are never remembered. An unresolved checkout or target also requires an explicit one-off confirmation rather than being guessed. Named `git push` remotes are resolved from the command working directory before that fallback.

There are no settings or policies.

## Confirmation deadline

OMP 17.0.2 ends extension handlers after 30 seconds. The guard cannot extend that host deadline, so a confirmation left open beyond it cannot authorize the original write. While that menu remains open, identical retries are blocked without opening another menu; resolve it, then retry to receive a fresh one-off choice. Host support for a confirmation that survives its handler deadline is required to remove this limitation.

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
