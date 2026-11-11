// Painel do Atalho: SPA sem build. Texto de usuário sempre entra por textContent; gráficos e QR são SVG.
const raiz = document.getElementById("raiz");
const avisos = document.getElementById("avisos");
const NS = "http://www.w3.org/2000/svg";
let chave = ""; // chave do painel (só se o servidor exigir PAINEL_TOKEN)
try { chave = sessionStorage.getItem("chave") ?? ""; } catch { /* armazenamento indisponível */ }

// ---------- utilidades ----------
function h(tag, props = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === false || v == null) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k in el && k !== "list") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  el.append(...filhos.flat().filter((f) => f != null && f !== false));
  return el;
}
function s(tag, attrs = {}, ...filhos) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...filhos.filter(Boolean));
  return el;
}
const ICONES = {
  copiar: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
  abrir: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  seta: '<path d="M7 17L17 7M9 7h8v8"/>',
  lixo: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3"/>',
  pausa: '<path d="M9 5v14M15 5v14"/>',
  tocar: '<path d="M7 4l12 8-12 8z"/>',
  baixar: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  busca: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
};
function icone(nome) {
  const el = s("svg", { viewBox: "0 0 24 24", class: "ic", "aria-hidden": "true" });
  el.innerHTML = ICONES[nome]; // constante do código
  return el;
}
function aviso(msg, erro = false) {
  const el = h("div", { class: `aviso ${erro ? "erro" : ""}` }, msg);
  avisos.append(el);
  setTimeout(() => el.remove(), 3800);
}
async function api(metodo, caminho, corpo) {
  const cab = {};
  if (chave) cab["x-api-key"] = chave;
  if (metodo === "POST" || metodo === "PATCH") cab["content-type"] = "application/json";
  const r = await fetch(`/api${caminho}`, { method: metodo, headers: cab, body: metodo === "POST" || metodo === "PATCH" ? JSON.stringify(corpo ?? {}) : undefined });
  if (r.status === 401) throw Object.assign(new Error("Chave de acesso necessária."), { precisaChave: true });
  const tipo = r.headers.get("content-type") ?? "";
  const dados = tipo.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error(dados.erro ?? `Erro ${r.status}`);
  return dados;
}
const fmtNum = (n) => n.toLocaleString("pt-BR");
const fmtDia = (iso, opc = { day: "2-digit", month: "short" }) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", opc).replace(".", "");
function relativo(iso) {
  if (!iso) return "nenhum";
  const seg = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (seg < 60) return "agora";
  if (seg < 3600) return `há ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `há ${Math.floor(seg / 3600)} h`;
  return `há ${Math.floor(seg / 86400)} d`;
}
function hostDe(url) { try { return new URL(url).host; } catch { return url; } }
async function copiar(texto, ok = "Link copiado") {
  try { await navigator.clipboard.writeText(texto); } catch {
    const t = h("textarea", { value: texto, class: "oculto" });
    document.body.append(t); t.select(); document.execCommand("copy"); t.remove();
  }
  aviso(ok);
}

// ---------- estado ----------
const est = { links: [], selecionado: null, filtro: "", dias: 30, totalCliques: 0 };
let elLista, elDetalhe, elResumo;

// ---------- minigráfico e gráfico ----------
function sparkline(vals) {
  const w = 76, hh = 26, max = Math.max(1, ...vals);
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * (w - 4) + 2, hh - 3 - (v / max) * (hh - 7)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");
  return s("svg", { viewBox: `0 0 ${w} ${hh}`, class: "spark", "aria-hidden": "true" }, s("path", { d, class: "spark-linha" }), s("circle", { cx: pts.at(-1)[0], cy: pts.at(-1)[1], r: 2.4, class: "spark-ponto" }));
}

function escalaNice(max) {
  if (max <= 4) return { topo: 4, passo: 1 };
  const bruto = max / 4;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= bruto);
  return { topo: Math.ceil(max / passo) * passo, passo };
}

function grafico(serie) {
  const W = 760, H = 270, e = 46, d = 14, t = 14, b = 30;
  const max = Math.max(...serie.map((x) => x.cliques));
  const { topo, passo } = escalaNice(max);
  const x = (i) => e + (i / (serie.length - 1)) * (W - e - d);
  const y = (v) => t + (1 - v / topo) * (H - t - b);
  const linha = serie.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.cliques).toFixed(1)}`).join("");
  const area = `${linha}L${x(serie.length - 1)} ${H - b}L${x(0)} ${H - b}Z`;
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "grafico", role: "img", "aria-label": `Cliques por dia nos últimos ${serie.length} dias. Total: ${fmtNum(serie.reduce((a, p) => a + p.cliques, 0))}. Pico: ${fmtNum(max)} em ${fmtDia(serie.find((p) => p.cliques === max).dia)}.` });
  svg.append(s("defs", {}, (() => {
    const g = s("linearGradient", { id: "areaGrad", x1: "0", y1: "0", x2: "0", y2: "1" });
    g.append(s("stop", { offset: "0", class: "g0" }), s("stop", { offset: "1", class: "g1" }));
    return g;
  })()));
  for (let v = 0; v <= topo + 1e-9; v += passo) {
    svg.append(s("line", { x1: e, x2: W - d, y1: y(v), y2: y(v), class: v === 0 ? "eixo" : "grade" }));
    const rot = s("text", { x: e - 8, y: y(v) + 4, class: "rotulo", "text-anchor": "end" }); rot.textContent = fmtNum(v);
    svg.append(rot);
  }
  const cada = Math.ceil(serie.length / 7);
  serie.forEach((p, i) => {
    if ((serie.length - 1 - i) % cada) return;
    const r = s("text", { x: x(i), y: H - 8, class: "rotulo", "text-anchor": i === 0 ? "start" : i === serie.length - 1 ? "end" : "middle" }); r.textContent = fmtDia(p.dia);
    svg.append(r);
  });
  svg.append(s("path", { d: area, fill: "url(#areaGrad)" }), s("path", { d: linha, class: "linha" }));
  const guia = s("line", { y1: t, y2: H - b, class: "guia", visibility: "hidden" });
  const ponto = s("circle", { r: 5.5, class: "ponto", visibility: "hidden" });
  svg.append(guia, ponto);

  const dica = h("div", { class: "dica-grafico", hidden: true, "aria-hidden": "true" });
  const caixa = h("div", { class: "grafico-caixa" }, svg, dica);
  const alvo = s("rect", { x: e, y: t, width: W - e - d, height: H - t - b, fill: "transparent" });
  svg.append(alvo);
  const mover = (ev) => {
    const r = svg.getBoundingClientRect();
    const vx = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(serie.length - 1, Math.round(((vx - e) / (W - e - d)) * (serie.length - 1))));
    const p = serie[i];
    guia.setAttribute("x1", x(i)); guia.setAttribute("x2", x(i)); guia.setAttribute("visibility", "visible");
    ponto.setAttribute("cx", x(i)); ponto.setAttribute("cy", y(p.cliques)); ponto.setAttribute("visibility", "visible");
    dica.hidden = false;
    dica.replaceChildren(h("strong", {}, fmtNum(p.cliques)), ` ${p.cliques === 1 ? "clique" : "cliques"}`, h("span", {}, fmtDia(p.dia, { weekday: "short", day: "2-digit", month: "short" })));
    const pct = (x(i) / W) * 100;
    dica.style.left = `${pct}%`;
    dica.style.top = `${(y(p.cliques) / H) * 100}%`;
    dica.classList.toggle("esq", pct > 70);
  };
  const sair = () => { guia.setAttribute("visibility", "hidden"); ponto.setAttribute("visibility", "hidden"); dica.hidden = true; };
  alvo.addEventListener("pointermove", mover);
  alvo.addEventListener("pointerdown", mover);
  alvo.addEventListener("pointerleave", sair);
  return caixa;
}

