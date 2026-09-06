# Shared helpers for install.sh and steps/*.sh. zsh only; sourced, never run.
#
# Every step is silent: it never asks anything. The app (or install.sh) tells it what to do
# through the environment:
#
#   BOOTSTRAP_ROOT          repo directory (required)
#   BOOTSTRAP_DRY_RUN=1     print the commands that would change something instead of running them
#   BOOTSTRAP_SELECT        comma-separated Brewfile names for steps with items; empty means all
#   BOOTSTRAP_EMAIL         comment for new SSH keys
#   BOOTSTRAP_PASSPHRASE    passphrase for new SSH keys; empty means none
#
# And talks back through plain lines, which the app reads:
#
#   "==> Installing Slack"   the item in progress
#   "✓ Slack"                one item done       (ok)
#   "✗ Slack"                one item failed     (fail)
#   anything else            log

ROOT="${BOOTSTRAP_ROOT:?BOOTSTRAP_ROOT is not set}"
DRY="${BOOTSTRAP_DRY_RUN:-0}"
export HOMEBREW_NO_ENV_HINTS=1
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

# ---- output (a % in the message is escaped so prompt expansion leaves it alone) ----
title() { print; print -P "%F{magenta}%B${*//\%/%%}%b%f" }
say()   { print -P "%F{blue}==>%f %B${*//\%/%%}%b" }
ok()    { print -P "%F{green}✓%f ${*//\%/%%}" }
warn()  { print -P "%F{yellow}!%f ${*//\%/%%}" }
fail()  { print -P "%F{red}✗%f ${*//\%/%%}" }
note()  { print -P "  %F{244}${*//\%/%%}%f" }

has() { command -v "$1" >/dev/null 2>&1 }

# pretty <path>: shorten the repo and $HOME in messages.
pretty() {
  local p="$1"
  p="${p/#$ROOT/${ROOT:t}}"
  print -r -- "${p/#$HOME/~}"
}

# run <command...>: run it, or only show it when dry-running.
run() {
  if (( DRY )); then
    print -P "  %F{244}\$ ${${(j: :)${(q-)@}}//\%/%%}%f"
    return 0
  fi
  "$@"
}

# copy_file <source> <target>: put a copy in place. Nothing links back to the repo, so the
# repo can be deleted afterwards. An existing different file is kept as a backup.
copy_file() {
  local src="$1" dst="$2" backup
  if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
    ok "$(pretty "$dst") is up to date"
    return 0
  fi
  if [[ -e "$dst" || -L "$dst" ]]; then
    backup="$dst.bak-$(date +%Y%m%d-%H%M%S)"
    run mv "$dst" "$backup"
    warn "Kept the old $(pretty "$dst") as $(pretty "$backup")"
  fi
  [[ -d "${dst:h}" ]] || run mkdir -p "${dst:h}"
  run cp "$src" "$dst"
  ok "$(pretty "$dst") written from $(pretty "$src")"
}

# ---- Brewfile:  brew "name"   # Label | Group   /   cask "name"   # Label | Group ----
# brewfile_entries <brew|cask>: prints "name<TAB>label<TAB>group" per matching line.
brewfile_entries() {
  awk -v kind="$1" '
    $1 == kind && match($0, /"[^"]+"/) {
      name = substr($0, RSTART + 1, RLENGTH - 2)
      rest = substr($0, RSTART + RLENGTH)
      label = name; group = "Other"
      if (match(rest, /#[ \t]*/)) {
        comment = substr(rest, RSTART + RLENGTH)
        n = split(comment, parts, "|")
        gsub(/^[ \t]+|[ \t]+$/, "", parts[1]); if (parts[1] != "") label = parts[1]
        if (n > 1) { gsub(/^[ \t]+|[ \t]+$/, "", parts[2]); if (parts[2] != "") group = parts[2] }
      }
      print name "\t" label "\t" group
    }' "$ROOT/Brewfile"
}

# selected <name>: true when BOOTSTRAP_SELECT is empty or lists the name.
selected() {
  [[ -z "${BOOTSTRAP_SELECT:-}" ]] && return 0
  local n
  for n in ${(s:,:)BOOTSTRAP_SELECT}; do
    [[ "$n" == "$1" ]] && return 0
  done
  return 1
}

