#!/bin/zsh
# label: Applications
# desc: Mac apps from Homebrew · pick which ones
# items: cask
# needs: sudo
set -e -u -o pipefail
source "${BOOTSTRAP_ROOT:?}/lib/common.sh"

title "Applications"

install_from_brewfile cask
