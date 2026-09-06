// The system check shown in the header, and the "already installed" facts used by the checklists.
// Every probe tolerates failure: on a fresh Mac most of these simply are not there yet.

import {execFile} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';

const exec = promisify(execFile);

export type SystemInfo = {
  macos: string;
  chip: string;
  freeGb: number;
  clt: boolean;
  brew: boolean;
  mise: boolean;
  sshKeys: boolean;
  casks: Set<string>;
  formulae: Set<string>;
};

async function out(cmd: string, args: string[]): Promise<string> {
  try {
    const {stdout} = await exec(cmd, args, {timeout: 20_000});
    return stdout.trim();
  } catch {
    return '';
  }
}

export async function inspectSystem(): Promise<SystemInfo> {
  const [macos, chip, df, clt, brew, mise, casks, formulae] = await Promise.all([
    out('sw_vers', ['-productVersion']),
    out('sysctl', ['-n', 'machdep.cpu.brand_string']),
    out('df', ['-k', '/']),
    out('xcode-select', ['-p']),
    out('brew', ['--version']),
    out('mise', ['--version']),
    out('brew', ['list', '--cask', '-1']),
    out('brew', ['list', '--formula', '-1']),
  ]);
  const availKb = Number(df.split('\n')[1]?.split(/\s+/)[3] ?? 0);
  const home = os.homedir();
  return {
    macos: macos || '?',
    chip: chip.replace(/^Apple\s+/, '') || '?',
    freeGb: Math.round(availKb / 1024 / 1024),
    clt: Boolean(clt),
    brew: Boolean(brew),
    mise: Boolean(mise),
    sshKeys:
      fs.existsSync(path.join(home, '.ssh', 'id_ed25519_github')) &&
      fs.existsSync(path.join(home, '.ssh', 'id_ed25519_gitlab')),
    casks: new Set(casks.split('\n').filter(Boolean)),
    formulae: new Set(formulae.split('\n').filter(Boolean)),
  };
}

export async function gitEmail(): Promise<string> {
  return out('git', ['config', '--global', 'user.email']);
}
