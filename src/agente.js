// Classificação básica de User-Agent e Referer. Sem banco de dados externo: regras simples e explícitas.
export function classificarAgente(ua = "") {
  const s = String(ua).slice(0, 400);
  if (!s || /bot|crawl|spider|slurp|facebookexternalhit|preview|curl|wget|python-requests|httpclient|monitor|headless/i.test(s)) {
    return { dispositivo: "robô", navegador: "Outro" };
  }
  const dispositivo = /ipad|tablet|(android(?!.*mobile))/i.test(s) ? "tablet" : /mobi|iphone|ipod|android/i.test(s) ? "celular" : "computador";
  const navegador = /edg(e|a|ios)?\//i.test(s) ? "Edge"
    : /opr\/|opera/i.test(s) ? "Opera"
    : /firefox|fxios/i.test(s) ? "Firefox"
    : /chrome|crios/i.test(s) ? "Chrome"
    : /safari/i.test(s) ? "Safari"
    : "Outro";
  return { dispositivo, navegador };
}

/** Origem do clique: host do Referer, ou "direto" quando não há. */
export function origemDoReferer(referer) {
  if (!referer) return "direto";
  try {
    const h = new URL(referer).hostname.replace(/^www\./, "").toLowerCase();
    return h.slice(0, 60) || "direto";
  } catch {
    return "direto";
  }
}
