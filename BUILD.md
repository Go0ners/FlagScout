# Construire FlagScout (Firefox & Chrome)

FlagScout partage un **cœur commun** (`shared/`) et une **couche par navigateur**
(`platform/<nav>/`). Le script `build.sh` assemble les deux dans `dist/<nav>/`
et produit un `.zip` par navigateur.

```
shared/                 # commun : popup, options, _locales, icons, vendor, background/ (core.js + doh.js)
platform/firefox/       # manifest + background.js (DNS natif + Referer via webRequest)
platform/chrome/        # manifest + background.js (DNS via DoH) + rules.json (Referer via DNR)
preview/                # aperçu de dev (hors extension, non empaqueté)
build.sh                # assemble dist/firefox/ et dist/chrome/
```

---

## Méthode recommandée : `./build.sh`

Prérequis : `bash` et `zip` (présents sur macOS/Linux). **Aucune dépendance Node** requise.

```bash
./build.sh             # construit firefox ET chrome
./build.sh firefox     # un seul navigateur
./build.sh chrome
```

Résultat :

- `dist/firefox/` + `dist/flagscout-firefox.zip`
- `dist/chrome/`  + `dist/flagscout-chrome.zip`

Le dossier `dist/<nav>/` est **chargeable tel quel** (non empaqueté) ; le `.zip`
sert à la publication. `manifest.json` est à la **racine** de chaque dossier/zip.

> ℹ️ Tout fichier ajouté dans `shared/` est inclus dans les deux navigateurs.
> Un fichier propre à un navigateur va dans `platform/<nav>/` (il écrase/complète
> le commun lors de l'assemblage).

---

## Charger en développement

- **Firefox** : `about:debugging#/runtime/this-firefox` → « Charger un module
  complémentaire temporaire… » → `dist/firefox/manifest.json`.
- **Chrome / Edge / Brave** : `chrome://extensions` → activer le **Mode
  développeur** → « Charger l'extension non empaquetée » → dossier `dist/chrome/`.

---

## Différences par navigateur (gérées automatiquement)

| Sujet | Firefox | Chrome (MV3) |
|---|---|---|
| Background | event page `scripts` (module) | `service_worker` (module) |
| API `browser.*` | natif | alias `browser.* → chrome.*` (`vendor/browser-polyfill.js`) |
| Résolution DNS | `browser.dns.resolve` | DNS-over-HTTPS (Cloudflare) |
| Referer tuiles OSM | `webRequest` bloquant | `declarativeNetRequest` (`rules.json`) |
| Réglages spécifiques | `browser_specific_settings`, `webRequestBlocking` | `declarativeNetRequest`, `minimum_chrome_version` |

Le code du popup, des options, des locales, des icônes et toute la logique du
background sont **identiques** sur les deux navigateurs.

---

## Publication

- **Firefox / AMO** : téléverser `dist/flagscout-firefox.zip` sur
  [addons.mozilla.org](https://addons.mozilla.org/developers/) (AMO signe le paquet).
- **Chrome Web Store** : téléverser `dist/flagscout-chrome.zip` sur le
  [Developer Dashboard](https://chrome.google.com/webstore/devconsole/).

### Lint Firefox (optionnel)
```bash
npx --yes web-ext lint --source-dir dist/firefox
```
⚠️ Sur **Node.js 24**, `web-ext` peut planter — utiliser **Node 18/20**. Non bloquant :
les magasins refont leur propre validation à la soumission.

---

## Changement de version

1. Mettre à jour `"version"` dans **les deux** manifests
   (`platform/firefox/manifest.json` et `platform/chrome/manifest.json`).
2. Relancer `./build.sh`.
3. Téléverser les nouveaux zips. Les magasins refusent un numéro déjà publié.
