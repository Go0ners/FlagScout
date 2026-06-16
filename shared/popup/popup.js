// FlagScout — popup : affiche l'état du site actif (pays, IP, FAI…) et propose
// des vues détaillées (carte, WHOIS, DNS, VirusTotal).

const t = (key) => browser.i18n.getMessage(key) || key; // raccourci i18n

// ─── Helpers DOM ────────────────────────────────────────

const $ = (id) => document.getElementById(id); // raccourci getElementById

// Écrit un texte dans l'élément `id` (no-op si l'élément n'existe pas).
function setText(id, txt) {
  const el = $(id);
  if (el) el.textContent = txt ?? "";
}

// Renseigne une valeur, mais masque toute la ligne si la valeur est vide.
function setOptRow(rowId, valueId, value) {
  const row = $(rowId);
  if (!row) return;
  if (value) { setText(valueId, value); row.hidden = false; }
  else { row.hidden = true; }
}

// Traduit les éléments [data-i18n] (texte) et [data-i18n-title] (titre/aria).
function applyI18n() {
  document.documentElement.lang = browser.i18n.getUILanguage();
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const msg = t(el.dataset.i18n);
    if (msg) el.textContent = msg;
  }
  for (const el of document.querySelectorAll("[data-i18n-title]")) {
    const msg = t(el.dataset.i18nTitle);
    if (msg) { el.title = msg; el.setAttribute("aria-label", msg); }
  }
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    const msg = t(el.dataset.i18nPlaceholder);
    if (msg) el.setAttribute("placeholder", msg);
  }
}

// Remplace le contenu du conteneur de tags par une puce (chip) par libellé.
function setTags(tags) {
  const c = $("site-tags");
  if (!c) return;
  c.replaceChildren();
  for (const label of tags) {
    const chip = document.createElement("span");
    chip.className = "tag";
    chip.textContent = label;
    c.appendChild(chip);
  }
}

// Convertit un code pays ISO en emoji drapeau (paire de symboles régionaux).
function flagFromCC(cc) {
  if (!/^[A-Z]{2}$/.test(cc)) return "🏳️"; // drapeau blanc si code invalide
  const A = 0x1F1E6; // point de code du symbole régional « A »
  return String.fromCodePoint(A + cc.charCodeAt(0) - 65, A + cc.charCodeAt(1) - 65);
}

// ─── Actions (copie, liens externes) ────────────────────

// Ouvre `url` dans un nouvel onglet et ferme le popup.
function openTab(url) {
  browser.tabs.create({ url });
  window.close();
}

// Configure un bouton d'action : le rend visible, activé/désactivé selon
// `enabled`, et lui attache `handler` (ou rien s'il est désactivé).
function wireAction(id, enabled, handler) {
  const btn = $(id);
  if (!btn) return;
  btn.hidden = false;
  btn.disabled = !enabled;
  btn.onclick = enabled ? handler : null;
}

// Récupère une clé API depuis le storage (ou null).
async function getApiKey(name) {
  try {
    const { apiKeys } = await browser.storage.local.get("apiKeys");
    return (apiKeys && apiKeys[name]) || null;
  } catch {
    return null;
  }
}

// Ouvre la page d'options et ferme le popup.
function openOptions() {
  browser.runtime.openOptionsPage();
  window.close();
}

// Hôte = adresse IP littérale (IPv4 ou IPv6) ?
function isIpHost(host) {
  if (!host) return false;
  const h = host.replace(/^\[|\]$/g, ""); // retire les crochets d'une IPv6
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(h) || h.includes(":");
}

// WHOIS/RDAP n'a de sens que pour un vrai domaine : pas une IP, et avec un TLD
// (au moins un point). Exclut 127.0.0.1, localhost, intranet « machine », etc.
function isWhoisable(host) {
  return !!host && !isIpHost(host) && host.includes(".");
}

// Normalise une saisie utilisateur en nom de domaine exploitable, ou null si la
// saisie est vide / invalide. Retire le schéma http(s)://, le chemin, la query,
// le port et un éventuel point final ; convertit les IDN en punycode via URL().
// Rejette les IP et les saisies sans point (la recherche cible des domaines).
function normalizeDomain(input) {
  if (!input) return null;
  let s = String(input).trim().toLowerCase();
  if (!s) return null;
  // Ajoute un schéma factice si absent pour pouvoir s'appuyer sur URL()
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = "http://" + s;
  let host;
  try { host = new URL(s).hostname; } catch { return null; } // saisie inanalysable
  host = host.replace(/\.$/, ""); // point final éventuel
  if (!host || host.includes(" ")) return null;
  if (isIpHost(host)) return null;              // domaines uniquement, pas d'IP
  if (!host.includes(".")) return null;         // doit comporter un TLD
  if (!/^[a-z0-9.-]+$/.test(host)) return null; // ASCII (IDN déjà converti en punycode)
  return host;
}

// ─── Domaine cible partagé (recherche manuelle) ─────────

// État partagé unique, en mémoire dans le popup. Non persisté : à chaque
// ouverture du popup le script est rechargé, donc `targetDomain` repart du
// domaine de l'onglet actif. Il survit en revanche à la navigation entre les
// vues internes (il reste en mémoire tant que le popup est ouvert).
let tabDomain = null;      // domaine de l'onglet actif (cible du reset)
let targetDomain = null;   // domaine actuellement analysé (onglet ou saisie manuelle)
let targetInit = false;    // targetDomain a-t-il déjà été initialisé ?

// Vrai si la cible courante est un domaine saisi manuellement (≠ onglet).
function isCustomDomain() {
  return !!targetDomain && targetDomain !== tabDomain;
}

