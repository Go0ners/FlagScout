// FlagScout — cœur du background (commun à tous les navigateurs)
//
// Logique indépendante du navigateur : résolution d'IP, géolocalisation, cache,
// rendu de l'icône, messagerie avec le popup. Les rares différences entre
// navigateurs (résolution DNS, injection d'en-tête) sont fournies par un
// « adaptateur de plateforme » passé à init() :
//
//   platform.dnsResolve(hostname, flags)  → { addresses: [...] }
//   platform.installTileReferer()         → installe l'ajout du Referer OSM
//
// L'objet global `browser` est fourni soit nativement (Firefox), soit via le
// polyfill `browser.* → chrome.*` (Chromium), importé avant ce module.

// Adaptateur de plateforme (renseigné par init()).
let platform = null;

// --- Constantes de configuration (durées de cache et délais réseau) ---
const GEO_TTL_MS = 24 * 3600 * 1000;      // Durée de validité d'une géoloc en cache (24 h)
const GEO_CACHE_MAX = 500;                // Nombre maximal d'IP gardées dans le cache géo
const PUBLIC_IP_TTL_MS = 5 * 60 * 1000;   // Fraîcheur de l'IP publique avant re-fetch (5 min)
const DNS_TIMEOUT_MS = 5000;              // Délai max d'une résolution DNS
const GEO_TIMEOUT_MS = 5000;              // Délai max d'un appel de géolocalisation
const PUBLIC_IP_TIMEOUT_MS = 10000;       // Délai max du fetch de l'IP publique
const FLAG_TIMEOUT_MS = 4000;             // Délai max du téléchargement d'un drapeau PNG

// État par onglet : { url, hostname, status, siteIp, info }
// status: "NonHttp" | "Resolving" | "Resolved" | "IpOnly" | "NoIp"
const tabs = new Map();

// IPs vues via webRequest : tabId -> { hostname, ip }
// (l'IP réellement contactée par le navigateur, source la plus fiable)
const wrIps = new Map();

// Cache mémoire ip -> { info, cachedAt }
// (premier niveau de cache, doublé par storage.local pour la persistance)
const geoMem = new Map();

// IP publique de l'utilisateur (valeur, horodatage du fetch, dernière erreur)
let userPublicIp = null;
let userPublicIpAt = 0;
let userPublicIpError = null;

// ---------- Utils ----------

