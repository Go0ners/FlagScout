# FlagScout - Politique de confidentialité / Privacy Policy

_Dernière mise à jour : 2026-06-16 · Last updated: 2026-06-16_

---

## Français

**FlagScout ne collecte, ne stocke et ne transmet aucune donnée personnelle à son développeur.** Aucun pistage, aucune publicité, aucune analyse d'audience.

### Données traitées localement
Pour fonctionner, l'extension conserve **uniquement sur votre appareil** (via `storage.local` du navigateur) :
- un **cache de géolocalisation** des adresses IP (expire après 24 h) ;
- votre **dernière IP publique** connue ;
- les **clés API** que vous saisissez vous-même (VirusTotal, ipapi.is).

Ces informations ne quittent jamais votre navigateur et ne sont jamais envoyées au développeur.

### Services tiers contactés
Pour afficher ses informations, FlagScout interroge des services tiers. Selon l'action, l'**adresse IP ou le nom de domaine du site que vous visitez (ou que vous recherchez manuellement dans le popup)** peut leur être transmis :

| Service | Donnée envoyée | Quand |
|---|---|---|
| api.ipapi.is | IP du site | géolocalisation (automatique) |
| checkip.amazonaws.com | — | récupération de votre IP publique |
| flagcdn.com | code pays | image du drapeau |
| RDAP (rdap.org, IANA, registres) | nom de domaine | bouton WHOIS |
| cloudflare-dns.com | IP / domaine du site | reverse DNS, bouton DNS, et résolution du domaine (sous Chrome) |
| tile.openstreetmap.org | coordonnées | bouton Carte |
| virustotal.com | nom de domaine | bouton VirusTotal (seulement si vous avez configuré une clé) |
| nslookup.io | nom de domaine | seulement si vous cliquez « ouvrir dans un onglet » depuis la vue DNS |

Chacun de ces services applique sa propre politique de confidentialité. FlagScout ne leur transmet aucune donnée d'identité vous concernant — seulement l'IP/le domaine nécessaire à la requête.

### Vos clés API
Les clés API sont stockées **en clair localement** sur votre appareil et ne servent qu'à interroger le service correspondant (VirusTotal, ipapi.is). Vous pouvez les supprimer à tout moment dans la page d'options.

### Contact
Pour toute question : **flagscout@gnrs.ca**

---

## English

**FlagScout does not collect, store, or transmit any personal data to its developer.** No tracking, no ads, no analytics.

### Data processed locally
To work, the extension keeps **only on your device** (via the browser's `storage.local`):
- a **geolocation cache** of IP addresses (expires after 24 h);
- your **last known public IP**;
- the **API keys** you enter yourself (VirusTotal, ipapi.is).

This information never leaves your browser and is never sent to the developer.

### Third-party services contacted
To display its information, FlagScout queries third-party services. Depending on the action, the **IP address or domain name of the site you are visiting (or that you manually search in the popup)** may be sent to them:

| Service                                                                                                         | Data sent | When |
|-----------------------------------------------------------------------------------------------------------------|---|---|
| api.ipapi.is                                                                                                    | site IP | geolocation (automatic) |
| checkip.amazonaws.com                                                                                           | — | fetching your public IP |
| flagcdn.com                                                                                                     | country code | flag image |
| RDAP (rdap.org, IANA, registries)                                                                               | domain name | WHOIS button |
| cloudflare-dns.com                                                                                              | site IP / domain | reverse DNS, DNS button, and domain resolution (on Chrome) |
| tile.openstreetmap.org                                                                                          | coordinates | Map button |
| virustotal.com                                                                                                  | domain name | VirusTotal button (only if you configured a key) |
| nslookup.io                                                                                                     | domain name | only if you click "open in a tab" from the DNS view |

Each service applies its own privacy policy. FlagScout sends them no identifying data about you — only the IP/domain required for the request.

### Your API keys
API keys are stored **locally in plain text** on your device and are used only to query the matching service (VirusTotal, ipapi.is). You can delete them at any time from the options page.

### Contact
Questions: **flagscout@gnrs.ca**
