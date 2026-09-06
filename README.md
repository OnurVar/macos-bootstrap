# macos-bootstrap

Sets up a fresh Mac from one command. A terminal app asks what you want, installs it,
and the folder it ran from can go straight to the bin.

## Run

```sh
/bin/zsh -c "$(curl -fsSL https://raw.githubusercontent.com/OnurVar/macos-bootstrap/main/bootstrap.sh)"
```

That is all a new Mac needs. The command installs the Xcode Command Line Tools and
Homebrew, downloads this repo into `~/Downloads/macos-bootstrap`, and opens the app.
You click through the Command Line Tools dialog and type your password once; the rest
is the app.

Want to look before anything changes? Add `-- --dry-run`. Want no app at all? Add
`-- --yes` and every step runs unattended.

## The app

```
 macos-bootstrap                          macOS 26.6 · M4 Pro · 412 GB free
┌ Steps ───────────────────┐┌ Detail ─────────────────────────────────────┐
│ ▸ [x] System        ·    ││ Applications                                │
│   [x] Shell         ·    ││ Mac apps from Homebrew · pick which ones    │
│   [x] SSH keys      ·    ││                                             │
│   [x] CLI tools     7/7  ││ Daily                                       │
│   [x] Runtimes      ·    ││   [x] Google Chrome                         │
│   [x] Applications  30/30││   [x] Firefox                               │
└──────────────────────────┘└─────────────────────────────────────────────┘
 6 steps ticked · enter starts
 ↑↓ move · space tick · → items · a all/none · tab log · d dry run · enter start · q quit
```

- Everything starts ticked. Press enter for a full install.
- `→` opens the items of CLI tools or Applications; space ticks one, `a` ticks all or none.
- `d` switches dry run on or off: the same run, but the log shows every command and nothing changes.
- Before the first step it asks what it needs, once: the email and passphrase for the SSH keys,
  your password for the installers that use sudo. Nothing underneath ever prompts. The
  passphrase is asked twice, because a typo there makes keys that nobody can unlock.
- Each answer goes only to the step that asked for it, so the passphrase is never in the
  environment of the steps that install apps.
- While it runs, the right pane is the live log. Ctrl-C stops the step that is running and
  quits; nothing keeps installing behind a closed screen.
- Afterwards, a summary line and a macOS notification. Quitting prints the summary, the public
  keys to add to GitHub and GitLab, and the path of the full log, so they survive the
  full-screen view closing. The log is `last-run.log` inside the repo folder.

## What the steps do

| Step | What happens |
|---|---|
| System | Creates `~/Projects` and `~/Storage`. Finder shows all file extensions. |
| Shell | Copies `config/zshrc` to `~/.zshrc` (Homebrew, mise, Android paths). The old file is kept as a backup. Machine-only lines belong in `~/.zshrc.local`. |
| SSH keys | ed25519 keys for GitHub and GitLab, host blocks in `~/.ssh/config`, passphrases in Keychain. Prints the public keys to add. |
| CLI tools | The `brew` lines of the Brewfile, each a checkbox. |
| Runtimes | mise installs Node, Ruby, Python, Java, yarn and eas-cli from `config/mise.toml`, then cocoapods as a gem and specify as a uv tool. |
| Applications | The `cask` lines of the Brewfile, each a checkbox, grouped. |
| Check | Opens a clean new terminal and reports what it finds: Homebrew, mise, the Android paths, the SSH keys, the runtimes, and how much of the Brewfile is installed. |

Every step is safe to rerun: existing folders, keys, files and apps are left alone, and one
failing item never stops the rest. To add something later, run the one-liner again.

## Checking the result

The Check step runs last and reports whether the setup actually took. It matters because the
question is not whether the installer's own shell worked, it is whether a **new terminal**
works, so every shell-dependent check runs in a clean login shell rather than in the
installer's environment.

Run it again whenever you want, without touching anything else:

```sh
cd ~/Downloads/macos-bootstrap
./install.sh --yes --only verify
```

Something missing because you chose not to install it is a yellow note. Only something
actually wrong, like a key with the wrong permissions or a mise that a new terminal cannot
see, is a red failure and makes the step exit non-zero.

## Changing what gets installed

- **An app or a CLI tool** is one line in `Brewfile`: `cask "name"   # Label | Group` or
  `brew "name"   # Label | Group`. The label is what the checklist shows, the group its heading.
  Delete the line to drop it.
- **A runtime** is one line under `[tools]` in `config/mise.toml`. Gems and uv tools are the
  two arrays at the top of `steps/50-runtimes.sh`.
