# OMP GitHub Write Guard

Opt-in OMP extension that protects GitHub writes outside the current checkout. It identifies the operation and target, then either allows it or presents an informative confirmation choice.

It never hard-codes a GitHub owner or repository, and Git worktrees inherit the same GitHub project identity as their origin repository.

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

Policy is non-secret JSON. By default the plugin reads `~/.omp/agent/github-write-guard.json`; `OMP_GITHUB_WRITE_GUARD_CONFIG` overrides that path for a profile-specific policy.

```json
{
  "issueCreationPolicies": {
    "example-org/repository": "allow"
  },
  "pullRequestCreationPolicies": {
    "example-org/repository": "confirm"
  }
}
```

Use the same two JSON fields in OMP's plugin settings UI. Plugin UI values override the corresponding local-policy field. Each map uses exact `owner/repository` targets, case-insensitively:

- `allow` — create without a confirmation.
- `confirm` — show the confirmation choice.
- Unlisted or malformed entries — show the confirmation choice.

No operation is hard-blocked by policy. The confirmation is an OMP menu choice, not typed input. It states the current project, requested issue/PR target, whether it is the same or a different project, and why a choice is required. A confirmed issue or pull-request creation is remembered for that exact resolved target for the rest of the OMP session; denied requests, generic writes, unresolved targets, and different action/target pairs prompt again.

```text
You are in example-org/current-project. Create pull request will create a GitHub artifact in example-org/repository.
Choose an option because this is a different project.
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
