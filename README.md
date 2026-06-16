<div align="center">

<img src="shared/icons/icon-128.png" alt="FlagScout" width="112" height="112" />

# FlagScout

**The hosting country, IP, geolocation, ISP, WHOIS, DNS and VirusTotal reputation of any site — right in your toolbar.**

<br/>

[![Install for Firefox](https://img.shields.io/badge/Firefox-Install%20the%20extension-FF7139?style=for-the-badge&logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/firefox/addon/flagscout/)

<br/>

![Firefox Add-on](https://img.shields.io/amo/v/flagscout?logo=firefoxbrowser&logoColor=white&label=Firefox%20Add-on&color=FF7139)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-2563EB)
![No tracking](https://img.shields.io/badge/tracking-none-16A34A)
![i18n](https://img.shields.io/badge/i18n-FR%20%2F%20EN-6B7280)

</div>

Shows, in the **toolbar**, the hosting country flag of the visited site. On click: a panel with the site's IP, its geolocation, the ISP, your public IP, a **domain search** field, and quick access to a **map**, **VirusTotal**, **WHOIS** and the **DNS records** of the domain.

---

> ### 🦊 Install from the official Firefox portal
> **→ [addons.mozilla.org/firefox/addon/flagscout](https://addons.mozilla.org/firefox/addon/flagscout/)**
> Automatic install and updates, package signed by Mozilla.

> ### 🚫 No Chrome Web Store release
> I **refuse to pay the $5** developer fee Google requires to publish on the Chrome Web Store.
> The code is nonetheless **100% Chromium-compatible**: you can build it yourself (`./build.sh`, see [`BUILD.md`](BUILD.md)) and load it in developer mode (`chrome://extensions`). No Chrome release will be distributed.

---

## Installation (dev)

First assemble the packages: `./build.sh` (see `BUILD.md`).

- **Firefox** (115+): `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on…" → `dist/firefox/manifest.json`
- **Chrome** (110+): `chrome://extensions` → Developer mode → "Load unpacked" → `dist/chrome/` folder

## Architecture (cross-browser)

Shared core + per-browser layer, assembled by `build.sh` into `dist/<browser>/`:

- `shared/` — code **common to both browsers**:
  - `background/core.js` — all the logic (geolocation, flags, public IP, caches, messaging). Receives a platform adapter.
  - `popup/` — details panel and its sub-views (map, VirusTotal, WHOIS, DNS)
  - `options/` — API key configuration page
  - `_locales/{fr,en}/` — i18n strings
  - `icons/icon-{16,32,48,96,128}.png` — add-on icon
  - `vendor/browser-polyfill.js` — `browser.* → chrome.*` alias (no-op on Firefox)
- `platform/firefox/` — `manifest.json` (MV3 event page, `dns`, `webRequestBlocking`) + `background.js` (DNS via `browser.dns`, Referer via `webRequest`)
- `platform/chrome/` — `manifest.json` (MV3 service worker, `declarativeNetRequest`) + `background.js` (DNS via DoH) + `rules.json` (Referer for OSM tiles)
- `preview/preview.html` — rendering preview page (dev tool, outside the extension)

> The browser differences (DNS resolution and OSM Referer injection) are isolated in a small adapter passed to `core.js`. Everything else is strictly identical.

## The popup

### Main view
- **Header**: flag + country + city/region, and a **⚙️** button that opens the API keys page.
- **Details**: site IP, ISP, and **tags** when they apply (VPN, Proxy, Tor, Datacenter, Mobile). Clicking a row (IP, ISP, public IP) **copies** it to the clipboard.
- **Actions**: `Map`, `VirusTotal` (only visible if a key is configured), `Whois`, `DNS`. A **search field** (green magnifier) lets you analyze an arbitrary domain; a red **✕** button returns to the tab's domain.
- The user's **public IP**.

### Sub-views (header: ← back · ↗ open in a tab)
- **Map**: static `tile.openstreetmap.org` tiles rendered directly (no Leaflet), centered marker + zoom ±. The ↗ icon opens the interactive OSM map.
- **VirusTotal**: reputation score ("X / Y engines"), malicious/suspicious/harmless/undetected breakdown and reputation, via the **API v3** (key required). Without a key the button is hidden. The ↗ icon opens the VirusTotal page.
- **WHOIS**: registrar, dates, nameservers, statuses and registrant, via **RDAP** (IANA bootstrap + `rdap.org` fallback). The ↗ icon opens `whois.com`. TLDs without an RDAP server show a dedicated message.

## Options page (API keys)

Opens **automatically on install**. There you configure:

- **VirusTotal** — *required* to show the score in the popup (free tier: 4 req/min, 500/day).
- **ipapi.is** — *optional*; raises the geolocation quota, which already works without a key.

Each field has a **Test** button (validates the key live → green/red) and an **eye** to show/hide the value. Keys are stored in `storage.local`.

## External services

| Service | Usage | Key |
|---|---|---|
| `api.ipapi.is` | IP geolocation | optional |
| `checkip.amazonaws.com` | User's public IP | no |
| `flagcdn.com` | Flag images | no |
| `rdap.org` (+ IANA, registries) | Domain WHOIS | no |
| `cloudflare-dns.com` | DNS-over-HTTPS: reverse DNS, DNS view, and domain resolution (Chrome) | no |
| `nslookup.io` | Opening the DNS view in a tab | no |
| `tile.openstreetmap.org` | Map tiles | no |
| `virustotal.com` | Domain reputation | **required** |

## How it works (background)

- **Site IP**: the actually-contacted IP is preferred (captured via `webRequest.onResponseStarted`); otherwise DNS resolution (IPv4 preferred, IPv6 fallback), capped at 5 s. Resolution goes through the platform adapter: `browser.dns.resolve` on Firefox, **DNS-over-HTTPS** (Cloudflare) on Chrome.
- **Manual search**: a domain typed in the popup is resolved and geolocated on demand (`RESOLVE_DOMAIN` message), without switching tabs.
- **Geolocation**: `api.ipapi.is`, normalized then cached (memory + `storage.local`, 24 h TTL).
- **Flags**: PNG from `flagcdn.com`, with a fallback to a text chip rasterized via `OffscreenCanvas` (country code on a colored background) when the PNG is unavailable.
- **Public IP**: restored from cache on wake-up, and refreshed (network) on the popup's request if older than 5 min; the last successful value is kept on failure.
- **Non-persistent background**: event page on Firefox, service worker on Chrome. The full tab scan only runs at **browser startup** (`onStartup`) and on **install/update** (`onInstalled`); on wake-up, only the lightweight state is restored. A tab's state is rebuilt on demand when the popup opens.

## Notes

- No system notifications — everything goes through the icon and the popup.
- Native JavaScript, no bundler or transpilation; a simple assembly (`build.sh`) combines `shared/` + `platform/<browser>/`.
- UI localized in FR / EN (`browser.i18n`).

### Contact
Questions: **flagscout@gnrs.ca**