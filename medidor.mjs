#!/usr/bin/env node
// medidor-3d: mide una página WebGL con Chrome real (fps, tiempos de cuadro, long tasks, draw calls, peso, memoria).
//   node medidor.mjs <url> [opciones]          → reportes/<host>-<AAAAMMDD-HHMM>.{json,md}
//   node medidor.mjs comparar a.json b.json [--md comparacion.md]
//   node medidor.mjs comparar-capturas a.png|carpetaA b.png|carpetaB [--zonas zonas.json] [--umbral 10] [--diff diff.png] [--md salida.md]
//   node medidor.mjs capturas <url> --pasos vistas.json --captura carpeta/pref.png [--solo-canvas] [--listo …]   (v0.5: solo capturas)
//   node medidor.mjs <urlA> --intercalar <urlB> --repetir N   (v0.5: A1 B1 A2 B2 …, con veredicto por pares)
// Ver README.md para las opciones.
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resumirPaso, resumirLongTasks, esSoftware, aMarkdown, comparar, comparacionMd, alertas, agregarCorridas, compararCapturas, capturasMd, resumirAB, resumirIntercalado } from './lib.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const log = (...a) => console.error('[medidor]', ...a);
const rojo = (s) => (process.stderr.isTTY ? `\x1b[31m${s}\x1b[0m` : s);
const MB = (b) => Math.round((b / 1048576) * 10) / 10;

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    etiqueta: { type: 'string' }, dur: { type: 'string', default: '10' }, calentar: { type: 'string', default: '3' },
    listo: { type: 'string' }, js: { type: 'string' }, pasos: { type: 'string' }, repetir: { type: 'string', default: '1' },
    ancho: { type: 'string', default: '1600' }, alto: { type: 'string', default: '900' }, dpr: { type: 'string', default: '1' },
    'sin-vsync': { type: 'boolean' }, visible: { type: 'boolean' }, 'sin-gl': { type: 'boolean' }, interactuar: { type: 'boolean' },
    chrome: { type: 'string' }, angle: { type: 'string' }, extra: { type: 'string' }, cpu: { type: 'string' },
    captura: { type: 'string' }, congelar: { type: 'string' }, 'congelar-cuadros': { type: 'string' },
    zonas: { type: 'string' }, umbral: { type: 'string', default: '10' }, diff: { type: 'string' },
    salida: { type: 'string' }, md: { type: 'string' }, ab: { type: 'string' }, ayuda: { type: 'boolean', short: 'h' },
    intercalar: { type: 'string' }, caliente: { type: 'boolean' }, limite: { type: 'string' }, 'solo-canvas': { type: 'boolean' },
  },
});

if (o.ayuda || !positionals.length) {
  console.error(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 8).join('\n'));
  process.exit(positionals.length || o.ayuda ? 0 : 1);
}
const n = (k) => { const v = Number(o[k]); if (!Number.isFinite(v) || v < 0) { log(`--${k} debe ser un número`); process.exit(1); } return v; };

if (positionals[0] === 'comparar') {
  const abrir = (f) => JSON.parse(readFileSync(existsSync(f) ? f : `${f}.json`, 'utf8'));
  if (positionals.length < 3) { log('uso: node medidor.mjs comparar a.json b.json [--md salida.md]'); process.exit(1); }
  const A = abrir(positionals[1]), B = abrir(positionals[2]), md = comparacionMd(A, B, comparar(A, B));
  if (o.md) writeFileSync(o.md, md);
  process.stdout.write(md);
  process.exit(0);
}