# ---- live progress: a status line, not a log line ----
# On a terminal it redraws in place; through the app it becomes a "::progress" line, which the
# app shows in its status bar and keeps out of the log.
progress() {
  if [[ -t 1 ]]; then
    printf '\r\033[K  %s' "$*"
  else
    print -r -- "::progress $*"
  fi
}
progress_end() {
  if [[ -t 1 ]]; then
    print
  fi
}

human_kb() {
  local kb=$1
  if (( kb >= 1048576 )); then
    printf '%.1f GB' $(( kb / 1048576.0 ))
  elif (( kb >= 1024 )); then
    printf '%d MB' $(( kb / 1024 ))
  else
    printf '%d KB' "$kb"
  fi
}

# prefetch <brew|cask> <what> <name>...: download everything in one `brew fetch`, which
# Homebrew runs in parallel, while reporting how many are done and how much has landed.
# Failures are not reported here; the install loop retries each item and reports it properly.
prefetch() {
  local kind="$1" what="$2"
  shift 2
  local -a names
  names=("$@")
  local total=$#names cache out pid before now kb marks manifests finished
  cache="$(brew --cache 2>/dev/null)/downloads"
  out="$(mktemp)"
  before="$(du -sk "$cache" 2>/dev/null | cut -f1)"
  before="${before:-0}"
  say "Downloading $total $what at once"
  brew fetch --"$kind" "${names[@]}" >"$out" 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    sleep 2
    now="$(du -sk "$cache" 2>/dev/null | cut -f1)"
    now="${now:-$before}"
    kb=$(( now - before ))
    if (( kb < 0 )); then
      kb=0
    fi
    marks="$(grep -cE '^(✔︎|✘)' "$out" 2>/dev/null || true)"
    manifests="$(grep -c 'Bottle Manifest' "$out" 2>/dev/null || true)"
    finished=$(( ${marks:-0} - ${manifests:-0} ))
    progress "Downloading $finished of $total $what · $(human_kb "$kb") so far"
  done
  wait "$pid" || true
  progress_end
  rm -f "$out"
}

# install_from_brewfile <brew|cask>: download every selected entry at once, then install them
# one by one from the cache, so one failure cannot stop the rest. Prints one ✓ or ✗ per item.
install_from_brewfile() {
  local kind="$1" what
  local -a installed todo todo_labels
  local line name label failed=0 count=0 i
  if [[ "$kind" == cask ]]; then
    what="apps"
    installed=(${(f)"$(brew list --cask -1 2>/dev/null)"})
  else
    what="tools"
    installed=(${(f)"$(brew list --formula -1 2>/dev/null)"})
  fi
  for line in ${(f)"$(brewfile_entries "$kind")"}; do
    name="${line%%$'\t'*}"
    label="${${line#*$'\t'}%%$'\t'*}"
    selected "$name" || continue
    count=$((count + 1))
    if (( ${installed[(Ie)${name:t}]} )); then
      ok "$label (already installed)"
      continue
    fi
    todo+=("$name")
    todo_labels+=("$label")
  done
  if (( count == 0 )); then
    note "Nothing selected"
    return 0
  fi
  if (( $#todo == 0 )); then
    return 0
  fi

  # The downloads are the slow part, so do them all together first.
  if (( $#todo > 1 )); then
    if (( DRY )); then
      run brew fetch --"$kind" "${todo[@]}"
    else
      prefetch "$kind" "$what" "${todo[@]}"
    fi
  fi

  for (( i = 1; i <= $#todo; i++ )); do
    name="${todo[$i]}"
    label="${todo_labels[$i]}"
    say "Installing $label"
    if [[ "$kind" == cask ]]; then
      run brew install --cask --adopt --quiet "$name" || { fail "$label"; failed=$((failed + 1)); continue }
    else
      run brew install --quiet "$name" || { fail "$label"; failed=$((failed + 1)); continue }
    fi
    ok "$label"
  done
  (( failed == 0 ))
}