// Met à jour la cible, rafraîchit l'UI racine et les boutons d'analyse.
// Le fetch des vues d'analyse reste « à la demande » (à l'ouverture d'une vue),
// mais la vue racine (IP/géoloc/carte) est résolue immédiatement pour la cible.
function setTargetDomain(domain) {
  targetDomain = domain || null;
  renderTarget();
}

// Reflète la cible courante sur la vue racine : ligne « Domaine » (si saisie
// manuelle), valeur du champ de recherche, visibilité du bouton reset.
function renderTargetUi() {
  const custom = isCustomDomain();
  // Ligne « Domaine » au-dessus de l'IPv4, uniquement pour un domaine manuel
  setOptRow("domain-row", "site-domain", custom ? targetDomain : "");
  // Champ de recherche : reflète la cible (sans écraser une saisie en cours)
  const input = $("domain-search");
  if (input && document.activeElement !== input) input.value = targetDomain || "";
  // Bouton reset visible seulement quand un domaine manuel est actif
  const resetBtn = $("domain-reset");
  if (resetBtn) resetBtn.hidden = !custom;
}

// Affiche brièvement un message d'erreur À L'INTÉRIEUR du champ (placeholder),
// puis restaure le placeholder par défaut après quelques secondes.
let searchErrTimer = null;
function flashSearchError(msgKey) {
  const input = $("domain-search");
  if (!input) return;
  input.value = "";                       // vide le champ pour révéler le placeholder
  input.placeholder = t(msgKey);
  input.classList.add("input-error");
  clearTimeout(searchErrTimer);
  searchErrTimer = setTimeout(() => {
    input.placeholder = t("searchPlaceholder");
    input.classList.remove("input-error");
    searchErrTimer = null;
  }, 2500);
}

// Annule l'état d'erreur et restaure le placeholder par défaut.
function clearSearchError() {
  const input = $("domain-search");
  if (!input) return;
  if (searchErrTimer) { clearTimeout(searchErrTimer); searchErrTimer = null; }
  input.placeholder = t("searchPlaceholder");
  input.classList.remove("input-error");
}

// Valide la saisie et met à jour la cible ; refuse une entrée vide/invalide.
function submitSearch() {
  const input = $("domain-search");
  const norm = normalizeDomain(input ? input.value : "");
  if (!norm) { flashSearchError("searchInvalid"); return; } // aucune requête
  clearSearchError();
  setTargetDomain(norm);
}

// (Re)câble les boutons d'analyse selon le domaine cible. WHOIS/DNS actifs dès
// qu'il y a un domaine valide ; VirusTotal seulement si une clé est configurée.
async function updateAnalysisButtons() {
  const enabled = isWhoisable(targetDomain);
  wireAction("whois-btn", enabled, () => showWhoisView());
  wireAction("dns-btn", enabled, () => showDnsView());

  const vtBtn = $("vt-btn");
  const vtKey = await getApiKey("virustotal");
  if (vtBtn) {
    if (vtKey) {
      wireAction("vt-btn", enabled, () => showVtView());
    } else {
      vtBtn.hidden = true;
      vtBtn.onclick = null;
    }
  }
}

// ─── Copie au clic sur une rangée ───────────────────────

// Valeurs qui ne doivent jamais être copiées (placeholders / états)
const NOT_COPYABLE = new Set(["", "—", "…"]);

// Copie le texte d'une rangée dans le presse-papier avec retour visuel temporaire.
async function flashCopy(row, valueEl) {
  if (row.dataset.copying) return; // évite les clics multiples pendant l'animation
  const text = valueEl.textContent;
  try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
  row.dataset.copying = "1";
  row.classList.add("copied");
  valueEl.textContent = t("btnCopied"); // affiche « Copié ! » brièvement
  setTimeout(() => {
    // Restaure la valeur d'origine après 1,2 s
    valueEl.textContent = text;
    row.classList.remove("copied");
    delete row.dataset.copying;
  }, 1200);
}

// Active/désactive la copie au clic selon que la valeur est réelle
function setupCopyRows(valueIds) {
  const placeholders = new Set([...NOT_COPYABLE, t("statusUnavailable"), t("statusIpUnavailable")]);
  for (const id of valueIds) {
    const valueEl = $(id);
    if (!valueEl) continue;
    const row = valueEl.closest(".row");
    if (!row) continue;
    const copyable = !placeholders.has(valueEl.textContent.trim());
    row.classList.toggle("row-copyable", copyable);
    row.title = copyable ? t("copyHint") : "";
    row.onclick = copyable ? () => flashCopy(row, valueEl) : null;
  }
}

// ─── Vue principale ─────────────────────────────────────

let activeTabId = null; // pour filtrer les notifications du background
let tabState = null;    // dernier état connu de l'onglet actif (rendu par défaut)

// Charge et affiche l'état de l'onglet actif + l'IP publique de l'utilisateur.
async function loadMain() {
  // Indépendant de l'état d'onglet (et potentiellement un fetch réseau) :
  // on le déclenche tout de suite et on l'attend en fin de fonction.
  const pipPromise = browser.runtime.sendMessage({ type: "REFRESH_PUBLIC_IP" });

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab ? tab.id : null;
  let state = null;
  if (tab) {
    const r = await browser.runtime.sendMessage({ type: "GET_TAB_STATE", tabId: tab.id });
    state = r && r.state;
  }
  tabState = state;

  // Domaine de l'onglet → cible par défaut, initialisée une seule fois.
  tabDomain = isWhoisable(state && state.hostname) ? state.hostname : null;
  if (!targetInit) { targetDomain = tabDomain; targetInit = true; }

  renderTarget();

  // Affiche l'IP publique (ou un message d'erreur si le fetch a échoué)
  const pip = await pipPromise;
  setText("user-ip", pip && pip.ip ? pip.ip : t("statusUnavailable"));
  setText("user-err", pip && pip.error && !pip.ip ? t("statusFetchFailed") : "");

  // Rangées copiables au clic : IP(s) du site, FAI, IP publique
  setupCopyRows(["site-ip", "site-ip6", "site-isp", "user-ip"]);
}

