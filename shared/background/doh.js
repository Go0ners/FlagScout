// FlagScout — résolution DNS via DNS-over-HTTPS (Cloudflare)
//
// Utilisé par les navigateurs dépourvus d'API DNS native (Chromium).
// Imite la forme de browser.dns.resolve de Firefox : renvoie { addresses: [...] }.

const DOH_URL = "https://cloudflare-dns.com/dns-query";

// Résout `hostname` en adresses. `flags` peut contenir "disable_ipv6" pour ne
// demander que des enregistrements A (IPv4) ; sinon A + AAAA.
export async function dnsResolveDoH(hostname, flags) {
  const v4only = Array.isArray(flags) && flags.includes("disable_ipv6");
  const types = v4only ? [["A", 1]] : [["A", 1], ["AAAA", 28]]; // [type texte, code DNS]
  const addresses = [];
  for (const [type, num] of types) {
    try {
      const res = await fetch(
        `${DOH_URL}?name=${encodeURIComponent(hostname)}&type=${type}`,
        { headers: { accept: "application/dns-json" } },
      );
      if (!res.ok) continue;
      const data = await res.json();
      for (const a of (data.Answer || [])) {
        if (a.type === num && a.data) addresses.push(a.data);
      }
    } catch { /* enregistrement indisponible → on ignore */ }
  }
  return { addresses };
}
