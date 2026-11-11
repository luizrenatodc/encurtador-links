// Validação do destino (anti URL perigosa e anti loop) e do apelido (slug).
import { isIPv4, isIPv6 } from "node:net";

export class UrlInvalida extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = "UrlInvalida";
  }
}

const MAX_URL = 2048;
// Encurtadores públicos conhecidos: encadear um no outro esconde o destino real e abre porta para laços.
const ENCURTADORES = new Set(["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "rebrand.ly", "cutt.ly", "shorturl.at", "t.ly", "rb.gy", "tiny.cc"]);
const SUFIXOS_INTERNOS = [".local", ".localhost", ".internal", ".intranet", ".lan", ".home", ".corp", ".private"];

function ipv4Privado(ip) {
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

function ipv6Privado(ip) {
  const h = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "::" || h === "::1") return true;
  if (/^f[cd]/.test(h) || /^fe[89ab]/.test(h)) return true; // única local (fc00::/7) e link-local (fe80::/10)
  const mapeado = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(h);
  if (mapeado) {
    if (mapeado[1]) return ipv4Privado(mapeado[1]);
    const hi = parseInt(mapeado[2], 16), lo = parseInt(mapeado[3], 16);
    return ipv4Privado(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return false;
}

/**
 * Valida e normaliza o destino. `hostsProprios` são os hosts deste encurtador (para barrar laços).
 * Devolve a URL normalizada (string) ou lança UrlInvalida com mensagem em português.
 */
export function validarDestino(entrada, hostsProprios = []) {
  if (typeof entrada !== "string" || !entrada.trim()) throw new UrlInvalida("Informe a URL de destino.");
  const texto = entrada.trim();
  if (texto.length > MAX_URL) throw new UrlInvalida(`A URL passa de ${MAX_URL} caracteres.`);
  if (/[\u0000-\u001f\u007f\s]/.test(texto)) throw new UrlInvalida("A URL não pode ter espaços nem caracteres de controle.");
  let u;
  try {
    u = new URL(texto);
  } catch {
    throw new UrlInvalida("URL inválida. Use o formato https://exemplo.com/caminho.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UrlInvalida("Só são aceitas URLs http e https (javascript:, data: e file: são bloqueadas).");
  if (u.username || u.password) throw new UrlInvalida("URLs com usuário e senha embutidos são bloqueadas (usadas em golpes de disfarce).");
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new UrlInvalida("URL sem endereço.");
  const semColchetes = host.replace(/^\[|\]$/g, "");
  if (host === "localhost" || SUFIXOS_INTERNOS.some((s) => host.endsWith(s)) || (!host.includes(".") && !isIPv6(semColchetes))) {
    throw new UrlInvalida("Endereços locais e de rede interna não são permitidos.");
  }
  if (isIPv4(host) ? ipv4Privado(host) : isIPv6(semColchetes) && ipv6Privado(semColchetes)) {
    throw new UrlInvalida("Endereços IP privados, locais ou reservados não são permitidos.");
  }
  const proprios = hostsProprios.map((h) => h.toLowerCase().replace(/:\d+$/, ""));
  if (proprios.includes(host)) throw new UrlInvalida("O destino aponta para este próprio encurtador (isso criaria um laço).");
  if (ENCURTADORES.has(host) || ENCURTADORES.has(host.replace(/^www\./, ""))) throw new UrlInvalida("Não é permitido encurtar o link de outro encurtador.");
  return u.href;
}

const RESERVADOS = new Set(["api", "painel", "assets", "admin", "health", "saude", "favicon.ico", "robots.txt", "estilo.css", "app.js", "index.html", "qr", "login", "static", "docs"]);

/** Valida o apelido personalizado: 3 a 32 caracteres, letras, números, hífen e sublinhado. */
export function validarSlug(slug) {
  if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9_-]{2,31}$/i.test(slug)) {
    throw new UrlInvalida("Apelido: 3 a 32 caracteres, só letras, números, - e _ (sem começar por símbolo).");
  }
  if (RESERVADOS.has(slug.toLowerCase())) throw new UrlInvalida("Esse apelido é reservado. Escolha outro.");
  return slug;
}