// Peint la vue principale selon le domaine cible : état de l'onglet si la cible
// est l'onglet, sinon résolution/géoloc à la demande du domaine saisi.
function renderTarget() {
  if (isCustomDomain()) {
    renderCustomDomain(targetDomain);
  } else {
    renderMainState(tabState);
  }
}

// Résout et géolocalise un domaine saisi manuellement (via le background), puis
// peint la vue principale. Affiche d'abord un état « résolution en cours ».
async function renderCustomDomain(domain) {
  renderMainState({ hostname: domain, status: "Resolving" });
  let r = null;
  try {
    r = await browser.runtime.sendMessage({ type: "RESOLVE_DOMAIN", domain });
  } catch { /* background indispo */ }
  if (targetDomain !== domain) return; // la cible a changé entre-temps
  if (!r || !r.siteIp) {
    renderMainState({ hostname: domain, status: "NoIp" });
    return;
  }
  renderMainState({
    hostname: domain,
    status: r.info ? "Resolved" : "IpOnly",
    siteIp: r.siteIp, siteIpv4: r.siteIpv4, siteIpv6: r.siteIpv6,
    info: r.info || null,
  });
}

// Peint la vue principale à partir d'un état d'onglet (peut être appelé à
// nouveau via les notifications push du background).
function renderMainState(state) {
  const hostname = state && state.hostname;
  const info = state && state.info;
  const siteIp = state && state.status !== "NonHttp" ? state.siteIp : null;

  // Réinitialise les lignes optionnelles (re-révélées plus bas si pertinent)
  $("ip6-row").hidden = true;
  $("rdns-row").hidden = true;
  $("isp-row").hidden = false;
  $("ip-label").textContent = t("labelIp");
  $("copy-report-btn").hidden = true;

  if (!state || state.status === "NonHttp") {
    // Page interne / sans hôte résoluble
    setText("site-flag", "🌍");
    setText("site-country", t("statusNonHttp"));
    setText("site-loc", "");
    setText("site-ip", "—");
    $("isp-row").hidden = true;
    setTags([]);
  } else if (state.status === "Resolving") {
    // Résolution en cours → placeholders « … »
    setText("site-flag", "⏳");
    setText("site-country", t("statusResolving"));
    setText("site-loc", "");
    setText("site-ip", "…");
    setText("site-isp", "…");
    setTags([]);
  } else {
    // Résolu (avec ou sans géoloc)
    fillIps(state);
    if (info) {
      setText("site-flag", flagFromCC(info.countryCode));
      setText("site-country", info.countryName);
      setText("site-loc", [info.city, info.region].filter(Boolean).join(", "));
      setOptRow("isp-row", "site-isp", info.isp);
      const tags = [];
      // Filtrer les faux positifs CDN : ipapi.is renvoie souvent VPN/Proxy:true
      // pour les IP Cloudflare/Fastly qui sont aussi `is_datacenter`. Quand
      // c'est le cas, on garde uniquement le tag « Datacenter », plus utile.
      const cdnFalsePositive = info.isDatacenter && (info.isVpn || info.isProxy) && !info.isTor;
      if (info.isVpn && !cdnFalsePositive)   tags.push(t("tagVpn"));
      if (info.isProxy && !cdnFalsePositive) tags.push(t("tagProxy"));
      if (info.isTor)        tags.push(t("tagTor"));
      if (info.isDatacenter) tags.push(t("tagDatacenter"));
      if (info.isMobile)     tags.push(t("tagMobile"));
      setTags(tags);
    } else {
      // IP trouvée mais pas de géolocalisation
      setText("site-flag", "🌍");
      setText("site-country", t("statusNoGeo"));
      setText("site-loc", "");
      $("isp-row").hidden = true;
      setTags([]);
    }
  }

  // Enrichissements quand le site est résolu avec une IP : copie du rapport + rDNS
  if (siteIp) {
    const copyBtn = $("copy-report-btn");
    copyBtn.hidden = false;
    copyBtn.onclick = () => copyReport(copyBtn);
    fillRdns(siteIp);
  }

  // Bouton carte selon la géoloc de l'onglet ; boutons d'analyse selon la cible.
  wireAction("map-btn", info && info.lat != null && info.lon != null,
    () => showMapView(info.lat, info.lon));
  updateAnalysisButtons();
  renderTargetUi();

  setupCopyRows(["site-domain", "site-ip", "site-ip6", "site-isp"]);
}

// Push du background : l'état d'onglet a changé → mémoriser et rafraîchir la vue
// racine seulement si la cible n'est pas un domaine saisi manuellement.
browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "TAB_STATE_UPDATED" && msg.tabId === activeTabId) {
    tabState = msg.state;
    tabDomain = isWhoisable(msg.state && msg.state.hostname) ? msg.state.hostname : null;
    if (!targetInit) { targetDomain = tabDomain; targetInit = true; }
    if (!isCustomDomain()) renderMainState(tabState);
  }
});

// ─── Navigation entre vues ──────────────────────────────

// Affiche la vue `id` et masque toutes les autres.
function showView(id) {
  for (const el of document.querySelectorAll("#main-view, #whois-view, #map-view, #vt-view, #dns-view")) {
    el.classList.toggle("hidden", el.id !== id);
  }
}

