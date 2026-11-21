#!/usr/bin/env node
// medidor-3d: mide una página WebGL con Chrome real (fps, tiempos de cuadro, long tasks, draw calls, peso, memoria).
//   node medidor.mjs <url> [opciones]          → reportes/<host>-<AAAAMMDD-HHMM>.{json,md}
//   node medidor.mjs comparar a.json b.json [--md comparacion.md]
// Ver README.md para las opciones.
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resumirPaso, resumirLongTasks, esSoftware, aMarkdown, comparar, comparacionMd, alertas } from './lib.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const log = (...a) => console.error('[medidor]', ...a);
const rojo = (s) => (process.stderr.isTTY ? `\x1b[31m${s}\x1b[0m` : s);
const MB = (b) => Math.round((b / 1048576) * 10) / 10;

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    etiqueta: { type: 'string' }, dur: { type: 'string', default: '10' }, calentar: { type: 'string', default: '3' },
    listo: { type: 'string' }, js: { type: 'string' }, pasos: { type: 'string' },
    ancho: { type: 'string', default: '1600' }, alto: { type: 'string', default: '900' }, dpr: { type: 'string', default: '1' },
    'sin-vsync': { type: 'boolean' }, visible: { type: 'boolean' }, 'sin-gl': { type: 'boolean' }, interactuar: { type: 'boolean' },
    chrome: { type: 'string' }, angle: { type: 'string' }, extra: { type: 'string' }, cpu: { type: 'string' },
    captura: { type: 'string' }, salida: { type: 'string' }, md: { type: 'string' }, ayuda: { type: 'boolean', short: 'h' },
  },
});

if (o.ayuda || !positionals.length) {
  console.error(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 5).join('\n'));
  process.exit(positionals.length || o.ayuda ? 0 : 1);
}

if (positionals[0] === 'comparar') {
  const abrir = (f) => JSON.parse(readFileSync(existsSync(f) ? f : `${f}.json`, 'utf8'));
  if (positionals.length < 3) { log('uso: node medidor.mjs comparar a.json b.json [--md salida.md]'); process.exit(1); }
  const A = abrir(positionals[1]), B = abrir(positionals[2]), md = comparacionMd(A, B, comparar(A, B));
  if (o.md) writeFileSync(o.md, md);
  process.stdout.write(md);
  process.exit(0);
}

// ---------------- medir
const url = positionals[0];
const n = (k) => { const v = Number(o[k]); if (!Number.isFinite(v) || v < 0) { log(`--${k} debe ser un número`); process.exit(1); } return v; };
const dur = n('dur'), calentar = n('calentar'), ancho = n('ancho'), alto = n('alto'), dpr = n('dpr'), nCpu = o.cpu ? n('cpu') : 0;
const pasos = o.pasos ? JSON.parse(readFileSync(o.pasos, 'utf8')) : [{ nombre: 'base' }];
const LIMITE = 120000;

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

let browser;
try {
  browser = await chromium.launch({ ...(exe ? { executablePath: exe } : { channel: 'chrome' }), headless: !o.visible, args });
} catch (e) {
  log(`no se pudo abrir Chrome (${exe || 'channel chrome'}): ${e.message.split('\n')[0]}`);
  log('pasa la ruta con --chrome <ruta> o la variable CHROME');
  process.exit(2);
}

// bypassCSP: --listo/--js/--extra se evalúan como string (eval en la página); una CSP sin 'unsafe-eval' los rompería.
const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: dpr, bypassCSP: true });
const sonda = readFileSync(join(AQUI, 'sonda.js'), 'utf8');
await ctx.addInitScript({ content: `window.__medidorCfg = ${JSON.stringify({ sinGl: !!o['sin-gl'] })};\n${sonda}` });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);

// peso transferido por CDP
const urls = new Map(), recibidos = [];
cdp.on('Network.requestWillBeSent', (e) => urls.set(e.requestId, e.request.url));
cdp.on('Network.loadingFinished', (e) => recibidos.push({ url: urls.get(e.requestId) || '?', bytes: e.encodedDataLength }));
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