if (positionals[0] === 'comparar-capturas') {
  if (positionals.length < 3) { log('uso: node medidor.mjs comparar-capturas a.png b.png [--zonas zonas.json] [--umbral 10] [--diff diff.png] [--md salida.md]'); process.exit(1); }
  const [, fa, fb] = positionals;
  const esDir = (f) => existsSync(f) && statSync(f).isDirectory();
  if (esDir(fa) || esDir(fb)) { // v0.5: dos carpetas → cada .png que esté en las dos, una fila por archivo
    if (!esDir(fa) || !esDir(fb)) { log('comparar-capturas: si una es carpeta, las dos tienen que serlo'); process.exit(1); }
    const zonas = o.zonas ? JSON.parse(readFileSync(o.zonas, 'utf8')) : null, filas = [];
    const nombres = readdirSync(fa).filter((x) => /\.png$/i.test(x) && existsSync(join(fb, x))).sort();
    if (!nombres.length) { log('comparar-capturas: no hay .png con el mismo nombre en las dos carpetas'); process.exit(1); }
    let fallas = 0;
    for (const x of nombres) {
      try {
        const r = compararCapturas(readFileSync(join(fa, x)), readFileSync(join(fb, x)), { zonas, umbral: n('umbral') });
        filas.push(`| ${x} | ${r.total.lumA} | ${r.total.lumB} | ${r.total.delta} | ${r.total.difierenPct} |`, ...(r.zonas || []).map((z) => `| ↳ ${z.nombre} | ${z.lumA} | ${z.lumB} | ${z.delta} | ${z.difierenPct} |`));
      } catch (e) { fallas++; filas.push(`| ${x} | – | – | – | ${e.message} |`); }
    }
    const md = [`# Capturas: ${fa} contra ${fb}`, '', `umbral ${n('umbral')} · ${nombres.length} archivo(s)`, '', '| archivo / zona | luminancia A | luminancia B | Δ% | píxeles que difieren % |', '|---|---|---|---|---|', ...filas, ''].join('\n');
    if (o.md) writeFileSync(o.md, md);
    process.stdout.write(md);
    if (fallas) log(rojo(`${fallas} de ${nombres.length} comparaciones fallaron`));
    process.exit(fallas ? 1 : 0);
  }
  let r;
  try {
    r = compararCapturas(readFileSync(fa), readFileSync(fb), { zonas: o.zonas ? JSON.parse(readFileSync(o.zonas, 'utf8')) : null, umbral: n('umbral'), diff: !!o.diff });
  } catch (e) { log(e.message); process.exit(1); }
  if (o.diff) writeFileSync(o.diff, r.diffPng);
  const md = capturasMd(fa, fb, r);
  if (o.md) writeFileSync(o.md, md);
  process.stdout.write(md);
  process.exit(0);
}

