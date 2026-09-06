#!/bin/zsh
# label: SSH keys
# desc: ed25519 keys for GitHub and GitLab · ssh config · Keychain
# needs: email passphrase
# does: ~/.ssh/id_ed25519_github and ~/.ssh/id_ed25519_gitlab
# does: Host blocks in ~/.ssh/config with Keychain enabled
# does: Prints the public keys to add to GitHub and GitLab
set -e -u -o pipefail
source "${BOOTSTRAP_ROOT:?}/lib/common.sh"

title "SSH keys"

ssh_dir="$HOME/.ssh"
config="$ssh_dir/config"
email="${BOOTSTRAP_EMAIL:-}"
passphrase="${BOOTSTRAP_PASSPHRASE:-}"
[[ -d "$ssh_dir" ]] || run mkdir -p -m 700 "$ssh_dir"

# An unattended run has no passphrase unless one was given, and a key without one is worth
# saying out loud rather than discovering later.
if (( ! DRY )) && [[ -z "$passphrase" ]]; then
  if [[ ! -f "$ssh_dir/id_ed25519_github" || ! -f "$ssh_dir/id_ed25519_gitlab" ]]; then
    warn "No passphrase given, so new keys get none. Set BOOTSTRAP_PASSPHRASE to use one."
  fi
fi

typeset -a pubkeys
for host in github.com gitlab.com; do
  name="${host%%.*}"
  key="$ssh_dir/id_ed25519_$name"

  if [[ -f "$key" ]]; then
    ok "$(pretty "$key") exists"
  else
    say "Creating $(pretty "$key")"
    if (( DRY )); then
      run ssh-keygen -q -t ed25519 -C "$email" -f "$key" -N '<passphrase>'
    else
      ssh-keygen -q -t ed25519 -C "$email" -f "$key" -N "$passphrase"
    fi
    ok "Created $(pretty "$key")"
  fi
  pubkeys+=("$key.pub")

  if [[ -f "$config" ]] && grep -qE "^Host[[:space:]]+$host([[:space:]]|\$)" "$config"; then
    ok "ssh config already has $host"
    continue
  fi
  block="Host $host
  AddKeysToAgent yes
  UseKeychain yes
  IdentitiesOnly yes
  IdentityFile $(pretty "$key")"
  if (( DRY )); then
    note "Would add to $(pretty "$config"):"
    print -r -- "$block" | sed 's/^/      /'
    continue
  fi
  { [[ -s "$config" ]] && print; print -r -- "$block" } >> "$config"
  chmod 600 "$config"
  ok "Added $host to $(pretty "$config")"
done

say "Public keys to add to your accounts"
for pub in "${pubkeys[@]}"; do
  [[ -f "$pub" ]] || continue
  note "$(pretty "$pub")"
  print -r -- "  $(cat "$pub")"
done
note "GitHub: https://github.com/settings/ssh/new   or: gh auth login -s admin:public_key && gh ssh-key add ~/.ssh/id_ed25519_github.pub"
note "GitLab: https://gitlab.com/-/user_settings/ssh_keys"
