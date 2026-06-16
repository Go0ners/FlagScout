// FlagScout — entrée du background (Chromium, MV3 service worker / module)
//
// Adaptateur de plateforme pour le cœur partagé :
//  - DNS via DNS-over-HTTPS (Chromium n'a pas d'API browser.dns)
//  - en-tête Referer des tuiles OSM : géré par declarativeNetRequest (rules.json),
//    donc installTileReferer() est un no-op ici.

import "./vendor/browser-polyfill.js"; // alias browser.* → chrome.*
import { init } from "./background/core.js";
import { dnsResolveDoH } from "./background/doh.js";

init({
  dnsResolve: dnsResolveDoH,
  installTileReferer: () => {}, // géré par declarativeNetRequest (voir rules.json)
});
