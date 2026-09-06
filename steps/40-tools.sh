#!/bin/zsh
# label: CLI tools
# desc: command-line tools from Homebrew · pick which ones
# items: brew
set -e -u -o pipefail
source "${BOOTSTRAP_ROOT:?}/lib/common.sh"

title "CLI tools"

install_from_brewfile brew
