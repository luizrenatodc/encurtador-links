// Gerador de QR Code em SVG, sem dependências. Modo byte (UTF-8), correção de erro nível M, versões 1 a 15.
// Segue a ISO/IEC 18004: padrões de posição, alinhamento, temporização, Reed-Solomon sobre GF(256),
// 8 máscaras com pontuação de penalidade e bits de formato/versão.

const ECC_POR_BLOCO_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24];
const BLOCOS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10];
const VERSAO_MAX = 15;

const tamanho = (v) => v * 4 + 17;

function modulosBrutos(v) {
  let n = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const a = Math.floor(v / 7) + 2;
    n -= (25 * a - 10) * a - 55;
    if (v >= 7) n -= 36;
  }
  return n;
}
const capacidadeDados = (v) => Math.floor(modulosBrutos(v) / 8) - ECC_POR_BLOCO_M[v] * BLOCOS_M[v];

function posicoesAlinhamento(v) {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2;
  const passo = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let pos = tamanho(v) - 7; r.length < n; pos -= passo) r.splice(1, 0, pos);
  return r;
}

// ---------- Reed-Solomon ----------
function mulGF(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function divisorRS(grau) {
  const r = new Array(grau - 1).fill(0).concat([1]);
  let raiz = 1;
  for (let i = 0; i < grau; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = mulGF(r[j], raiz);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    raiz = mulGF(raiz, 2);
  }
  return r;
}
function restoRS(dados, divisor) {
  const r = divisor.map(() => 0);
  for (const b of dados) {
    const f = b ^ r.shift();
    r.push(0);
    divisor.forEach((c, i) => (r[i] ^= mulGF(c, f)));
  }
  return r;
}

// ---------- codificação dos dados ----------
function codificar(bytes, v) {
  const bits = [];
  const poe = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  poe(0b0100, 4);
  poe(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) poe(b, 8);
  const cap = capacidadeDados(v) * 8;
  poe(0, Math.min(4, cap - bits.length));
  poe(0, (8 - (bits.length % 8)) % 8);
  const dados = [];
  for (let i = 0; i < bits.length; i += 8) dados.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; dados.length < capacidadeDados(v); pad ^= 0xec ^ 0x11) dados.push(pad);
  return dados;
}

function intercalar(dados, v) {
  const nBlocos = BLOCOS_M[v];
  const eccLen = ECC_POR_BLOCO_M[v];
  const brutos = Math.floor(modulosBrutos(v) / 8);
  const curtos = nBlocos - (brutos % nBlocos);
  const lenCurto = Math.floor(brutos / nBlocos);
  const divisor = divisorRS(eccLen);
  const blocos = [];
  for (let i = 0, k = 0; i < nBlocos; i++) {
    const dat = dados.slice(k, k + lenCurto - eccLen + (i < curtos ? 0 : 1));
    k += dat.length;
    const ecc = restoRS(dat, divisor);
    if (i < curtos) dat.push(0);
    blocos.push(dat.concat(ecc));
  }
  const saida = [];
  for (let i = 0; i < blocos[0].length; i++) {
    blocos.forEach((b, j) => { if (i !== lenCurto - eccLen || j >= curtos) saida.push(b[i]); });
  }
  return saida;
}

