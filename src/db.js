import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const ESQUEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  url TEXT NOT NULL,
  titulo TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL,
  expira_em TEXT,
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS cliques (
  id INTEGER PRIMARY KEY,
  link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  em TEXT NOT NULL,
  dia TEXT NOT NULL,
  origem TEXT NOT NULL,
  dispositivo TEXT NOT NULL,
  navegador TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_cliques_link_dia ON cliques(link_id, dia);
`;

export function abrirBanco(caminho = ":memory:") {
  if (caminho !== ":memory:") mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(ESQUEMA);
  return db;
}

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
/** Dia civil (AAAA-MM-DD) no fuso de São Paulo: é nele que os cliques são agrupados. */
export const diaDe = (data) => fmt.format(data);
export function somarDias(dia, n) {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
