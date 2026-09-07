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

# The commit this copy of the repo is at, e.g. "c3b5421 from 2026-09-06".
bootstrap_version() {
  git -C "$ROOT" log -1 --format='%h from %cs' 2>/dev/null || print -r -- unknown
}

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

# bar <percent> [width]: a text meter, e.g. ███░░░░░░░░░░░
bar() {
  # The padding flag needs a named parameter: with `set -u`, which every step runs under,
  # the nameless form ${(l:N::x:)} fails with "parameter not set".
  local pct=$1 width=${2:-14} filled pad="" f="" e=""
  (( pct < 0 )) && pct=0
  (( pct > 100 )) && pct=100
  filled=$(( pct * width / 100 ))
  (( filled > 0 )) && f="${(l:$filled::█:)pad}"
  (( width - filled > 0 )) && e="${(l:$(( width - filled ))::░:)pad}"
  printf '%s%s' "$f" "$e"
}

human_secs() {
  local s=$1
  if (( s >= 3600 )); then
    printf '%dh %dm' $(( s / 3600 )) $(( (s % 3600) / 60 ))
  elif (( s >= 60 )); then
    printf '%dm' $(( (s + 59) / 60 ))
  else
    printf '%ds' "$s"
  fi
}

# item_size_kb <kind> <name>: how big this download is, by asking the server. 0 when unknown,
# which just means the bar is left out.
item_size_kb() {
  local url len
  url="$(brew info --"$1" --json=v2 "$2" 2>/dev/null | jq -r '.casks[]?.url // empty' 2>/dev/null)"
  if [[ -z "$url" ]]; then
    print 0
    return 0
  fi
  len="$(curl -sIL --max-time 8 "$url" 2>/dev/null | grep -i '^content-length:' | tail -1 | tr -dc '0-9')"
  print $(( ${len:-0} / 1024 ))
}

# install_one <kind> <name> <label>: install a single item while showing how its download is
# going. One at a time on purpose: knowing which app is being fetched, and how far along it is,
# is worth more than the seconds saved by downloading them all at once behind one opaque total.
ITEM_DETAIL=""
install_one() {
  local kind="$1" name="$2" label="$3"
  local cache before size_kb pid now kb started elapsed rate_kbs pct left detail rc
  cache="$(brew --cache 2>/dev/null)/downloads"
  before="${$(du -sk "$cache" 2>/dev/null | cut -f1):-0}"
  size_kb="$(item_size_kb "$kind" "$name")"

  if [[ "$kind" == cask ]]; then
    brew install --cask --adopt --quiet "$name" >/dev/null 2>&1 &
  else
    brew install --quiet "$name" >/dev/null 2>&1 &
  fi
  pid=$!
  started="$(date +%s)"
  while kill -0 "$pid" 2>/dev/null; do
    sleep 1
    now="${$(du -sk "$cache" 2>/dev/null | cut -f1):-$before}"
    kb=$(( now - before ))
    (( kb < 0 )) && kb=0
    (( size_kb > 0 && kb > size_kb )) && kb=$size_kb
    elapsed=$(( $(date +%s) - started ))
    (( elapsed < 1 )) && elapsed=1
    rate_kbs=$(( kb / elapsed ))
    if (( size_kb > 0 && kb >= size_kb )); then
      # The bytes are all here; what is left is unpacking and moving it into place.
      detail="$(bar 100) $(human_kb "$size_kb") downloaded · installing"
    elif (( size_kb > 0 && kb > 0 )); then
      pct=$(( kb * 100 / size_kb ))
      detail="$(bar "$pct") $pct% · $(human_kb "$kb") / $(human_kb "$size_kb")"
      if (( rate_kbs > 0 )); then
        detail="$detail · $(human_kb "$rate_kbs")/s"
        (( size_kb > kb )) && detail="$detail · $(human_secs $(( (size_kb - kb) / rate_kbs )) ) left"
      fi
    elif (( kb > 0 )); then
      detail="$(human_kb "$kb") downloaded"
    else
      # Nothing new on disk: already in the cache, so this is the install itself.
      detail="installing"
    fi
    progress "$label · $detail"
  done
  wait "$pid"
  rc=$?
  progress_end
  # Leave the size and time in the log, so the finished list still says what each app cost.
  now="${$(du -sk "$cache" 2>/dev/null | cut -f1):-$before}"
  kb=$(( now - before ))
  elapsed=$(( $(date +%s) - started ))
  if (( rc == 0 && kb > 512 )); then
    ITEM_DETAIL="$(human_kb "$kb") in $(human_secs $(( elapsed > 0 ? elapsed : 1 )))"
  else
    ITEM_DETAIL=""
  fi
  return $rc
}

# install_from_brewfile <brew|cask>: install the selected entries one at a time, showing each
# download as it happens, so one failure cannot stop the rest. Prints one ✓ or ✗ per item.
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

  for (( i = 1; i <= $#todo; i++ )); do
    name="${todo[$i]}"
    label="${todo_labels[$i]}"
    say "Installing $label  ($i of $#todo)"
    if (( DRY )); then
      if [[ "$kind" == cask ]]; then
        run brew install --cask --adopt --quiet "$name"
      else
        run brew install --quiet "$name"
      fi
    elif ! install_one "$kind" "$name" "$label"; then
      fail "$label"
      failed=$((failed + 1))
      continue
    fi
    if [[ -n "${ITEM_DETAIL:-}" ]]; then
      ok "$label  ($ITEM_DETAIL)"
      continue
    fi
    ok "$label"
  done
  (( failed == 0 ))
}
