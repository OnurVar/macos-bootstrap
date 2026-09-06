// Runs one step script and turns its output into events. This is the only place the app
// touches the shell; the steps do the actual work.

import {spawn, type ChildProcess} from 'node:child_process';
import readline from 'node:readline';

export type RunEvent = {type: 'ok' | 'fail' | 'current'; label: string};
export type RunResult = {code: number | null; ok: number; failed: number};

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
export const stripAnsi = (s: string): string => s.replace(ANSI, '');

let current: ChildProcess | undefined;

// Steps run in their own process group (see `detached` below), so one signal reaches the whole
// tree: the step's zsh, the brew it started, and whatever brew started.
export function killCurrent(): void {
  const child = current;
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
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
    const child = spawn('zsh', [opts.file], {env: opts.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true});
    current = child;
    let ok = 0;
    let failed = 0;
    const handle = (raw: string) => {
      const line = stripAnsi(raw).replace(/\s+$/, '');
      const t = line.trim();
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
