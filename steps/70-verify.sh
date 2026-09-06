#!/bin/zsh
# label: Check
# desc: prove a new terminal really works · folders · keys · runtimes · apps
# does: Open a clean login shell and look for Homebrew, mise and the Android paths
# does: Check the SSH keys, their type, passphrase and permissions
# does: Report the Node, Ruby, Python, Java, Yarn and CocoaPods a new terminal sees
# does: Count the Brewfile tools and apps that are installed
set -e -u -o pipefail
source "${BOOTSTRAP_ROOT:?}/lib/common.sh"

title "Check"

if (( DRY )); then
  note "Nothing was changed, so there is nothing to check. Run for real to see this report."
  return 0 2>/dev/null || exit 0
fi

# A fresh terminal is the only honest test: `zsh -l -c` skips ~/.zshrc and inherits this
# process's environment, so both would pass for the wrong reason. `env -i` clears the
# environment and `-i` makes zsh read ~/.zshrc, which is what a new window really does.
fresh() {
  env -i HOME="$HOME" USER="${USER:-$(id -un)}" TERM="${TERM:-xterm-256color}" SHELL=/bin/zsh \
    /bin/zsh -ilc "$1" 2>/dev/null || true
}

problems=0
broken() {
  fail "$1"
  problems=$(( problems + 1 ))
}

# ---- folders and macOS settings ----
say "Folders"
for dir in "$HOME/Projects" "$HOME/Storage"; do
  if [[ -d "$dir" ]]; then
    ok "$(pretty "$dir")"
  else
    warn "$(pretty "$dir") is missing (the System step was not run)"
  fi
done
if [[ "$(defaults read NSGlobalDomain AppleShowAllExtensions 2>/dev/null || true)" == 1 ]]; then
  ok "Finder shows all file extensions"
else
  warn "Finder hides file extensions"
fi

# ---- the shell a new window gets ----
say "Shell, in a new terminal"
if [[ -f "$HOME/.zshrc" ]]; then
  if cmp -s "$ROOT/config/zshrc" "$HOME/.zshrc"; then
    ok "~/.zshrc matches config/zshrc"
  else
    warn "~/.zshrc differs from config/zshrc (edited by hand, or from an older run)"
  fi
else
  warn "~/.zshrc is missing (the Shell step was not run)"
fi

fresh_brew="$(fresh 'command -v brew')"
if [[ -n "$fresh_brew" ]]; then
  ok "Homebrew   $fresh_brew"
elif has brew; then
  broken "Homebrew is installed but a new terminal cannot see it"
else
  warn "Homebrew is not installed"
fi

fresh_mise="$(fresh 'command -v mise')"
if [[ -n "$fresh_mise" ]]; then
  ok "mise       $(fresh 'mise --version') at $fresh_mise"
elif has mise; then
  broken "mise is installed but a new terminal cannot see it"
else
  warn "mise is not installed (the Runtimes step was not run)"
fi

fresh_android="$(fresh 'print -r -- ${ANDROID_HOME:-}')"
if [[ -n "$fresh_android" ]]; then
  ok "ANDROID_HOME $(pretty "$fresh_android")"
  if [[ -n "$(fresh 'command -v adb')" ]]; then
    ok "adb on PATH"
  else
    note "adb is not there yet; Android Studio's first-run wizard installs it"
  fi
else
  warn "ANDROID_HOME is not set in a new terminal"
fi

startup="$( { /usr/bin/time -p env -i HOME="$HOME" USER="${USER:-$(id -un)}" TERM=xterm SHELL=/bin/zsh \
  /bin/zsh -ilc exit ; } 2>&1 | awk '/^real/ {print $2}' || true )"
[[ -n "$startup" ]] && note "a new terminal is ready in ${startup}s"

# ---- SSH keys ----
say "SSH keys"
ssh_dir="$HOME/.ssh"
for host in github.com gitlab.com; do
  name="${host%%.*}"
  key="$ssh_dir/id_ed25519_$name"
  if [[ ! -f "$key" ]]; then
    warn "$(pretty "$key") is missing (the SSH keys step was not run)"
    continue
  fi
  detail=""
  if [[ "$(cut -d' ' -f1 "$key.pub" 2>/dev/null || true)" == "ssh-ed25519" ]]; then
    detail="ed25519"
  else
    detail="unexpected key type"
    problems=$(( problems + 1 ))
  fi
  if ssh-keygen -y -P "" -f "$key" >/dev/null 2>&1; then
    detail="$detail, no passphrase"
  else
    detail="$detail, passphrase set"
  fi
  perms="$(stat -f '%Lp' "$key" 2>/dev/null || true)"
  if [[ "$perms" == 600 ]]; then
    ok "$(pretty "$key")  $detail"
  else
    broken "$(pretty "$key") has permissions $perms, expected 600"
  fi
  if grep -qE "^Host[[:space:]]+$host([[:space:]]|\$)" "$ssh_dir/config" 2>/dev/null; then
    ok "~/.ssh/config has $host"
  else
    warn "~/.ssh/config has no entry for $host"
  fi
done
if [[ -d "$ssh_dir" ]]; then
  perms="$(stat -f '%Lp' "$ssh_dir" 2>/dev/null || true)"
  if [[ "$perms" == 700 ]]; then
    ok "~/.ssh permissions are 700"
  else
    broken "~/.ssh has permissions $perms, expected 700"
  fi
  note "add the public keys to your accounts if you have not: gh ssh-key add ~/.ssh/id_ed25519_github.pub"
fi

# ---- what a new terminal can actually run ----
say "Runtimes, in a new terminal"
runtime() {
  local label="$1" out
  out="$(fresh "$2")"
  out="${out//$'\n'/ }"
  if [[ -n "$out" ]]; then
    ok "$(printf '%-8s %s' "$label" "$out")"
  else
    warn "$label is not available in a new terminal"
  fi
}
runtime node   'node --version'
runtime ruby   'ruby --version | cut -d" " -f2'
runtime python 'python3 --version | cut -d" " -f2'
runtime java   'java -version 2>&1 | head -1'
runtime yarn   'yarn --version'
runtime pod    'pod --version'
if [[ -n "$(fresh 'print -r -- ${JAVA_HOME:-}')" ]]; then
  ok "JAVA_HOME is set"
else
  warn "JAVA_HOME is not set in a new terminal"
fi

# ---- everything the Brewfile lists ----
say "Tools and apps"
check_brewfile() {
  local kind="$1" what="$2"
  local -a installed missing
  local line name label total=0
  if [[ "$kind" == cask ]]; then
    installed=(${(f)"$(brew list --cask -1 2>/dev/null || true)"})
  else
    installed=(${(f)"$(brew list --formula -1 2>/dev/null || true)"})
  fi
  for line in ${(f)"$(brewfile_entries "$kind")"}; do
    name="${line%%$'\t'*}"
    label="${${line#*$'\t'}%%$'\t'*}"
    total=$(( total + 1 ))
    if (( ! ${installed[(Ie)${name:t}]} )); then
      missing+=("$label")
    fi
  done
  if (( $#missing == 0 )); then
    ok "$total of $total $what"
  else
    ok "$(( total - $#missing )) of $total $what"
    warn "not installed: ${(j:, :)missing}"
  fi
}
if has brew; then
  check_brewfile brew "CLI tools"
  check_brewfile cask "apps"
else
  warn "Homebrew is not installed, so nothing from the Brewfile could be checked"
fi

print
if (( problems )); then
  fail "$problems thing(s) look wrong above"
  exit 1
fi
ok "Everything checks out"
