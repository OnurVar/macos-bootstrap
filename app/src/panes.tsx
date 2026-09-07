// Presentational pieces of the screen. They know nothing about running steps.

import React from 'react';
import {Box, Text} from 'ink';
import TextInput from 'ink-text-input';
import type {PromptSpec} from './prompts';
import type {SystemInfo} from './system';
import type {Item, Phase, StepState} from './types';

export function Header({sys, dryRun, version}: {sys: SystemInfo | null; dryRun: boolean; version: string}) {
  const facts = sys ? `macOS ${sys.macos} · ${sys.chip} · ${sys.freeGb} GB free` : 'checking this Mac…';
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text>
        <Text bold color="magenta">
          macos-bootstrap
        </Text>
        {version ? <Text dimColor> {version}</Text> : null}
      </Text>
      <Text>
        <Text dimColor>{facts}</Text>
        {dryRun ? <Text color="yellow" bold> DRY RUN</Text> : null}
      </Text>
    </Box>
  );
}

function statusGlyph(s: StepState, spinner: string): React.ReactNode {
  if (s.status === 'done') return <Text color="green">✓</Text>;
  if (s.status === 'failed') return <Text color="red">✗</Text>;
  if (s.status === 'running') return <Text color="yellow">{spinner}</Text>;
  return <Text dimColor>·</Text>;
}

export const STEPS_WIDTH = 36;

export function StepsPane({
  steps,
  items,
  cursor,
  focused,
  height,
  spinner,
}: {
  steps: StepState[];
  items: Record<string, Item[]>;
  cursor: number;
  focused: boolean;
  height: number;
  spinner: string;
}) {
  return (
    <Box flexDirection="column" width={STEPS_WIDTH} flexShrink={0} height={height} borderStyle="round" borderColor={focused ? 'magenta' : 'gray'} paddingX={1}>
      <Text bold color="magenta">
        Steps
      </Text>
      {steps.map((s, i) => {
        const list = s.items ? items[s.items] ?? [] : [];
        const picked = list.filter((x) => x.selected).length;
        let note = '';
        if (s.status === 'running') note = s.items ? `${s.ok + s.failed}/${picked}` : '';
        else if (s.status === 'done') note = s.items ? `${s.ok} done` : 'done';
        else if (s.status === 'failed') note = s.items ? `${s.failed} failed` : 'failed';
        else if (s.items) note = `${picked}/${list.length}`;
        const cur = i === cursor;
        return (
          <Text key={s.key} wrap="truncate">
            <Text color="magenta">{cur ? '▸ ' : '  '}</Text>
            <Text color={s.selected ? 'magenta' : undefined} dimColor={!s.selected}>
              {s.selected ? '[x] ' : '[ ] '}
            </Text>
            <Text bold={cur}>{s.label.padEnd(13)}</Text>
            {statusGlyph(s, spinner)}
            <Text dimColor> {note}</Text>
          </Text>
        );
      })}
    </Box>
  );
}

type Row = {kind: 'group'; text: string} | {kind: 'item'; index: number};

export function itemRows(list: Item[]): Row[] {
  const rows: Row[] = [];
  let group = '';
  list.forEach((it, index) => {
    if (it.group !== group) {
      group = it.group;
      rows.push({kind: 'group', text: group});
    }
    rows.push({kind: 'item', index});
  });
  return rows;
}

function window<T>(rows: T[], anchor: number, height: number): T[] {
  if (rows.length <= height) return rows;
  const start = Math.min(Math.max(0, anchor - Math.floor(height / 2)), rows.length - height);
  return rows.slice(start, start + height);
}

export function DetailPane({
  step,
  items,
  itemCursor,
  focused,
  height,
  width,
  miseTools,
}: {
  step: StepState | undefined;
  items: Record<string, Item[]>;
  itemCursor: number;
  focused: boolean;
  height: number;
  width: number;
  miseTools: string[];
}) {
  const inner = Math.max(1, height - 5);
  let body: React.ReactNode = null;
  if (step?.items) {
    const list = items[step.items] ?? [];
    const rows = itemRows(list);
    const anchor = rows.findIndex((r) => r.kind === 'item' && r.index === itemCursor);
    const picked = list.filter((x) => x.selected).length;
    const installed = list.filter((x) => x.installed).length;
    body = (
      <>
        <Text dimColor>
          {picked} of {list.length} ticked{installed ? ` · ${installed} already installed` : ''}
        </Text>
        {window(rows, anchor, inner - 1).map((r) =>
          r.kind === 'group' ? (
            <Text key={`g-${r.text}`} color="cyan">
              {r.text}
            </Text>
          ) : (
            (() => {
              const it = list[r.index];
              const cur = focused && r.index === itemCursor;
              return (
                <Text key={it.name} wrap="truncate">
                  <Text color="magenta">{cur ? '▸ ' : '  '}</Text>
                  {it.installed ? (
                    <Text dimColor>[✓] {it.label} · installed</Text>
                  ) : (
                    <>
                      <Text color={it.selected ? 'magenta' : undefined} dimColor={!it.selected}>
                        {it.selected ? '[x] ' : '[ ] '}
                      </Text>
                      <Text bold={cur}>{it.label}</Text>
                    </>
                  )}
                </Text>
              );
            })()
          ),
        )}
      </>
    );
  } else if (step) {
    const lines = [...(step.detail === 'mise' ? miseTools : []), ...step.does];
    body = (
      <>
        {lines.slice(0, inner).map((l, i) => (
          <Text key={i} wrap="truncate">
            <Text color="green">  ✓ </Text>
            {l}
          </Text>
        ))}
      </>
    );
  }
  return (
    <Box flexDirection="column" width={width} flexShrink={0} height={height} borderStyle="round" borderColor={focused ? 'magenta' : 'gray'} paddingX={1}>
      <Text bold color="magenta">
        Detail
      </Text>
      {step ? (
        <>
          <Text wrap="truncate">
            <Text bold>{step.label}</Text>
            <Text dimColor>  {step.desc}</Text>
          </Text>
          <Text> </Text>
          {body}
        </>
      ) : null}
    </Box>
  );
}

