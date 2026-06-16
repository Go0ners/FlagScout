// FlagScout — entrée du background (Firefox, MV3 event page / module)
//
// Fournit l'adaptateur de plateforme au cœur partagé :
//  - DNS via l'API native browser.dns
//  - en-tête Referer des tuiles OSM via webRequest bloquant

import "./vendor/browser-polyfill.js"; // no-op sous Firefox (browser natif)
import { init } from "./background/core.js";

// La politique de tuiles OSM exige un Referer (sinon 403). Depuis une page
// d'extension, Firefox n'en envoie aucun → on l'ajoute pour ces requêtes.
const TILE_REFERER = "https://gnrs.ca/";

function installTileReferer() {
  browser.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      const headers = details.requestHeaders || [];
      if (!headers.some((h) => h.name.toLowerCase() === "referer")) {
        headers.push({ name: "Referer", value: TILE_REFERER });
      }
      return { requestHeaders: headers };
    },
    { urls: ["https://tile.openstreetmap.org/*"] },
    ["blocking", "requestHeaders"]
  );
}

init({
  // browser.dns.resolve renvoie déjà { addresses: [...] }.
  dnsResolve: (hostname, flags) => browser.dns.resolve(hostname, flags),
  installTileReferer,
});
