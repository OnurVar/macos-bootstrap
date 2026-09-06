// A step declares what it needs with `# needs: email passphrase sudo`; each word maps to one or
// more prompts here. The app asks them all before the first step runs, so nothing underneath
// ever prompts. Adding a new kind of prompt is one entry in this table.

import {sudoValidate} from './runner';

export type PromptSpec = {
  key: string;
  title: string;
  hint: string;
  secret?: boolean;
  initial?: string;
  // Gets the answers given so far, so a confirmation can compare against an earlier one.
  validate?: (value: string, answers: Record<string, string>) => Promise<string | null>;
  // When validation fails, go back to this prompt instead of asking this one again.
  restartFrom?: string;
};

export type PromptContext = {
  gitEmail: string;
  sshKeysExist: boolean;
};

const REGISTRY: Record<string, (ctx: PromptContext) => PromptSpec | PromptSpec[] | null> = {
  email: (ctx) =>
    ctx.sshKeysExist
      ? null
      : {
          key: 'email',
          title: 'Email to label the SSH keys with',
          hint: 'enter to continue · esc to go back',
          initial: ctx.gitEmail,
        },
  // Asked twice: a typo here would produce keys that nobody can unlock, and a later run would
  // see the files and never offer to make them again.
  passphrase: (ctx) =>
    ctx.sshKeysExist
      ? null
      : [
          {
            key: 'passphrase',
            title: 'Passphrase for the SSH keys',
            hint: 'leave it empty for none · Keychain remembers it after the first use',
            secret: true,
          },
          {
            key: 'passphrase_confirm',
            title: 'Type the passphrase again',
            hint: 'asked twice so a typo cannot lock your keys',
            secret: true,
            restartFrom: 'passphrase',
            validate: async (value, answers) =>
              value === (answers.passphrase ?? '') ? null : 'Those did not match. Start again.',
          },
        ],
  sudo: () => ({
    key: 'sudo',
    title: 'Your Mac password',
    hint: 'some installers need sudo · checked now, never asked again during the run',
    secret: true,
    validate: async (value) => ((await sudoValidate(value)) ? null : 'That password did not work. Try again.'),
  }),
};

export function promptsFor(needs: string[], ctx: PromptContext): PromptSpec[] {
  const specs: PromptSpec[] = [];
  const seen = new Set<string>();
  for (const key of needs) {
    if (seen.has(key)) continue;
    seen.add(key);
    const made = REGISTRY[key]?.(ctx);
    if (!made) continue;
    for (const spec of Array.isArray(made) ? made : [made]) specs.push(spec);
  }
  return specs;
}
