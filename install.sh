#!/bin/zsh
# macos-bootstrap without the app: runs the steps unattended. Handy for a scripted run,
# a quick rerun of one step, or when the app cannot start.
#
#   ./install.sh --yes                     every step, every item
#   ./install.sh --yes --only ssh,apps     only these steps (names from --list)
#   ./install.sh --yes --select slack,gh   only these Brewfile names inside the item steps
#   ./install.sh --yes --dry-run           show what would change, change nothing
#   ./install.sh --list                    the steps
#
# The SSH step reads two variables, because nothing here asks questions:
#   BOOTSTRAP_EMAIL=you@example.com        comment on new keys (default: git config user.email)
#   BOOTSTRAP_PASSPHRASE=secret            passphrase for new keys (default: none)
#
# The interactive way is the app: bootstrap.sh starts it, or `cd app && npm start`.

set -e -u -o pipefail

export BOOTSTRAP_ROOT="${0:A:h}"
export BOOTSTRAP_YES=1
export BOOTSTRAP_DRY_RUN="${BOOTSTRAP_DRY_RUN:-0}"
export BOOTSTRAP_SELECT="${BOOTSTRAP_SELECT:-}"
only=""
list=0
yes=0

while (( $# )); do
  case "$1" in
    -y|--yes)     yes=1 ;;
    -n|--dry-run) export BOOTSTRAP_DRY_RUN=1 ;;
    --only)       only="${2:-}"; shift ;;
    --only=*)     only="${1#--only=}" ;;
    --select)     export BOOTSTRAP_SELECT="${2:-}"; shift ;;
    --select=*)   export BOOTSTRAP_SELECT="${1#--select=}" ;;
    -l|--list)    list=1 ;;
    -h|--help)    sed -n '2,15p' "$0" | sed -E 's/^# ?//'; exit 0 ;;
    *)            print -u2 "Unknown option: $1 (try --help)"; exit 2 ;;
  esac
  shift
done

source "$BOOTSTRAP_ROOT/lib/common.sh"

# ---- steps live in steps/NN-name.sh; "# label:" and "# desc:" describe them ----
typeset -a files keys labels descs
for file in "$BOOTSTRAP_ROOT"/steps/[0-9][0-9]-*.sh; do
  key="${${file:t}%.sh}"
  key="${key#[0-9][0-9]-}"
  files+=("$file")
  keys+=("$key")
  labels+=("$(sed -n 's/^# label: *//p' "$file" | head -n 1)")
  descs+=("$(sed -n 's/^# desc: *//p' "$file" | head -n 1)")
done

if (( list )); then
  for i in {1..$#keys}; do
    printf '  %-10s %-14s %s\n' "$keys[$i]" "$labels[$i]" "$descs[$i]"
  done
  exit 0
fi
if (( ! yes )); then
  sed -n '2,15p' "$0" | sed -E 's/^# ?//'
  exit 2
fi

[[ -x /opt/homebrew/bin/brew || -x /usr/local/bin/brew ]] || { fail "Homebrew is not installed. Run bootstrap.sh first."; exit 1 }

typeset -a selected
if [[ -n "$only" ]]; then
  for key in ${(s:,:)only}; do
    i=${keys[(Ie)$key]}
    (( i )) || { fail "No step called '$key'. Steps: ${(j:, :)keys}"; exit 2 }
    selected+=($i)
  done
else
  selected=({1..$#keys})
fi

note "macos-bootstrap $(bootstrap_version)"
(( DRY )) && warn "Dry run: nothing will be changed"

typeset -a passed failed
for i in "${selected[@]}"; do
  if zsh "$files[$i]"; then
    passed+=("$labels[$i]")
  else
    failed+=("$labels[$i]")
  fi
done

title "Summary"
(( $#passed )) && ok "${(j: · :)passed}"
(( $#failed )) && fail "Failed: ${(j: · :)failed}"
print
note "Open a new terminal, or run: exec zsh"
(( $#failed )) && exit 1
exit 0
