#!/usr/bin/env bash
# Rebuilds site/js/theme-engine.js from the product's theme engine (packages/contracts/src) on the
# foundation branch, so the portal demo uses exactly the colours and checks the app uses.
set -euo pipefail
ref="${1:-origin/claude/phase-1-foundation}"
tmp="$(mktemp -d)"; mkdir -p "$tmp/src"
git show "$ref:packages/contracts/src/theme.ts" > "$tmp/src/theme.ts"
git show "$ref:packages/contracts/src/color.ts" > "$tmp/src/color.ts"
echo 'const any = new Proxy(function () {}, { get: () => any, apply: () => any }); export const z = any;' > "$tmp/zod-stub.js"
printf "export { resolveTheme, CONTRAST_REQUIREMENTS, THEME_IDS, themeTemplates } from './src/theme';\nexport { contrastRatio } from './src/color';\n" > "$tmp/entry.ts"
npx -y esbuild@0.24.2 "$tmp/entry.ts" --bundle --format=esm --minify --alias:zod="$tmp/zod-stub.js" --outfile="$tmp/out.js"
{ echo "// The product's own theme engine (packages/contracts/src/theme.ts and color.ts on claude/phase-1-foundation),"
  echo "// bundled with esbuild (zod schemas stubbed out). Regenerate with site/tools/build-theme-engine.sh."
  cat "$tmp/out.js"; } > "$(dirname "$0")/../js/theme-engine.js"
rm -rf "$tmp"