// ---------- matriz ----------
const MASCARAS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function montar(dados, v) {
  const n = tamanho(v);
  const m = Array.from({ length: n }, () => new Array(n).fill(false));
  const fn = Array.from({ length: n }, () => new Array(n).fill(false));
  const ponto = (x, y, escuro) => { m[y][x] = escuro; fn[y][x] = true; };
  const bit = (x, i) => ((x >>> i) & 1) !== 0;

  for (let i = 0; i < n; i++) { ponto(6, i, i % 2 === 0); ponto(i, 6, i % 2 === 0); }
  const localizador = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && x < n && y >= 0 && y < n) ponto(x, y, d !== 2 && d !== 4);
    }
  };
  localizador(3, 3); localizador(n - 4, 3); localizador(3, n - 4);
  const pos = posicoesAlinhamento(v);
  for (let i = 0; i < pos.length; i++) for (let j = 0; j < pos.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) ponto(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const formato = (mascara) => {
    const d = (0 << 3) | mascara; // nível M = 0
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const bits = ((d << 10) | r) ^ 0x5412;
    for (let i = 0; i <= 5; i++) ponto(8, i, bit(bits, i));
    ponto(8, 7, bit(bits, 6)); ponto(8, 8, bit(bits, 7)); ponto(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) ponto(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) ponto(n - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) ponto(8, n - 15 + i, bit(bits, i));
    ponto(8, n - 8, true);
  };
  formato(0); // reserva a área antes de posicionar os dados
  if (v >= 7) {
    let r = v;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const bits = (v << 12) | r;
    for (let i = 0; i < 18; i++) {
      const a = n - 11 + (i % 3), b = Math.floor(i / 3);
      ponto(a, b, bit(bits, i)); ponto(b, a, bit(bits, i));
    }
  }

  let k = 0;
  for (let dir = n - 1; dir >= 1; dir -= 2) {
    if (dir === 6) dir = 5;
    for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
      const x = dir - j;
      const y = ((dir + 1) & 2) === 0 ? n - 1 - vert : vert;
      if (!fn[y][x] && k < dados.length * 8) { m[y][x] = bit(dados[k >>> 3], 7 - (k & 7)); k++; }
    }
  }

  const aplicar = (mascara) => {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fn[y][x] && MASCARAS[mascara](x, y)) m[y][x] = !m[y][x];
  };
  let melhor = 0, menor = Infinity;
  for (let mk = 0; mk < 8; mk++) {
    aplicar(mk); formato(mk);
    const p = penalidade(m);
    if (p < menor) { menor = p; melhor = mk; }
    aplicar(mk);
  }
  aplicar(melhor); formato(melhor);
  return m;
}

function penalidade(m) {
  const n = m.length;
  let p = 0;
  const linhaPen = (get) => {
    for (let a = 0; a < n; a++) {
      let corrida = 1;
      for (let b = 1; b <= n; b++) {
        if (b < n && get(a, b) === get(a, b - 1)) corrida++;
        else { if (corrida >= 5) p += 3 + corrida - 5; corrida = 1; }
      }
      // padrão semelhante ao localizador: 1:1:3:1:1 com 4 módulos claros de um lado
      const s = Array.from({ length: n }, (_, b) => (get(a, b) ? "1" : "0")).join("");
      for (const re of [/10111010000/g, /00001011101/g]) p += 40 * (s.match(re)?.length ?? 0);
    }
  };
  linhaPen((a, b) => m[a][b]);
  linhaPen((a, b) => m[b][a]);
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
  }
  const escuros = m.flat().filter(Boolean).length;
  p += Math.floor(Math.abs(escuros * 20 - n * n * 10) / (n * n)) * 10; // equilíbrio claro/escuro
  return p;
}

/** Matriz booleana (true = módulo escuro) do QR para o texto. */
export function matrizQR(texto) {
  const bytes = [...new TextEncoder().encode(texto)];
  let v = 1;
  while (v <= VERSAO_MAX && 4 + (v < 10 ? 8 : 16) + bytes.length * 8 > capacidadeDados(v) * 8) v++;
  if (v > VERSAO_MAX) throw new RangeError("Texto grande demais para o QR (máximo ~330 bytes).");
  return montar(intercalar(codificar(bytes, v), v), v);
}

/** SVG do QR (módulos pretos em fundo branco, com zona de silêncio de 4 módulos). */
export function qrSvg(texto, { cor = "#000", fundo = "#fff", borda = 4 } = {}) {
  const m = matrizQR(texto);
  const total = m.length + borda * 2;
  let d = "";
  m.forEach((linha, y) => {
    for (let x = 0; x < linha.length; x++) {
      if (!linha[x]) continue;
      let f = x;
      while (f < linha.length && linha[f]) f++;
      d += `M${x + borda} ${y + borda}h${f - x}v1h${x - f}z`;
      x = f;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="QR Code do link"><rect width="${total}" height="${total}" fill="${fundo}"/><path d="${d}" fill="${cor}"/></svg>`;
}
