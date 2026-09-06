// Command-line flags for the app. bootstrap.sh and install.sh pass these through.

export type Args = {
  dryRun: boolean;
  help: boolean;
  // Test / unattended affordances: start the run at once with the defaults, and exit the
  // process when it finishes. Used by test/run.sh so it never has to drive the TUI by hand.
  autostart: boolean;
  exitWhenDone: boolean;
};

export function parseArgs(argv: string[]): Args {
  const args: Args = {dryRun: false, help: false, autostart: false, exitWhenDone: false};
  for (const a of argv) {
    if (a === '--dry-run' || a === '-n') args.dryRun = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--autostart') args.autostart = true;
    else if (a === '--exit-when-done') args.exitWhenDone = true;
  }
  return args;
}

export const usage = `macos-bootstrap

  Pick what to set up, press enter, watch it happen.

  --dry-run, -n   show every command instead of running it
  --help, -h      this text

  For scripts (used by test/run.sh)
  --autostart        start the run at once with the defaults
  --exit-when-done   quit when the run finishes

  Keys inside the app
    up/down       move            space       tick or untick
    left/right    switch pane     a           all or none in the list
    tab           detail or log   d           dry run on or off
    enter         start           q           quit
`;
