import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseStepHeader} from './steps';

test('reads label, desc, items, needs, detail and does lines', () => {
  const step = parseStepHeader('apps', '/x/60-apps.sh', `#!/bin/zsh
# label: Applications
# desc: Mac apps from Homebrew · pick which ones
# items: cask
# needs: sudo
# does: Install the ticked apps
# does: Adopt apps that are already there
set -e
`);
  assert.equal(step.label, 'Applications');
  assert.equal(step.desc, 'Mac apps from Homebrew · pick which ones');
  assert.equal(step.items, 'cask');
  assert.deepEqual(step.needs, ['sudo']);
  assert.deepEqual(step.does, ['Install the ticked apps', 'Adopt apps that are already there']);
  assert.equal(step.detail, undefined);
});

test('falls back to the key when there is no header', () => {
  const step = parseStepHeader('shell', '/x/20-shell.sh', '#!/bin/zsh\necho hi\n');
  assert.equal(step.label, 'shell');
  assert.equal(step.items, undefined);
  assert.deepEqual(step.needs, []);
});
