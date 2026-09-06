// Every run writes last-run.log next to the repo, so a failure is something to read.

import fs from 'node:fs';

export class LogFile {
  private stream: fs.WriteStream;

  constructor(public readonly path: string) {
    this.stream = fs.createWriteStream(path, {flags: 'w'});
  }

  header(lines: string[]): void {
    this.stream.write(lines.join('\n') + '\n\n');
  }

  line(text: string): void {
    this.stream.write(`${new Date().toTimeString().slice(0, 8)}  ${text}\n`);
  }

  close(): void {
    this.stream.end();
  }
}