// Jetons de requête : invalident une recherche en cours si on change de vue
let whoisToken = 0;
let vtToken = 0;
let dnsToken = 0;

// Retour à l'accueil : invalide toute recherche en cours (WHOIS / VirusTotal / DNS)
function goMain() {
  whoisToken++;
  vtToken++;
  dnsToken++;
  showView("main-view");
}

// ─── IP du site (IPv4 / IPv6) ───────────────────────────

// Affiche les IP du site : si les deux familles existent, les sépare
// (IPv4 sur la ligne principale, IPv6 sur une ligne dédiée) ; sinon une seule.
function fillIps(state) {
  const v4 = state && state.siteIpv4;
  const v6 = state && state.siteIpv6;
  if (v4 && v6) {
    $("ip-label").textContent = "IPv4";
    setText("site-ip", v4);
    setText("site-ip6", v6);
    $("ip6-row").hidden = false;
  } else {
    setText("site-ip", (state && state.siteIp) || t("statusIpUnavailable"));
  }
}

// ─── DNS-over-HTTPS (Cloudflare) ────────────────────────

const DOH_URL = "https://cloudflare-dns.com/dns-query";
const DOH_TIMEOUT_MS = 8000;

// Interroge un enregistrement DNS (`name`/`type`) via DoH et renvoie le JSON.
async function dohQuery(name, type) {
  const url = `${DOH_URL}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
  const res = await fetch(url, {
    headers: { accept: "application/dns-json" }, // format JSON DNS de Cloudflare
    signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error("doh-" + res.status);
  return res.json();
}

// ─── Reverse DNS (PTR) ──────────────────────────────────

// Développe une IPv6 abrégée (avec « :: ») en 32 chiffres hex sans séparateur.
// Renvoie null si l'adresse est malformée.
function expandIpv6(ip) {
  let h = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (h.includes("::")) {
    // « :: » représente une suite de groupes nuls → on la reconstitue
    const [head, tail] = h.split("::");
    const hp = head ? head.split(":") : [];
    const tp = tail ? tail.split(":") : [];
    const missing = 8 - hp.length - tp.length;
    if (missing < 0) return null;
    h = [...hp, ...Array(missing).fill("0"), ...tp].join(":");
  }
  const parts = h.split(":");
  if (parts.length !== 8) return null;
  return parts.map((p) => p.padStart(4, "0")).join(""); // chaque groupe sur 4 chiffres
}

// Construit le nom de requête PTR (reverse DNS) pour une IPv4 ou IPv6.
function reverseName(ip) {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    // IPv4 : octets inversés + .in-addr.arpa
    return ip.split(".").reverse().join(".") + ".in-addr.arpa";
  }
  if (ip.includes(":")) {
    // IPv6 : chiffres hex inversés + .ip6.arpa
    const nib = expandIpv6(ip);
    return nib ? nib.split("").reverse().join(".") + ".ip6.arpa" : null;
  }
  return null;
}

// Résout le reverse DNS (PTR) d'une IP et affiche la ligne si un nom existe.
async function fillRdns(ip) {
  const name = reverseName(ip);
  if (!name) return;
  let ptr = null;
  try {
    const data = await dohQuery(name, "PTR");
    const rec = ((data && data.Answer) || []).find((a) => a.type === 12 && a.data); // 12 = PTR
    if (rec) ptr = rec.data.replace(/\.$/, ""); // retire le point final
  } catch { /* pas de rDNS → ligne laissée masquée */ }
  if (!ptr) return;
  setText("site-rdns", ptr);
  $("rdns-row").hidden = false;
  setupCopyRows(["site-rdns"]);
}

// ─── Copier le rapport ──────────────────────────────────

// Construit une ligne « label : valeur », ou null si la valeur est un placeholder.
function reportLine(label, valueId) {
  const el = $(valueId);
  if (!el) return null;
  const v = el.textContent.trim();
  if (!v || NOT_COPYABLE.has(v)) return null;
  return `${label} : ${v}`;
}

// Assemble un rapport texte multi-lignes résumant les infos affichées.
function buildReport() {
  const country = $("site-country").textContent.trim();
  const loc = $("site-loc").textContent.trim();
  const lines = [loc ? `${country} — ${loc}` : country]; // en-tête pays/localité
  const push = (l) => { if (l) lines.push(l); }; // n'ajoute que les lignes non nulles
  push(reportLine($("ip-label").textContent.trim(), "site-ip"));
  if (!$("ip6-row").hidden) push(reportLine("IPv6", "site-ip6"));
  if (!$("rdns-row").hidden) push(reportLine(t("labelRdns"), "site-rdns"));
  push(reportLine(t("labelIsp"), "site-isp"));
  const tags = [...$("site-tags").querySelectorAll(".tag")].map((e) => e.textContent.trim());
  if (tags.length) push(`Tags : ${tags.join(", ")}`);
  push(reportLine(t("sectionMyIp"), "user-ip"));
  return lines.join("\n");
}

// Copie le rapport dans le presse-papier avec retour visuel sur le bouton.
async function copyReport(btn) {
  try { await navigator.clipboard.writeText(buildReport()); } catch { /* ignore */ }
  btn.classList.add("copied");
  const prev = btn.title;
  btn.title = t("btnCopied");
  setTimeout(() => { btn.classList.remove("copied"); btn.title = prev; }, 1200);
}

// ─── Vue DNS (enregistrements via DoH) ──────────────────

// Types d'enregistrements interrogés (clé textuelle + code numérique DNS)
const DNS_TYPES = [
  { key: "A", num: 1 },
  { key: "AAAA", num: 28 },
  { key: "MX", num: 15 },
  { key: "NS", num: 2 },
  { key: "TXT", num: 16 },
];

// URL d'un service web tiers présentant les enregistrements DNS d'un domaine.
function dnsGuiUrl(host) {
  return `https://www.nslookup.io/domains/${encodeURIComponent(host)}/dns-records/`;
}

