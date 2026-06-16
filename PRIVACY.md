# FlagScout - Privacy Policy

_Last updated: 2026-06-16_

---

**FlagScout does not collect, store, or transmit any personal data to its developer.** No tracking, no ads, no analytics.

### Data processed locally
To work, the extension keeps **only on your device** (via the browser's `storage.local`):
- a **geolocation cache** of IP addresses (expires after 24 h);
- your **last known public IP**;
- the **API keys** you enter yourself (VirusTotal, ipapi.is).

This information never leaves your browser and is never sent to the developer.

### Third-party services contacted
To display its information, FlagScout queries third-party services. Depending on the action, the **IP address or domain name of the site you are visiting (or that you manually search in the popup)** may be sent to them:

| Service | Data sent | When |
|---|---|---|
| api.ipapi.is | site IP | geolocation (automatic) |
| checkip.amazonaws.com | — | fetching your public IP |
| flagcdn.com | country code | flag image |
| RDAP (rdap.org, IANA, registries) | domain name | WHOIS button |
| cloudflare-dns.com | site IP / domain | reverse DNS, DNS button, and domain resolution (on Chrome) |
| tile.openstreetmap.org | coordinates | Map button |
| virustotal.com | domain name | VirusTotal button (only if you configured a key) |
| nslookup.io | domain name | only if you click "open in a tab" from the DNS view |

Each service applies its own privacy policy. FlagScout sends them no identifying data about you — only the IP/domain required for the request.

### Your API keys
API keys are stored **locally in plain text** on your device and are used only to query the matching service (VirusTotal, ipapi.is). You can delete them at any time from the options page.

### Contact
Questions: **flagscout@gnrs.ca**
