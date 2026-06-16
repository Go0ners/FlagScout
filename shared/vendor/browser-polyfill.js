// FlagScout — alias minimal browser.* → chrome.*
//
// Firefox expose nativement l'objet `browser` (API à promesses) : ce fichier
// est alors un no-op. Chromium n'expose que `chrome` ; en Manifest V3, les API
// `chrome.*` renvoient déjà des promesses, donc un simple alias suffit pour
// l'usage de FlagScout. La seule incompatibilité (réponse asynchrone aux
// messages runtime) est gérée dans background/core.js via le motif
// `sendResponse(...)` + `return true`, valable sur les deux navigateurs.
//
// Utilisable à la fois comme script classique (popup/options) et comme import
// à effet de bord dans un module de service worker (background Chromium).
(() => {
  if (typeof globalThis.browser === "undefined" && typeof globalThis.chrome !== "undefined") {
    globalThis.browser = globalThis.chrome;
  }
})();
