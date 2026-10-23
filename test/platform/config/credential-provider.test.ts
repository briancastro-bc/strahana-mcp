import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createXsenvCredentialProvider } from '../../../src/platform/config/credential-provider.js';

test('xsenv adapter reads services from a default-env.json file', () => {
  const previous = process.env['VCAP_SERVICES'];
  delete process.env['VCAP_SERVICES'];
  try {
    const dir = mkdtempSync(join(tmpdir(), 'strahana-env-'));
    const file = join(dir, 'default-env.json');
    writeFileSync(
      file,
      JSON.stringify({
        VCAP_SERVICES: {
          'user-provided': [
            { name: 'svc-a', tags: ['t1'], credentials: { user: 'u' } },
            { name: 'svc-b', tags: ['t2'], credentials: { user: 'v' } },
          ],
        },
      }),
    );
    const provider = createXsenvCredentialProvider(file);
    assert.deepEqual(provider.byName('svc-a'), { user: 'u' });
    assert.deepEqual(provider.byTag('t2'), [{ user: 'v' }]);
    assert.equal(provider.byName('nope'), undefined);
  } finally {
    if (previous === undefined) delete process.env['VCAP_SERVICES'];
    else process.env['VCAP_SERVICES'] = previous;
  }
});