- **The shell config** is `config/zshrc`.
- **A new step** is a file `steps/NN-name.sh`. The app reads its header:

  ```sh
  # label: Applications              shown in the left pane
  # desc: Mac apps from Homebrew     one line under the label
  # items: cask                      per-item checklist from the Brewfile (brew or cask)
  # needs: sudo                      prompts to ask first: email, passphrase, sudo
  # does: Install the ticked apps    one line per thing it does, shown in the detail pane
  ```

  A step never asks anything. It reads `BOOTSTRAP_DRY_RUN`, `BOOTSTRAP_SELECT`,
  `BOOTSTRAP_EMAIL` and `BOOTSTRAP_PASSPHRASE` from the environment, wraps anything that
  changes the system in `run` so dry run keeps working, and reports with `✓ name` and
  `✗ name` lines, which the app counts. `lib/common.sh` has the helpers.
- **A new kind of prompt** is one entry in `app/src/prompts.ts`.

## Without the app

```sh
./install.sh --yes                    # every step, every item
./install.sh --yes --only ssh,apps    # only these steps
./install.sh --yes --select slack,gh  # only these Brewfile names
./install.sh --yes --dry-run          # show what would change
./install.sh --list                   # the step names
```

## Layout

```
bootstrap.sh       one-liner target: Command Line Tools, Homebrew, download, start the app
app/               the app: Ink + TypeScript, run by the Node that mise installs
  src/App.tsx        state and the run loop
  src/panes.tsx      the screen
  src/runner.ts      spawns steps, streams output, sudo, notifications
  src/steps.ts       reads the step headers
  src/brewfile.ts    reads the Brewfile
  src/prompts.ts     the prompt registry
steps/             the six step scripts, silent and driven by the environment
lib/common.sh      shared helpers: run, copy_file, Brewfile parsing, output
Brewfile           apps and CLI tools
config/            zshrc, mise.toml
install.sh         the unattended way
test/run.sh        every check, in a throwaway home
```

The app runs on Node through mise, the same Node the Runtimes step keeps, so nothing extra
stays on the Mac. bootstrap.sh installs mise, lets it fetch the Node version named in
`config/mise.toml`, installs the app's dependencies, and starts it.

## Testing

```sh
test/run.sh
```

Runs the syntax checks, the app's type-check and unit tests, a dry run of every step, a real
run of the file-only steps in a throwaway home, and a full run of the app itself. Needs
node 22 or newer on PATH.

The app takes two flags for that last check: `--autostart` begins the run with the defaults and
`--exit-when-done` quits when it finishes, so the test drives a real run without touching the
keyboard. `--dry-run --autostart --exit-when-done` is also a handy way to preview a full run.

For a rehearsal on a truly fresh macOS, use a virtual machine: Parallels Desktop can download
macOS itself. Give it 4 cores, 8 GB and a 100 GB disk, finish the macOS setup without an Apple
ID, take a snapshot called "fresh", then run the one-liner inside. Anything wrong: revert to
the snapshot, fix, push, run again. The VM cannot sign in to the App Store or run the Android
emulator, and downloading Xcode through Xcodes needs an Apple ID, so leave those to the real Mac.

Afterwards, check:

```sh
brew list --cask            # the apps you ticked
mise ls                     # node, ruby, python, java, yarn, eas-cli
node -v; ruby -v; python3 -V; java -version
pod --version               # cocoapods on the mise ruby
ls ~/.ssh                   # id_ed25519_github, id_ed25519_gitlab, config
time zsh -i -c exit         # well under half a second
```

## Notes

- **SSH keys.** Add the printed public keys to your accounts. With the GitHub CLI:
  `gh auth login -s admin:public_key && gh ssh-key add ~/.ssh/id_ed25519_github.pub`.
- **React Native on iOS.** Xcode runs its build scripts in a shell where mise is not
  activated. Put `export NODE_BINARY="$(/opt/homebrew/bin/mise which node)"` in the
  project's `.xcode.env.local`.
- **Apps download all at once.** The Applications and CLI tools steps fetch every ticked item in
  one go, which Homebrew does in parallel, and install from the cache afterwards. The status line
  shows how many downloads are done and how much has landed.
- **idb-companion** (iOS simulator automation) needs the full Xcode to build, so it is not in the
  Brewfile. Once Xcode is installed: `brew install facebook/fb/idb-companion`.
- **Android.** Android Studio's first-run wizard installs the SDK into
  `~/Library/Android/sdk`, which is where the shell config already points.
- **Coming from nvm, pyenv and rbenv.** Once mise has the runtimes, the old managers can go:
  `brew uninstall pyenv pyenv-virtualenv rbenv ruby-build` and `rm -rf ~/.nvm ~/.pyenv ~/.rbenv`.