function barras(titulo, itens, total) {
  return h("section", { class: "barras" }, h("h3", {}, titulo),
    itens.length ? h("ul", {}, itens.map((i) => {
      const pct = total ? (i.cliques / total) * 100 : 0;
      const trilho = h("span", { class: "trilho" }, h("span", { class: "enchimento" }));
      trilho.firstChild.style.width = `${Math.max(pct, 2)}%`;
      return h("li", {}, h("span", { class: "nome" }, i.nome), trilho, h("span", { class: "val" }, `${Math.round(pct)}%`, h("small", {}, fmtNum(i.cliques))));
    })) : h("p", { class: "dica" }, "Sem dados no período."));
}

// ---------- telas ----------
const chip = (estado) => h("span", { class: `chip ${estado}` }, { ativo: "Ativo", expirado: "Expirado", pausado: "Pausado" }[estado]);

function itemLista(l) {
  const sel = est.selecionado === l.slug;
  const b = h("button", { type: "button", class: `item ${sel ? "sel" : ""} ${l.estado !== "ativo" ? "inativo" : ""}`, "aria-current": sel ? "true" : false, onclick: () => selecionar(l.slug) },
    h("span", { class: "item-topo" }, h("span", { class: "slug" }, `/${l.slug}`), chip(l.estado)),
    h("span", { class: "item-sub" }, l.titulo || hostDe(l.url)),
    h("span", { class: "item-base" }, sparkline(l.ultimos7), h("span", { class: "cliques" }, h("strong", {}, fmtNum(l.cliques)), " cliques")));
  return h("li", {}, b);
}
function pintarLista() {
  const q = est.filtro.trim().toLowerCase();
  const vis = est.links.filter((l) => !q || `${l.slug} ${l.url} ${l.titulo}`.toLowerCase().includes(q));
  elLista.replaceChildren(...(vis.length ? vis.map(itemLista) : [h("li", { class: "vazio" }, q ? "Nenhum link com esse termo." : "Nenhum link ainda. Crie o primeiro acima.")]));
  const ativos = est.links.filter((l) => l.estado === "ativo").length;
  elResumo.replaceChildren(h("span", {}, h("strong", {}, fmtNum(est.links.length)), " links"), h("span", {}, h("strong", {}, fmtNum(ativos)), " ativos"), h("span", {}, h("strong", {}, fmtNum(est.totalCliques)), " cliques"));
}
async function recarregar() {
  const r = await api("GET", "/links");
  est.links = r.links;
  est.totalCliques = r.total_cliques;
  pintarLista();
}