// Ouvre la vue DNS et interroge en parallèle tous les types d'enregistrements
// pour le domaine cible (lu dans l'état partagé au moment de l'affichage).
async function showDnsView() {
  const host = targetDomain;
  const token = ++dnsToken; // jeton pour annuler si l'utilisateur quitte la vue
  showView("dns-view");
  setText("dns-domain", host || "");
  $("dns-open-btn").onclick = host ? () => openTab(dnsGuiUrl(host)) : null;
  if (!host) { renderStatus(t("searchEmpty"), "empty", "dns-body"); return; } // pas de domaine

  renderStatus(t("dnsLoading"), "loading", "dns-body");
  let results;
  try {
    // Une requête DoH par type ; chaque échec isolé renvoie data: null
    results = await Promise.all(DNS_TYPES.map((rt) =>
      dohQuery(host, rt.key).then((data) => ({ rt, data })).catch(() => ({ rt, data: null }))));
  } catch {
    if (token === dnsToken) renderStatus(t("dnsError"), "error", "dns-body");
    return;
  }
  if (token !== dnsToken) return; // l'utilisateur a quitté la vue
  renderDns(results);
}

// Construit l'affichage des enregistrements DNS regroupés par type.
function renderDns(results) {
  const card = document.createElement("div");
  card.className = "whois-card";
  let any = false;
  for (const { rt, data } of results) {
    // Filtre les réponses du bon type, nettoie les guillemets et le point final
    const recs = ((data && data.Answer) || [])
      .filter((a) => a.type === rt.num && a.data)
      .map((a) => a.data.replace(/^"|"$/g, "").replace(/\.$/, ""));
    if (!recs.length) continue;
    any = true;
    const sec = makeSectionText(card, rt.key);
    for (const r of recs) addLine(sec, r, "whois-item mono");
  }
  if (!any) { renderStatus(t("dnsEmpty"), "empty", "dns-body"); return; } // aucun enregistrement
  $("dns-body").replaceChildren(card);
}

// ─── Vue carte (tuiles statiques, sans Leaflet) ─────────

const TILE = 256;                                 // taille d'une tuile OSM en px
const MAP_ZOOM_MIN = 2, MAP_ZOOM_MAX = 19;        // bornes de zoom autorisées
let mapState = null; // { lat, lon, zoom }

// URL OpenStreetMap centrée sur un point, avec marqueur.
function osmFullUrl(lat, lon, zoom = 11) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;
}

// Projection Web Mercator → coordonnées de tuile (fractionnaires)
function lonToTileX(lon, z) {
  return ((lon + 180) / 360) * Math.pow(2, z);
}
function latToTileY(lat, z) {
  const r = (lat * Math.PI) / 180; // latitude en radians
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z);
}

// (Re)dessine la grille de tuiles centrée sur le marqueur
function renderMap() {
  const { lat, lon, zoom } = mapState;
  const canvas = $("map-canvas");
  for (const el of canvas.querySelectorAll(".map-tile")) el.remove(); // efface l'ancienne grille

  // Dimensions réelles du cadre (suivent le CSS, pas de valeurs codées en dur)
  const W = canvas.clientWidth || 312;
  const H = canvas.clientHeight || 240;

  const n = 2 ** zoom; // nombre de tuiles par côté à ce niveau de zoom
  const originX = lonToTileX(lon, zoom) * TILE - W / 2; // px global au bord gauche
  const originY = latToTileY(lat, zoom) * TILE - H / 2;

  // Indices de tuiles couvrant le cadre visible
  const i0 = Math.floor(originX / TILE), i1 = Math.floor((originX + W) / TILE);
  const j0 = Math.floor(originY / TILE), j1 = Math.floor((originY + H) / TILE);

  const frag = document.createDocumentFragment();
  for (let j = j0; j <= j1; j++) {
    if (j < 0 || j >= n) continue; // pas de tuile hors latitude
    for (let i = i0; i <= i1; i++) {
      const xi = ((i % n) + n) % n; // enroulement horizontal (longitude cyclique)
      const img = document.createElement("img");
      img.className = "map-tile";
      img.alt = "";
      img.loading = "eager";
      img.src = `https://tile.openstreetmap.org/${zoom}/${xi}/${j}.png`;
      // Position absolue de la tuile relative au bord du cadre
      img.style.left = `${i * TILE - originX}px`;
      img.style.top = `${j * TILE - originY}px`;
      img.onerror = () => img.remove(); // tuile manquante → on l'enlève
      frag.appendChild(img);
    }
  }
  canvas.insertBefore(frag, canvas.firstChild); // tuiles sous le marqueur / zoom
}

// Modifie le zoom (borné) et redessine si le niveau a changé.
function setMapZoom(delta) {
  const z = Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, mapState.zoom + delta));
  if (z !== mapState.zoom) { mapState.zoom = z; renderMap(); }
}

// Ouvre la vue carte centrée sur (lat, lon) et câble les boutons.
function showMapView(lat, lon) {
  showView("map-view");
  setText("map-domain", targetDomain || ""); // domaine analysé (sous le titre)
  mapState = { lat, lon, zoom: 11 };
  renderMap();
  $("map-open-btn").onclick = () => openTab(osmFullUrl(lat, lon, mapState.zoom));
  $("map-zoom-in").onclick = () => setMapZoom(+1);
  $("map-zoom-out").onclick = () => setMapZoom(-1);
}

