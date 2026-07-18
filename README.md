# OMP GitHub Write Guard — retired

This package is a no-op compatibility release. It removes the legacy `0.2.0` Git-push prompt, including same-origin `git push origin` and a push used to open a draft pull request, and adds no confirmation prompts.

OMP already injects `no-issue-filing-without-confirmation`: creating an issue in an external GitHub repository requires current-conversation authorization before Bash runs. Keeping a second guard produced duplicate prompts without providing additional protection.

## Remove the package

```bash
omp plugin uninstall omp-github-write-guard
```

Existing version `0.2.0` installations can instead update to this no-op `0.3.0` release:

```bash
omp plugin install github:klondikemarlen/omp-github-write-guard
```

## Development

```bash
bun test
```
