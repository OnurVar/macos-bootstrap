#!/bin/zsh
# macos-bootstrap: set up a fresh Mac with one command.
#
#   /bin/zsh -c "$(curl -fsSL https://raw.githubusercontent.com/OnurVar/macos-bootstrap/main/bootstrap.sh)"
#
# Installs the Xcode Command Line Tools and Homebrew, downloads this repo into
# ~/Downloads/macos-bootstrap, and opens the app that asks what to set up.
# The folder can be deleted afterwards; nothing on the Mac points back to it.
#
# Arguments go to the app, so a dry run is:
#
#   /bin/zsh -c "$(curl -fsSL https://raw.githubusercontent.com/OnurVar/macos-bootstrap/main/bootstrap.sh)" -- --dry-run
#
# and an unattended run without the app is:
#
#   /bin/zsh -c "$(curl -fsSL https://raw.githubusercontent.com/OnurVar/macos-bootstrap/main/bootstrap.sh)" -- --yes

set -e -u -o pipefail

repo="${BOOTSTRAP_REPO:-https://github.com/OnurVar/macos-bootstrap.git}"
dest="${BOOTSTRAP_DIR:-$HOME/Downloads/macos-bootstrap}"
brew=/opt/homebrew/bin/brew
[[ "$(uname -m)" == arm64 ]] || brew=/usr/local/bin/brew

say() { print -P "%F{blue}==>%f %B$*%b" }
ok()  { print -P "  %F{green}✓%f $*" }

# Set while a background loop keeps the sudo ticket alive during the Homebrew install.
sudo_keepalive=""
trap 'if [[ -n "${sudo_keepalive:-}" ]]; then kill "$sudo_keepalive" 2>/dev/null; fi' EXIT

unattended=0
[[ " $* " == *" --yes "* || " $* " == *" -y "* ]] && unattended=1

print
print -P "%B  macos-bootstrap%b"
print
print "  Installs the Xcode Command Line Tools and Homebrew, downloads"
print "  $repo"
print "  into ${dest/#$HOME/~} and opens the app that asks what to set up."
print
if (( ! unattended )); then
  if [[ ! -t 0 ]]; then
    print -u2 '  Run it as  /bin/zsh -c "$(curl -fsSL ...)"  so the app can read your keyboard.'
    exit 1
  fi
  read -q "reply?  Continue? [y/N] " || { print; exit 1 }
  print
fi

# The Command Line Tools bring git and the compilers Homebrew needs. `xcode-select -p` answers
# as soon as the folder exists, which is before the tools are usable, so look for a real git.
clt_ready() {
  local dev
  dev="$(xcode-select -p 2>/dev/null)" || return 1
  [[ -n "$dev" && -x "$dev/usr/bin/git" ]]
}

if clt_ready; then
  ok "Xcode Command Line Tools"
else
  say "Installing the Xcode Command Line Tools"
  xcode-select --install >/dev/null 2>&1 || true
  print "  Finish the dialog that just opened. Waiting for it to finish..."
  waited=0
  until clt_ready; do
    sleep 5
    waited=$(( waited + 5 ))
    if (( waited % 60 == 0 )); then
      print "  Still waiting, $(( waited / 60 )) min so far."
    fi
    if (( waited >= 1800 )); then
      print -u2 "  The Command Line Tools did not finish installing."
      print -u2 "  Run 'xcode-select --install' yourself, let it finish, then run this again."
      exit 1
    fi
  done
  ok "Xcode Command Line Tools"
fi

if [[ -x "$brew" ]]; then
  ok "Homebrew"
else
  # NONINTERACTIVE makes Homebrew's installer use `sudo -n`, which aborts outright when no
  # password is cached, and on a new Mac none is. So ask once here and keep the ticket warm.
  say "Installing Homebrew"
  print "  macOS asks for your password once so Homebrew can create its folders."
  if ! sudo -v; then
    print -u2 "  Homebrew needs an administrator password. Run this again as an admin user."
    exit 1
  fi
  ( while true; do sleep 60; sudo -n -v 2>/dev/null || exit 0; done ) &
  sudo_keepalive=$!
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  kill "$sudo_keepalive" 2>/dev/null || true
  sudo_keepalive=""
  [[ -x "$brew" ]] || { print -u2 "Homebrew did not end up at $brew"; exit 1 }
  ok "Homebrew"
fi
eval "$("$brew" shellenv)"

if [[ -d "$dest/.git" ]]; then
  # A rerun should get the latest version, not whatever was downloaded last time.
  if git -C "$dest" pull --ff-only --quiet 2>/dev/null; then
    ok "Updated ${dest/#$HOME/~}"
  else
    ok "Using ${dest/#$HOME/~} as it is"
  fi
else
  say "Downloading into ${dest/#$HOME/~}"
  mkdir -p "${dest:h}"
  git clone --quiet "$repo" "$dest"
  ok "Downloaded"
fi

if (( unattended )); then
  exec "$dest/install.sh" "$@"
fi

# The app runs on the Node that mise installs, the same one the Runtimes step keeps,
# so nothing extra stays behind. The version comes from config/mise.toml.
node_version="$(sed -nE 's/^node *= *"([^"]+)".*/\1/p' "$dest/config/mise.toml")"
node_version="${node_version:-24}"
if command -v mise >/dev/null 2>&1; then
  ok "mise"
else
  say "Installing mise"
  brew install --quiet mise
  ok "mise"
fi
say "Preparing Node $node_version for the app"
mise --yes exec "node@$node_version" -- node --version >/dev/null
ok "Node $node_version"

cd "$dest/app"
if [[ ! -d node_modules || package-lock.json -nt node_modules ]]; then
  say "Installing the app's dependencies"
  mise --yes exec "node@$node_version" -- npm ci --silent --no-fund --no-audit
  ok "App ready"
fi

exec mise --yes exec "node@$node_version" -- node --import tsx src/index.tsx "$@"
