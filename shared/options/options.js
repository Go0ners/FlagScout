// FlagScout — page d'options : saisie et test des clés API (VirusTotal, ipapi.is)

const t = (key) => browser.i18n.getMessage(key) || key; // raccourci i18n (texte localisé)
const $ = (id) => document.getElementById(id);           // raccourci getElementById
const TEST_TIMEOUT_MS = 9000;                            // délai max d'un test de clé

// Construit un <svg class="ic"><use href="#id"/></svg> (sans innerHTML).
// Évite innerHTML pour rester conforme aux règles CSP de l'extension.
const SVG_NS = "http://www.w3.org/2000/svg";
function svgIcon(symbolId) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "ic");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", "#" + symbolId);
  svg.appendChild(use);
  return svg;
}

// Ajoute un bouton « œil » qui affiche/masque la valeur de chaque champ clé.
function setupReveal() {
  for (const input of document.querySelectorAll(".field-input > input")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-eye";
    const icon = svgIcon("ic-eye-off");
    btn.appendChild(icon);
    btn.setAttribute("aria-label", t("optReveal"));
    btn.addEventListener("click", () => {
      // Bascule entre type password (masqué) et text (révélé) + icône/aria
      const reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      icon.firstChild.setAttribute("href", reveal ? "#ic-eye" : "#ic-eye-off");
      btn.setAttribute("aria-label", reveal ? t("optHide") : t("optReveal"));
    });
    input.after(btn); // place le bouton juste après le champ
  }
}

// Traduit tous les éléments porteurs d'un attribut data-i18n et fixe la langue.
function applyI18n() {
  document.documentElement.lang = browser.i18n.getUILanguage();
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const msg = t(el.dataset.i18n);
    if (msg) el.textContent = msg;
  }
}

// Charge les clés enregistrées et les place dans les champs du formulaire.
async function load() {
  try {
    const { apiKeys } = await browser.storage.local.get("apiKeys");
    const k = apiKeys || {};
    $("vt-key").value = k.virustotal || "";
    $("ipapi-key").value = k.ipapi || "";
  } catch { /* storage indispo */ }
}

// Champs de clés : service ↔ ids du champ et de son statut
const FIELDS = [
  { service: "virustotal", input: "vt-key",    status: "vt-status" },
  { service: "ipapi",      input: "ipapi-key", status: "ipapi-status" },
];

// Met à jour l'élément de statut d'un champ (classe CSS + texte).
function setStatus(el, kind, text) {
  el.className = "test-status" + (kind ? " " + kind : "");
  el.textContent = text || "";
}

// À l'enregistrement : on teste chaque clé non vide et on n'enregistre que les
// valides (check individuel). Une clé invalide affiche une erreur et n'est pas
// sauvegardée ; une clé vide est retirée.
async function save(e) {
  e.preventDefault(); // empêche le rechargement de page du <form>

  // Récupère les clés déjà enregistrées (pour le cas « réseau KO » plus bas)
  let stored = {};
  try { ({ apiKeys: stored = {} } = await browser.storage.local.get("apiKeys")); } catch {}

  // Désactive le bouton d'envoi pendant les tests réseau
  const submit = (e.submitter) || $("keys-form").querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;

  const newKeys = {};
  let hadError = false;

  for (const f of FIELDS) {
    const val = $(f.input).value.trim();
    const status = $(f.status);
    if (!val) { setStatus(status, ""); continue; } // vide → clé retirée

    setStatus(status, "is-pending", t("optTesting"));
    const r = await TESTERS[f.service](val); // teste la clé via son API

    if (r === "ok") {
      newKeys[f.service] = val;
      setStatus(status, "is-ok", t("optTestOk"));
    } else if (r === "err" && val === (stored[f.service] || "")) {
      // Clé inchangée + réseau indisponible → on préserve l'existant
      newKeys[f.service] = val;
      setStatus(status, "is-ko", t("optTestErr"));
    } else {
      // Clé refusée (ko) ou nouvelle clé non vérifiable (err) → non enregistrée
      hadError = true;
      setStatus(status, "is-ko", r === "err" ? t("optTestErr") : t("optTestKo"));
    }
  }

  try { await browser.storage.local.set({ apiKeys: newKeys }); } catch { /* storage indispo */ }

  if (submit) submit.disabled = false;

  // Message de confirmation, effacé après ~3 s
  const msg = $("saved-msg");
  msg.classList.toggle("is-error", hadError);
  msg.textContent = hadError ? t("optSaveErrors") : t("optSaved");
  setTimeout(() => { msg.textContent = ""; msg.classList.remove("is-error"); }, 3200);
}

// ─── Test des clés ──────────────────────────────────────
// Renvoie "ok" | "ko" | "empty" | "err"
//   ok    = clé valide
//   ko    = clé refusée par l'API
//   empty = champ vide
//   err   = réseau/timeout (impossible de vérifier)

// Teste une clé VirusTotal via une requête sur une IP connue.
async function testVirusTotal(key) {
  if (!key) return "empty";
  try {
    const res = await fetch("https://www.virustotal.com/api/v3/ip_addresses/8.8.8.8", {
      headers: { "x-apikey": key },
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    if (res.status === 401) return "ko";              // clé invalide
    if (res.ok || res.status === 429) return "ok";    // 429 = clé valide mais quota atteint
    return "err";
  } catch {
    return "err";
  }
}

// Teste une clé ipapi.is via une requête sur une IP connue.
async function testIpapi(key) {
  if (!key) return "empty";
  try {
    const res = await fetch(`https://api.ipapi.is/?q=8.8.8.8&key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) return "ko"; // clé refusée
    if (!res.ok) return "err";
    const j = await res.json();
    if (j && j.error) return "ko";       // erreur applicative (clé invalide)
    if (j && j.location) return "ok";    // réponse exploitable
    return "err";
  } catch {
    return "err";
  }
}

// Table service → fonction de test correspondante
const TESTERS = { virustotal: testVirusTotal, ipapi: testIpapi };

// Handler du bouton « Tester » : lance le test du service ciblé et affiche le résultat.
async function onTest(e) {
  const btn = e.currentTarget;
  const input = $(btn.dataset.target);
  const status = $(btn.dataset.status);
  const tester = TESTERS[btn.dataset.service];
  if (!input || !status || !tester) return;

  btn.disabled = true;
  setStatus(status, "is-pending", t("optTesting"));

  const result = await tester(input.value.trim());

  // Traduit le code de retour en classe CSS + message localisé
  setStatus(
    status,
    result === "ok" ? "is-ok" : result === "empty" ? "" : "is-ko",
    result === "ok"    ? t("optTestOk")
    : result === "ko"    ? t("optTestKo")
    : result === "empty" ? t("optTestEmpty")
    :                      t("optTestErr"),
  );
  btn.disabled = false;
}

// Remplit la section « À propos » : version du manifeste et année courante.
function fillAbout() {
  try { $("about-version").textContent = browser.runtime.getManifest().version; } catch {}
  $("about-year").textContent = String(new Date().getFullYear());
}

// Initialisation : i18n, à-propos, champs, chargement des clés, listeners.
document.addEventListener("DOMContentLoaded", () => {
  applyI18n();
  fillAbout();
  setupReveal();
  load();
  $("keys-form").addEventListener("submit", save);
  for (const btn of document.querySelectorAll(".btn-test")) {
    btn.addEventListener("click", onTest);
  }
});