// ---------------- medir
const soloCapturas = positionals[0] === 'capturas';
const url = soloCapturas ? positionals[1] : positionals[0], urlB = o.intercalar ?? null;
if (!url) { log('falta la URL'); process.exit(1); }
if (soloCapturas && !o.captura) { log('capturas: falta --captura carpeta/pref.png (con varios pasos sale pref-<paso>.png)'); process.exit(1); }
if (urlB && o.ab != null) { log('--intercalar y --ab no se combinan: --ab compara dos variantes en la misma página, --intercalar dos URLs'); process.exit(1); }
if (urlB && o.captura) { log('--intercalar no captura (las dos URLs escribirían el mismo archivo): usa el subcomando capturas para cada una y comparar-capturas carpetaA carpetaB'); process.exit(1); }
const dur = n('dur'), calentar = n('calentar'), ancho = n('ancho'), alto = n('alto'), dpr = n('dpr'), nCpu = o.cpu ? n('cpu') : 0;
const reps = Math.max(1, Math.round(n('repetir'))), nCongelar = o['congelar-cuadros'] != null ? Math.round(n('congelar-cuadros')) : null;
const congelar = o.congelar != null || nCongelar != null; // con cualquiera de los dos, las capturas salen de su propia pasada
let pasos = o.pasos ? JSON.parse(readFileSync(o.pasos, 'utf8')) : [{ nombre: 'base' }];
const nombrePaso = (p, i) => p.nombre || `paso${i + 1}`;
{ const ns = pasos.map(nombrePaso), rep = ns.find((x, i) => ns.indexOf(x) !== i); if (rep) { log(`--pasos: el nombre "${rep}" se repite; cada paso necesita un nombre distinto (rangos y comparar se emparejan por nombre)`); process.exit(1); } }
// --ab N (v0.4): los dos últimos pasos son la variante A y la B; los anteriores corren una vez (preparación). Se intercalan
// A#1 B#1 A#2 … B#N A#N+1 y cada B se compara con sus dos A vecinas: una escena que cambia sola no se confunde con la variante.
let AB = null;
if (o.ab != null) {
  const veces = Math.max(1, Math.round(n('ab')));
  if (pasos.length < 2) { log('--ab necesita --pasos con al menos 2 pasos: los dos últimos son A y B'); process.exit(1); }
  const [A, B] = pasos.slice(-2), a = nombrePaso(A, pasos.length - 2), b = nombrePaso(B, pasos.length - 1);
  if (a === b) { log('--ab: A y B necesitan nombres distintos'); process.exit(1); }
  AB = { a, b };
  pasos = [...pasos.slice(0, -2), ...Array.from({ length: veces }, (_, i) => [{ ...A, nombre: `${a}#${i + 1}` }, { ...B, nombre: `${b}#${i + 1}` }]).flat(), { ...A, nombre: `${a}#${veces + 1}` }];
}
const LIMITE = 120000;
// v0.5: tope por corrida. Una corrida colgada (pasó en una migración con --sin-vsync: más de 9 min) ya no detiene todo: se cierra el
// navegador y se sigue con la siguiente. Por defecto: carga y listo (2 × 120 s) + 1.5 × (calentar + pasos) + 60 s; la fría de --caliente suma 120 s.
const limiteMs = o.limite != null ? n('limite') * 1000
  : 2 * LIMITE + 1.5 * 1000 * (calentar + pasos.reduce((s, p) => s + (p.dur ?? dur) + (p.espera ?? 0) / 1000, 0)) + 60000 + (o.caliente ? LIMITE : 0);

let chromium;
try { ({ chromium } = await import('playwright-core')); } catch { log('falta playwright-core: corre `npm i` en la carpeta del medidor'); process.exit(1); }

const linux = process.platform === 'linux';
const args = process.platform === 'win32' ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
  : linux ? ['--headless=new', '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
  : ['--enable-gpu', '--ignore-gpu-blocklist'];
if (o.angle) { const i = args.findIndex((a) => a.startsWith('--use-angle=')); i >= 0 ? (args[i] = `--use-angle=${o.angle}`) : args.push(`--use-angle=${o.angle}`); }
if (o['sin-vsync']) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
if (o.visible) { const i = args.indexOf('--headless=new'); if (i >= 0) args.splice(i, 1); }
const exe = o.chrome || process.env.CHROME;
const sonda = readFileSync(join(AQUI, 'sonda.js'), 'utf8');
const abiertos = new Set(); // navegadores vivos, para cerrarlos si una corrida pasa el límite
// generación de la corrida en curso: conLimite la sube al vencer; un launch() que termina después (de una corrida ya descartada) se cierra solo
let gen = 0;

// un navegador nuevo por corrida: perfil temporal limpio, sin caché HTTP ni de shaders de la corrida anterior
async function lanzar() {
  const mia = gen;
  try {
    const b = await chromium.launch({ ...(exe ? { executablePath: exe } : { channel: 'chrome' }), headless: !o.visible, args });
    if (mia !== gen) { await b.close().catch(() => {}); throw new Error('corrida descartada por --limite'); } // no contamina la siguiente
    abiertos.add(b); b.on('disconnected', () => abiertos.delete(b));
    return b;
  } catch (e) {
    if (mia !== gen) throw e;
    log(`no se pudo abrir Chrome (${exe || 'channel chrome'}): ${e.message.split('\n')[0]}`);
    log('pasa la ruta con --chrome <ruta> o la variable CHROME');
    process.exit(2);
  }
}

async function abrir(browser, cfg) {
  // bypassCSP: --listo/--js/--extra se evalúan como string (eval en la página); una CSP sin 'unsafe-eval' los rompería.
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: dpr, bypassCSP: true });
  await ctx.addInitScript({ content: `window.__medidorCfg = ${JSON.stringify(cfg)};\n${sonda}` });
  const page = await ctx.newPage(), errores = [];
  page.on('pageerror', (e) => errores.length < 30 && errores.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errores.length < 30 && errores.push(`[console] ${m.text()}`));
  return { ctx, page, errores };
}

