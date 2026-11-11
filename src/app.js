// API REST, redirecionamento e painel estático. createApp() não abre porta (facilita os testes).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomInt, timingSafeEqual } from "node:crypto";
import { abrirBanco, diaDe, somarDias } from "./db.js";
import { validarDestino, validarSlug, UrlInvalida } from "./url.js";
import { classificarAgente, origemDoReferer } from "./agente.js";
import { qrSvg } from "./qr.js";

const PUBLICO = fileURLToPath(new URL("../public", import.meta.url));
const TIPOS = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const ALFABETO = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CINCO_ANOS_MS = 5 * 365 * 24 * 3600 * 1000;

class Erro extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}
const exige = (c, status, msg) => {
  if (!c) throw new Erro(status, msg);
};

class Limite {
  constructor(max, janelaMs) {
    Object.assign(this, { max, janelaMs, mapa: new Map() });
  }
  tentar(chave) {
    const t = Date.now();
    let e = this.mapa.get(chave);
    if (!e || t >= e.fim) {
      if (this.mapa.size > 5000) for (const [k, v] of this.mapa) if (t >= v.fim) this.mapa.delete(k);
      e = { n: 0, fim: t + this.janelaMs };
      this.mapa.set(chave, e);
    }
    if (e.n >= this.max) return Math.ceil((e.fim - t) / 1000);
    e.n++;
    return 0;
  }
}

