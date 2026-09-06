#!/bin/zsh
# label: Shell
# desc: zsh config for Homebrew · mise · Android SDK paths
# does: Copy config/zshrc to ~/.zshrc (the old file is kept as a backup)
# does: Machine-only lines go in ~/.zshrc.local, which is never touched
set -e -u -o pipefail
source "${BOOTSTRAP_ROOT:?}/lib/common.sh"

title "Shell"

copy_file "$ROOT/config/zshrc" "$HOME/.zshrc"
