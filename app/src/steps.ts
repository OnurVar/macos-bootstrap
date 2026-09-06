// Steps are the files in steps/NN-name.sh. The app never lists them by hand:
// it reads the header comments of each file, so adding a step is adding a file.
//
//   # label: Applications                 shown in the left pane
//   # desc: Mac apps from Homebrew        one line under the label
//   # items: cask                         per-item checklist from the Brewfile (brew or cask)
//   # needs: sudo                         prompts the app asks for first (see prompts.ts)
//   # detail: mise                        extra detail provider (see App.tsx)
//   # does: Create ~/Projects             one line per thing the step does, shown in the detail pane

import fs from 'node:fs/promises';
import path from 'node:path';

export type ItemKind = 'brew' | 'cask';

export type Step = {
  key: string;
  file: string;
  label: string;
  desc: string;
  items?: ItemKind;
  needs: string[];
  detail?: string;
  does: string[];
};

export function parseStepHeader(key: string, file: string, text: string): Step {
  const step: Step = {key, file, label: key, desc: '', needs: [], does: []};
  for (const raw of text.split('\n').slice(0, 40)) {
    const m = /^#\s*([a-z]+):\s*(.*)$/.exec(raw);
    if (!m) continue;
    const [, name, value] = m;
    const v = value.trim();
    if (name === 'label') step.label = v;
    else if (name === 'desc') step.desc = v;
    else if (name === 'items' && (v === 'brew' || v === 'cask')) step.items = v;
    else if (name === 'needs') step.needs = v.split(/\s+/).filter(Boolean);
    else if (name === 'detail') step.detail = v;
    else if (name === 'does') step.does.push(v);
  }
  return step;
}

export async function discoverSteps(root: string): Promise<Step[]> {
  const dir = path.join(root, 'steps');
  const names = (await fs.readdir(dir)).filter((n) => /^\d\d-.+\.sh$/.test(n)).sort();
  const steps: Step[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    const key = name.replace(/^\d\d-/, '').replace(/\.sh$/, '');
    steps.push(parseStepHeader(key, file, await fs.readFile(file, 'utf8')));
  }
  return steps;
}
