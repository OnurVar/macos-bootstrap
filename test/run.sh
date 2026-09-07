#!/bin/zsh
# Every check in one command. Nothing touches this Mac outside a throwaway folder:
#   - zsh syntax of every script
#   - the app: dependencies, type-check, unit tests
#   - a dry run of every step in a throwaway home
#   - a real run of the file-only steps (Shell, SSH keys) in a throwaway home, twice
#   - a scripted session of the app in dry-run mode: tick, start, wait for Done, quit
#
# Needs node 22+ on PATH and expect (ships with macOS).

set -e -u -o pipefail

root="${0:A:h:h}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cd "$root"

step()  { print -P "\n%F{magenta}%B== $1%b%f" }
plain() { sed 's/\x1b\[[0-9;]*m//g' }

step "zsh syntax"
for f in bootstrap.sh install.sh lib/common.sh steps/*.sh config/zshrc test/run.sh; do
  zsh -n "$f"
done
print "ok"

step "app: dependencies, type-check, unit tests"
command -v node >/dev/null || { print -u2 "node is not on PATH"; exit 1 }
(cd app && { [[ -d node_modules ]] || npm ci --silent --no-fund --no-audit; })
(cd app && npx tsc --noEmit)
(cd app && npm test --silent 2>&1 | grep -E '^# (pass|fail)')

step "install.sh --list"
./install.sh --list

# The steps run under `set -e -u -o pipefail`; the helpers must work there, not just in a
# plain shell. bar() used the nameless ${(l:N::x:)} padding, which passed a loose test and
# then failed on every progress tick of a real run with "parameter not set".
step "shell helpers under the flags a step actually uses"
cat > "$tmp/helpers.zsh" <<'HELPERS'
set -e -u -o pipefail
source "$BOOTSTRAP_ROOT/lib/common.sh"
for pct in 0 1 27 50 99 100 150 -5; do
  out="$(bar $pct 14)"
  [[ ${#out} -eq 14 ]] || { print -u2 "bar $pct gave ${#out} chars, expected 14"; exit 1 }
done
for kb in 0 1 1023 1024 5000 1048576 9999999; do human_kb $kb >/dev/null; done
for s in 0 5 59 60 90 3599 3600 90000; do human_secs $s >/dev/null; done
progress "$(bar 27 14) 27% · 1.2 GB / 4.4 GB · 21 MB/s · 2m left · 7/29 apps" >/dev/null
progress_end >/dev/null
HELPERS
if ! BOOTSTRAP_ROOT="$root" zsh "$tmp/helpers.zsh"; then
  print -u2 "a shell helper breaks under the flags the steps use"
  exit 1
fi
print "ok"

step "dry run of every step in a throwaway home"
mkdir -p "$tmp/dry"
if ! HOME="$tmp/dry" BOOTSTRAP_EMAIL=test@example.com ./install.sh --yes --dry-run > "$tmp/dry.log" 2>&1; then
  cat "$tmp/dry.log"
  exit 1
fi
plain < "$tmp/dry.log" | grep -q 'System · Shell · SSH keys · CLI tools · Runtimes · Applications' || {
  cat "$tmp/dry.log"; print -u2 "summary line missing"; exit 1
}
print "ok"

step "real run of Shell and SSH keys in a throwaway home, twice"
mkdir -p "$tmp/real"
HOME="$tmp/real" BOOTSTRAP_EMAIL=test@example.com BOOTSTRAP_PASSPHRASE=test ./install.sh --yes --only shell,ssh > "$tmp/real1.log" 2>&1
HOME="$tmp/real" BOOTSTRAP_EMAIL=test@example.com ./install.sh --yes --only shell,ssh > "$tmp/real2.log" 2>&1
cmp -s "$tmp/real/.zshrc" config/zshrc
[[ -f "$tmp/real/.ssh/id_ed25519_github" && -f "$tmp/real/.ssh/id_ed25519_gitlab" ]]
grep -q '^Host github.com' "$tmp/real/.ssh/config"
ssh-keygen -y -P test -f "$tmp/real/.ssh/id_ed25519_github" > /dev/null
plain < "$tmp/real2.log" | grep -q 'is up to date'
print "ok"

step "app: full run in a throwaway home (--autostart --exit-when-done)"
mkdir -p "$tmp/app"
# The app is a full-screen TUI, so driving it key-by-key from a script is fragile. Instead the
# app takes --autostart (begin at once with the defaults) and --exit-when-done (quit when the
# run finishes). The test just runs it to exit and checks last-run.log, the file it writes as it
# goes. A pty is still needed because the app refuses to start without a terminal, so expect
# provides one and drains it while the app runs.
log="$root/last-run.log"
cat > "$tmp/app.exp" <<'EXP'
set timeout 120
match_max 400000
spawn -noecho node --import tsx src/index.tsx --dry-run --autostart --exit-when-done
stty rows 40 cols 120 < $spawn_out(slave,name)
expect {
  eof {}
  timeout { puts "TIMEOUT: app did not finish"; exit 1 }
}
EXP
rm -f "$log"
if ! (cd app && HOME="$tmp/app" BOOTSTRAP_EMAIL=test@example.com expect "$tmp/app.exp" > "$tmp/app.log" 2>&1); then
  sed 's/\x1b\[[0-9;?]*[A-Za-z]//g' "$tmp/app.log" | tail -30
  exit 1
fi
grep -q 'Done\.' "$log"
# How many steps the app plans depends on what this Mac already has, so assert that every
# planned step succeeded rather than a fixed count.
summary="$(grep -oE '[0-9]+ of [0-9]+ steps ok' "$log" | tail -1)"
[[ -n "$summary" ]] || { print -u2 "no summary line in $log"; exit 1 }
[[ "${summary%% of *}" == "${${summary#* of }%% *}" ]] || { print -u2 "some steps failed: $summary"; exit 1 }
if grep -q '✗' "$log"; then
  print -u2 "the run reported failures:"
  grep '✗' "$log"
  exit 1
fi
print "ok"

print -P "\n%F{green}%BAll checks passed%b%f"
