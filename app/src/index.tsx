import path from 'node:path';
import React from 'react';
import {render} from 'ink';
import {App} from './App';
import {parseArgs, usage} from './args';
import {killCurrent} from './runner';

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage);
  process.exit(0);
}
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('macos-bootstrap needs a terminal. For an unattended run use: ./install.sh --yes');
  process.exit(1);
}

// On a fresh Mac Homebrew is not on PATH yet; the probes and the steps need it.
process.env.PATH = ['/opt/homebrew/bin', '/opt/homebrew/sbin', process.env.PATH ?? ''].join(':');

const root = path.resolve(import.meta.dirname, '..', '..');

// Killed from another window, or the terminal closed: stop the running step. Ink restores the
// screen itself on the way out, including on signals and crashes.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    killCurrent();
    process.exit(130);
  });
}

// The full-screen UI disappears on exit, so anything worth keeping is printed afterwards.
const farewell: {lines: string[]} = {lines: []};

// exitOnCtrlC is off because the app stops the running step itself before it quits.
const app = render(
  <App
    root={root}
    dryRun={args.dryRun}
    autostart={args.autostart}
    exitWhenDone={args.exitWhenDone}
    onFarewell={(lines) => {
      farewell.lines = lines;
    }}
  />,
  {exitOnCtrlC: false, alternateScreen: true},
);
await app.waitUntilExit();

for (const line of farewell.lines) console.log(line);
