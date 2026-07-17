# OMP GitHub Write Guard

Opt-in OMP extension that protects GitHub writes outside the current checkout. It identifies the operation and target, then either allows, confirms, or blocks it according to local policy.

It never hard-codes a GitHub owner or repository.

## Install
Install the public Git repository:

```bash
omp plugin install github:klondikemarlen/omp-github-write-guard
```

For development, run the repository directly:

```bash
OMP_GITHUB_WRITE_GUARD_CONFIG="$HOME/.omp/agent/github-write-guard.json" omp --extension .
```

The package root declares `index.ts` in `package.json` under `omp.extensions` for packaged installation.

## Configure

Policy is non-secret JSON. Point `OMP_GITHUB_WRITE_GUARD_CONFIG` at a local file; set a different path for each OMP profile when policies differ.

```json
{
  "trustedOwners": ["example-org"],
  "allowOwnedIssueCreation": true,
  "blockExternalPullRequests": true
}
```

- With no configuration, writes outside the current checkout require confirmation.
- `trustedOwners` identifies organizations or users that receive the owned-policy behavior.
- `allowOwnedIssueCreation` permits new issues in trusted owners without confirmation.
- Pull-request creation in a trusted owner always requires a target-specific confirmation.
- `blockExternalPullRequests` denies PR creation outside trusted owners before execution. Its default is `false`.

Confirmations stay compact and name the action and target:

```text
Allow Create pull request targeting example-org/repository? pull-request creation requires target-specific authorization.
```

## Local Policy Migration

Keep any existing local guard enabled until this extension is installed and its policy is verified. `omp-config` tracks that removal separately in [klondikemarlen/omp-config#6](https://github.com/klondikemarlen/omp-config/issues/6).

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
