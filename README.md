# OMP Repository Boundary Guard

Opt-in OMP extension that offers a soft, best-guess warning when a recognized mutation clearly crosses the active repository boundary.

## What it guards

- Local `write` and structured `edit` operations, including both endpoints of an `edit` move.
- `git push`, including default, configured, named, SSH, and HTTPS remotes.
- `gh issue` creation and updates, `gh pr` creation and updates, and mutating `gh api` requests.
- Supported `xd://github` issue and pull-request writes.

The guard asks only when it can resolve a supported mutation and identify a target different from the active repository. Same-repository mutations remain silent. Read-only operations, unknown or malformed operations, dynamic or ambiguous commands, unresolved paths, unresolved repositories, and missing checkout information pass through without an Ask. The underlying tool remains responsible for validating anything the guard cannot classify confidently.

The active boundary is the invoking session's normalized GitHub `origin`, or its canonical Git root when no GitHub origin exists. Tool `cwd`, shell `cd … &&`, and Git `-C` help resolve a target, but never redefine the boundary. A different local checkout or resolved GitHub repository triggers one standard OMP Ask; one approval authorizes exactly one matching retry.

## Ask handoff

`bun run handoff` reads `{"event":{"toolName":…,"input":…},"cwd":"…"}` from standard input and writes one JSON packet. Its `decision` is `allow` or `ask`; an `ask` packet includes the exact standard OMP Ask payload, active repository, resolved mutation target, action, and exact-retry fingerprint.

```bash
printf '%s\n' '{"event":{"toolName":"bash","input":{"command":"git push https://github.com/elsewhere/example.git HEAD"}}}' | bun run handoff
```

## Install

```bash
omp plugin install github:klondikemarlen/omp-repository-boundary-guard
```

After installing or reinstalling, start a new OMP process (or reload its extensions) before retesting. Existing OMP processes retain extension modules loaded at startup.

If `omp-github-write-guard` is installed from the historical package name, remove it before installing this replacement. Running both guards creates competing confirmation flows.

```bash
omp plugin uninstall omp-github-write-guard
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

Release policy:

- Patch versions cover merged behavior fixes, documentation, and maintenance changes.
- Minor versions cover new user-visible capabilities or supported policy changes.
- Every release must advance `package.json` beyond the latest semantic Git tag; `release:check` rejects an unchanged version.

```bash
bun run release:check
```

After `main` is pushed:

```bash
bun run reinstall
```

`bun run reinstall` is the normal release install path; it uses the generic GitHub reference and follows the repository's default branch. Use an exact commit hash with `--force` only when reproducing a specific release or diagnosing a stale cached install:

```bash
omp plugin install github:klondikemarlen/omp-repository-boundary-guard#<full-commit-hash> --force
```