// ─── Vue VirusTotal ─────────────────────────────────────

const VT_TIMEOUT_MS = 9000;

// URL de la fiche VirusTotal d'un domaine (interface web).
function vtGuiUrl(domain) {
  return `https://www.virustotal.com/gui/domain/${encodeURIComponent(domain)}`;
}

// Interroge l'API VirusTotal pour un domaine. Renvoie { data } ou { error: <clé i18n> }.
async function fetchVtDomain(domain, key) {
  try {
    const res = await fetch(
      `https://www.virustotal.com/api/v3/domains/${encodeURIComponent(domain)}`,
      { headers: { "x-apikey": key }, signal: AbortSignal.timeout(VT_TIMEOUT_MS) },
    );
    if (res.status === 401) return { error: "vtErrAuth" };      // clé invalide
    if (res.status === 429) return { error: "vtErrQuota" };     // quota dépassé
    if (res.status === 404) return { error: "vtErrNotFound" };  // domaine inconnu
    if (!res.ok) return { error: "vtError" };
    return { data: await res.json() };
  } catch (e) {
    if (e && e.name === "TimeoutError") return { error: "vtErrTimeout" };
    return { error: "vtError" };
  }
}

// Ouvre la vue VirusTotal et y affiche l'analyse du domaine cible.
async function showVtView() {
  const domain = targetDomain;
  const token = ++vtToken; // jeton d'annulation si on quitte la vue
  showView("vt-view");
  setText("vt-domain", domain || "");
  $("vt-open-btn").onclick = domain ? () => openTab(vtGuiUrl(domain)) : null;
  if (!domain) { renderStatus(t("searchEmpty"), "empty", "vt-body"); return; } // pas de domaine

  const key = await getApiKey("virustotal");
  if (token !== vtToken) return;
  if (!key) { renderStatus(t("vtErrAuth"), "error", "vt-body"); return; } // clé retirée entre-temps

  renderStatus(t("vtLoading"), "loading", "vt-body");
  const result = await fetchVtDomain(domain, key);
  if (token !== vtToken) return; // l'utilisateur a quitté la vue

  if (result.error) {
    renderStatus(t(result.error), "error", "vt-body");
    return;
  }
  renderVt(result.data);
}

// Ajoute une ligne « label : valeur » colorée (level) dans une section VT.
function addVtStat(section, labelKey, value, level) {
  const row = document.createElement("div");
  row.className = "whois-row";
  const l = document.createElement("span");
  l.className = "whois-row-label";
  l.textContent = t(labelKey);
  const v = document.createElement("span");
  v.className = "whois-row-value vt-stat-val " + level;
  v.textContent = String(value);
  row.append(l, v);
  section.appendChild(row);
}

// Construit l'affichage du rapport VirusTotal : score global + détail des votes.
function renderVt(json) {
  const attr = (json && json.data && json.data.attributes) || {};
  const s = attr.last_analysis_stats || {};
  // Décompte des verdicts des moteurs d'analyse
  const malicious  = s.malicious  || 0;
  const suspicious = s.suspicious || 0;
  const harmless   = s.harmless   || 0;
  const undetected = s.undetected || 0;
  const total = malicious + suspicious + harmless + undetected + (s.timeout || 0);
  const flagged = malicious + suspicious; // moteurs ayant signalé l'IP

  const body = $("vt-body");
  body.replaceChildren();

  // Bloc note : nombre de moteurs ayant signalé l'IP
  const score = document.createElement("div");
  // Couleur : rouge si malveillant, orange si suspect, vert sinon
  score.className = "vt-score " + (malicious ? "is-bad" : suspicious ? "is-warn" : "is-good");
  const num = document.createElement("div");
  num.className = "vt-score-num";
  num.textContent = `${flagged} / ${total}`;
  const cap = document.createElement("div");
  cap.className = "vt-score-cap";
  cap.textContent = flagged ? t("vtFlagged") : t("vtClean");
  score.append(num, cap);
  body.appendChild(score);

  // Détail des votes
  const card = document.createElement("div");
  card.className = "whois-card";
  const sec = makeSection(card, "vtDetections");
  addVtStat(sec, "vtLabelMalicious",  malicious,  "bad");
  addVtStat(sec, "vtLabelSuspicious", suspicious, "warn");
  addVtStat(sec, "vtLabelHarmless",   harmless,   "good");
  addVtStat(sec, "vtLabelUndetected", undetected, "dim");
  // Réputation communautaire (score signé) si présente
  if (typeof attr.reputation === "number") {
    const s2 = makeSection(card, "vtReputation");
    addLine(s2, String(attr.reputation), "whois-text");
  }
  body.appendChild(card);
}

// URL de la fiche WHOIS d'un domaine (interface web).
function whoisGuiUrl(hostname) {
  return `https://www.whois.com/whois/${encodeURIComponent(hostname)}`;
}

// Ouvre la vue WHOIS et y affiche les données RDAP du domaine cible.
async function showWhoisView() {
  const hostname = targetDomain;
  const token = ++whoisToken; // jeton d'annulation
  showView("whois-view");
  setText("whois-domain", hostname || "");
  $("whois-open-btn").onclick = hostname ? () => openTab(whoisGuiUrl(hostname)) : null;
  if (!hostname) { renderStatus(t("searchEmpty"), "empty"); return; } // pas de domaine

  // Callback de progression : met à jour le statut tant que le jeton est valide
  const onStep = (msg) => { if (token === whoisToken) renderStatus(msg, "loading"); };
  onStep(t("whoisResolving"));

  const result = await fetchRdap(hostname, onStep);
  if (token !== whoisToken) return; // l'utilisateur a quitté la vue

  if (result.error) {
    renderStatus(t(result.error), "error");
    return;
  }
  renderWhois(parseRdap(result.data));
}