function LogLine({line}: {line: string}) {
  const t = line.trim();
  if (t.startsWith('✓')) return <Text color="green" wrap="truncate">{line}</Text>;
  if (t.startsWith('✗')) return <Text color="red" wrap="truncate">{line}</Text>;
  if (t.startsWith('!')) return <Text color="yellow" wrap="truncate">{line}</Text>;
  if (t.startsWith('==>')) return <Text bold wrap="truncate">{line}</Text>;
  if (t.startsWith('$')) return <Text dimColor wrap="truncate">{line}</Text>;
  return <Text wrap="truncate">{line}</Text>;
}

export function LogPane({
  lines,
  height,
  width,
  scroll,
  path,
  live = '',
}: {
  lines: string[];
  height: number;
  width: number;
  scroll: number;
  path: string;
  // The download happening right now, drawn under the log rather than in the footer.
  live?: string;
}) {
  const inner = Math.max(1, height - 3 - (live ? 1 : 0));
  const end = Math.max(0, lines.length - scroll);
  const shown = lines.slice(Math.max(0, end - inner), end);
  return (
    <Box flexDirection="column" width={width} flexShrink={0} height={height} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text wrap="truncate">
        <Text bold color="magenta">
          Log
        </Text>
        <Text dimColor>
          {'  '}
          {path}
          {scroll ? `  · ${scroll} lines up, ↓ to follow` : ''}
        </Text>
      </Text>
      {shown.map((l, i) => (
        <LogLine key={`${end - shown.length + i}`} line={l} />
      ))}
      {live ? (
        <Text color="cyan" wrap="truncate">
          {live}
        </Text>
      ) : null}
    </Box>
  );
}

export function PromptPane({
  spec,
  index,
  count,
  value,
  error,
  busy,
  height,
  width,
  onChange,
  onSubmit,
}: {
  spec: PromptSpec;
  index: number;
  count: number;
  value: string;
  error: string;
  busy: boolean;
  height: number;
  width: number;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
}) {
  return (
    <Box flexDirection="column" width={width} flexShrink={0} height={height} borderStyle="round" borderColor="magenta" paddingX={1}>
      <Text bold color="magenta">
        Question {index + 1} of {count}
      </Text>
      <Text> </Text>
      <Text bold>{spec.title}</Text>
      <Box>
        <Text color="cyan">› </Text>
        <TextInput value={value} onChange={onChange} onSubmit={onSubmit} mask={spec.secret ? '•' : undefined} focus={!busy} />
      </Box>
      {error ? <Text color="red">{error}</Text> : null}
      {busy ? <Text color="yellow">checking…</Text> : null}
      <Text> </Text>
      <Text dimColor>{spec.hint}</Text>
    </Box>
  );
}

export function StatusLine({
  phase,
  overall,
  current,
  summary,
  selectedSteps,
  dryRun,
}: {
  phase: Phase;
  overall: {done: number; total: number};
  current: string;
  summary: string;
  selectedSteps: number;
  dryRun: boolean;
}) {
  let content: React.ReactNode;
  if (phase === 'loading') content = <Text dimColor>Checking this Mac…</Text>;
  else if (phase === 'select')
    content = (
      <Text>
        <Text dimColor>{selectedSteps} steps ticked · enter starts</Text>
        {dryRun ? <Text color="yellow"> · dry run: shows every command, changes nothing</Text> : null}
      </Text>
    );
  else if (phase === 'prompt') content = <Text dimColor>Answer on the right, then it runs.</Text>;
  else if (phase === 'running') {
    const w = 24;
    const n = overall.total ? Math.round((overall.done / overall.total) * w) : 0;
    content = (
      <Text wrap="truncate">
        <Text color="green">{'█'.repeat(n)}</Text>
        <Text dimColor>{'░'.repeat(w - n)}</Text>
        <Text> {overall.done}/{overall.total}  </Text>
        <Text dimColor>{current}</Text>
      </Text>
    );
  } else content = <Text wrap="truncate"><Text color="green" bold>Done.</Text> {summary}</Text>;
  return <Box paddingX={1}>{content}</Box>;
}

export function Hints({phase, pane}: {phase: Phase; pane: 'steps' | 'detail'}) {
  let text = '';
  if (phase === 'select')
    text = pane === 'steps'
      ? '↑↓ move · space tick · → items · a all/none · tab log · d dry run · enter start · q quit'
      : '↑↓ move · space tick · a all/none · ← back to steps · enter start';
  else if (phase === 'prompt') text = 'enter continue · esc back';
  else if (phase === 'running') text = '↑↓ scroll log · tab detail/log · ctrl-c abort';
  else text = 'q quit · ↑↓ scroll log · tab detail/log';
  return (
    <Box paddingX={1}>
      <Text dimColor wrap="truncate">
        {text}
      </Text>
    </Box>
  );
}
