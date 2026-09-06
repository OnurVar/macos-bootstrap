import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseMiseTools} from './mise';

test('lists the tools table only', () => {
  const tools = parseMiseTools(`
[settings]
idiomatic_version_file_enable_tools = ["node"]

[tools]
node = "24"     # LTS
ruby = "3.4"
"npm:yarn" = "latest"
`);
  assert.deepEqual(tools, ['node 24', 'ruby 3.4', 'yarn latest']);
});
