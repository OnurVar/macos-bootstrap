#!/bin/zsh
# label: System
# desc: Projects and Storage folders · Finder shows all file extensions
# does: Create ~/Projects and ~/Storage
# does: Finder: show all file extensions
set -e -u -o pipefail
source "${BOOTSTRAP_ROOT:?}/lib/common.sh"

title "System"

for dir in "$HOME/Projects" "$HOME/Storage"; do
  if [[ -d "$dir" ]]; then
    ok "$(pretty "$dir") exists"
  else
    run mkdir -p "$dir"
    ok "Created $(pretty "$dir")"
  fi
done

if [[ "$(defaults read NSGlobalDomain AppleShowAllExtensions 2>/dev/null)" == 1 ]]; then
  ok "Finder already shows all file extensions"
else
  run defaults write NSGlobalDomain AppleShowAllExtensions -bool true
  run killall Finder || true
  ok "Finder shows all file extensions"
fi
