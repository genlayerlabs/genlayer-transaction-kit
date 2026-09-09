# Publishing

The tag-triggered `.github/workflows/publish.yml` uses npm trusted publishing
(GitHub Actions OIDC). It does not read `NPM_TOKEN`. Branch pushes run ordinary CI,
not an npm credential check. Publishing still requires the tag to match the
owning release branch's current head and all package versions to agree.

## npm configuration

Configure a GitHub Actions trusted publisher separately for each package:

- `@genlayer/transaction-kit`
- `@genlayer/transaction-kit-react`
- `@genlayer/transaction-kit-vue`

Use these exact, case-sensitive values:

| Field | Value |
| --- | --- |
| Organization or user | `genlayerlabs` |
| Repository | `genlayer-transaction-kit` |
| Workflow filename | `publish.yml` |
| Environment name | `Publish` |
| Allowed actions | Enable `npm publish` (staging is also allowed by npm) |

The workflow uses GitHub-hosted runners with Node 24, verifies npm >= 11.5.1,
and grants `id-token: write` only to the publishing job. `npm whoami` is not an
OIDC test: authentication is performed by `npm publish` itself.

## Migration and verification

1. Save and verify all three npm trusted publisher connections before landing
   the tokenless workflow.
2. Validate the workflow and normal build/test gates. A dry run or a rerun that
   skips existing versions does **not** prove OIDC publication works.
3. Verify the next authorized release publishes all three packages without a
   token and has the expected version, `gitHead`, dist-tag, and provenance.
   Do not create a release solely as an authentication probe.
4. After a successful tokenless release, remove the obsolete `NPM_TOKEN` secret
   from the GitHub `Publish` environment, revoke its npm token, and select
   "Require two-factor authentication and disallow bypass 2fa tokens" for all
   three packages. Keep any unrelated credentials unchanged.

npm scans uploads before making them publicly available. Registry verification
allows up to ten minutes per package; a timeout does not mean the upload failed.
Check registry availability before retrying. Existing versions are skipped only
when their `gitHead` matches the release commit.

If a trusted connection is misconfigured, correct it in npm before retrying the
same release. Never move a published release tag or overwrite a package version.

Reference: <https://docs.npmjs.com/trusted-publishers/>