function formCriar() {
  const url = h("input", { id: "c-url", type: "url", required: true, placeholder: "https://example.com/uma/pagina/bem/longa", autocomplete: "off", inputMode: "url" });
  const slug = h("input", { id: "c-slug", type: "text", placeholder: "gerado automaticamente", autocomplete: "off", maxLength: 32, pattern: "[A-Za-z0-9][A-Za-z0-9_\\-]{2,31}", autocapitalize: "none" });
  const titulo = h("input", { id: "c-titulo", type: "text", placeholder: "Opcional, só para você", maxLength: 80 });
  const exp = h("select", { id: "c-exp" }, [["", "Nunca expira"], ["1", "Em 1 dia"], ["7", "Em 7 dias"], ["30", "Em 30 dias"], ["90", "Em 90 dias"], ["365", "Em 1 ano"]].map(([v, t]) => h("option", { value: v }, t)));
  const erro = h("p", { class: "erro-form", role: "alert" });
  const btn = h("button", { class: "btn primario", type: "submit" }, "Encurtar link");
  return h("form", { class: "cartao form-criar", onsubmit: async (e) => {
    e.preventDefault();
    erro.textContent = "";
    btn.disabled = true;
    try {
      const corpo = { url: url.value };
      if (slug.value.trim()) corpo.slug = slug.value.trim();
      if (titulo.value.trim()) corpo.titulo = titulo.value.trim();
      if (exp.value) corpo.expira_dias = Number(exp.value);
      const l = await api("POST", "/links", corpo);
      url.value = slug.value = titulo.value = ""; exp.value = "";
      await recarregar();
      await selecionar(l.slug);
      aviso(`Criado: ${l.curto}`);
    } catch (err) {
      if (err.precisaChave) return pedirChave();
      erro.textContent = err.message;
    } finally { btn.disabled = false; }
  } },
  h("h2", {}, "Novo link"),
  h("div", { class: "campo" }, h("label", { for: "c-url" }, "URL de destino"), url),
  h("div", { class: "duas" },
    h("div", { class: "campo" }, h("label", { for: "c-slug" }, "Apelido (opcional)"), h("div", { class: "prefixo" }, h("span", { title: `${location.host}/` }, "/"), slug)),
    h("div", { class: "campo" }, h("label", { for: "c-exp" }, "Expiração"), exp)),
  h("div", { class: "campo" }, h("label", { for: "c-titulo" }, "Título"), titulo),
  erro, btn);
}