async function cargar(page, errores, u) {
  try { await page.goto(u, { waitUntil: 'load', timeout: LIMITE }); } catch (e) { errores.push(`[goto] ${e.message.split('\n')[0]}`); }
  if (o.listo) {
    await page.waitForFunction(o.listo, null, { timeout: LIMITE, polling: 100 }).catch((e) => errores.push(e.name === 'TimeoutError'
      ? `[listo] no se cumplió en ${LIMITE / 1000} s: ${o.listo}` : `[listo] error: ${e.message.split('\n')[0]}`));
  } else await page.waitForTimeout(2000);
}

// arrastres reales (izquierdo = orbitar, derecho = desplazar) y rueda sobre el canvas más grande, hasta agotar ms
async function interactuar(page, ms) {
  const r = await page.evaluate(() => { const c = [...document.querySelectorAll('canvas')].map((x) => x.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0]; return c && { x: c.x, y: c.y, w: c.width, h: c.height }; }) || { x: 0, y: 0, w: ancho, h: alto };
  const fin = Date.now() + ms, cx = r.x + r.w * 0.45, cy = r.y + r.h * 0.5;
  for (let k = 0; Date.now() < fin; k++) {
    const boton = k % 4 === 3 ? 'right' : 'left';
    await page.mouse.move(cx, cy); await page.mouse.down({ button: boton });
    for (let i = 0; i < 40 && Date.now() < fin; i++) await page.mouse.move(cx + Math.sin(i / 7 + k) * r.w * 0.2, cy + Math.cos(i / 11 + k) * r.h * 0.12, { steps: 2 });
    await page.mouse.up({ button: boton });
    if (k % 3 === 0) for (let i = 0; i < 6 && Date.now() < fin; i++) { await page.mouse.wheel(0, k % 2 ? 200 : -200); await page.waitForTimeout(50); }
    await page.waitForTimeout(Math.max(0, Math.min(300, fin - Date.now())));
  }
}

