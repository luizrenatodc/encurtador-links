import { test } from "node:test";
import assert from "node:assert/strict";
import { matrizQR, qrSvg } from "../src/qr.js";

const finder = (m, x0, y0) => {
  for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
    const borda = dx === 0 || dx === 6 || dy === 0 || dy === 6;
    const miolo = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
    if (m[y0 + dy][x0 + dx] !== (borda || miolo)) return false;
  }
  return true;
};

test("tamanho cresce com o texto (versão 1 = 21 módulos)", () => {
  assert.equal(matrizQR("oi").length, 21);
  assert.equal(matrizQR("http://localhost:3000/abc").length, 25); // versão 2
  assert.equal(matrizQR("x".repeat(100)).length, 4 * 6 + 17); // versão 6
  assert.equal(matrizQR("x".repeat(300)).length, 4 * 13 + 17); // versão 13 (tem bits de versão)
});

test("tem os três localizadores nos cantos certos e o módulo escuro fixo", () => {
  for (const t of ["a", "https://exemplo.com/" + "z".repeat(150)]) {
    const m = matrizQR(t);
    const n = m.length;
    assert.ok(finder(m, 0, 0) && finder(m, n - 7, 0) && finder(m, 0, n - 7), "localizadores");
    assert.equal(m[n - 8][8], true, "módulo escuro fixo");
    assert.equal(m[6][8] && !m[6][9], true, "faixa de temporização alterna");
  }
});

test("é determinístico e muda com o conteúdo", () => {
  assert.deepEqual(matrizQR("abc"), matrizQR("abc"));
  assert.notDeepEqual(matrizQR("abc"), matrizQR("abd"));
});

test("aceita UTF-8 e recusa texto grande demais", () => {
  assert.ok(matrizQR("https://exemplo.com/ação-ç").length >= 21);
  assert.throws(() => matrizQR("x".repeat(500)), RangeError);
});

test("SVG válido, com viewBox incluindo a zona de silêncio", () => {
  const svg = qrSvg("https://exemplo.com");
  assert.match(svg, /^<svg [^>]*viewBox="0 0 (\d+) \1"/);
  const n = matrizQR("https://exemplo.com").length;
  assert.ok(svg.includes(`viewBox="0 0 ${n + 8} ${n + 8}"`));
  assert.match(svg, /<path d="M/);
  assert.equal(svg.includes("<script"), false);
});
