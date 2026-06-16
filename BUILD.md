# Building FlagScout (Firefox & Chrome)

FlagScout shares a **common core** (`shared/`) and a **per-browser layer**
(`platform/<browser>/`). The `build.sh` script assembles both into `dist/<browser>/`
and produces one `.zip` per browser.

```
shared/                 # common: popup, options, _locales, icons, vendor, background/ (core.js + doh.js)
platform/firefox/       # manifest + background.js (native DNS + Referer via webRequest)
platform/chrome/        # manifest + background.js (DNS via DoH) + rules.json (Referer via DNR)
preview/                # dev preview (outside the extension, not packaged)
build.sh                # assembles dist/firefox/ and dist/chrome/
```

---

## Recommended method: `./build.sh`

Prerequisites: `bash` and `zip` (present on macOS/Linux). **No Node dependency** required.

```bash
./build.sh             # builds firefox AND chrome
./build.sh firefox     # a single browser
./build.sh chrome
```

Result:

- `dist/firefox/` + `dist/flagscout-firefox.zip`
- `dist/chrome/`  + `dist/flagscout-chrome.zip`

The `dist/<browser>/` folder is **loadable as is** (unpackaged); the `.zip`
is used for publishing. `manifest.json` is at the **root** of each folder/zip.

> ℹ️ Any file added to `shared/` is included in both browsers.
> A browser-specific file goes into `platform/<browser>/` (it overrides/completes
> the common part during assembly).

---

## Load in development

- **Firefox**: `about:debugging#/runtime/this-firefox` → "Load Temporary
  Add-on…" → `dist/firefox/manifest.json`.
- **Chrome / Edge / Brave**: `chrome://extensions` → enable **Developer
  mode** → "Load unpacked" → `dist/chrome/` folder.

---

## Per-browser differences (handled automatically)

| Topic | Firefox | Chrome (MV3) |
|---|---|---|
| Background | event page `scripts` (module) | `service_worker` (module) |
| `browser.*` API | native | alias `browser.* → chrome.*` (`vendor/browser-polyfill.js`) |
| DNS resolution | `browser.dns.resolve` | DNS-over-HTTPS (Cloudflare) |
| OSM tile Referer | blocking `webRequest` | `declarativeNetRequest` (`rules.json`) |
| Specific settings | `browser_specific_settings`, `webRequestBlocking` | `declarativeNetRequest`, `minimum_chrome_version` |

The popup, options, locales, icons code and all the background logic
are **identical** across both browsers.

---

## Changing the version

1. Update `"version"` in **both** manifests
   (`platform/firefox/manifest.json` and `platform/chrome/manifest.json`).
2. Re-run `./build.sh`.

### Contact
Questions: **flagscout@gnrs.ca**