/** Una corrida completa en un navegador nuevo → {entorno, carga, pasos, cpu}. */
async function corrida(u, ultima) {
  const browser = await lanzar();
  const { ctx, page, errores } = await abrir(browser, { sinGl: !!o['sin-gl'] });
  const cdp = await ctx.newCDPSession(page);

  // peso transferido por CDP
  const urls = new Map(), recibidos = [];
  cdp.on('Network.requestWillBeSent', (e) => urls.set(e.requestId, e.request.url));
  cdp.on('Network.loadingFinished', (e) => recibidos.push({ url: urls.get(e.requestId) || '?', bytes: e.encodedDataLength }));
  await cdp.send('Network.enable');
  // --caliente (v0.5): con caché HTTP, como un usuario que vuelve; sin él, cada carga baja todo
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: !o.caliente });

  const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return MB((await cdp.send('Runtime.getHeapUsage')).usedSize); };
  const extra = () => (o.extra ? page.evaluate(`(() => { const v = (${o.extra}); return v === undefined ? null : JSON.parse(JSON.stringify(v)); })()`).catch((e) => ({ error: String(e.message || e) })) : null);

  // --caliente: una primera visita sin medir llena la caché de HTTP y la de shaders del navegador (ANGLE/Dawn); se mide la segunda
  let fria = null;
  if (o.caliente) {
    log(`primera visita (fría) a ${u}`);
    await cargar(page, errores, u);
    fria = { listoMs: Math.round(await page.evaluate(() => performance.now())), transferidoBytes: recibidos.reduce((s, r) => s + r.bytes, 0) };
    recibidos.length = 0;
  }
  log(`abriendo ${u}${o.caliente ? ' (segunda visita, en caliente)' : ''}`);
  await cargar(page, errores, u);
  const listoMs = await page.evaluate(() => performance.now());
  const nav = await page.evaluate(() => { const e = performance.getEntriesByType('navigation')[0]; return e ? { dcl: e.domContentLoadedEventEnd, load: e.loadEventEnd } : {}; });
  const ltCarga = await page.evaluate((t) => window.__medidor?.longTasksHasta(t) || [], listoMs);
  const shadersCarga = await page.evaluate((t) => ({ links: window.__medidor?.linksHasta(t) ?? null, programas: window.__medidor?.programas() ?? null }), listoMs).catch(() => ({}));
  const transferidos = [...recibidos];
  const carga = {
    domContentLoadedMs: Math.round(nav.dcl || 0), loadMs: Math.round(nav.load || 0), listoMs: Math.round(listoMs),
    peticiones: transferidos.length, transferidoBytes: transferidos.reduce((s, r) => s + r.bytes, 0),
    masPesados: transferidos.sort((a, b) => b.bytes - a.bytes).slice(0, 10), longTasks: resumirLongTasks(ltCarga), shaders: shadersCarga, errores,
    ...(fria && { fria }),
  };
  log(`listo en ${carga.listoMs} ms · ${carga.peticiones} peticiones · ${MB(carga.transferidoBytes)} MB${fria ? ` (la fría: ${fria.listoMs} ms)` : ''}`);

  if (o.js) await page.evaluate(o.js).catch((e) => errores.push(`[--js] ${e.message.split('\n')[0]}`));
  if (calentar) { log(`calentando ${calentar} s`); await page.waitForTimeout(calentar * 1000); }

  if (nCpu) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); await cdp.send('Profiler.start'); }

  const resultados = [];
  for (const [i, p] of pasos.entries()) {
    const nombre = nombrePaso(p, i), d = p.dur ?? dur;
    await page.evaluate(() => window.__medidor?.prepararPaso?.()); // v0.5: lo que compile el js/espera del paso cuenta para el paso
    if (p.js) await page.evaluate(p.js).catch((e) => errores.push(`[paso ${nombre}] ${e.message.split('\n')[0]}`));
    if (p.espera) await page.waitForTimeout(p.espera);
    const ini = await heap();
    await page.evaluate(() => window.__medidor.marcar());
    const inter = p.interactuar ?? !!o.interactuar;
    log(`midiendo "${nombre}" ${d} s${inter ? ' con ratón' : ''}`);
    if (inter) await interactuar(page, d * 1000); else await page.waitForTimeout(d * 1000);
    const crudo = await page.evaluate(() => window.__medidor.leer());
    resultados.push(resumirPaso({ nombre, ...crudo, interactuar: inter, heapMB: { ini, fin: await heap() }, extra: await extra() }));
  }

  let cpu = [];
  if (nCpu) { // tiempo propio por función
    const { profile: P } = await cdp.send('Profiler.stop'), dt = (P.endTime - P.startTime) / 1000 / P.samples.length, propio = {};
    const porId = Object.fromEntries(P.nodes.map((x) => [x.id, x]));
    for (const id of P.samples) { const f = porId[id].callFrame, k = `${f.functionName || '(anon)'} ${f.url.split('/').pop().split('?')[0]}:${f.lineNumber + 1}`; propio[k] = (propio[k] || 0) + dt; }
    cpu = Object.entries(propio).sort((a, b) => b[1] - a[1]).slice(0, nCpu).map(([fn, ms]) => ({ ms: Math.round(ms), fn }));
  }

  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    if (!gl) return 'sin WebGL';
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  }).catch(() => '?');
  // three escribe su REVISION en window.__THREE__ al importarse; Babylon la expone en BABYLON.Engine.Version
  const motor = await page.evaluate(() => ({ three: window.__THREE__ ?? null, babylon: window.BABYLON?.Engine?.Version ?? null })).catch(() => ({ three: null, babylon: null }));
  if (o.captura && !congelar && ultima) await page.screenshot({ path: o.captura }); // como en 0.2: al final de la (última) corrida
  const navegador = `${browser.browserType().name()} ${browser.version()}`;
  await browser.close();
  return { entorno: { plataforma: `${process.platform}-${process.arch}`, navegador, gpu, motor, software: esSoftware(gpu), viewport: [ancho, alto], dpr, vsync: !o['sin-vsync'], caliente: !!o.caliente }, carga, pasos: resultados, cpu };
}

