// Gera as capturas de docs/ e os quadros do GIF (tmp/quadros) usando o painel de verdade, com banco novo.
// Uso: node scripts/telas.mjs     (precisa de puppeteer-core e Edge/Chrome)
//   PUPPETEER_DIR  pasta onde puppeteer-core está instalado (padrão: pasta atual)
//   NAVEGADOR      caminho do Edge/Chrome (padrão: Edge do Windows)
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const require = createRequire((process.env.PUPPETEER_DIR ?? process.cwd()).replace(/[\\/]?$/, "/"));
const puppeteer = require("puppeteer-core");
const NAVEGADOR = process.env.NAVEGADOR ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORTA = 8099;
const URL_APP = `http://localhost:${PORTA}/`;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

for (const f of ["tmp/quadros", "tmp/captura.db", "tmp/captura.db-wal", "tmp/captura.db-shm"]) rmSync(f, { recursive: true, force: true });
mkdirSync("tmp/quadros", { recursive: true });
mkdirSync("docs", { recursive: true });
const servidor = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server.js"], {
  env: { ...process.env, PORT: String(PORTA), BANCO: "tmp/captura.db" },
  stdio: "ignore",
});
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(URL_APP)).ok) break; } catch { /* aguardando */ }
  await dormir(150);
}

const navegador = await puppeteer.launch({ executablePath: NAVEGADOR, headless: "new" });
const erros = [];
async function pagina(largura, altura, dsf = 1, escuro = false, hash = "") {
  const p = await (await navegador.createBrowserContext()).newPage();
  await p.setViewport({ width: largura, height: altura, deviceScaleFactor: dsf });
  await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: escuro ? "dark" : "light" }, { name: "prefers-reduced-motion", value: "reduce" }]);
  p.on("pageerror", (e) => erros.push(e.message));
  p.on("console", (m) => m.type() === "error" && !m.text().includes("status of 400") && erros.push(m.text()));
  p.on("dialog", (d) => d.accept());
  await p.goto(URL_APP + hash, { waitUntil: "networkidle0" });
  await p.waitForSelector(".kpis", { timeout: 8000 });
  await p.waitForFunction(() => document.querySelector(".qr")?.src?.startsWith("data:"));
  await dormir(300);
  return p;
}
const clicar = async (slug, vezes, ua, ref) => {
  for (let i = 0; i < vezes; i++) await fetch(`${URL_APP}${slug}`, { redirect: "manual", headers: { "user-agent": ua[i % ua.length], ...(ref[i % ref.length] ? { referer: ref[i % ref.length] } : {}) } });
};
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

// ---------- GIF: URL perigosa recusada -> criar -> clicar -> estatísticas ----------
const duracoes = [];
let n = 0;
async function quadro(p, ms = 900) {
  await dormir(280);
  await p.screenshot({ path: `tmp/quadros/f${String(n++).padStart(4, "0")}.png` });
  duracoes.push(ms);
}
const g = await pagina(1280, 800);
process.on("unhandledRejection", async (e) => { console.error(e.message); await g.screenshot({ path: "tmp/falha.png" }).catch(() => {}); servidor.kill(); process.exit(1); });
await quadro(g, 2200);
await g.type("#c-url", "http://169.254.169.254/latest/meta-data", { delay: 22 });
await g.click(".form-criar .primario");
await g.waitForSelector(".erro-form:not(:empty)");
await quadro(g, 2400);
await g.$eval("#c-url", (el) => { el.value = ""; el.focus(); });
await g.type("#c-url", "https://loja.example.com/promocoes/black-friday?utm_source=bio&utm_campaign=bf26", { delay: 14 });
await g.type("#c-slug", "black-friday", { delay: 40 });
await g.select("#c-exp", "30");
await g.type("#c-titulo", "Black Friday 2026", { delay: 30 });
await quadro(g, 1800);
await g.click(".form-criar .primario");
await g.waitForFunction(() => document.querySelector(".det-url h2")?.textContent.includes("black-friday"));
await g.waitForFunction(() => document.querySelector(".qr")?.src?.startsWith("data:"));
await quadro(g, 2600);
await clicar("black-friday", 26, [IPHONE, IPHONE, ANDROID, WIN], ["https://www.instagram.com/", "https://www.instagram.com/", "https://wa.me/", "", "https://www.linkedin.com/"]);
await g.evaluate(() => document.querySelector(".item.sel").click());
await g.waitForFunction(() => document.querySelector(".kpi strong")?.textContent === "26");
await quadro(g, 2800);
await g.evaluate(() => [...document.querySelectorAll(".item")].find((b) => b.textContent.includes("/promo-verao")).click());
await g.waitForFunction(() => document.querySelector(".det-url h2")?.textContent.includes("promo-verao"));
await dormir(500);
const alvo = await g.$(".grafico rect[fill=transparent]");
const caixa = await alvo.boundingBox();
await g.mouse.move(caixa.x + caixa.width * 0.72, caixa.y + caixa.height * 0.5);
await quadro(g, 3000);
await g.close();

// ---------- capturas estáticas ----------
const m = await pagina(1360, 940, 2, false, "#/promo-verao");
await m.screenshot({ path: "docs/painel.png" });
await m.evaluate(() => document.querySelector(".kpis").scrollIntoView({ block: "start" }));
await dormir(250);
const al = await m.$(".grafico rect[fill=transparent]");
const cx = await al.boundingBox();
await m.mouse.move(cx.x + cx.width * 0.8, cx.y + cx.height * 0.4);
await dormir(250);
await m.screenshot({ path: "docs/estatisticas.png" });
await m.evaluate(() => document.querySelector(".qr-bloco").scrollIntoView({ block: "center" }));
await dormir(200);
await m.screenshot({ path: "docs/qr-e-gestao.png" });
await m.close();

const cel = await pagina(390, 820, 2, false, "#/cardapio");
await cel.evaluate(() => document.querySelector(".detalhe").scrollIntoView({ block: "start" }));
await dormir(250);
await cel.screenshot({ path: "docs/celular.png" });
await cel.close();

const esc = await pagina(1360, 940, 2, true, "#/agenda");
await esc.screenshot({ path: "docs/escuro.png" });
await esc.close();

const exp = await (await navegador.createBrowserContext()).newPage();
await exp.setViewport({ width: 900, height: 520, deviceScaleFactor: 2 });
await exp.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
await exp.goto(`${URL_APP}live-sexta`, { waitUntil: "networkidle0" });
await exp.screenshot({ path: "docs/link-expirado.png" });
await exp.close();

writeFileSync("tmp/quadros/duracoes.json", JSON.stringify(duracoes));
await navegador.close();
servidor.kill();
console.log(`${n} quadros; erros no console: ${erros.length}`);
if (erros.length) { console.log(erros.join("\n")); process.exitCode = 1; }