// ─── RDAP ───────────────────────────────────────────────

const RDAP_TIMEOUT_MS = 9000;
const BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json"; // table TLD → serveur RDAP
const BOOTSTRAP_TTL_MS = 7 * 24 * 3600 * 1000;               // cache de 7 jours

let bootstrapMap = null; // tld -> base RDAP url (sans / final)

// Charge la table de routage RDAP de l'IANA (cache mémoire → storage → réseau).
async function loadBootstrap() {
  if (bootstrapMap) return bootstrapMap; // déjà en mémoire
  try {
    const { rdapBootstrap } = await browser.storage.local.get("rdapBootstrap");
    if (rdapBootstrap && Date.now() - rdapBootstrap.at < BOOTSTRAP_TTL_MS) {
      return (bootstrapMap = rdapBootstrap.map); // cache storage encore frais
    }
  } catch { /* storage indispo */ }
  try {
    const res = await fetch(BOOTSTRAP_URL, { signal: AbortSignal.timeout(RDAP_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = await res.json();
    // Construit la table tld → URL de base RDAP (en préférant https)
    const map = {};
    for (const [tlds, urls] of data.services || []) {
      const base = (urls || []).find((u) => u.startsWith("https://")) || (urls || [])[0];
      if (!base) continue;
      for (const tld of tlds) map[tld.toLowerCase()] = base.replace(/\/+$/, "");
    }
    bootstrapMap = map;
    try { await browser.storage.local.set({ rdapBootstrap: { map, at: Date.now() } }); } catch {}
    return map;
  } catch {
    return null;
  }
}

// Interroge le RDAP pour un domaine. Renvoie { domain, data } ou { error: <clé i18n> }.
async function fetchRdap(hostname, onStep) {
  const labels = hostname.toLowerCase().split(".");
  const tld = labels[labels.length - 1];

  onStep(t("whoisResolving"));
  const map = await loadBootstrap();
  const authBase = map && map[tld]; // serveur RDAP faisant autorité pour ce TLD
  let sawTimeout = false;

  // Remonte progressivement vers le domaine apex :
  // www.blog.example.com → blog.example.com → example.com
  for (let i = 0; i <= labels.length - 2; i++) {
    const domain = labels.slice(i).join(".");
    // Sources tentées : serveur faisant autorité, puis le relais rdap.org
    const urls = [];
    if (authBase) urls.push({ url: `${authBase}/domain/${encodeURIComponent(domain)}`, auth: true });
    urls.push({ url: `https://rdap.org/domain/${encodeURIComponent(domain)}`, auth: false });

    for (const { url, auth } of urls) {
      onStep(auth ? t("whoisQuerying") : t("whoisFallback"));
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(RDAP_TIMEOUT_MS) });
        if (res.ok) return { domain, data: await res.json() };
        if (res.status === 404) break; // domaine introuvable à ce niveau → essayer plus court
        // autre code (429, 5xx) → tenter la source suivante
      } catch (e) {
        if (e && e.name === "TimeoutError") sawTimeout = true;
        // réseau / timeout → tenter la source suivante
      }
    }
  }

  // Aucun résultat : on distingue timeout / TLD non supporté / erreur générique
  if (sawTimeout) return { error: "whoisErrTimeout" };
  if (!authBase) return { error: "whoisErrUnsupported" };
  return { error: "whoisError" };
}

// Extrait nom / organisation / pays d'un vCard d'entité RDAP.
function extractVcard(entity) {
  const vcard = entity && entity.vcardArray;
  if (!Array.isArray(vcard) || vcard[0] !== "vcard") return {};
  const out = {};
  // Chaque propriété vCard est un tableau [nom, params, type, valeur]
  for (const [prop, , , val] of vcard[1] || []) {
    if (prop === "fn")  out.name = val;
    if (prop === "org") out.org = Array.isArray(val) ? val[0] : val;
    if (prop === "adr" && Array.isArray(val)) out.country = val[6] || null; // index 6 = pays
  }
  return out;
}

// Transforme la réponse RDAP brute en objet synthétique pour l'affichage.
function parseRdap(data) {
  // Indexe les dates d'événements par type d'action
  const events = {};
  for (const e of data.events || []) {
    if (e.eventAction && e.eventDate) events[e.eventAction] = e.eventDate;
  }

  // Cherche le registrar et le titulaire parmi les entités
  let registrar = null;
  let registrant = null;
  for (const entity of data.entities || []) {
    const roles = entity.roles || [];
    const vc = extractVcard(entity);
    if (roles.includes("registrar") && !registrar) registrar = vc.name || vc.org || null;
    if (roles.includes("registrant") && !registrant) {
      registrant = [...new Set([vc.name, vc.org, vc.country].filter(Boolean))]; // dédoublonné
    }
  }

  return {
    registrar,
    registrant: registrant && registrant.length ? registrant : null,
    created: events["registration"] || null,
    expires: events["expiration"] || null,
    updated: events["last changed"] || null,
    nameservers: (data.nameservers || [])
      .map((ns) => (ns.ldhName ? ns.ldhName.toLowerCase() : null))
      .filter(Boolean),
    status: Array.isArray(data.status) ? data.status : [],
  };
}

// ─── Rendu WHOIS ────────────────────────────────────────

// Formate une date ISO selon la langue de l'UI (ex. « 5 janv. 2024 »).
function fmtDate(iso) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat(browser.i18n.getUILanguage(), {
      year: "numeric", month: "short", day: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10); // repli : on garde juste AAAA-MM-JJ
  }
}

