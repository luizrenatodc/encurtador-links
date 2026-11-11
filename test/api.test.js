import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { semear } from "../src/semente.js";
import { diaDe, somarDias } from "../src/db.js";

let relogio = new Date("2026-11-10T15:00:00-03:00");
let app, base;
before(async () => {
  app = createApp({ agora: () => relogio, limites: { criar: 1000, api: 100000, redirecionar: 100000 } });
  await new Promise((ok) => app.servidor.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${app.servidor.address().port}`;
});
after(() => app.fechar());

const j = async (metodo, caminho, corpo, cab = {}) => {
  const r = await fetch(base + caminho, { method: metodo, headers: { ...(corpo !== undefined ? { "content-type": "application/json" } : {}), ...cab }, body: corpo !== undefined ? JSON.stringify(corpo) : undefined });
  const t = await r.text();
  let json; try { json = JSON.parse(t); } catch { json = t; }
  return { status: r.status, json, headers: r.headers };
};
const visitar = (slug, cab = {}) => fetch(`${base}/${slug}`, { redirect: "manual", headers: cab });

test("cria link com slug automático e devolve URL curta", async () => {
  const r = await j("POST", "/api/links", { url: "https://example.com/pagina" });
  assert.equal(r.status, 201);
  assert.match(r.json.slug, /^[a-zA-Z0-9]{6}$/);
  assert.equal(r.json.curto, `${base}/${r.json.slug}`);
  assert.equal(r.json.estado, "ativo");
  assert.equal(r.json.cliques, 0);
});

test("slug personalizado: aceita, repete (409), valida e reserva", async () => {
  assert.equal((await j("POST", "/api/links", { url: "https://example.com/a", slug: "minha-promo" })).status, 201);
  assert.equal((await j("POST", "/api/links", { url: "https://example.com/b", slug: "MINHA-PROMO" })).status, 409); // sem diferenciar maiúsculas
  assert.equal((await j("POST", "/api/links", { url: "https://example.com/b", slug: "ab" })).status, 400);
  assert.equal((await j("POST", "/api/links", { url: "https://example.com/b", slug: "api" })).status, 400);
});

test("recusa URLs perigosas e laços com mensagem clara", async () => {
  for (const url of ["javascript:alert(1)", "http://localhost:3000/", "http://169.254.169.254/", "https://user:pw@example.com/", `${base}/minha-promo`, "https://bit.ly/abc"]) {
    const r = await j("POST", "/api/links", { url });
    assert.equal(r.status, 400, url);
    assert.ok(r.json.erro.length > 10);
  }
});

test("redireciona com 302, conta o clique e classifica origem/dispositivo", async () => {
  await j("POST", "/api/links", { url: "https://example.com/destino?x=1", slug: "ir-ja" });
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const r = await visitar("ir-ja", { "user-agent": iphone, referer: "https://www.instagram.com/p/xyz" });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "https://example.com/destino?x=1");
  assert.equal(r.headers.get("cache-control"), "no-store");
  await visitar("ir-ja", { "user-agent": "curl/8.4.0" }); // sem referer: robô, direto
  const e = (await j("GET", "/api/links/ir-ja/estatisticas")).json;
  assert.equal(e.total, 2);
  assert.equal(e.hoje, 2);
  assert.deepEqual(e.origens.map((o) => o.nome).sort(), ["direto", "instagram.com"]);
  assert.deepEqual(e.dispositivos.map((o) => o.nome).sort(), ["celular", "robô"]);
});

test("HEAD não conta clique; slug inexistente dá 404 em HTML", async () => {
  await j("POST", "/api/links", { url: "https://example.com/h", slug: "so-head" });
  const h = await fetch(`${base}/so-head`, { method: "HEAD", redirect: "manual" });
  assert.equal(h.status, 302);
  assert.equal((await j("GET", "/api/links/so-head")).json.cliques, 0);
  const nf = await fetch(`${base}/nao-existe-1`, { redirect: "manual" });
  assert.equal(nf.status, 404);
  assert.match(nf.headers.get("content-type"), /html/);
});

test("expiração: vale até o instante e depois responde 410", async () => {
  const r = await j("POST", "/api/links", { url: "https://example.com/exp", slug: "vence-logo", expira_dias: 2 });
  assert.equal(r.status, 201);
  assert.equal((await visitar("vence-logo")).status, 302);
  relogio = new Date(relogio.getTime() + 3 * 86400_000);
  const v = await visitar("vence-logo");
  assert.equal(v.status, 410);
  assert.equal((await j("GET", "/api/links/vence-logo")).json.estado, "expirado");
  relogio = new Date(relogio.getTime() - 3 * 86400_000);
});

test("expiração: valida passado, formato e limite de 5 anos", async () => {
  const f = (b) => j("POST", "/api/links", { url: "https://example.com/v", ...b });
  assert.equal((await f({ expira_em: "2020-01-01T00:00:00Z" })).status, 400);
  assert.equal((await f({ expira_em: "ontem" })).status, 400);
  assert.equal((await f({ expira_dias: 0 })).status, 400);
  assert.equal((await f({ expira_dias: 1.5 })).status, 400);
  assert.equal((await f({ expira_em: "2040-01-01T00:00:00Z" })).status, 400);
  assert.equal((await f({ expira_em: "2026-12-31T23:59:00-03:00" })).status, 201);
});

test("pausar e reativar via PATCH; link pausado responde 410", async () => {
  await j("POST", "/api/links", { url: "https://example.com/p", slug: "pausavel" });
  assert.equal((await j("PATCH", "/api/links/pausavel", { ativo: false })).json.estado, "pausado");
  assert.equal((await visitar("pausavel")).status, 410);
  assert.equal((await j("PATCH", "/api/links/pausavel", { ativo: true })).json.estado, "ativo");
  assert.equal((await visitar("pausavel")).status, 302);
  assert.equal((await j("PATCH", "/api/links/pausavel", { ativo: "sim" })).status, 400);
});

test("estatísticas: série completa com zeros, por dia no fuso de São Paulo", async () => {
  await j("POST", "/api/links", { url: "https://example.com/s", slug: "serie-dias" });
  await visitar("serie-dias");
  relogio = new Date(relogio.getTime() - 86400_000);
  await visitar("serie-dias");
  await visitar("serie-dias");
  relogio = new Date(relogio.getTime() + 86400_000);
  const e = (await j("GET", "/api/links/serie-dias/estatisticas?dias=7")).json;
  assert.equal(e.serie.length, 7);
  const hoje = diaDe(relogio);
  assert.equal(e.serie.at(-1).dia, hoje);
  assert.equal(e.serie.at(-1).cliques, 1);
  assert.equal(e.serie.at(-2).dia, somarDias(hoje, -1));
  assert.equal(e.serie.at(-2).cliques, 2);
  assert.equal(e.serie[0].cliques, 0);
  assert.equal(e.total, 3);
  assert.equal(e.ultimos7, 3);
  assert.equal((await j("GET", "/api/links/serie-dias/estatisticas?dias=3")).status, 400);
});

test("23h em São Paulo ainda é o mesmo dia (UTC já virou)", () => {
  assert.equal(diaDe(new Date("2026-11-10T23:30:00-03:00")), "2026-11-10");
  assert.equal(diaDe(new Date("2026-11-11T00:30:00-03:00")), "2026-11-11");
});

test("QR Code em SVG aponta para a URL curta", async () => {
  const r = await fetch(`${base}/api/links/ir-ja/qr.svg`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /image\/svg\+xml/);
  const svg = await r.text();
  assert.match(svg, /^<svg/);
  assert.equal((await j("GET", "/api/links/naoexiste/qr.svg")).status, 404);
});

test("listagem traz cliques e minigráfico de 7 dias; busca filtra", async () => {
  const l = (await j("GET", "/api/links")).json;
  assert.ok(l.links.length >= 5);
  const ir = l.links.find((x) => x.slug === "ir-ja");
  assert.equal(ir.cliques, 2);
  assert.equal(ir.ultimos7.length, 7);
  assert.equal(ir.ultimos7.at(-1), 2);
  assert.equal((await j("GET", "/api/links?q=ir-j")).json.links.length, 1);
});

test("excluir remove o link e seus cliques", async () => {
  await j("POST", "/api/links", { url: "https://example.com/x", slug: "apagar-me" });
  await visitar("apagar-me");
  assert.equal((await j("DELETE", "/api/links/apagar-me")).status, 200);
  assert.equal((await visitar("apagar-me")).status, 404);
  assert.equal(app.db.prepare("SELECT COUNT(*) n FROM cliques WHERE link_id NOT IN (SELECT id FROM links)").get().n, 0);
});

test("protocolo: exige JSON, rejeita corpo ruim, método errado e caminho perigoso", async () => {
  const txt = await fetch(`${base}/api/links`, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });
  assert.equal(txt.status, 415);
  const ruim = await fetch(`${base}/api/links`, { method: "POST", headers: { "content-type": "application/json" }, body: "{nao json" });
  assert.equal(ruim.status, 400);
  assert.equal((await j("PUT", "/api/links/ir-ja", {})).status, 405);
  assert.equal((await fetch(`${base}/%E0%A4%A`)).status, 400);
  assert.equal((await fetch(`${base}/..%2fpackage.json`)).status, 400);
  assert.match((await fetch(base)).headers.get("content-security-policy"), /script-src 'self'/);
});

test("PAINEL_TOKEN protege a API, mas não o redirecionamento", async () => {
  const p = createApp({ token: "segredo-123" });
  await new Promise((ok) => p.servidor.listen(0, "127.0.0.1", ok));
  const b = `http://127.0.0.1:${p.servidor.address().port}`;
  const post = (cab) => fetch(`${b}/api/links`, { method: "POST", headers: { "content-type": "application/json", ...cab }, body: JSON.stringify({ url: "https://example.com/t", slug: "com-token" }) });
  assert.equal((await post({})).status, 401);
  assert.equal((await post({ "x-api-key": "errada" })).status, 401);
  assert.equal((await post({ authorization: "Bearer segredo-123" })).status, 201);
  assert.equal((await fetch(`${b}/api/config`)).status, 200);
  assert.equal((await fetch(`${b}/com-token`, { redirect: "manual" })).status, 302);
  await p.fechar();
});

test("rate limit na criação de links: 429 com retry-after", async () => {
  const p = createApp({ limites: { criar: 2 } });
  await new Promise((ok) => p.servidor.listen(0, "127.0.0.1", ok));
  const b = `http://127.0.0.1:${p.servidor.address().port}`;
  const criar = (i) => fetch(`${b}/api/links`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: `https://example.com/${i}` }) });
  assert.deepEqual([(await criar(1)).status, (await criar(2)).status, (await criar(3)).status], [201, 201, 429]);
  assert.ok(Number((await criar(4)).headers.get("retry-after")) > 0);
  await p.fechar();
});

test("BASE_URL define o domínio da URL curta e o laço é checado contra ele", async () => {
  const p = createApp({ baseUrl: "https://atalho.example.com" });
  await new Promise((ok) => p.servidor.listen(0, "127.0.0.1", ok));
  const b = `http://127.0.0.1:${p.servidor.address().port}`;
  const post = (url) => fetch(`${b}/api/links`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, slug: "dominio-x" }) });
  assert.equal((await post("https://atalho.example.com/abc")).status, 400);
  const ok = await (await post("https://example.com/ok")).json();
  assert.equal(ok.curto, "https://atalho.example.com/dominio-x");
  await p.fechar();
});

test("semente: cria links e cliques e é idempotente", async () => {
  const s = createApp();
  assert.equal(semear(s.db, new Date("2026-11-10T12:00:00Z")), true);
  assert.equal(semear(s.db), false);
  const n = s.db.prepare("SELECT COUNT(*) n FROM cliques").get().n;
  assert.ok(n > 3000, `cliques: ${n}`);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM links").get().n, 8);
});