/** Corre fn con el tope --limite; si se pasa, cierra los navegadores abiertos y devuelve null (la corrida se descarta). */
async function conLimite(fn, que) {
  let t;
  gen++;
  try {
    return await Promise.race([fn(), new Promise((_, no) => { t = setTimeout(() => no(new Error(`${que}: pasó el límite de ${Math.round(limiteMs / 1000)} s (--limite)`)), limiteMs); })]);
  } catch (e) {
    gen++; // lo que siga corriendo de esta corrida ya no puede abrir un navegador que se quede vivo
    log(rojo(`ERROR: ${e.message.split('\n')[0]}; se descarta`));
    for (const b of [...abiertos]) await b.close().catch(() => {});
    return null;
  } finally { clearTimeout(t); }
}

/**
 * Pasada aparte para capturas comparables (navegador nuevo, sin medir). Tras `listo`: con --congelar-cuadros espera a que la app
 * corra N cuadros de reloj virtual; evalúa --congelar; y por cada paso evalúa su `js`, espera `espera`, deja dibujar 2 cuadros
 * (con el tiempo quieto) y captura. Un paso → --captura tal cual; varios → <captura>-<paso>.png.
 * v0.5: --solo-canvas oculta la interfaz y captura solo el canvas más grande (la escena, sin paneles ni etiquetas HTML).
 */