// Affiche un état (chargement / erreur / vide) dans le corps d'une vue.
// kind: "loading" | "error" | "empty"
function renderStatus(message, kind, bodyId = "whois-body") {
  const body = $(bodyId);
  const wrap = document.createElement("div");
  wrap.className = "whois-status" + (kind === "error" ? " is-error" : "");
  if (kind === "loading") {
    const spinner = document.createElement("div");
    spinner.className = "whois-spinner";
    wrap.appendChild(spinner);
  }
  const label = document.createElement("div");
  label.textContent = message;
  wrap.appendChild(label);
  body.replaceChildren(wrap);
}

// Section dont le titre est un texte brut (types DNS, etc.)
function makeSectionText(card, titleText) {
  const section = document.createElement("div");
  section.className = "whois-section";
  const title = document.createElement("div");
  title.className = "whois-section-title";
  title.textContent = titleText;
  section.appendChild(title);
  card.appendChild(section);
  return section;
}

// Variante dont le titre est une clé i18n.
function makeSection(card, titleKey) {
  return makeSectionText(card, t(titleKey));
}

// Âge relatif d'une date ISO (« il y a 5 jours / 3 mois / 7 ans »)
function relAge(iso) {
  try {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days < 0) return null; // date dans le futur → ignorée
    const rtf = new Intl.RelativeTimeFormat(browser.i18n.getUILanguage(), { numeric: "auto" });
    // Choisit l'unité selon l'ancienneté
    if (days < 60) return rtf.format(-days, "day");
    if (days < 730) return rtf.format(-Math.floor(days / 30), "month");
    return rtf.format(-Math.floor(days / 365), "year");
  } catch {
    return null;
  }
}

// Domaine enregistré il y a moins de 30 jours (signal anti-phishing)
function isRecentDomain(iso) {
  try {
    return Date.now() - new Date(iso).getTime() < 30 * 86400000;
  } catch {
    return false;
  }
}

// Ajoute une ligne « label : valeur » dans une section (ignorée si valeur vide).
function addKV(section, labelKey, value) {
  if (!value) return;
  const row = document.createElement("div");
  row.className = "whois-row";
  const l = document.createElement("span");
  l.className = "whois-row-label";
  l.textContent = t(labelKey);
  const v = document.createElement("span");
  v.className = "whois-row-value";
  v.textContent = value;
  row.append(l, v);
  section.appendChild(row);
}

// Ajoute une simple ligne de texte (classe CSS au choix) dans une section.
function addLine(section, text, cls) {
  const el = document.createElement("div");
  el.className = cls;
  el.textContent = text;
  section.appendChild(el);
}

// Construit l'affichage WHOIS complet à partir des données RDAP parsées.
function renderWhois(d) {
  const card = document.createElement("div");
  card.className = "whois-card";

  // Registrar (bureau d'enregistrement)
  if (d.registrar) {
    const s = makeSection(card, "whoisRegistrar");
    addLine(s, d.registrar, "whois-text");
  }

  // Dates clés + âge + éventuelle pastille « domaine récent »
  if (d.created || d.expires || d.updated) {
    const s = makeSection(card, "whoisDates");
    addKV(s, "whoisLabelCreated", fmtDate(d.created));
    if (d.created) addKV(s, "whoisLabelAge", relAge(d.created));
    addKV(s, "whoisLabelExpires", fmtDate(d.expires));
    addKV(s, "whoisLabelUpdated", fmtDate(d.updated));
    if (d.created && isRecentDomain(d.created)) {
      const chip = document.createElement("span");
      chip.className = "whois-newchip";
      chip.textContent = t("whoisNewDomain");
      s.appendChild(chip);
    }
  }

  // Serveurs de noms
  if (d.nameservers.length) {
    const s = makeSection(card, "whoisNameservers");
    for (const ns of d.nameservers) addLine(s, ns, "whois-item mono");
  }

  // Codes de statut EPP du domaine
  if (d.status.length) {
    const s = makeSection(card, "whoisStatus");
    for (const st of d.status) addLine(s, st, "whois-item");
  }

  // Titulaire (nom / organisation / pays)
  if (d.registrant) {
    const s = makeSection(card, "whoisRegistrant");
    for (const line of d.registrant) addLine(s, line, "whois-text");
  }

  if (!card.children.length) {
    renderStatus(t("whoisEmpty"), "empty"); // aucune donnée exploitable
    return;
  }
  $("whois-body").replaceChildren(card);
}

// ─── Init ───────────────────────────────────────────────

// Initialisation : i18n, boutons retour, recherche de domaine, options, chargement.
document.addEventListener("DOMContentLoaded", () => {
  applyI18n();
  for (const btn of document.querySelectorAll("[data-back]")) btn.onclick = goMain;
  $("settings-btn").onclick = openOptions;

  // Recherche manuelle de domaine (vue racine)
  const form = $("domain-search-form");
  if (form) form.addEventListener("submit", (e) => { e.preventDefault(); submitSearch(); });
  const input = $("domain-search");
  if (input) input.addEventListener("input", clearSearchError); // restaure le placeholder à la frappe
  const resetBtn = $("domain-reset");
  if (resetBtn) resetBtn.onclick = () => { clearSearchError(); setTargetDomain(tabDomain); };

  loadMain();
});

// Touche Échap : revenir à l'accueil depuis une sous-vue, sinon fermer le popup.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  // Dans une sous-vue → revenir à l'accueil ; sinon fermer le popup.
  if ($("main-view").classList.contains("hidden")) {
    goMain();
  } else {
    window.close();
  }
});
