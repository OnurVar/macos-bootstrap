#!/bin/zsh
# label: Runtimes
# desc: Node · Ruby · Python · Java · Yarn via mise
# detail: mise
# does: cocoapods (gem, for React Native iOS)
# does: specify (uv tool, spec-kit)
set -e -u -o pipefail
source "${BOOTSTRAP_ROOT:?}/lib/common.sh"

# Add a runtime: one line in config/mise.toml. Add a gem or a uv tool: one line below.
GEMS=(cocoapods)
UV_TOOLS=("specify-cli --from git+https://github.com/github/spec-kit.git")

title "Runtimes"

if has mise; then
  ok "mise is installed"
else
  say "Installing mise"
  run brew install --quiet mise
  ok "mise"
fi

copy_file "$ROOT/config/mise.toml" "$HOME/.config/mise/config.toml"

say "Installing the versions in config/mise.toml"
run mise install --yes
ok "Runtimes from config/mise.toml"

for gem in "${GEMS[@]}"; do
  if has mise && mise exec -- gem list -i "$gem" >/dev/null 2>&1; then
    ok "$gem gem (already installed)"
  else
    say "Installing $gem gem"
    run mise exec -- gem install --no-document "$gem" && ok "$gem gem" || fail "$gem gem"
  fi
done

for spec in "${UV_TOOLS[@]}"; do
  tool="${spec%% *}"
  if ! has uv; then
    warn "uv is not installed, skipping $tool (tick it under CLI tools)"
    continue
  fi
  if uv tool list 2>/dev/null | grep -q "^$tool "; then
    ok "$tool (already installed)"
  else
    say "Installing $tool"
    run uv tool install ${=spec} && ok "$tool" || fail "$tool"
  fi
done

if has mise && (( ! DRY )); then
  mise ls --current 2>/dev/null || true
fi
