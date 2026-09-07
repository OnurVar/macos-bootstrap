// Runs one step script and turns its output into events. This is the only place the app
// touches the shell; the steps do the actual work.

import {execFileSync, spawn, type ChildProcess} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

export type RunEvent = {type: 'ok' | 'fail' | 'current' | 'progress'; label: string};
export type RunResult = {code: number | null; ok: number; failed: number};

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
export const stripAnsi = (s: string): string => s.replace(ANSI, '');

let current: ChildProcess | undefined;

// Every process under `pid`, found by walking the process table. Steps must stay attached to
// our terminal (macOS sudo keys its cached password to the terminal, and the .pkg installers
// need it), so they cannot be put in their own process group; this walk is how Ctrl-C still
// reaches brew and whatever brew started.
function descendants(pid: number): number[] {
  let table: string;
  try {
    table = execFileSync('ps', ['-axo', 'pid=,ppid='], {encoding: 'utf8'});
  } catch {
    return [];
  }
  const children = new Map<number, number[]>();
  for (const line of table.split('\n')) {
    const [p, pp] = line.trim().split(/\s+/).map(Number);
    if (!p || !pp) continue;
    const list = children.get(pp);
    if (list) list.push(p);
    else children.set(pp, [p]);
  }
  const found: number[] = [];
  const stack = [pid];
  while (stack.length) {
    for (const c of children.get(stack.pop()!) ?? []) {
      found.push(c);
      stack.push(c);
    }
  }
  return found;
}

export function killCurrent(): void {
  const child = current;
  if (!child?.pid) return;
  for (const pid of [...descendants(child.pid).reverse(), child.pid]) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
}

export function runStep(opts: {
  file: string;
  env: NodeJS.ProcessEnv;
  onLine: (line: string) => void;
  onEvent?: (ev: RunEvent) => void;
}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn('zsh', [opts.file], {env: opts.env, stdio: ['ignore', 'pipe', 'pipe']});
    current = child;
    let ok = 0;
    let failed = 0;
    const handle = (raw: string) => {
      const line = stripAnsi(raw).replace(/\s+$/, '');
      const t = line.trim();
      // A live status, such as download progress: shown in the status line, kept out of the log.
      if (t.startsWith('::progress ')) {
        opts.onEvent?.({type: 'progress', label: t.slice(11)});
        return;
      }
      if (t.startsWith('✓ ')) {
        ok++;
        opts.onEvent?.({type: 'ok', label: t.slice(2)});
      } else if (t.startsWith('✗ ')) {
        failed++;
        opts.onEvent?.({type: 'fail', label: t.slice(2)});
      } else if (t.startsWith('==> ')) {
        opts.onEvent?.({type: 'current', label: t.slice(4)});
      }
      opts.onLine(line);
    };
    readline.createInterface({input: child.stdout!}).on('line', handle);
    readline.createInterface({input: child.stderr!}).on('line', handle);
    child.on('error', (err) => {
      failed++;
      opts.onLine(`✗ could not start ${opts.file}: ${err.message}`);
    });
    child.on('close', (code) => {
      current = undefined;
      resolve({code, ok, failed});
    });
  });
}

// A .pkg installer runs `sudo`, which cannot prompt from underneath a full-screen UI, and
// whose cached ticket can expire during a long download. An askpass helper hands the password
// over with no terminal and no ticket involved: Homebrew adds `sudo -A` when SUDO_ASKPASS is
// set. The file holds the password, so it is mode 700 inside a private directory and is
// deleted the moment the run is over.
export function makeAskpass(password: string): {path: string; cleanup: () => void} {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'macos-bootstrap-'));
  const file = path.join(dir, 'askpass');
  const quoted = `'${password.replace(/'/g, `'\\''`)}'`;
  writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' ${quoted}\n`, {mode: 0o700});
  return {path: file, cleanup: () => rmSync(dir, {recursive: true, force: true})};
}

// sudo: validate the password once, then keep the timestamp fresh while steps run,
// so no installer underneath ever stops to ask.
export function sudoValidate(password: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('sudo', ['-S', '-p', '', '-v'], {stdio: ['pipe', 'ignore', 'ignore']});
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
    child.stdin.write(password + '\n');
    child.stdin.end();
  });
}

export function sudoKeepalive(): () => void {
  const timer = setInterval(() => {
    spawn('sudo', ['-n', '-v'], {stdio: 'ignore'}).on('error', () => {});
  }, 60_000);
  return () => clearInterval(timer);
}

export function notify(title: string, message: string): void {
  const q = (s: string) => `"${s.replace(/["\\]/g, "'")}"`;
  spawn('osascript', ['-e', `display notification ${q(message)} with title ${q(title)}`], {stdio: 'ignore'}).on('error', () => {});
}