const pagina = (titulo, texto) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${titulo} – Atalho</title><link rel="stylesheet" href="/estilo.css"></head><body class="pagina-erro"><main class="cartao-erro"><p class="selo">Atalho</p><h1>${titulo}</h1><p>${texto}</p><a class="btn" href="/">Ir para o painel</a></main></body></html>`;

export function createApp({ banco = ":memory:", baseUrl = process.env.BASE_URL, token = process.env.PAINEL_TOKEN, limites = {}, agora = () => new Date() } = {}) {
  const db = abrirBanco(banco);
  const lim = { criar: new Limite(limites.criar ?? 30, 60_000), api: new Limite(limites.api ?? 600, 60_000), redirecionar: new Limite(limites.redirecionar ?? 1200, 60_000) };
  const q = (sql) => db.prepare(sql);
  const base = baseUrl ? baseUrl.replace(/\/$/, "") : null;

  const origemRequisicao = (req) => {
    if (base) return base;
    const h = req.headers.host ?? "";
    return /^[a-z0-9.\-:[\]]{1,100}$/i.test(h) ? `http://${h}` : "http://localhost";
  };
  const hostsProprios = (req) => {
    const hs = [new URL(origemRequisicao(req)).hostname];
    const h = req.headers.host;
    if (h && /^[a-z0-9.\-:[\]]{1,100}$/i.test(h)) hs.push(h.replace(/:\d+$/, ""));
    return hs;
  };

  const estadoDe = (l) => (!l.ativo ? "pausado" : l.expira_em && new Date(l.expira_em) <= agora() ? "expirado" : "ativo");
  const linkJson = (l, req) => ({
    slug: l.slug, url: l.url, curto: `${origemRequisicao(req)}/${l.slug}`, titulo: l.titulo,
    criado_em: l.criado_em, expira_em: l.expira_em, ativo: !!l.ativo, estado: estadoDe(l), cliques: l.cliques ?? 0,
  });
  const buscar = (slug) => {
    const l = /^[a-z0-9_-]{3,32}$/i.test(slug) ? q("SELECT l.*, (SELECT COUNT(*) FROM cliques WHERE link_id = l.id) AS cliques FROM links l WHERE slug = ?").get(slug) : null;
    exige(l, 404, "Link não encontrado.");
    return l;
  };
  const gerarSlug = () => {
    for (let t = 0; t < 12; t++) {
      let s = "";
      for (let i = 0; i < 6; i++) s += ALFABETO[randomInt(ALFABETO.length)];
      try { validarSlug(s); } catch { continue; }
      if (!q("SELECT 1 FROM links WHERE slug = ?").get(s)) return s;
    }
    throw new Erro(503, "Não foi possível gerar um apelido livre. Tente de novo.");
  };

  function estatisticas(l, dias) {
    const hoje = diaDe(agora());
    const inicio = somarDias(hoje, -(dias - 1));
    const porDia = new Map(q("SELECT dia, COUNT(*) n FROM cliques WHERE link_id = ? AND dia >= ? GROUP BY dia").all(l.id, inicio).map((r) => [r.dia, r.n]));
    const serie = Array.from({ length: dias }, (_, i) => {
      const dia = somarDias(inicio, i);
      return { dia, cliques: porDia.get(dia) ?? 0 };
    });
    const grupo = (col) => q(`SELECT ${col} AS nome, COUNT(*) AS cliques FROM cliques WHERE link_id = ? AND dia >= ? GROUP BY ${col} ORDER BY cliques DESC, nome LIMIT 6`).all(l.id, inicio);
    return {
      slug: l.slug, dias, total: l.cliques,
      periodo: serie.reduce((a, d) => a + d.cliques, 0),
      hoje: serie.at(-1).cliques,
      ultimos7: serie.slice(-7).reduce((a, d) => a + d.cliques, 0),
      ultimo_clique: q("SELECT MAX(em) AS em FROM cliques WHERE link_id = ?").get(l.id).em,
      serie, origens: grupo("origem"), dispositivos: grupo("dispositivo"), navegadores: grupo("navegador"),
    };
  }

  // ---------- rotas da API ----------
  const rotas = [];
  const rota = (metodo, caminho, fn) => rotas.push({ metodo, re: new RegExp(`^${caminho.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`), fn });

  rota("GET", "/api/config", () => [200, { protegido: !!token }]);
  rota("GET", "/api/links", (c) => {
    const termo = (c.url.searchParams.get("q") ?? "").trim().slice(0, 60).replace(/[%_\\]/g, "");
    const linhas = q(`SELECT l.*, (SELECT COUNT(*) FROM cliques WHERE link_id = l.id) AS cliques FROM links l
      WHERE (l.slug LIKE ? OR l.url LIKE ? OR l.titulo LIKE ?) ORDER BY l.id DESC LIMIT 200`).all(`%${termo}%`, `%${termo}%`, `%${termo}%`);
    const hoje = diaDe(agora());
    const ini = somarDias(hoje, -6);
    const mini = new Map();
    for (const r of q("SELECT link_id, dia, COUNT(*) n FROM cliques WHERE dia >= ? GROUP BY link_id, dia").all(ini)) {
      if (!mini.has(r.link_id)) mini.set(r.link_id, new Map());
      mini.get(r.link_id).set(r.dia, r.n);
    }
    const links = linhas.map((l) => ({ ...linkJson(l, c.req), ultimos7: Array.from({ length: 7 }, (_, i) => mini.get(l.id)?.get(somarDias(ini, i)) ?? 0) }));
    return [200, { links, total_cliques: links.reduce((a, l) => a + l.cliques, 0) }];
  });
  rota("POST", "/api/links", (c) => {
    const espera = lim.criar.tentar(c.ip);
    if (espera) throw Object.assign(new Erro(429, `Muitos links criados em pouco tempo. Tente em ${espera}s.`), { espera });
    const { url, slug, titulo, expira_em, expira_dias } = c.corpo;
    const destino = validarDestino(url, hostsProprios(c.req));
    const apelido = slug === undefined || slug === null || slug === "" ? gerarSlug() : validarSlug(slug);
    exige(!q("SELECT 1 FROM links WHERE slug = ?").get(apelido), 409, "Esse apelido já está em uso.");
    exige(titulo === undefined || (typeof titulo === "string" && titulo.length <= 80), 400, "O título passa de 80 caracteres.");
    let expira = null;
    if (expira_em !== undefined && expira_em !== null && expira_em !== "") {
      const d = new Date(expira_em);
      exige(typeof expira_em === "string" && !Number.isNaN(d.getTime()), 400, "Data de expiração inválida.");
      expira = d;
    } else if (expira_dias !== undefined && expira_dias !== null && expira_dias !== "") {
      exige(Number.isInteger(expira_dias) && expira_dias >= 1 && expira_dias <= 1825, 400, "Expiração: de 1 a 1825 dias.");
      expira = new Date(agora().getTime() + expira_dias * 86400_000);
    }
    if (expira) {
      exige(expira > agora(), 400, "A expiração precisa estar no futuro.");
      exige(expira.getTime() - agora().getTime() <= CINCO_ANOS_MS, 400, "A expiração pode ser de no máximo 5 anos.");
    }
    q("INSERT INTO links (slug, url, titulo, criado_em, expira_em) VALUES (?,?,?,?,?)").run(apelido, destino, (titulo ?? "").trim(), agora().toISOString(), expira?.toISOString() ?? null);
    return [201, linkJson(buscar(apelido), c.req)];
  });
  rota("GET", "/api/links/:slug", (c) => [200, linkJson(buscar(c.params.slug), c.req)]);
  rota("PATCH", "/api/links/:slug", (c) => {
    const l = buscar(c.params.slug);
    const { ativo, expira_em, titulo } = c.corpo;
    if (ativo !== undefined) {
      exige(typeof ativo === "boolean", 400, "`ativo` deve ser verdadeiro ou falso.");
      q("UPDATE links SET ativo = ? WHERE id = ?").run(ativo ? 1 : 0, l.id);
    }
    if (titulo !== undefined) {
      exige(typeof titulo === "string" && titulo.length <= 80, 400, "O título passa de 80 caracteres.");
      q("UPDATE links SET titulo = ? WHERE id = ?").run(titulo.trim(), l.id);
    }
    if (expira_em !== undefined) {
      if (expira_em === null) q("UPDATE links SET expira_em = NULL WHERE id = ?").run(l.id);
      else {
        const d = new Date(expira_em);
        exige(typeof expira_em === "string" && !Number.isNaN(d.getTime()) && d > agora(), 400, "A expiração precisa ser uma data futura válida.");
        exige(d.getTime() - agora().getTime() <= CINCO_ANOS_MS, 400, "A expiração pode ser de no máximo 5 anos.");
        q("UPDATE links SET expira_em = ? WHERE id = ?").run(d.toISOString(), l.id);
      }
    }
    return [200, linkJson(buscar(l.slug), c.req)];
  });
  rota("DELETE", "/api/links/:slug", (c) => {
    q("DELETE FROM links WHERE id = ?").run(buscar(c.params.slug).id);
    return [200, { ok: true }];
  });
  rota("GET", "/api/links/:slug/estatisticas", (c) => {
    const dias = Number(c.url.searchParams.get("dias") ?? 30);
    exige(Number.isInteger(dias) && dias >= 7 && dias <= 90, 400, "`dias` deve ficar entre 7 e 90.");
    return [200, estatisticas(buscar(c.params.slug), dias)];
  });
  rota("GET", "/api/links/:slug/qr.svg", (c) => {
    const l = buscar(c.params.slug);
    return [200, qrSvg(`${origemRequisicao(c.req)}/${l.slug}`), "image/svg+xml"];
  });

  // ---------- servidor ----------
  const CAB = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  };
  const resp = (res, status, corpo, tipo = "application/json; charset=utf-8", extra = {}) => {
    res.writeHead(status, { "content-type": tipo, "cache-control": "no-store", ...CAB, ...extra }).end(typeof corpo === "string" ? corpo : JSON.stringify(corpo));
  };
  const autorizado = (req) => {
    if (!token) return true;
    const dado = (req.headers["x-api-key"] ?? /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "").toString();
    const a = Buffer.from(dado), b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  async function lerCorpo(req) {
    exige((req.headers["content-type"] ?? "").startsWith("application/json"), 415, "Envie JSON (content-type: application/json).");
    const partes = [];
    let tam = 0;
    for await (const p of req) {
      tam += p.length;
      exige(tam <= 10_000, 413, "Corpo grande demais.");
      partes.push(p);
    }
    try {
      const v = JSON.parse(Buffer.concat(partes).toString("utf8") || "{}");
      exige(v && typeof v === "object" && !Array.isArray(v), 400, "O corpo deve ser um objeto JSON.");
      return v;
    } catch (e) {
      if (e instanceof Erro) throw e;
      throw new Erro(400, "JSON inválido.");
    }
  }

  async function api(req, res, url) {
    const ip = req.socket.remoteAddress ?? "?";
    const espera = lim.api.tentar(ip);
    if (espera) return resp(res, 429, { erro: `Muitas requisições. Tente em ${espera}s.` }, undefined, { "retry-after": String(espera) });
    const alvo = rotas.filter((r) => r.re.test(url.pathname));
    if (!alvo.length) return resp(res, 404, { erro: "Rota não encontrada." });
    const r = alvo.find((x) => x.metodo === req.method);
    if (!r) return resp(res, 405, { erro: "Método não permitido." }, undefined, { allow: alvo.map((x) => x.metodo).join(", ") });
    if (url.pathname !== "/api/config" && !autorizado(req)) return resp(res, 401, { erro: "Chave de acesso ausente ou incorreta." });
    const ctx = { req, res, url, ip, params: Object.fromEntries(Object.entries(r.re.exec(url.pathname).groups ?? {}).map(([k, v]) => [k, decodeURIComponent(v)])), corpo: {} };
    if (req.method === "POST" || req.method === "PATCH") ctx.corpo = await lerCorpo(req);
    const [status, corpo, tipo] = r.fn(ctx);
    resp(res, status, corpo, tipo);
  }

  function redirecionar(req, res, slug) {
    const espera = lim.redirecionar.tentar(req.socket.remoteAddress ?? "?");
    if (espera) return resp(res, 429, pagina("Calma aí", "Muitos acessos em pouco tempo. Tente de novo em instantes."), "text/html; charset=utf-8", { "retry-after": String(espera) });
    const l = q("SELECT * FROM links WHERE slug = ?").get(slug);
    if (!l) return resp(res, 404, pagina("Link não encontrado", "Esse atalho não existe ou foi removido."), "text/html; charset=utf-8");
    const estado = estadoDe(l);
    if (estado !== "ativo") return resp(res, 410, pagina(estado === "expirado" ? "Link expirado" : "Link pausado", estado === "expirado" ? "O prazo deste atalho terminou." : "O dono deste atalho o pausou por enquanto."), "text/html; charset=utf-8");
    if (req.method === "GET") {
      try {
        const ag = classificarAgente(req.headers["user-agent"]);
        const t = agora();
        q("INSERT INTO cliques (link_id, em, dia, origem, dispositivo, navegador) VALUES (?,?,?,?,?,?)").run(l.id, t.toISOString(), diaDe(t), origemDoReferer(req.headers.referer), ag.dispositivo, ag.navegador);
      } catch (e) {
        console.error("falha ao registrar clique:", e.message); // o redirecionamento não pode falhar por causa da métrica
      }
    }
    res.writeHead(302, { location: l.url, "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" }).end();
  }

  async function estatico(res, caminho) {
    let rel;
    try {
      rel = decodeURIComponent(caminho);
    } catch {
      return resp(res, 400, { erro: "Endereço inválido." });
    }
    if (rel === "/") rel = "/index.html";
    if (rel.includes("..") || rel.includes("\\") || rel.includes("\0")) return resp(res, 400, { erro: "Caminho inválido." });
    try {
      const d = await readFile(join(PUBLICO, rel));
      res.writeHead(200, { "content-type": TIPOS[extname(rel)] ?? "application/octet-stream", "cache-control": "no-cache", ...CAB }).end(d);
    } catch {
      resp(res, 404, pagina("Página não encontrada", "Esse endereço não existe."), "text/html; charset=utf-8");
    }
  }

  const servidor = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      if (req.method !== "GET" && req.method !== "HEAD") return resp(res, 405, { erro: "Método não permitido." });
      const m = /^\/([A-Za-z0-9_-]{3,32})$/.exec(url.pathname);
      if (m && !m[1].includes(".")) return redirecionar(req, res, decodeURIComponent(m[1]));
      await estatico(res, url.pathname);
    } catch (e) {
      if (e instanceof UrlInvalida) return resp(res, 400, { erro: e.message });
      if (e instanceof Erro) return resp(res, e.status, { erro: e.message }, undefined, e.espera ? { "retry-after": String(e.espera) } : {});
      if (e instanceof URIError) return resp(res, 400, { erro: "Endereço inválido." });
      console.error(e);
      resp(res, 500, { erro: "Erro interno." });
    }
  });
  return { servidor, db, fechar: () => new Promise((ok) => (servidor.close(ok), servidor.closeAllConnections?.())) };
}
