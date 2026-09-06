import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseBrewfile, shortName} from './brewfile';

test('parses labels and groups from the trailing comment', () => {
  const items = parseBrewfile(`
# comment line
tap "facebook/fb"
brew "gh"                          # GitHub CLI | Git
cask "google-chrome"   # Google Chrome | Daily
cask "mos"
brew "facebook/fb/idb-companion"   # idb companion (iOS simulator automation) | Mobile
`);
  assert.deepEqual(items, [
    {kind: 'brew', name: 'gh', label: 'GitHub CLI', group: 'Git'},
    {kind: 'cask', name: 'google-chrome', label: 'Google Chrome', group: 'Daily'},
    {kind: 'cask', name: 'mos', label: 'mos', group: 'Other'},
    {kind: 'brew', name: 'facebook/fb/idb-companion', label: 'idb companion (iOS simulator automation)', group: 'Mobile'},
  ]);
  assert.equal(shortName('facebook/fb/idb-companion'), 'idb-companion');
});