async function selecionar(slug) {
  est.selecionado = slug;
  history.replaceState(null, "", `#/${slug}`);
  pintarLista();
  await pintarDetalhe();
  recarregar().catch(() => {}); // atualiza contadores e minigráficos da lista
  if (matchMedia("(max-width: 940px)").matches) elDetalhe.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function pintarDetalhe() {
  if (!est.selecionado) {
    elDetalhe.replaceChildren(h("div", { class: "vazio-detalhe" }, h("div", { class: "seta-grande" }, icone("seta")), h("h2", {}, "Escolha um link"), h("p", {}, "Os cliques por dia, a origem, o dispositivo e o QR Code aparecem aqui.")));
    return;
  }
  const slug = est.selecionado;
  let l, e;
  try {
    [l, e] = await Promise.all([api("GET", `/links/${slug}`), api("GET", `/links/${slug}/estatisticas?dias=${est.dias}`)]);
  } catch (err) {
    if (err.precisaChave) return pedirChave();
    est.selecionado = null;
    history.replaceState(null, "", "#/");
    pintarLista();
    return pintarDetalhe();
  }
  const kpi = (rot, val, sub) => h("div", { class: "kpi" }, h("span", { class: "kpi-rot" }, rot), h("strong", {}, val), h("span", { class: "kpi-sub" }, sub));
  const seletor = h("div", { class: "periodos", role: "group", "aria-label": "Período do gráfico" }, [7, 30, 90].map((d) => h("button", { type: "button", class: d === est.dias ? "atual" : "", "aria-pressed": String(d === est.dias), onclick: () => { est.dias = d; pintarDetalhe(); } }, `${d} dias`)));
  const tabela = h("details", { class: "tabela-dados" }, h("summary", {}, "Ver dados em tabela"),
    h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Dia"), h("th", {}, "Cliques"))), h("tbody", {}, [...e.serie].reverse().map((p) => h("tr", {}, h("td", {}, fmtDia(p.dia, { day: "2-digit", month: "2-digit", year: "numeric" })), h("td", {}, String(p.cliques)))))));

  const qrImg = h("img", { class: "qr", alt: `QR Code de ${l.curto}`, width: 168, height: 168 });
  let svgQr = "";
  api("GET", `/links/${slug}/qr.svg`).then((svg) => { svgQr = svg; qrImg.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; }).catch(() => {});
  const expInput = h("input", { type: "date", id: "d-exp", "aria-label": "Nova data de expiração" });
  expInput.min = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);

  const acao = async (fn, msg) => { try { await fn(); await recarregar(); await pintarDetalhe(); if (msg) aviso(msg); } catch (err) { aviso(err.message, true); } };
  elDetalhe.replaceChildren(
    h("header", { class: "det-topo" },
      h("div", { class: "det-url" },
        h("div", { class: "linha-chip" }, chip(l.estado), l.expira_em ? h("span", { class: "dica" }, `${l.estado === "expirado" ? "expirou" : "expira"} em ${new Date(l.expira_em).toLocaleDateString("pt-BR")}`) : h("span", { class: "dica" }, "sem expiração")),
        h("h2", {}, h("a", { href: l.curto, target: "_blank", rel: "noopener" }, l.curto.replace(/^https?:\/\//, ""))),
        h("p", { class: "destino", title: l.url }, h("span", {}, "→ "), l.titulo ? h("strong", {}, `${l.titulo} · `) : null, l.url)),
      h("div", { class: "det-acoes" },
        h("button", { class: "btn", type: "button", onclick: () => copiar(l.curto) }, icone("copiar"), "Copiar"),
        h("a", { class: "btn", href: l.curto, target: "_blank", rel: "noopener" }, icone("abrir"), "Abrir"))),
    h("div", { class: "kpis" }, kpi("Cliques no total", fmtNum(e.total), `${fmtNum(e.periodo)} nos últimos ${e.dias} dias`), kpi("Hoje", fmtNum(e.hoje), "desde 00h"), kpi("Últimos 7 dias", fmtNum(e.ultimos7), `média ${(e.ultimos7 / 7).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por dia`), kpi("Último clique", relativo(e.ultimo_clique), e.ultimo_clique ? new Date(e.ultimo_clique).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "–")),
    h("section", { class: "cartao bloco" }, h("div", { class: "bloco-topo" }, h("h3", {}, "Cliques por dia"), seletor), grafico(e.serie), tabela),
    h("div", { class: "grade-2" },
      h("section", { class: "cartao bloco" }, h("h3", {}, "De onde vêm"), barras("Origem", e.origens, e.periodo)),
      h("section", { class: "cartao bloco" }, h("div", { class: "duas-col" }, barras("Dispositivo", e.dispositivos, e.periodo), barras("Navegador", e.navegadores, e.periodo)))),
    h("div", { class: "grade-2" },
      h("section", { class: "cartao bloco qr-bloco" }, qrImg, h("div", {}, h("h3", {}, "QR Code"), h("p", { class: "dica" }, "Gerado aqui mesmo, sem serviço externo. Aponta para o link curto."),
        h("button", { class: "btn", type: "button", onclick: () => {
          const a = h("a", { href: URL.createObjectURL(new Blob([svgQr], { type: "image/svg+xml" })), download: `qr-${slug}.svg` });
          a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        } }, icone("baixar"), "Baixar SVG"))),
      h("section", { class: "cartao bloco gerenciar" }, h("h3", {}, "Gerenciar"),
        h("div", { class: "linha-btn" },
          l.ativo ? h("button", { class: "btn", type: "button", onclick: () => acao(() => api("PATCH", `/links/${slug}`, { ativo: false }), "Link pausado") }, icone("pausa"), "Pausar")
            : h("button", { class: "btn primario", type: "button", onclick: () => acao(() => api("PATCH", `/links/${slug}`, { ativo: true }), "Link reativado") }, icone("tocar"), "Reativar")),
        h("div", { class: "linha-exp" }, h("label", { for: "d-exp" }, "Mudar expiração"), expInput,
          h("button", { class: "btn", type: "button", onclick: () => expInput.value && acao(() => api("PATCH", `/links/${slug}`, { expira_em: new Date(`${expInput.value}T23:59:00-03:00`).toISOString() }), "Expiração atualizada") }, "Salvar"),
          l.expira_em ? h("button", { class: "btn sutil", type: "button", onclick: () => acao(() => api("PATCH", `/links/${slug}`, { expira_em: null }), "Expiração removida") }, "Remover") : null),
        h("button", { class: "btn perigo", type: "button", onclick: () => confirm(`Excluir /${slug} e todo o histórico de cliques? Não dá para desfazer.`) && acao(async () => { await api("DELETE", `/links/${slug}`); est.selecionado = null; history.replaceState(null, "", "#/"); }, "Link excluído") }, icone("lixo"), "Excluir link"))));
}

function pedirChave() {
  if (document.querySelector("dialog.dialogo")) return;
  const campo = h("input", { type: "password", id: "chave", autocomplete: "off", required: true });
  const dlg = h("dialog", { class: "dialogo" }, h("form", { method: "dialog", onsubmit: (e) => {
    e.preventDefault();
    chave = campo.value;
    try { sessionStorage.setItem("chave", chave); } catch { /* ok */ }
    dlg.close();
    iniciar();
  } }, h("h2", {}, "Painel protegido"), h("p", { class: "dica" }, "Este servidor foi iniciado com PAINEL_TOKEN. Informe a chave para continuar."), h("label", { for: "chave" }, "Chave de acesso"), campo, h("div", { class: "linha-btn" }, h("button", { class: "btn primario", type: "submit" }, "Entrar"))));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

function montar() {
  const busca = h("input", { type: "search", placeholder: "Buscar por apelido, destino ou título", "aria-label": "Buscar links", oninput: (e) => { est.filtro = e.target.value; pintarLista(); } });
  elLista = h("ul", { class: "lista" });
  elResumo = h("div", { class: "resumo" });
  elDetalhe = h("section", { class: "detalhe", "aria-live": "polite", "aria-label": "Detalhes do link" });
  raiz.replaceChildren(h("div", { class: "pagina" },
    h("header", { class: "topo" }, h("a", { href: "#/", class: "marca", "aria-label": "Atalho" }, h("span", { class: "marca-sel" }, icone("seta")), h("span", {}, "Atalho")), h("span", { class: "selo-demo" }, "Demonstração com dados fictícios")),
    h("main", { id: "conteudo", class: "grade" },
      h("aside", { class: "esquerda" }, formCriar(), h("div", { class: "cartao lista-caixa" }, elResumo, h("div", { class: "busca" }, icone("busca"), busca), elLista)),
      elDetalhe)));
}

async function iniciar() {
  montar();
  try {
    await recarregar();
  } catch (err) {
    if (err.precisaChave) return pedirChave();
    aviso(err.message, true);
  }
  const doHash = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  est.selecionado = est.links.find((l) => l.slug === doHash)?.slug ?? est.links.find((l) => l.estado === "ativo")?.slug ?? null;
  pintarLista();
  await pintarDetalhe();
}
iniciar();