const errores = [];
page.on('pageerror', (e) => errores.length < 30 && errores.push(`[pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errores.length < 30 && errores.push(`[console] ${m.text()}`));

const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return MB((await cdp.send('Runtime.getHeapUsage')).usedSize); };
const extra = () => (o.extra ? page.evaluate(`(() => { const v = (${o.extra}); return v === undefined ? null : JSON.parse(JSON.stringify(v)); })()`).catch((e) => ({ error: String(e.message || e) })) : null);

// arrastres reales (izquierdo = orbitar, derecho = desplazar) y rueda sobre el canvas más grande, hasta agotar ms
async function interactuar(ms) {
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

log(`abriendo ${url}`);
try { await page.goto(url, { waitUntil: 'load', timeout: LIMITE }); } catch (e) { errores.push(`[goto] ${e.message.split('\n')[0]}`); }
if (o.listo) {
  await page.waitForFunction(o.listo, null, { timeout: LIMITE, polling: 100 }).catch((e) => errores.push(e.name === 'TimeoutError'
    ? `[listo] no se cumplió en ${LIMITE / 1000} s: ${o.listo}` : `[listo] error: ${e.message.split('\n')[0]}`));
} else await page.waitForTimeout(2000);
const listoMs = await page.evaluate(() => performance.now());
const nav = await page.evaluate(() => { const e = performance.getEntriesByType('navigation')[0]; return e ? { dcl: e.domContentLoadedEventEnd, load: e.loadEventEnd } : {}; });
const ltCarga = await page.evaluate((t) => window.__medidor?.longTasksHasta(t) || [], listoMs);
const shadersCarga = await page.evaluate((t) => ({ links: window.__medidor?.linksHasta(t) ?? null, programas: window.__medidor?.programas() ?? null }), listoMs).catch(() => ({}));
const transferidos = [...recibidos];
const carga = {
  domContentLoadedMs: Math.round(nav.dcl || 0), loadMs: Math.round(nav.load || 0), listoMs: Math.round(listoMs),
  peticiones: transferidos.length, transferidoBytes: transferidos.reduce((s, r) => s + r.bytes, 0),
  masPesados: transferidos.sort((a, b) => b.bytes - a.bytes).slice(0, 10), longTasks: resumirLongTasks(ltCarga), shaders: shadersCarga, errores,
};
log(`listo en ${carga.listoMs} ms · ${carga.peticiones} peticiones · ${MB(carga.transferidoBytes)} MB`);

if (o.js) await page.evaluate(o.js).catch((e) => errores.push(`[--js] ${e.message.split('\n')[0]}`));
if (calentar) { log(`calentando ${calentar} s`); await page.waitForTimeout(calentar * 1000); }

if (nCpu) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); await cdp.send('Profiler.start'); }

const resultados = [];
for (const p of pasos) {
  const nombre = p.nombre || `paso${resultados.length + 1}`, d = p.dur ?? dur;
  if (p.js) await page.evaluate(p.js).catch((e) => errores.push(`[paso ${nombre}] ${e.message.split('\n')[0]}`));
  if (p.espera) await page.waitForTimeout(p.espera);
  const ini = await heap();
  await page.evaluate(() => window.__medidor.marcar());
  const inter = p.interactuar ?? !!o.interactuar;
  log(`midiendo "${nombre}" ${d} s${inter ? ' con ratón' : ''}`);
  if (inter) await interactuar(d * 1000); else await page.waitForTimeout(d * 1000);
  const crudo = await page.evaluate(() => window.__medidor.leer());
  resultados.push(resumirPaso({ nombre, ...crudo, heapMB: { ini, fin: await heap() }, extra: await extra() }));
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
if (o.captura) await page.screenshot({ path: o.captura });
const navegador = `${browser.browserType().name()} ${browser.version()}`;
await browser.close();

const reporte = {
  version: 2, fecha: new Date().toISOString(), url, etiqueta: o.etiqueta || null,
  entorno: { plataforma: `${process.platform}-${process.arch}`, navegador, gpu, software: esSoftware(gpu), viewport: [ancho, alto], dpr, vsync: !o['sin-vsync'] },
  carga, pasos: resultados, cpu,
};
if (reporte.entorno.software) log(rojo(`AVISO: GPU por software (${gpu}); los fps no representan una GPU real`));

if (o.salida === '-') process.stdout.write(JSON.stringify(reporte, null, 2) + '\n');
else {
  const f = new Date(), d2 = (x) => String(x).padStart(2, '0');
  let host = 'local'; try { host = new URL(url).hostname.replace(/[^\w.-]/g, '_') || 'local'; } catch { /* url rara */ }
  const base = (o.salida || join('reportes', `${host}-${f.getFullYear()}${d2(f.getMonth() + 1)}${d2(f.getDate())}-${d2(f.getHours())}${d2(f.getMinutes())}`)).replace(/\.json$/, '');
  mkdirSync(dirname(base), { recursive: true });
  writeFileSync(`${base}.json`, JSON.stringify(reporte, null, 2));
  writeFileSync(`${base}.md`, aMarkdown(reporte));
  log(`→ ${base}.json / .md`);
  for (const p of resultados) log(`${p.nombre}: fps p50 ${p.fps.p50} · p1 ${p.fps.p1} · ms p99 ${p.ms.p99} · calls ${p.gl?.calls ?? '–'} · tris ${p.gl?.tris ?? '–'}`);
  for (const a of alertas(reporte)) log(rojo(`ALERTA: ${a}`));
}
