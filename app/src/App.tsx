// State and orchestration. The screen is drawn by panes.tsx, the shell work by runner.ts.

import fs from 'node:fs/promises';
import path from 'node:path';
import React, {useEffect, useRef, useState} from 'react';
import {Box, useApp, useInput, useStdout} from 'ink';
import {parseBrewfile, shortName} from './brewfile';
import {LogFile} from './log';
import {parseMiseTools} from './mise';
import {DetailPane, Header, Hints, LogPane, PromptPane, STEPS_WIDTH, StatusLine, StepsPane} from './panes';
import {promptsFor, type PromptSpec} from './prompts';
import {killCurrent, makeAskpass, notify, runStep, sudoKeepalive} from './runner';
import {discoverSteps, type ItemKind} from './steps';
import {gitEmail, inspectSystem, repoVersion, type SystemInfo} from './system';
import type {Item, Phase, Status, StepState} from './types';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function App({
  root,
  dryRun: initialDryRun,
  autostart = false,
  exitWhenDone = false,
  onFarewell,
}: {
  root: string;
  dryRun: boolean;
  autostart?: boolean;
  exitWhenDone?: boolean;
  // Lines to print on the normal screen after the full-screen UI is gone.
  onFarewell?: (lines: string[]) => void;
}) {
  const {exit} = useApp();
  const {stdout} = useStdout();
  const [size, setSize] = useState(() => ({cols: stdout.columns ?? 100, rows: stdout.rows ?? 30}));
  const [phase, setPhase] = useState<Phase>('loading');
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [items, setItems] = useState<Record<ItemKind, Item[]>>({brew: [], cask: []});
  const [miseTools, setMiseTools] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [version, setVersion] = useState('');
  const [dryRun, setDryRun] = useState(initialDryRun);
  const [pane, setPane] = useState<'steps' | 'detail'>('steps');
  const [view, setView] = useState<'detail' | 'log'>('detail');
  const [cursor, setCursor] = useState(0);
  const [itemCursor, setItemCursor] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [logScroll, setLogScroll] = useState(0);
  const [prompts, setPrompts] = useState<PromptSpec[]>([]);
  const [promptIdx, setPromptIdx] = useState(0);
  const [promptValue, setPromptValue] = useState('');
  const [promptError, setPromptError] = useState('');
  const [busy, setBusy] = useState(false);
  const [overall, setOverall] = useState({done: 0, total: 0});
  const [current, setCurrent] = useState('');
  const [live, setLive] = useState('');
  const [summary, setSummary] = useState('');
  const [tick, setTick] = useState(0);
  const answers = useRef<Record<string, string>>({});
  const aborted = useRef(false);
  const pubKeys = useRef<string[]>([]);
  const stepsRef = useRef(steps);
  const itemsRef = useRef(items);
  stepsRef.current = steps;
  itemsRef.current = items;
  const logPath = path.join(root, 'last-run.log');
  const shortPath = (p: string): string => (process.env.HOME ? p.replace(process.env.HOME, '~') : p);

  useEffect(() => {
    const onResize = () => setSize({cols: stdout.columns ?? 100, rows: stdout.rows ?? 30});
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  useEffect(() => {
    if (phase !== 'running') return;
    const t = setInterval(() => setTick((n) => n + 1), 90);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    (async () => {
      const [found, brewText, sysInfo, miseText, mail, ver] = await Promise.all([
        discoverSteps(root),
        fs.readFile(path.join(root, 'Brewfile'), 'utf8'),
        inspectSystem(),
        fs.readFile(path.join(root, 'config', 'mise.toml'), 'utf8').catch(() => ''),
        gitEmail(),
        repoVersion(root),
      ]);
      setVersion(ver);
      const parsed = parseBrewfile(brewText);
      const build = (kind: ItemKind): Item[] =>
        parsed
          .filter((i) => i.kind === kind)
          .map((i) => {
            const installed = (kind === 'cask' ? sysInfo.casks : sysInfo.formulae).has(shortName(i.name));
            return {...i, installed, selected: !installed};
          });
      setItems({brew: build('brew'), cask: build('cask')});
      setSteps(found.map((s) => ({...s, selected: true, status: 'idle', ok: 0, failed: 0, current: ''})));
      setMiseTools(parseMiseTools(miseText));
      setSys(sysInfo);
      setEmail(mail || process.env.BOOTSTRAP_EMAIL || '');
      setPhase('select');
    })().catch((err: unknown) => {
      setLog([`✗ ${String(err)}`]);
      setView('log');
      setPhase('select');
    });
  }, [root]);

  // --autostart: begin the run as soon as the choices are loaded, once.
  const autostarted = useRef(false);
  useEffect(() => {
    if (autostart && phase === 'select' && !autostarted.current) {
      autostarted.current = true;
      startRun();
    }
  }, [autostart, phase]);

  const step = steps[cursor];
  const listOf = (s: StepState | undefined): Item[] => (s?.items ? items[s.items] ?? [] : []);
  const patchStep = (key: string, patch: Partial<StepState>) =>
    setSteps((ss) => ss.map((s) => (s.key === key ? {...s, ...patch} : s)));
  const toggleItem = (kind: ItemKind, index: number) =>
    setItems((it) => ({...it, [kind]: it[kind].map((x, j) => (j === index && !x.installed ? {...x, selected: !x.selected} : x))}));
  const toggleAllItems = (kind: ItemKind) =>
    setItems((it) => {
      const open = it[kind].filter((x) => !x.installed);
      const all = open.every((x) => x.selected);
      return {...it, [kind]: it[kind].map((x) => (x.installed ? x : {...x, selected: !all}))};
    });

  const plannedSteps = (): StepState[] =>
    stepsRef.current.filter((s) => s.selected && (!s.items || itemsRef.current[s.items].some((i) => i.selected)));

  // Ctrl-C: stop the step that is running before quitting, so nothing keeps installing unseen.
  function abortRun() {
    if (aborted.current) return;
    aborted.current = true;
    killCurrent();
    onFarewell?.(
      phase === 'running'
        ? ['Stopped. The step that was running was cut short.', `Log: ${shortPath(logPath)}`]
        : ['Stopped.'],
    );
    exit();
  }

  function startRun() {
    const plan = plannedSteps();
    if (!plan.length) {
      setSummary('Nothing ticked.');
      return;
    }
    if (!dryRun) {
      const specs = promptsFor(
        plan.flatMap((s) => s.needs),
        {gitEmail: email, sshKeysExist: sys?.sshKeys ?? false},
      );
      if (specs.length) {
        setPrompts(specs);
        setPromptIdx(0);
        setPromptValue(specs[0].initial ?? '');
        setPromptError('');
        setPhase('prompt');
        return;
      }
    }
    void execute();
  }

  async function submitPrompt(value: string) {
    const spec = prompts[promptIdx];
    if (!spec || busy) return;
    if (spec.validate) {
      setBusy(true);
      const err = await spec.validate(value, answers.current);
      setBusy(false);
      if (err) {
        setPromptError(err);
        const back = spec.restartFrom ? prompts.findIndex((p) => p.key === spec.restartFrom) : -1;
        if (back >= 0) {
          setPromptIdx(back);
          setPromptValue(prompts[back].initial ?? '');
        } else {
          setPromptValue('');
        }
        return;
      }
    }
    answers.current[spec.key] = value;
    const next = promptIdx + 1;
    if (next < prompts.length) {
      setPromptIdx(next);
      setPromptValue(prompts[next].initial ?? '');
      setPromptError('');
    } else {
      void execute();
    }
  }

  async function execute() {
    const plan = plannedSteps();
    const snapshot = itemsRef.current;
    setPhase('running');
    setView('log');
    setLogScroll(0);
    setLog([]);
    setSummary('');
    const file = new LogFile(logPath);
    file.header([
      `macos-bootstrap ${version} · ${new Date().toISOString()}${dryRun ? ' (dry run)' : ''}`,
      ...plan.map((s) => `  ${s.label}${s.items ? ': ' + snapshot[s.items].filter((i) => i.selected).map((i) => i.name).join(', ') : ''}`),
    ]);
    const useSudo = !dryRun && Boolean(answers.current.sudo);
    const stopSudo = useSudo ? sudoKeepalive() : () => {};
    // Lets the .pkg installers get the password without a terminal (see makeAskpass).
    const askpass = useSudo ? makeAskpass(answers.current.sudo) : undefined;
    const cleanUp = () => {
      stopSudo();
      askpass?.cleanup();
    };
    const weights = plan.map((s) => (s.items ? snapshot[s.items].filter((i) => i.selected).length : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let before = 0;
    setOverall({done: 0, total});
    pubKeys.current = [];
    const append = (line: string) => {
      const t = line.trim();
      // Worth repeating on the normal screen at the end: these have to go into GitHub/GitLab.
      if (t.startsWith('ssh-ed25519 ') && !pubKeys.current.includes(t)) pubKeys.current.push(t);
      setLog((l) => (l.length > 4000 ? [...l.slice(-3000), line] : [...l, line]));
      file.line(line);
    };
    const failedSteps: string[] = [];
    const failedItems: string[] = [];
    let okItems = 0;

    for (let k = 0; k < plan.length; k++) {
      if (aborted.current) break;
      const s = plan[k];
      const names = s.items ? snapshot[s.items].filter((i) => i.selected).map((i) => i.name) : [];
      patchStep(s.key, {status: 'running', ok: 0, failed: 0});
      setCurrent(s.label);
      setLive('');
      let ok = 0;
      let failed = 0;
      // A secret goes only to the step that declared it in its `# needs:` header, so brew,
      // gem, npm and their postinstall scripts never see the SSH passphrase in their env.
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        BOOTSTRAP_ROOT: root,
        BOOTSTRAP_YES: '1',
        BOOTSTRAP_DRY_RUN: dryRun ? '1' : '0',
        BOOTSTRAP_SELECT: names.join(','),
      };
      delete env.BOOTSTRAP_EMAIL;
      delete env.BOOTSTRAP_PASSPHRASE;
      if (s.needs.includes('email')) env.BOOTSTRAP_EMAIL = answers.current.email ?? email;
      if (s.needs.includes('passphrase')) env.BOOTSTRAP_PASSPHRASE = answers.current.passphrase ?? '';
      if (s.needs.includes('sudo') && askpass) env.SUDO_ASKPASS = askpass.path;
      const result = await runStep({
        file: s.file,
        env,
        onLine: append,
        onEvent: (ev) => {
          if (ev.type === 'progress') setLive(ev.label);
          // A new item starts: drop the previous item's download line.
          if (ev.type === 'current') {
            setCurrent(ev.label);
            setLive('');
          }
          if (ev.type === 'ok') {
            ok++;
            patchStep(s.key, {ok});
          }
          if (ev.type === 'fail') {
            failed++;
            failedItems.push(ev.label);
            patchStep(s.key, {failed});
          }
          if (s.items && ev.type !== 'current') setOverall({done: Math.min(total, before + ok + failed), total});
        },
      });
      before += weights[k];
      setOverall({done: before, total});
      if (s.items) okItems += ok;
      const status: Status = result.code === 0 && result.failed === 0 ? 'done' : 'failed';
      if (status === 'failed') failedSteps.push(s.label);
      patchStep(s.key, {status});
    }

    cleanUp();
    if (aborted.current) {
      append('');
      append('Stopped before finishing.');
      file.close();
      setCurrent('');
      setLive('');
      setPhase('finished');
      return;
    }
    const parts = [`${plan.length - failedSteps.length} of ${plan.length} steps ok`];
    if (okItems) parts.push(`${okItems} items installed`);
    if (failedItems.length) parts.push(`failed: ${failedItems.join(', ')}`);
    else if (failedSteps.length) parts.push(`failed: ${failedSteps.join(', ')}`);
    const text = parts.join(' · ');
    append('');
    append(`Done. ${text}`);
    append('Open a new terminal, or run: exec zsh');
    file.close();
    setCurrent('');
    setLive('');
    setSummary(text);
    setPhase('finished');
    if (!dryRun) notify('macos-bootstrap', failedSteps.length ? `Finished with problems. ${text}` : `Your Mac is ready. ${text}`);

    // The screen goes away on quit, so hand the useful parts back to the normal terminal.
    const closing = [`macos-bootstrap ${version} · ${text}`, `Log: ${shortPath(logPath)}`];
    if (pubKeys.current.length) {
      closing.push('', 'Add these public keys to your accounts:');
      for (const key of pubKeys.current) closing.push(`  ${key}`);
      closing.push('  GitHub: https://github.com/settings/ssh/new');
      closing.push('  GitLab: https://gitlab.com/-/user_settings/ssh_keys');
    }
    closing.push('', 'Open a new terminal, or run: exec zsh');
    onFarewell?.(closing);

    if (exitWhenDone) setTimeout(() => exit(), 200);
  }

  useInput(
    (raw, key) => {
      // Ctrl-C stops the running step first; the SIGINT handler in index.tsx covers the
      // loading phase, where no input hook is listening yet.
      if (key.ctrl && raw === 'c') {
        abortRun();
        return;
      }
      // Typed characters can arrive glued together (key repeat, paste, a busy terminal); handle each.
      const special = key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.return || key.escape || key.tab || key.pageUp || key.pageDown;
      const inputs = !special && raw.length > 1 ? [...raw] : [raw];
      for (const input of inputs) handleKey(input, key);
    },
    {isActive: phase !== 'prompt' && phase !== 'loading'},
  );

  function handleKey(input: string, key: Parameters<Parameters<typeof useInput>[0]>[1]) {
    {
      if (phase === 'select') {
        const list = listOf(step);
        if (key.upArrow) {
          if (pane === 'steps') {
            setCursor((c) => Math.max(0, c - 1));
            setItemCursor(0);
          } else setItemCursor((c) => Math.max(0, c - 1));
        } else if (key.downArrow) {
          if (pane === 'steps') {
            setCursor((c) => Math.min(steps.length - 1, c + 1));
            setItemCursor(0);
          } else setItemCursor((c) => Math.min(list.length - 1, c + 1));
        } else if (key.rightArrow) {
          if (step?.items && list.length) {
            setPane('detail');
            setView('detail');
          }
        } else if (key.leftArrow || key.escape) setPane('steps');
        else if (input === ' ') {
          if (pane === 'steps') patchStep(step.key, {selected: !step.selected});
          else if (step?.items) toggleItem(step.items, itemCursor);
        } else if (input === 'a') {
          if (pane === 'detail' && step?.items) toggleAllItems(step.items);
          else
            setSteps((ss) => {
              const all = ss.every((s) => s.selected);
              return ss.map((s) => ({...s, selected: !all}));
            });
        } else if (key.tab) setView((v) => (v === 'detail' ? 'log' : 'detail'));
        else if (input === 'd') setDryRun((d) => !d);
        else if (key.return) startRun();
        else if (input === 'q') exit();
      } else if (phase === 'running' || phase === 'finished') {
        if (key.tab) setView((v) => (v === 'detail' ? 'log' : 'detail'));
        else if (key.upArrow) setLogScroll((s) => Math.min(Math.max(0, log.length - 1), s + 1));
        else if (key.downArrow) setLogScroll((s) => Math.max(0, s - 1));
        else if (key.pageUp) setLogScroll((s) => Math.min(Math.max(0, log.length - 1), s + 10));
        else if (key.pageDown) setLogScroll((s) => Math.max(0, s - 10));
        else if (input === 'q' && phase === 'finished') exit();
      }
    }
  }

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') {
        abortRun();
        return;
      }
      if (key.escape && !busy) {
        setPhase('select');
        setPromptError('');
      }
    },
    {isActive: phase === 'prompt'},
  );

  const rows = Math.max(12, size.rows);
  const cols = Math.max(60, size.cols);
  const paneHeight = rows - 3;
  const rightWidth = cols - STEPS_WIDTH;
  const spinner = SPINNER[tick % SPINNER.length];
  const showLog = view === 'log' || phase === 'running' || phase === 'finished' ? view === 'log' : false;

  let right: React.ReactNode;
  if (phase === 'prompt' && prompts[promptIdx]) {
    right = (
      <PromptPane
        spec={prompts[promptIdx]}
        index={promptIdx}
        count={prompts.length}
        value={promptValue}
        error={promptError}
        busy={busy}
        height={paneHeight}
        width={rightWidth}
        onChange={setPromptValue}
        onSubmit={(v) => void submitPrompt(v)}
      />
    );
  } else if (showLog) {
    right = <LogPane lines={log} height={paneHeight} width={rightWidth} scroll={logScroll} live={live} path={logPath.replace(process.env.HOME ?? '', '~')} />;
  } else {
    right = (
      <DetailPane step={step} items={items} itemCursor={itemCursor} focused={pane === 'detail' && phase === 'select'} height={paneHeight} width={rightWidth} miseTools={miseTools} />
    );
  }

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      <Header sys={sys} dryRun={dryRun} version={version} />
      <Box flexGrow={1}>
        <StepsPane steps={steps} items={items} cursor={cursor} focused={pane === 'steps' && phase === 'select'} height={paneHeight} spinner={spinner} />
        {right}
      </Box>
      <StatusLine phase={phase} overall={overall} current={current} summary={summary} selectedSteps={steps.filter((s) => s.selected).length} dryRun={dryRun} />
      <Hints phase={phase} pane={pane} />
    </Box>
  );
}
