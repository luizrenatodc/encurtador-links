// Links e cliques fictícios para a demonstração (determinísticos: mesma semente, mesmos números).
import { abrirBanco, diaDe } from "./db.js";
import { fileURLToPath } from "node:url";

const LINKS = [
  // slug, destino, título, peso base de cliques/dia, tendência (-1 cai, 0 estável, 1 cresce), situação
  ["promo-verao", "https://loja.example.com/colecao/verao?utm_source=bio", "Coleção de verão", 34, 1, "ativo"],
  ["cardapio", "https://restaurante.example.com/cardapio.pdf", "Cardápio em PDF", 21, 0, "ativo"],
  ["agenda", "https://agenda.example.com/reservar?origem=bio", "Agendar horário", 15, 1, "ativo"],
  ["podcast-ep12", "https://podcast.example.com/episodios/12", "Podcast, episódio 12", 12, -1, "ativo"],
  ["vagas-2026", "https://carreiras.example.com/vagas", "Vagas abertas", 9, 0, "vence"],
  ["newsletter", "https://newsletter.example.com/assine", "Assine a newsletter", 7, 1, "ativo"],
  ["live-sexta", "https://eventos.example.com/live-de-sexta", "Live de sexta", 18, -1, "expirado"],
  ["guia-estudos", "https://example.org/guia-de-estudos.pdf", "Guia de estudos (pausado)", 5, 0, "pausado"],
];
const ORIGENS = [["direto", 30], ["instagram.com", 28], ["wa.me", 14], ["linkedin.com", 11], ["google.com", 9], ["t.co", 5], ["facebook.com", 3]];
const DISPOSITIVOS = [["celular", 66], ["computador", 27], ["tablet", 4], ["robô", 3]];
const NAVEGADORES = [["Chrome", 52], ["Safari", 31], ["Edge", 8], ["Firefox", 6], ["Outro", 3]];

function gerador(semente) {
  let s = semente >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
const escolher = (lista, r) => {
  const total = lista.reduce((a, [, p]) => a + p, 0);
  let x = r * total;
  for (const [v, p] of lista) if ((x -= p) < 0) return v;
  return lista[0][0];
};

export function semear(db, agora = new Date()) {
  if (db.prepare("SELECT COUNT(*) n FROM links").get().n > 0) return false;
  const rnd = gerador(20261110);
  const DIAS = 45;
  db.exec("BEGIN");
  LINKS.forEach(([slug, url, titulo, base, tendencia, situacao], i) => {
    const criado = new Date(agora.getTime() - (DIAS + 2 - i) * 86400_000);
    const expira = situacao === "vence" ? new Date(agora.getTime() + 18 * 86400_000) : situacao === "expirado" ? new Date(agora.getTime() - 86400_000) : null;
    const id = Number(db.prepare("INSERT INTO links (slug, url, titulo, criado_em, expira_em, ativo) VALUES (?,?,?,?,?,?)").run(slug, url, titulo, criado.toISOString(), expira?.toISOString() ?? null, situacao === "pausado" ? 0 : 1).lastInsertRowid);
    const ins = db.prepare("INSERT INTO cliques (link_id, em, dia, origem, dispositivo, navegador) VALUES (?,?,?,?,?,?)");
    for (let d = DIAS - 1; d >= 0; d--) {
      const frac = (DIAS - 1 - d) / (DIAS - 1); // 0 = mais antigo, 1 = hoje
      const fator = tendencia === 1 ? 0.35 + 1.1 * frac : tendencia === -1 ? 1.4 - 1.1 * frac : 1;
      const semana = [0.8, 1.05, 1.1, 1.1, 1.05, 0.95, 0.75][new Date(agora.getTime() - d * 86400_000).getUTCDay()];
      const pico = Math.sin(frac * 17 + i) * 0.22 + 1;
      let n = Math.max(0, Math.round(base * fator * semana * pico * (0.75 + rnd() * 0.5)));
      if (expira && expira < agora && d < 1) n = 0;
      const ancora = agora.getTime() - d * 86400_000;
      for (let k = 0; k < n; k++) {
        const em = new Date(ancora - Math.floor(rnd() * 86400_000 * (d === 0 ? Math.min(1, 0.6) : 1)));
        if (em < criado || em > agora) continue;
        ins.run(id, em.toISOString(), diaDe(em), escolher(ORIGENS, rnd()), escolher(DISPOSITIVOS, rnd()), escolher(NAVEGADORES, rnd()));
      }
    }
  });
  db.exec("COMMIT");
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = abrirBanco(process.env.BANCO ?? "dados/links.db");
  console.log(semear(db) ? "Links e cliques fictícios criados." : "O banco já tem dados; nada a fazer.");
}
