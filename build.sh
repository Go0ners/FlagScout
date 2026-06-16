#!/usr/bin/env bash
#
# Construit FlagScout pour chaque navigateur :
#   dist/firefox/   + dist/flagscout-firefox.zip
#   dist/chrome/    + dist/flagscout-chrome.zip
#
# Usage :
#   ./build.sh             # construit firefox ET chrome
#   ./build.sh firefox     # un seul navigateur
#   ./build.sh chrome
#
# Principe : on assemble le cœur commun (shared/) puis on superpose la couche
# spécifique au navigateur (platform/<nav>/) dans dist/<nav>/. Le dossier
# obtenu est chargeable tel quel (non empaqueté) et aussi zippé pour publication.
#
set -euo pipefail
cd "$(dirname "$0")"

assemble() {
  local nav="$1"
  local out="dist/$nav"
  rm -rf "$out"
  mkdir -p "$out"
  cp -R shared/. "$out"/
  cp -R "platform/$nav/." "$out"/
  find "$out" -name '.DS_Store' -delete
}

build_one() {
  local nav="$1"
  if [ ! -d "platform/$nav" ]; then
    echo "❌ Navigateur inconnu : $nav (attendu : firefox | chrome)" >&2
    exit 1
  fi

  echo "▶ Construction $nav → dist/$nav/"
  assemble "$nav"

  rm -f "dist/flagscout-$nav.zip"
  ( cd "dist/$nav" && zip -qr -X "../flagscout-$nav.zip" . )
  echo "  ✅ dist/$nav/  +  dist/flagscout-$nav.zip"
}

targets=("$@")
if [ ${#targets[@]} -eq 0 ]; then
  targets=(firefox chrome)
fi

mkdir -p dist
for nav in "${targets[@]}"; do
  build_one "$nav"
done

echo
echo "Terminé. Charger en développement :"
echo "  • Firefox : about:debugging → Charger un module temporaire → dist/firefox/manifest.json"
echo "  • Chrome  : chrome://extensions → Mode développeur → Charger non empaquetée → dist/chrome/"