async function capturar(u) {
  const browser = await lanzar();
  const { page, errores } = await abrir(browser, { sinGl: true, congelarCuadros: nCongelar });
  log(`capturas${congelar ? ' congeladas' : ''} de ${u}`);
  await cargar(page, errores, u);
  if (nCongelar != null) {
    await page.waitForFunction(() => window.__medidor.congelado(), null, { timeout: LIMITE, polling: 100 })
      .catch(() => errores.push(`[congelar-cuadros] la app no pidió ${nCongelar} cuadros de rAF en ${LIMITE / 1000} s`));
  }
  if (o.congelar) await page.evaluate(o.congelar).catch((e) => errores.push(`[--congelar] ${e.message.split('\n')[0]}`));
  if (o.js) await page.evaluate(o.js).catch((e) => errores.push(`[--js] ${e.message.split('\n')[0]}`));
  if (!congelar && calentar) await page.waitForTimeout(calentar * 1000);
  const archivos = [];
  for (const [i, p] of pasos.entries()) {
    const nombre = nombrePaso(p, i);
    if (p.js) await page.evaluate(p.js).catch((e) => errores.push(`[paso ${nombre}] ${e.message.split('\n')[0]}`));
    if (p.espera) await page.waitForTimeout(p.espera);
    await page.evaluate(() => (window.__medidor?.avanzar ? window.__medidor.avanzar(2) : new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
    const f = pasos.length === 1 ? o.captura : o.captura.replace(/(\.png)?$/i, `-${nombre}.png`);
    mkdirSync(dirname(f), { recursive: true });
    if (o['solo-canvas']) {
      const c = await page.evaluateHandle(() => {
        if (!document.getElementById('__medidorSoloCanvas')) { const st = document.createElement('style'); st.id = '__medidorSoloCanvas'; st.textContent = 'body{visibility:hidden!important} canvas{visibility:visible!important}'; document.head.append(st); }
        return [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0] || null;
      });
      const el = c.asElement();
      if (el) await el.screenshot({ path: f }); else { errores.push(`[paso ${nombre}] --solo-canvas: la página no tiene canvas; se capturó la página`); await page.screenshot({ path: f }); }
    } else await page.screenshot({ path: f });
    archivos.push(f);
  }
  await browser.close();
  for (const e of errores) log(rojo(`captura: ${e}`));
  log(`capturas → ${archivos.join(', ')}`);
  return { archivos, errores };
}

if (soloCapturas) {
  const r = await conLimite(() => capturar(url), 'capturas');
  process.exit(r && !r.errores.some((e) => /^\[(goto|listo|congelar)/.test(e)) ? 0 : 3);
}

/** Junta las corridas de una URL en el reporte (v5). */
function armar(u, corridas, etiqueta) {
  const [c1] = corridas, reps = corridas.length;
  const r = { version: 5, fecha: new Date().toISOString(), url: u, etiqueta: etiqueta || null, entorno: c1.entorno };
  if (reps === 1) Object.assign(r, { carga: c1.carga, pasos: c1.pasos, cpu: c1.cpu });
  else {
    const ag = agregarCorridas(corridas);
    Object.assign(r, { repeticiones: reps, carga: ag.carga, pasos: ag.pasos, cpu: c1.cpu, rango: ag.rango, corridas: corridas.map(({ entorno, ...c }) => c) });
  }
  if (r.entorno.software) log(rojo(`AVISO: GPU por software (${r.entorno.gpu}); los fps no representan una GPU real`));
  return r;
}

const fechaBase = (() => {
  const f = new Date(), d2 = (x) => String(x).padStart(2, '0');
  let host = 'local'; try { host = new URL(url).hostname.replace(/[^\w.-]/g, '_') || 'local'; } catch { /* url rara */ }
  return (o.salida || join('reportes', `${host}-${f.getFullYear()}${d2(f.getMonth() + 1)}${d2(f.getDate())}-${d2(f.getHours())}${d2(f.getMinutes())}`)).replace(/\.json$/, '');
})();

function guardar(r, base) {
  mkdirSync(dirname(base), { recursive: true });
  writeFileSync(`${base}.json`, JSON.stringify(r, null, 2));
  writeFileSync(`${base}.md`, aMarkdown(r));
  log(`→ ${base}.json / .md`);
}
// resumen por paso en stderr (también con --salida -, que deja stdout solo para el JSON)
function logPasos(r, quien = '') {
  for (const p of r.pasos) {
    const g = p.gl, calls = g ? (g.alterna ? `${g.callsMedia} (media; alterna ${g.alterna.bajo}/${g.alterna.alto})` : g.calls) : '–';
    log(`${quien}${p.nombre}: fps p50 ${p.fps.p50} · p1 ${p.fps.p1} · ms p99 ${p.ms.p99} · calls ${calls} · tris ${g ? (g.alterna ? g.trisMedia : g.tris) : '–'}${r.repeticiones ? ` (mediana de ${r.repeticiones})` : ''}`);
  }
}

if (urlB) {
  // v0.5: A1 B1 A2 B2 …: si la máquina se pone más lenta (otra app, temperatura) pesa igual en los dos lados
  const cA = [], cB = [];
  for (let k = 1; k <= reps; k++) {
    log(`par ${k}/${reps}: A`); const a = await conLimite(() => corrida(url, k === reps), `A#${k}`);
    log(`par ${k}/${reps}: B`); const b = await conLimite(() => corrida(urlB, k === reps), `B#${k}`);
    if (a && b) { cA.push(a); cB.push(b); } else log(rojo(`par ${k} descartado: falló ${a ? 'B' : 'A'}`));
  }
  if (!cA.length) { log(rojo('ninguna corrida completa')); process.exit(3); }
  const RA = armar(url, cA, o.etiqueta ? `${o.etiqueta} A` : 'A'), RB = armar(urlB, cB, o.etiqueta ? `${o.etiqueta} B` : 'B');
  const inter = resumirIntercalado(cA, cB), cmp = comparar(RA, RB);
  const md = comparacionMd(RA, RB, cmp) + ['', '## Intercalado (A1 B1 A2 B2 …)', '', '| paso | fps p50 A por corrida | fps p50 B por corrida | Δ % por par | mediana Δ % | ruido A % | veredicto |', '|---|---|---|---|---|---|---|',
    ...inter.map((x) => `| ${x.nombre} | ${x.fpsA.join(' / ')} | ${x.fpsB.join(' / ')} | ${x.pares.join(' / ')} | ${x.dFps ?? '–'} | ${x.ruidoA ?? '–'} | **${x.veredicto}** |`), ''].join('\n');
  if (o.salida === '-') process.stdout.write(JSON.stringify({ a: RA, b: RB, intercalado: inter }, null, 2) + '\n');
  else {
    guardar(RA, `${fechaBase}-a`); guardar(RB, `${fechaBase}-b`);
    writeFileSync(`${fechaBase}-comparacion.md`, md);
    log(`→ ${fechaBase}-comparacion.md`);
  }
  logPasos(RA, 'A '); logPasos(RB, 'B ');
  for (const x of inter) log(`intercalado "${x.nombre}": ${x.veredicto} (Δ fps ${x.dFps} % por pares ${x.pares.join(', ')}; ruido A ${x.ruidoA ?? '–'} %)`);
  for (const a of cmp.avisos) log(rojo(`AVISO: ${a}`));
  for (const a of [...alertas(RA).map((x) => `A ${x}`), ...alertas(RB).map((x) => `B ${x}`)]) log(rojo(`ALERTA: ${a}`));
  process.exit(0);
}

const corridas = [];
for (let k = 1; k <= reps; k++) {
  if (reps > 1) log(`corrida ${k}/${reps}`);
  const c = await conLimite(() => corrida(url, k === reps), `corrida ${k}`);
  if (c) corridas.push(c);
}
if (!corridas.length) { log(rojo('ninguna corrida completa')); process.exit(3); }
const reporte = armar(url, corridas, o.etiqueta);
if (AB) reporte.ab = resumirAB(corridas.map((c) => c.pasos), AB.a, AB.b);
if (o.captura && congelar) {
  reporte.capturas = await conLimite(() => capturar(url), 'capturas');
  if (!reporte.capturas || reporte.capturas.errores.some((e) => /^\[(goto|listo|congelar)/.test(e))) { log(rojo('las capturas congeladas fallaron (ver capturas en el reporte)')); process.exitCode = 3; }
}

if (o.salida === '-') process.stdout.write(JSON.stringify(reporte, null, 2) + '\n');
else {
  guardar(reporte, fechaBase);
  if (reporte.ab) log(`A/B ${reporte.ab.a} contra ${reporte.ab.b}: ${reporte.ab.veredicto} (Δ fps ${reporte.ab.dFps} %, ruido entre A ${reporte.ab.ruidoA} %, ${reporte.ab.pares.length} pares)`);
}
logPasos(reporte);
for (const a of alertas(reporte)) log(rojo(`ALERTA: ${a}`)); // también con --salida - (log va a stderr)
