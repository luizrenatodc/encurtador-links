import { test } from "node:test";
import assert from "node:assert/strict";
import { validarDestino, validarSlug, UrlInvalida } from "../src/url.js";
import { classificarAgente, origemDoReferer } from "../src/agente.js";

const recusa = (u, propios = ["atalho.test"]) => assert.throws(() => validarDestino(u, propios), UrlInvalida, `deveria recusar: ${u}`);

test("aceita http e https e normaliza", () => {
  assert.equal(validarDestino("  https://Exemplo.com/a b".replace(" b", "%20b")), "https://exemplo.com/a%20b");
  assert.equal(validarDestino("http://example.com"), "http://example.com/");
  assert.equal(validarDestino("https://example.com:8443/x?y=1#z"), "https://example.com:8443/x?y=1#z");
});

test("recusa esquemas perigosos", () => {
  for (const u of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd", "ftp://example.com/x", "vbscript:x", "//example.com", "example.com"]) recusa(u);
});

test("recusa credenciais embutidas, espaços e vazio", () => {
  recusa("https://usuario:senha@example.com/");
  recusa("https://banco.com@golpe.example.com/");
  recusa("https://example.com/a b");
  recusa("https://example.com/\u0000");
  recusa("");
  recusa(null);
  recusa("https://example.com/" + "a".repeat(2100));
});

test("recusa localhost, rede interna e IPs privados (inclusive formas disfarçadas)", () => {
  for (const u of [
    "http://localhost/", "http://localhost:3000/x", "http://app.local/", "http://servidor/", "http://x.internal/",
    "http://127.0.0.1/", "http://127.1/", "http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/",
    "http://10.0.0.5/", "http://172.16.0.1/", "http://172.31.255.255/", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data",
    "http://0.0.0.0/", "http://100.64.0.1/", "http://[::1]/", "http://[fd00::1]/", "http://[fe80::1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/",
  ]) recusa(u);
});

test("aceita IPs públicos", () => {
  assert.equal(validarDestino("http://8.8.8.8/"), "http://8.8.8.8/");
  assert.equal(validarDestino("http://172.32.0.1/"), "http://172.32.0.1/");
});

test("barra laço: o destino é o próprio encurtador", () => {
  recusa("https://atalho.test/abc");
  recusa("https://ATALHO.test:8443/abc");
  assert.equal(validarDestino("https://outro.example.com/"), "https://outro.example.com/");
});

test("barra encadeamento de encurtadores conhecidos", () => {
  recusa("https://bit.ly/3abc");
  recusa("https://www.tinyurl.com/x");
  recusa("https://t.co/xyz");
});

test("slug: formato e reservados", () => {
  assert.equal(validarSlug("promo-2026"), "promo-2026");
  assert.equal(validarSlug("a_b"), "a_b");
  for (const s of ["ab", "-abc", "com espaço", "a".repeat(33), "ação", "api", "PAINEL", "admin", "a/b", "a.b", 5, null]) {
    assert.throws(() => validarSlug(s), UrlInvalida, String(s));
  }
});

test("agente: dispositivo e navegador", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
  const chromeAndroid = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
  const firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0";
  assert.deepEqual(classificarAgente(iphone), { dispositivo: "celular", navegador: "Safari" });
  assert.deepEqual(classificarAgente(edge), { dispositivo: "computador", navegador: "Edge" });
  assert.deepEqual(classificarAgente(chromeAndroid), { dispositivo: "celular", navegador: "Chrome" });
  assert.deepEqual(classificarAgente(firefox), { dispositivo: "computador", navegador: "Firefox" });
  assert.equal(classificarAgente("Googlebot/2.1").dispositivo, "robô");
  assert.equal(classificarAgente("curl/8.0").dispositivo, "robô");
  assert.equal(classificarAgente("").dispositivo, "robô");
});

test("origem a partir do Referer", () => {
  assert.equal(origemDoReferer("https://www.instagram.com/p/abc/"), "instagram.com");
  assert.equal(origemDoReferer(undefined), "direto");
  assert.equal(origemDoReferer("não é url"), "direto");
});
