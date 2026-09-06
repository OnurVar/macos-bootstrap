import type {BrewItem} from './brewfile';
import type {Step} from './steps';

export type Status = 'idle' | 'running' | 'done' | 'failed';

export type StepState = Step & {
  selected: boolean;
  status: Status;
  ok: number;
  failed: number;
  current: string;
};

export type Item = BrewItem & {
  selected: boolean;
  installed: boolean;
};

export type Phase = 'loading' | 'select' | 'prompt' | 'running' | 'finished';
