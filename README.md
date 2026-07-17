# OMP GitHub Write Guard

Opt-in OMP extension that protects GitHub writes outside the current checkout.

It resolves the current GitHub project from the checkout's `origin` remote. Writes to that project proceed. A resolved external target requires an OMP confirmation for that single write; approvals are never remembered. A write with an unresolved checkout or target is blocked.

There are no settings or policies.

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