// Vrai si l'URL est résoluble par DNS, c.-à-d. http(s) (exclut about:, file:, …).
function isResolvable(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Extrait le nom d'hôte d'une URL, normalisé (minuscule, sans point final).
function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

// Regex validant une IPv4 complète (chaque octet entre 0 et 255).
const RE_IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

// Vrai si `s` est une IPv4 littérale valide.
function isIPv4(s) { return typeof s === "string" && RE_IPV4.test(s); }

// Vrai si `s` est une IPv6 littérale valide.
function isIPv6(s) {
  if (typeof s !== "string" || s.length < 2) return false;
  try { new URL(`http://[${s}]/`); return s.includes(":"); } catch { return false; }
}

// Vrai si `s` est une IP, quelle que soit la famille.
function isIp(s) { return isIPv4(s) || isIPv6(s); }

// ---------- Cache géo (mémoire + storage.local) ----------

// Lit une géoloc en cache pour `ip`, ou null si absente/expirée.
async function geoCacheGet(ip) {
  const mem = geoMem.get(ip);
  if (mem && Date.now() - mem.cachedAt < GEO_TTL_MS) return mem.info;
  try {
    const { geoCache = {} } = await browser.storage.local.get("geoCache");
    const e = geoCache[ip];
    if (e && Date.now() - e.cachedAt < GEO_TTL_MS) {
      geoMem.set(ip, { info: e, cachedAt: e.cachedAt }); // remonte en cache mémoire
      return e;
    }
  } catch {}
  return null;
}

// Écrit une géoloc en cache (mémoire + storage), avec horodatage, puis purge.
async function geoCacheSet(ip, info) {
  const entry = { ...info, cachedAt: Date.now() };
  geoMem.set(ip, { info: entry, cachedAt: entry.cachedAt });
  try {
    const { geoCache = {} } = await browser.storage.local.get("geoCache");
    geoCache[ip] = entry;
    // Éviction : 1) entrées expirées 2) limite de taille (LRU sur cachedAt)
    const now = Date.now();
    for (const k of Object.keys(geoCache)) {
      if (now - geoCache[k].cachedAt >= GEO_TTL_MS) delete geoCache[k];
    }
    const keys = Object.keys(geoCache);
    if (keys.length > GEO_CACHE_MAX) {
      keys.sort((a, b) => geoCache[a].cachedAt - geoCache[b].cachedAt);
      for (const k of keys.slice(0, keys.length - GEO_CACHE_MAX)) delete geoCache[k];
    }
    await browser.storage.local.set({ geoCache });
  } catch {}
}

// ---------- Lookup géo (api.ipapi.is) ----------

// Convertit la réponse brute d'ipapi.is en objet interne compact, ou null si
// la réponse est inexploitable (pas de pays valide).
function normalizeGeoResponse(j) {
  if (!j || typeof j !== "object" || !j.location || typeof j.location !== "object") return null;
  const loc = j.location;
  const cc = typeof loc.country_code === "string" ? loc.country_code.toUpperCase() : "";
  const country = typeof loc.country === "string" ? loc.country : "";
  if (!/^[A-Z]{2}$/.test(cc) || !country) return null;
  const isp = (j.company && j.company.name)
    || (j.asn && j.asn.org)
    || (j.datacenter && j.datacenter.datacenter)
    || null;
  const str = (v) => (typeof v === "string" && v ? v : null);
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
  return {
    countryCode: cc,
    countryName: country,
    city: str(loc.city),
    region: str(loc.state),
    isp: isp || null,
    lat: num(loc.latitude),
    lon: num(loc.longitude),
    isVpn: !!j.is_vpn,
    isProxy: !!j.is_proxy,
    isTor: !!j.is_tor,
    isDatacenter: !!j.is_datacenter,
    isMobile: !!j.is_mobile,
  };
}

// Récupère la clé API ipapi.is configurée par l'utilisateur (ou null).
async function ipapiKey() {
  try {
    const { apiKeys } = await browser.storage.local.get("apiKeys");
    return (apiKeys && apiKeys.ipapi) || null;
  } catch {
    return null;
  }
}

// Géolocalise une IP : cache → ipapi.is → cache, ou null en cas d'échec.
async function geoLookup(ip) {
  const cached = await geoCacheGet(ip);
  if (cached) return cached;
  try {
    const key = await ipapiKey();
    const url = `https://api.ipapi.is/?q=${encodeURIComponent(ip)}`
      + (key ? `&key=${encodeURIComponent(key)}` : "");
    const res = await fetch(url, { signal: AbortSignal.timeout(GEO_TIMEOUT_MS) });
    if (!res.ok) {
      console.warn("[flagscout] geo fetch http", res.status);
      return null;
    }
    const info = normalizeGeoResponse(await res.json());
    if (!info) {
      console.warn("[flagscout] geo response unusable for", ip);
      return null;
    }
    await geoCacheSet(ip, info);
    return info;
  } catch (e) {
    console.warn("[flagscout] geo fetch error", e);
    return null;
  }
}

// ---------- Résolution de l'IP du site ----------

// Renvoie { primary, v4, v6 } : l'IP « primaire » (réellement contactée si
// connue, sinon IPv4 préférée) plus les adresses IPv4/IPv6 quand elles existent.
// La résolution DNS proprement dite est déléguée à l'adaptateur de plateforme.
async function resolveIps(tabId, hostname) {
  // Résolution DNS avec garde-fou contre un hôte injoignable.
  const tryResolve = (flags) => Promise.race([
    platform.dnsResolve(hostname, flags),
    new Promise((_, rej) => setTimeout(() => rej(new Error("dns-timeout")), DNS_TIMEOUT_MS)),
  ]);

  // IP réellement contactée (webRequest) → renseigne déjà une famille
  const wr = wrIps.get(tabId);
  const contacted = (wr && wr.hostname === hostname && wr.ip) ? wr.ip : null;
  let v4 = contacted && isIPv4(contacted) ? contacted : null;
  let v6 = contacted && isIPv6(contacted) ? contacted : null;

  if (!v4) {
    try {
      const r = await tryResolve(["disable_ipv6"]); // force une réponse A (IPv4)
      v4 = ((r && r.addresses) || []).find(isIPv4) || null;
    } catch {}
  }
  if (!v6) {
    try {
      const r = await tryResolve([]); // peut renvoyer A et AAAA
      const addrs = (r && r.addresses) || [];
      v6 = addrs.find(isIPv6) || null;
      if (!v4) v4 = addrs.find(isIPv4) || null;
    } catch {}
  }

  return { primary: contacted || v4 || v6, v4, v6 };
}

// ---------- IP publique de l'utilisateur ----------

// Interroge un service externe pour obtenir l'IP publique.
async function fetchPublicIp() {
  try {
    const res = await fetch("https://checkip.amazonaws.com", {
      signal: AbortSignal.timeout(PUBLIC_IP_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error("http-" + res.status);
    const ip = (await res.text()).trim();
    if (!isIp(ip)) throw new Error("invalid-ip");
    userPublicIp = ip;
    userPublicIpAt = Date.now();
    userPublicIpError = null;
    try { await browser.storage.local.set({ userPublicIp: { ip, fetchedAt: userPublicIpAt } }); } catch {}
    return { ip, error: null };
  } catch (e) {
    userPublicIpError = String((e && e.message) || e);
    return { ip: userPublicIp, error: userPublicIpError };
  }
}

// Renvoie l'IP publique en cache si fraîche, sinon la rafraîchit.
async function refreshPublicIpIfStale() {
  if (userPublicIp && Date.now() - userPublicIpAt < PUBLIC_IP_TTL_MS) {
    return { ip: userPublicIp, error: null };
  }
  return await fetchPublicIp();
}

// ---------- Rendu de l'icône ----------

// Palette de secours (fond + texte) si le drapeau PNG est indisponible.
function colorsForCC(cc) {
  const palette = [
    ["#0052B4", "#FFFFFF"], ["#D80027", "#FFFFFF"], ["#009A49", "#FFFFFF"],
    ["#FFCD00", "#000000"], ["#000000", "#FFCD00"], ["#FF6600", "#FFFFFF"],
    ["#7B3F00", "#FFFFFF"], ["#003580", "#FFFFFF"], ["#006847", "#FFFFFF"],
    ["#BF0A30", "#FFFFFF"], ["#1E3A8A", "#FFFFFF"], ["#16A34A", "#FFFFFF"],
  ];
  let h = 0;
  for (const c of cc) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

const iconCache = new Map(); // key -> { 16, 32 } : ImageData mémorisés par drapeau

// Dessine une icône texte (1-2 caractères) sur fond arrondi, en 16 et 32 px.
function renderTextIcon(label, bg, fg) {
  const out = {};
  for (const sz of [16, 32]) {
    const canvas = new OffscreenCanvas(sz, sz);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = bg;
    ctx.beginPath();
    const r = Math.max(2, sz * 0.15);
    ctx.moveTo(r, 0);
    ctx.lineTo(sz - r, 0);
    ctx.quadraticCurveTo(sz, 0, sz, r);
    ctx.lineTo(sz, sz - r);
    ctx.quadraticCurveTo(sz, sz, sz - r, sz);
    ctx.lineTo(r, sz);
    ctx.quadraticCurveTo(0, sz, 0, sz - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.font = `bold ${Math.floor(sz * 0.55)}px -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, sz / 2, sz / 2 + sz * 0.04);
    out[sz] = ctx.getImageData(0, 0, sz, sz);
  }
  return out;
}

// Télécharge le drapeau du pays `cc` (flagcdn.com) → ImageData, avec cache.
async function fetchFlagImageData(cc) {
  const key = `flag:${cc}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const out = {};
  try {
    for (const sz of [16, 32]) {
      const url = `https://flagcdn.com/${sz === 16 ? "16x12" : "32x24"}/${cc.toLowerCase()}.png`;
      const res = await fetch(url, { signal: AbortSignal.timeout(FLAG_TIMEOUT_MS) });
      if (!res.ok) throw new Error("flag-http-" + res.status);
      const bitmap = await createImageBitmap(await res.blob());
      const canvas = new OffscreenCanvas(sz, sz);
      const ctx = canvas.getContext("2d");
      const dy = Math.max(0, Math.floor((sz - bitmap.height) / 2)); // centrage vertical
      ctx.drawImage(bitmap, 0, dy);
      out[sz] = ctx.getImageData(0, 0, sz, sz);
      bitmap.close();
    }
    iconCache.set(key, out);
    return out;
  } catch (e) {
    console.warn("[flagscout] flag fetch failed for", cc, e);
    return null;
  }
}

// Peint l'icône de l'onglet selon `kind` et met à jour l'infobulle.
async function setIcon(tabId, kind, cc) {
  let imageData;
  if (kind === "flag" && cc) {
    imageData = await fetchFlagImageData(cc);
    if (!imageData) {
      const [bg, fg] = colorsForCC(cc);
      imageData = renderTextIcon(cc, bg, fg);
    }
  } else if (kind === "default-flag") {
    imageData = renderTextIcon("?", "#888", "#FFF");
  } else if (kind === "loading") {
    imageData = renderTextIcon("…", "#666", "#FFF");
  } else {
    imageData = renderTextIcon("?", "#444", "#FFF");
  }
  try {
    await browser.action.setIcon({ tabId, imageData });
  } catch (e) {
    console.warn("[flagscout] setIcon error", e);
  }
  try {
    const st = tabs.get(tabId);
    let title;
    if (st && st.siteIp) title = st.siteIp;
    else if (kind === "loading") title = browser.i18n.getMessage("iconResolving") || "…";
    else title = browser.i18n.getMessage("statusIpUnavailable") || "?";
    await browser.action.setTitle({ tabId, title });
  } catch {}
}

// ---------- Orchestration par onglet ----------

// Détermine quel type d'icône afficher selon l'état de l'onglet.
function selectIconKind(state) {
  if (!state) return { kind: "unknown" };
  if (state.status === "Resolving") return { kind: "loading" };
  if (state.status === "Resolved" && state.info) {
    const cc = state.info.countryCode;
    if (/^[A-Z]{2}$/.test(cc)) return { kind: "flag", cc };
    return { kind: "default-flag" };
  }
  return { kind: "unknown" };
}

// Applique sur l'onglet l'icône correspondant à son état courant.
async function applyIcon(tabId) {
  const sel = selectIconKind(tabs.get(tabId));
  await setIcon(tabId, sel.kind, sel.cc);
}

// Notifier le popup qu'un état d'onglet a changé (no-op si aucun listener).
function notifyTabState(tabId) {
  const state = tabs.get(tabId) || null;
  browser.runtime.sendMessage({ type: "TAB_STATE_UPDATED", tabId, state }).catch(() => {});
}

// Pipeline complet pour un onglet : valide l'URL, résout l'IP, géolocalise,
// stocke l'état et peint l'icône, en notifiant le popup à chaque étape.
async function processTab(tabId, url) {
  if (!isResolvable(url)) {
    tabs.set(tabId, { url, hostname: null, status: "NonHttp", siteIp: null, info: null });
    await applyIcon(tabId);
    notifyTabState(tabId);
    return;
  }
  const host = hostnameOf(url);
  const prev = tabs.get(tabId);
  if (prev && prev.hostname === host && prev.status === "Resolved") {
    await applyIcon(tabId);
    return;
  }
  tabs.set(tabId, { url, hostname: host, status: "Resolving", siteIp: null, info: null });
  await applyIcon(tabId);
  notifyTabState(tabId);

  const { primary, v4, v6 } = await resolveIps(tabId, host);
  const cur = tabs.get(tabId);
  if (!cur || cur.hostname !== host) return; // l'onglet a changé entre-temps
  if (!primary) {
    tabs.set(tabId, { ...cur, status: "NoIp", siteIp: null, siteIpv4: null, siteIpv6: null, info: null });
    await applyIcon(tabId);
    notifyTabState(tabId);
    return;
  }
  const info = await geoLookup(primary);
  const cur2 = tabs.get(tabId);
  if (!cur2 || cur2.hostname !== host) return;
  tabs.set(tabId, {
    ...cur2,
    status: info ? "Resolved" : "IpOnly",
    siteIp: primary, siteIpv4: v4, siteIpv6: v6,
    info: info || null,
  });
  await applyIcon(tabId);
  notifyTabState(tabId);
}

// ---------- Démarrage ----------

// Léger : restaure l'IP publique en cache (storage seul, aucun réseau).
async function restorePublicIp() {
  try {
    const { userPublicIp: stored } = await browser.storage.local.get("userPublicIp");
    if (stored && isIp(stored.ip)) {
      userPublicIp = stored.ip;
      userPublicIpAt = stored.fetchedAt || 0;
    }
  } catch {}
}

// Coûteux : (re)peint tous les onglets (démarrage / install / màj uniquement).
async function scanAllTabs() {
  const CONCURRENCY = 3;
  let all;
  try { all = await browser.tabs.query({}); } catch { return; }
  const queue = all.filter((t) => t.url);
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const t = queue.shift();
      try { await processTab(t.id, t.url); } catch {}
    }
  });
  await Promise.all(workers);
}

// ---------- Messagerie ----------

// Traite un message du popup et renvoie la réponse (ou undefined).
async function handleMessage(msg) {
  if (!msg || typeof msg !== "object") return undefined;
  if (msg.type === "GET_TAB_STATE") {
    const state = tabs.get(msg.tabId) || null;
    if (!state) {
      browser.tabs.get(msg.tabId)
        .then((tab) => { if (tab && tab.url) processTab(msg.tabId, tab.url); })
        .catch(() => {});
    }
    return { type: "TAB_STATE", state };
  }
  if (msg.type === "GET_PUBLIC_IP") {
    return { type: "PUBLIC_IP", ip: userPublicIp, error: userPublicIpError };
  }
  if (msg.type === "REFRESH_PUBLIC_IP") {
    const r = await refreshPublicIpIfStale();
    return { type: "PUBLIC_IP", ip: r.ip, error: r.error };
  }
  if (msg.type === "RESOLVE_DOMAIN") {
    // Résolution + géoloc d'un domaine arbitraire (recherche manuelle du popup).
    const host = hostnameOf(`http://${msg.domain}/`);
    if (!host) return { type: "DOMAIN_INFO", siteIp: null, info: null };
    const { primary, v4, v6 } = await resolveIps(-1, host);
    if (!primary) return { type: "DOMAIN_INFO", siteIp: null, info: null };
    const info = await geoLookup(primary);
    return {
      type: "DOMAIN_INFO",
      siteIp: primary, siteIpv4: v4, siteIpv6: v6,
      info: info || null,
    };
  }
  return undefined;
}

// ---------- Initialisation ----------

// Point d'entrée appelé par le script de fond spécifique à chaque navigateur.
// `p` est l'adaptateur de plateforme { dnsResolve, installTileReferer }.
export function init(p) {
  platform = p;

  // Navigation terminée ou changement d'URL → (re)traiter l'onglet.
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab && tab.url) {
      processTab(tabId, tab.url);
    } else if (changeInfo.url) {
      processTab(tabId, changeInfo.url);
    }
  });

  // Onglet activé : repeindre depuis l'état connu, ou le résoudre si inconnu.
  browser.tabs.onActivated.addListener(async ({ tabId }) => {
    if (tabs.has(tabId)) {
      await applyIcon(tabId);
      return;
    }
    try {
      const tab = await browser.tabs.get(tabId);
      if (tab && tab.url) processTab(tabId, tab.url);
    } catch {}
  });

  // Onglet fermé : nettoyer les états associés.
  browser.tabs.onRemoved.addListener((tabId) => {
    tabs.delete(tabId);
    wrIps.delete(tabId);
  });

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
      browser.runtime.openOptionsPage().catch(() => {});
    }
    scanAllTabs();
  });

  // Démarrage du navigateur : (re)peindre tous les onglets ouverts.
  browser.runtime.onStartup.addListener(scanAllTabs);

  // Capte l'IP réellement contactée pour la page principale de chaque onglet.
  // Source la plus fiable ; on teste la présence de webRequest et, à défaut,
  // on retombe sur la résolution DNS.
  if (browser.webRequest && browser.webRequest.onResponseStarted) {
    try {
      browser.webRequest.onResponseStarted.addListener(
        (details) => {
          if (details.type !== "main_frame" || details.tabId < 0 || !details.ip) return;
          const host = hostnameOf(details.url);
          if (host) wrIps.set(details.tabId, { hostname: host, ip: details.ip });
        },
        { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] }
      );
    } catch (e) {
      console.warn("[flagscout] webRequest indisponible, repli DNS", e);
    }
  }

  // Injection de l'en-tête Referer pour les tuiles OSM (spécifique navigateur).
  platform.installTileReferer();

  // Messagerie popup ↔ background. Le motif sendResponse + `return true`
  // fonctionne à l'identique sous Firefox et Chromium.
  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handleMessage(msg).then(sendResponse);
    return true;
  });

  // Restaure l'IP publique en cache (aucun réseau).
  restorePublicIp();
}
