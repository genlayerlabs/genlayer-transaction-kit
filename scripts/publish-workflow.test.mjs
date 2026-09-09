import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8');
const releaseScript = readFileSync(new URL('./release.sh', import.meta.url), 'utf8');

test('release helper requires CI but not a removed branch credential workflow', () => {
  assert.match(releaseScript, /--workflow=ci\.yml/);
  assert.doesNotMatch(releaseScript, /--workflow=publish\.yml|credentials_status/);
  assert.match(releaseScript, /git push origin "refs\/tags\/\$tag"/);
});

test('publishing uses GitHub OIDC without a long-lived npm credential', () => {
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /environment: Publish/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(workflow, /secrets\.NPM_TOKEN|NODE_AUTH_TOKEN/);
  assert.match(workflow, /Trusted publishing requires npm >= 11\.5\.1/);
  assert.match(workflow, /test -n "\$ACTIONS_ID_TOKEN_REQUEST_URL"/);
});

test('publication remains tag-only and retains release safety checks', () => {
  assert.doesNotMatch(workflow, /branches:|workflow_dispatch:/);
  assert.match(workflow, /startsWith\(github.ref, 'refs\/tags\/'\)/);
  assert.match(workflow, /not the current head of \$branch; refusing to publish/);
  assert.match(workflow, /npm publish --workspace "\$workspace" --tag "\$dist_tag" --provenance --access public/);
  assert.match(workflow, /published_sha.*\$GITHUB_SHA/);
});

test('registry verification tolerates npm publish-time scanning', () => {
  assert.match(workflow, /seq 1 60/);
  assert.match(workflow, /sleep 10/);
  assert.match(workflow, /was not visible after publication/);
});
