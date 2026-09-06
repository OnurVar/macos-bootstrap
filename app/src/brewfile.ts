// The Brewfile is the list of apps and CLI tools. Each line carries its menu label and group
// in the trailing comment:
//
//   cask "google-chrome"   # Google Chrome | Daily
//   brew "gh"              # GitHub CLI | Git
//
// Without a comment the name is the label; without a group the item lands in "Other".
// It stays a valid Brewfile, so `brew bundle` works on it too.

import type {ItemKind} from './steps';

export type BrewItem = {
  kind: ItemKind;
  name: string;
  label: string;
  group: string;
};

const LINE = /^(brew|cask)\s+"([^"]+)"(?:\s*#\s*(.*))?\s*$/;

export function parseBrewfile(text: string): BrewItem[] {
  const items: BrewItem[] = [];
  for (const raw of text.split('\n')) {
    const m = LINE.exec(raw.trim());
    if (!m) continue;
    const [, kind, name, comment = ''] = m;
    const [labelPart, groupPart] = comment.split('|');
    const label = labelPart.trim() || name;
    const group = (groupPart ?? '').trim() || 'Other';
    items.push({kind: kind as ItemKind, name, label, group});
  }
  return items;
}

// brew list shows "idb-companion" for "facebook/fb/idb-companion".
export function shortName(name: string): string {
  return name.split('/').pop() ?? name;
}
