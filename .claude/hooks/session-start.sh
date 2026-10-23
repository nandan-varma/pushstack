#!/bin/bash
# SessionStart hook for Claude Code cloud sessions: installs the Node version in
# .node-version, the pnpm version in package.json's packageManager, the
# workspace dependencies, and builds the workspace libraries (the web app
# imports their dist/), so `pnpm test`, `pnpm typecheck` and `pnpm check` work.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
	exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

node_major="$(tr -d '[:space:]v' < .node-version)"
node_dir="$HOME/.local/node-v$node_major"

if ! command -v node > /dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "$node_major" ]; then
	if [ ! -x "$node_dir/bin/node" ]; then
		version="$(curl -fsSL https://nodejs.org/dist/index.json \
			| grep -o "\"version\":\"v$node_major\.[0-9.]*\"" | head -n 1 | cut -d '"' -f 4)"
		echo "Installing Node $version" >&2
		mkdir -p "$node_dir"
		curl -fsSL "https://nodejs.org/dist/$version/node-$version-linux-x64.tar.xz" \
			| tar -xJ -C "$node_dir" --strip-components=1
	fi
	export PATH="$node_dir/bin:$PATH"
	if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
		echo "export PATH=\"$node_dir/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
	fi
fi

pnpm_version="$(node -p 'require("./package.json").packageManager.split("@")[1]')"
if ! command -v pnpm > /dev/null || [ "$(pnpm -v)" != "$pnpm_version" ]; then
	npm install -g "pnpm@$pnpm_version" >&2
fi

# pnpm runs its packageManager-pinned copy from a tools directory it installs
# without build scripts, leaving shebang-less placeholder bins. Shells retry
# those, but turbo spawns `pnpm` directly and gets ENOEXEC, so link the native
# binary in.
pnpm_tool="${PNPM_HOME:-$HOME/.local/share/pnpm}/.tools/pnpm/$pnpm_version/node_modules/pnpm"
if [ -f "$pnpm_tool/install.js" ] && ! head -c 4 "$pnpm_tool/pnpm" | grep -q ELF; then
	(cd "$pnpm_tool" && node install.js) >&2
fi

pnpm install --frozen-lockfile >&2
pnpm exec turbo run build --filter='./packages/*' >&2
