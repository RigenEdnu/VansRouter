# CI/CD Release Policy

Mandatory for every AI-assisted release. Do not bypass these rules with force tags, manual npm publish, manual GHCR tag mutation, or `latest`-only deployment.

## Release Contract

- Release source: annotated Git tag `vX.Y.Z` pushed to the current tip of `main`.
- `package.json` and `cli/package.json` versions must equal `X.Y.Z`.
- `CHANGELOG.md` must start with `# vX.Y.Z (YYYY-MM-DD)`.
- The commit immediately before the tag must be the last commit changing only `CHANGELOG.md`.
- All code, workflow, test, and version changes must be complete before the changelog-only commit.
- Never retag or move an existing release tag. Use the next version.
- Never tag an older commit: CI requires the tag commit to equal `origin/main`.
- Never publish npm manually outside the release workflow.
- GitHub Actions checkout may dereference an annotated tag to its commit. CI must fetch the original tag object into a temporary ref before validating annotation:

```bash
git fetch origin "refs/tags/$GITHUB_REF_NAME:refs/tags/release-validation"
RELEASE_TAG_REF=refs/tags/release-validation node cli/scripts/validate-release.cjs "$GITHUB_REF_NAME"
```

## Required Commit Order

1. Implement code and tests.
2. Update `package.json` and `cli/package.json` to the same version.
3. Run validation and build.
4. Update the top `CHANGELOG.md` entry with the final version and verified changes.
5. Commit `CHANGELOG.md` alone. This must be the final commit before the tag.
6. Create and push an annotated tag:

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

### Example: Release `v0.91.9`

Use the exact release version everywhere. Do not combine the changelog commit with code, workflow, or package-version changes.

```bash
# Commit 1: code, CI, tests, and package version bump
git add package.json cli/package.json .github/workflows/release.yml cli/scripts AGENTS.md .agent/cicd.md
git commit -m "chore: prepare release 0.91.9"

# Commit 2: changelog only; must remain the final commit before the tag
git add CHANGELOG.md
git diff --cached --name-only
# Expected output: CHANGELOG.md
git commit -m "docs(changelog): release v0.91.9"

git push origin main
node cli/scripts/validate-release.cjs v0.91.9 --pretag
git tag -a v0.91.9 -m "Release v0.91.9"
git push origin v0.91.9
```

Before using another version, replace every `0.91.9` occurrence above with the new `X.Y.Z`. Confirm both package files and the top changelog heading use the same version.

## Pre-Tag Validation

Run from a clean `main` checkout:

```bash
git pull --ff-only origin main
git status --short
git diff --check
node -e 'const a=require("./package.json"),b=require("./cli/package.json"); if(a.version!==b.version) throw Error(`${a.version} !== ${b.version}`); console.log(a.version)'
pnpm test
pnpm run build
node cli/scripts/validate-release.cjs "v$(node -p "require('./package.json').version")" --pretag
```

The `--pretag` command checks the changelog-only commit before the tag exists. After creating the annotated tag, CI repeats the same checks and additionally verifies tag object type. If a check fails, stop. Do not push a tag.

## CI Gates

The release workflow must complete in this order:

```text
check-branch
package-npm + build-and-verify-ghcr
publish-npm
promote-ghcr
```

Required evidence:

- `check-branch`: tag points to `main`, versions match, changelog is final commit, tag is annotated.
- `check-branch` must validate the original annotated tag object, not the dereferenced checkout ref.
- `package-npm`: actual tarball contains `app/_nm/sql.js/dist/sql-wasm.wasm`; no `better_sqlite3.node`.
- Artifact smoke test: extracted CLI starts with a temporary `DATA_DIR`, responds to `/api/settings`, creates `db/data.sqlite`, and migrates legacy `db.json` without network.
- `build-and-verify-ghcr`: staging image contains `linux/amd64` and `linux/arm64`; native SQLite query succeeds.
- `publish-npm`: publishes the validated artifact, never rebuilds it.
- `promote-ghcr`: promotes staging image to `X.Y.Z` and `latest` only after npm succeeds.

## Deployment Rules

- Deploy immutable image tag `ghcr.io/vanszs/vansrouter:X.Y.Z`, not `latest`.
- Keep Docker volume name `9router-data`; never rename it without explicit DB migration and verification.
- PM2 deployments must set the production port explicitly and use `--update-env` on restart.
- Preserve `server.js`, `custom-server.js`, peer-token handling, proxy IP handling, and persistent `DATA_DIR`.
- After deployment, verify version and health:

```bash
curl -fsS http://127.0.0.1:3003/api/version
curl -fsS http://127.0.0.1:3003/api/health
```

- Verify SQLite path, migrations, login, and one authenticated/API-key request before declaring success.
- Do not claim deployment success without command output or GitHub Actions evidence.

## Failure Recovery

- `check-branch` or package failure: fix the branch and create a new version/tag.
- Once a tag is pushed, it is immutable even if CI fails. Never delete, move, force-push, or rerun under the same tag after a release-gate bug; fix the workflow and use the next version.
- `v0.91.3` and `v0.91.4` are historical failed tags. Do not reuse them; `v0.91.5` was the first recovery release with the temporary-tag validation fix. `v0.91.6` carries the subsequent Kiro hardening and the provider-dashboard revert.
- GHCR staging failure: do not promote its staging tag.
- npm publish timeout: query npm first; never retry blindly:

```bash
npm view vansrouter@X.Y.Z version
```

- npm already published but GHCR promotion failed: promote/recover the exact staging image; do not republish npm.
- Production health failure: rollback to the previous immutable image tag; preserve the DB volume and inspect migration backups.
- Never use `git reset --hard`, force-push, or delete published tags as recovery.
