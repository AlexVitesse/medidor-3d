// Funciones puras del medidor: sin navegador ni disco, para poder probarlas con node:assert.
import { inflateSync, deflateSync } from 'node:zlib';

const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

/** Percentil por rango más cercano: el valor en la posición ceil(p/100·n) de la lista ordenada. */
export function percentil(valores, p) {
  if (!valores.length) return null;
  const o = [...valores].sort((a, b) => a - b);
  return o[Math.min(o.length, Math.max(1, Math.ceil((p / 100) * o.length))) - 1];
}

const mediana = (v) => percentil(v, 50);
/** Mediana de verdad (promedio de los dos del centro si n es par), para resumir pocas corridas. */
export const medianaReal = (v) => { const o = [...v].sort((a, b) => a - b), k = o.length >> 1; return o.length % 2 ? o[k] : (o[k - 1] + o[k]) / 2; };

// mediana por hoja numérica; rango[ruta] = [mín, máx]. Listas y textos: los de la primera corrida.
function agregar(vals, ruta, rango) {
  const a = vals[0];
  if (typeof a === 'number') {
    const v = vals.filter(Number.isFinite);
    if (!v.length) return a;
    rango[ruta] = [r1(Math.min(...v)), r1(Math.max(...v))];
    return r1(medianaReal(v));
  }
  if (a && typeof a === 'object' && !Array.isArray(a)) return Object.fromEntries(Object.keys(a).map((k) => [k, agregar(vals.map((x) => x?.[k]), `${ruta}.${k}`, rango)]));
  return a;
}

/** Junta N corridas [{carga, pasos}] en {carga, pasos, rango}: medianas, y rango {'carga.listoMs': [mín, máx], 'base.fps.p50': [...]}. */
export function agregarCorridas(corridas) {
  const rango = {};
  const carga = agregar(corridas.map((c) => c.carga), 'carga', rango);
  const pasos = corridas[0].pasos.map((p, i) => agregar(corridas.map((c) => c.pasos[i]), p.nombre, rango));
  return { carga, pasos, rango };
}

/** Resumen de tareas largas: {n, totalMs, maxMs}. */
export const resumirLongTasks = (dur) => ({ n: dur.length, totalMs: r1(dur.reduce((s, d) => s + d, 0)), maxMs: r1(dur.length ? Math.max(...dur) : 0) });

/**
 * Convierte las muestras crudas de un paso en su resumen.
 * crudo = { nombre, durS, ms: [intervalos entre cuadros], longTasks: [duraciones], calls: [por cuadro], tris: [por cuadro], heapMB: {ini, fin}, extra }
 */
export function resumirPaso(c) {
  const ms = c.ms || [], media = ms.length ? ms.reduce((s, x) => s + x, 0) / ms.length : null;
  // ponytail: rAF da tiempos con resolución de ~0.1 ms; un intervalo de 0 (miles de fps sin vsync) se cuenta como 0.1 ms → tope de 10000 fps.
  const p50 = percentil(ms, 50), p95 = percentil(ms, 95), p99 = percentil(ms, 99), fps = (x) => (x == null ? null : r1(1000 / Math.max(x, 0.1)));
  return {
    nombre: c.nombre, durS: r1(c.durS), cuadros: ms.length,
    fps: { media: fps(media), p50: fps(p50), p5: fps(p95), p1: fps(p99) },
    ms: { p50: r1(p50), p95: r1(p95), p99: r1(p99), max: r1(ms.length ? Math.max(...ms) : null) },
    longTasks: resumirLongTasks(c.longTasks || []),
    gl: c.calls ? { calls: mediana(c.calls), tris: mediana(c.tris), callsMax: c.calls.length ? Math.max(...c.calls) : null, trisMax: c.tris.length ? Math.max(...c.tris) : null } : null,
    heapMB: c.heapMB || null, extra: c.extra ?? null,
    // v2: cuándo pasó cada cosa (s desde el inicio del paso), para ligar un tirón con su causa
    huecos: resumirHuecos(c.huecos || []),
    longTasksT: [...(c.longTasksT || [])].sort((a, b) => b[1] - a[1]).slice(0, 10),
    shaders: c.links == null && c.programas == null ? null : resumirShaders(c),
  };
}

/** Cuadros de más de 250 ms (tirones visibles): {n, maxMs, lista:[[t s, ms]] (los 10 más largos)}. */
export function resumirHuecos(h) {
  return { n: h.length, maxMs: h.length ? Math.max(...h.map((x) => x[1])) : 0, lista: [...h].sort((a, b) => b[1] - a[1]).slice(0, 10) };
}

/** Shaders durante el paso. Cualquier link después de la carga es una recompilación (con cualquier motor). */
export function resumirShaders(c) {
  const links = c.links || [], rc = c.recompilaciones || [];
  // ráfagas: links a menos de 1 s uno del otro
  const rafagas = [];
  for (const t of links) { const u = rafagas[rafagas.length - 1]; if (u && t - u.fin <= 1) { u.fin = t; u.n++; } else rafagas.push({ t, fin: t, n: 1 }); }
  return { links: links.length, programas: c.programas ?? null, rafagas: rafagas.map((r) => ({ t: r.t, n: r.n })), causas: rc.slice(0, 10) };
}

/** Avisos legibles: recompilaciones después de la carga y cuadros congelados (> 1 s). */
export function alertas(r) {
  if (r.corridas) return r.corridas.flatMap((c, i) => alertas(c).map((a) => `corrida ${i + 1}: ${a}`));
  const A = [];
  for (const p of r.pasos || []) {
    const s = p.shaders;
    if (s?.links) {
      const causa = (s.causas || []).flatMap((x) => x.luces).filter((v, i, a) => a.indexOf(v) === i);
      A.push(`[${p.nombre}] ${s.links} shaders compilados después de la carga, en ${s.rafagas.length} ráfaga(s) (t = ${s.rafagas.slice(0, 5).map((x) => x.t + ' s').join(', ')})` +
        (causa.length ? ` · cambió: ${causa.join('; ')}` : (s.causas || []).length ? ` · pista: ${s.causas[0].claves[0]}` : ''));
    }
    if (p.huecos?.maxMs > 1000) A.push(`[${p.nombre}] 3D congelado ${(p.huecos.maxMs / 1000).toFixed(1)} s (t = ${p.huecos.lista[0][0]} s); ${p.huecos.n} cuadro(s) de más de 250 ms`);
  }
  return A;
}

export const esSoftware = (gpu) => /swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpu || '');

const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(2)} MB` : `${(b / 1024).toFixed(1)} KB`);

/** Reporte de una corrida en markdown. */
export function aMarkdown(r) {
  const e = r.entorno, c = r.carga, L = [`# medidor-3d · ${r.etiqueta || r.url}`, '', `- URL: ${r.url}`, `- Fecha: ${r.fecha}`,
    `- Entorno: ${e.plataforma} · ${e.navegador} · viewport ${e.viewport.join('×')} @ dpr ${e.dpr} · vsync ${e.vsync ? 'sí' : 'no'}`, `- GPU: ${e.gpu}`];
  if (r.repeticiones) L.push(`- Repeticiones: ${r.repeticiones}. Cada valor es la mediana, con [mín–máx] si varió. Las listas (más pesados, tirones, recompilaciones) son de la corrida 1.`);
  if (e.software) L.push('', '> **AVISO: GPU POR SOFTWARE** (SwiftShader/llvmpipe). Los fps no representan una GPU real.');
  // valor con su [mín–máx], si hay repeticiones y varió
  const v = (ruta, x = leer(r, ruta)) => { const g = r.rango?.[ruta]; return g && g[0] !== g[1] ? `${x} [${g[0]}–${g[1]}]` : x; };
  L.push('', '## Carga', '', '| DOMContentLoaded | load | listo | peticiones | transferido | long tasks (n / total / máx ms) |', '|---|---|---|---|---|---|',
    `| ${v('carga.domContentLoadedMs')} ms | ${v('carga.loadMs')} ms | ${v('carga.listoMs')} ms | ${v('carga.peticiones')} | ${kb(c.transferidoBytes)} | ${v('carga.longTasks.n')} / ${v('carga.longTasks.totalMs')} / ${v('carga.longTasks.maxMs')} |`);
  if (c.masPesados?.length) L.push('', 'Más pesados:', '', ...c.masPesados.map((m) => `- ${kb(m.bytes)} · ${m.url}`));
  if (c.errores?.length) L.push('', 'Errores:', '', ...c.errores.map((x) => `- ${x}`));
  const al = alertas(r);
  if (al.length) L.push('', '## Alertas', '', ...al.map((a) => `- ⚠ ${a}`));
  L.push('', '## Pasos', '', '| paso | s | cuadros | fps media | p50 | p5 | p1 | ms p50 | p95 | p99 | máx | long tasks | calls (máx) | tris (máx) | heap MB ini→fin |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const p of r.pasos) {
    const q = (ruta) => v(`${p.nombre}.${ruta}`, leer(p, ruta));
    L.push(`| ${p.nombre} | ${p.durS} | ${q('cuadros')} | ${q('fps.media')} | ${q('fps.p50')} | ${q('fps.p5')} | ${q('fps.p1')} | ${q('ms.p50')} | ${q('ms.p95')} | ${q('ms.p99')} | ${q('ms.max')} | ${q('longTasks.n')} (${q('longTasks.totalMs')} ms) | ${p.gl ? `${q('gl.calls')} (${q('gl.callsMax')})` : '–'} | ${p.gl ? `${q('gl.tris')} (${q('gl.trisMax')})` : '–'} | ${p.heapMB ? `${q('heapMB.ini')}→${q('heapMB.fin')}` : '–'} |`);
  }
  for (const p of r.pasos) if (p.extra != null) L.push('', `Extra de \`${p.nombre}\`:`, '', '```json', JSON.stringify(p.extra).slice(0, 2000), '```');
  for (const p of r.pasos) {
    if (p.huecos?.n) L.push('', `Tirones de \`${p.nombre}\` (t s · ms): ${p.huecos.lista.map(([t, d]) => `${t}·${d}`).join(', ')}`);
    if (p.shaders?.causas?.length) L.push('', `Recompilaciones de \`${p.nombre}\`:`, '', ...p.shaders.causas.map((x) => `- t ${x.t} s: +${x.nuevos} programas (total ${x.total})${x.luces.length ? ' · ' + x.luces.join('; ') : ''}${x.claves.length ? ' · ' + x.claves.join(' | ') : ''}`));
  }
  if (r.capturas) L.push('', `Capturas congeladas: ${r.capturas.archivos.join(', ')}`, ...r.capturas.errores.map((x) => `- ${x}`));
  if (r.cpu?.length) L.push('', '## CPU (tiempo propio)', '', '| ms | función |', '|---|---|', ...r.cpu.map((f) => `| ${f.ms} | \`${f.fn}\` |`));
  L.push('', '_Se mide la cadencia de requestAnimationFrame, no el tiempo de GPU._', '');
  return L.join('\n');
}

// métricas comparadas: [ruta, más es mejor]
const METRICAS_PASO = [['fps.media', 1], ['fps.p50', 1], ['fps.p5', 1], ['fps.p1', 1], ['ms.p50', 0], ['ms.p95', 0], ['ms.p99', 0], ['ms.max', 0],
  ['longTasks.n', 0], ['longTasks.totalMs', 0], ['huecos.n', 0], ['huecos.maxMs', 0], ['shaders.links', 0], ['gl.calls', 0], ['gl.tris', 0], ['heapMB.fin', 0]];
const METRICAS_CARGA = [['listoMs', 0], ['loadMs', 0], ['peticiones', 0], ['transferidoBytes', 0], ['longTasks.totalMs', 0]];
const leer = (o, ruta) => ruta.split('.').reduce((x, k) => x?.[k], o);
// Umbral fijo del 5 %. Con --repetir, además, '≈' si |Δ| cabe en el ruido observado (ver ruidoRel).
const UMBRAL = 5;

/** Ruido de una métrica en un reporte: (máx − mín) / |mediana| · 100; null si el reporte no tiene repeticiones. */
export function ruidoRel(R, metrica, valor) {
  const g = R.rango?.[metrica];
  if (!g || valor == null) return null;
  return g[1] === g[0] ? 0 : valor === 0 ? Infinity : ((g[1] - g[0]) / Math.abs(valor)) * 100;
}

function fila(metrica, a, b, masMejor, ruido = null) {
  const delta = a == null || b == null ? null : a === b ? 0 : a === 0 ? null : ((b - a) / Math.abs(a)) * 100;
  const veredicto = delta == null ? '?' : Math.abs(delta) < Math.max(UMBRAL, ruido ?? 0) ? '≈' : (delta > 0) === !!masMejor ? 'mejor' : 'peor';
  return { metrica, a, b, delta: delta == null ? null : r1(delta), ruido: ruido === Infinity ? '∞' : r1(ruido), veredicto };
}

/** Compara dos reportes: {avisos, filas:[{metrica, a, b, delta, veredicto}]} (veredicto de B respecto a A). */
export function comparar(A, B) {
  const avisos = [];
  for (const k of ['gpu', 'viewport', 'dpr', 'vsync', 'software']) {
    if (JSON.stringify(A.entorno?.[k]) !== JSON.stringify(B.entorno?.[k])) avisos.push(`${k} distinto: ${JSON.stringify(A.entorno?.[k])} vs ${JSON.stringify(B.entorno?.[k])}`);
  }
  // ruido de la fila = el del lado más disperso (null si ninguno tiene repeticiones)
  const f = (met, a, b, mm) => { const rs = [ruidoRel(A, met, a), ruidoRel(B, met, b)].filter((x) => x != null); return fila(met, a, b, mm, rs.length ? Math.max(...rs) : null); };
  const filas = METRICAS_CARGA.map(([m, mm]) => f(`carga.${m}`, leer(A.carga, m), leer(B.carga, m), mm));
  for (const pa of A.pasos) {
    const pb = B.pasos.find((p) => p.nombre === pa.nombre);
    if (!pb) { avisos.push(`el paso "${pa.nombre}" solo está en A`); continue; }
    for (const [m, mm] of METRICAS_PASO) filas.push(f(`${pa.nombre}.${m}`, leer(pa, m), leer(pb, m), mm));
  }
  for (const pb of B.pasos) if (!A.pasos.some((p) => p.nombre === pb.nombre)) avisos.push(`el paso "${pb.nombre}" solo está en B`);
  return { avisos, filas };
}

export function comparacionMd(A, B, { avisos, filas }) {
  const n = (R) => (R.repeticiones ? `mediana de ${R.repeticiones} corridas` : 'una corrida: sin estimación de ruido');
  const L = [`# Comparación`, '', `- A: ${A.etiqueta || A.url} (${A.fecha}) · ${A.entorno.gpu} · ${n(A)}`, `- B: ${B.etiqueta || B.url} (${B.fecha}) · ${B.entorno.gpu} · ${n(B)}`, ''];
  if (avisos.length) L.push('**Avisos** (la comparación puede no ser justa):', '', ...avisos.map((a) => `- ${a}`), '');
  const conRuido = !!(A.rango || B.rango);
  L.push(conRuido
    ? `Regla: ≈ si |Δ| < máx(${UMBRAL} %, ruido); ruido = (máx − mín) / mediana, del lado más disperso.${A.rango && B.rango ? '' : ' Un lado tiene una sola corrida y no aporta ruido.'}`
    : `Una corrida por lado: sin estimación de ruido; ≈ solo si |Δ| < ${UMBRAL} %. En una iGPU dos corridas iguales pueden diferir 25 %: usa \`--repetir 3\`.`, '');
  const val = (R, m, x) => { const g = R.rango?.[m]; return x == null ? '–' : g && g[0] !== g[1] ? `${x} [${g[0]}–${g[1]}]` : x; };
  if (conRuido) L.push('| métrica | A | B | Δ% | ruido % | |', '|---|---|---|---|---|---|', ...filas.map((f) => `| ${f.metrica} | ${val(A, f.metrica, f.a)} | ${val(B, f.metrica, f.b)} | ${f.delta ?? '–'} | ${f.ruido ?? '–'} | ${f.veredicto} |`));
  else L.push('| métrica | A | B | Δ% | |', '|---|---|---|---|---|', ...filas.map((f) => `| ${f.metrica} | ${f.a ?? '–'} | ${f.b ?? '–'} | ${f.delta ?? '–'} | ${f.veredicto} |`));
  return L.join('\n') + '\n';
}

// ---------------- capturas: PNG con el zlib de Node (RGB o RGBA de 8 bits, sin entrelazar)
const FIRMA = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Decodifica un PNG a {ancho, alto, rgba}. Cualquier otro formato → error claro. */
export function leerPng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(FIRMA)) throw new Error('no es un PNG');
  let i = 8, ih = null; const idat = [];
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i), tipo = buf.toString('latin1', i + 4, i + 8), d = buf.subarray(i + 8, i + 8 + len);
    if (tipo === 'IHDR') ih = d; else if (tipo === 'IDAT') idat.push(d); else if (tipo === 'IEND') break;
    i += 12 + len;
  }
  if (!ih) throw new Error('PNG sin IHDR');
  const ancho = ih.readUInt32BE(0), alto = ih.readUInt32BE(4), bits = ih[8], color = ih[9], entrelazado = ih[12], k = { 2: 3, 6: 4 }[color];
  if (bits !== 8 || !k || entrelazado) throw new Error(`PNG no soportado (${bits} bits, tipo de color ${color}${entrelazado ? ', entrelazado' : ''}): solo RGB o RGBA de 8 bits sin entrelazar`);
  const raw = inflateSync(Buffer.concat(idat)), fila = ancho * k, rgba = new Uint8Array(ancho * alto * 4);
  let ant = new Uint8Array(fila), act = new Uint8Array(fila);
  for (let y = 0; y < alto; y++) {
    const o = y * (fila + 1), f = raw[o];
    for (let x = 0; x < fila; x++) {
      const a = x >= k ? act[x - k] : 0, b = ant[x], c = x >= k ? ant[x - k] : 0;
      let p;
      if (f === 0) p = 0; else if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else throw new Error(`PNG dañado: filtro ${f} en la fila ${y}`);
      act[x] = (raw[o + 1 + x] + p) & 255;
    }
    for (let x = 0; x < ancho; x++) for (let j = 0; j < 4; j++) rgba[(y * ancho + x) * 4 + j] = j < k ? act[x * k + j] : 255;
    [ant, act] = [act, ant];
  }
  return { ancho, alto, rgba };
}

const CRC = Int32Array.from({ length: 256 }, (_, n) => { for (let j = 0; j < 8; j++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n; });
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const trozo = (tipo, d) => { const t = Buffer.from(tipo, 'latin1'), l = Buffer.alloc(4), c = Buffer.alloc(4); l.writeUInt32BE(d.length); c.writeUInt32BE(crc32(Buffer.concat([t, d]))); return Buffer.concat([l, t, d, c]); };

/** Codifica RGBA de 8 bits a PNG (filtro 0 en todas las filas). */
export function escribirPng(ancho, alto, rgba) {
  const ih = Buffer.alloc(13); ih.writeUInt32BE(ancho, 0); ih.writeUInt32BE(alto, 4); ih[8] = 8; ih[9] = 6;
  const raw = Buffer.alloc((ancho * 4 + 1) * alto);
  for (let y = 0; y < alto; y++) raw.set(rgba.subarray(y * ancho * 4, (y + 1) * ancho * 4), y * (ancho * 4 + 1) + 1);
  return Buffer.concat([FIRMA, trozo('IHDR', ih), trozo('IDAT', deflateSync(raw)), trozo('IEND', Buffer.alloc(0))]);
}

// luminancia Rec. 601 sobre los valores sRGB (la misma que el modo "L" de PIL, que usó el piloto)
const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
const difiere = (a, b, i, u) => Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > u;

/**
 * Compara dos capturas del mismo tamaño. zonas = {nombre: [x, y, ancho, alto]} en px, o en fracción de la imagen si todos son ≤ 1.
 * → {ancho, alto, umbral, total, zonas: [{nombre, caja, lumA, lumB, delta, difierenPct}], diffPng?}
 * difierenPct: % de píxeles cuyo canal más distinto difiere más de `umbral` (0–255).
 */
export function compararCapturas(bufA, bufB, { zonas = null, umbral = 10, diff = false } = {}) {
  const A = leerPng(bufA), B = leerPng(bufB), W = A.ancho, H = A.alto, a = A.rgba, b = B.rgba;
  if (W !== B.ancho || H !== B.alto) throw new Error(`las capturas tienen tamaños distintos: ${W}×${H} y ${B.ancho}×${B.alto}`);
  const medir = (x0, y0, w, h) => {
    let la = 0, lb = 0, d = 0;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * W + x) * 4; la += lum(a, i); lb += lum(b, i); if (difiere(a, b, i, umbral)) d++; }
    const n = w * h; la /= n; lb /= n;
    return { lumA: r2(la), lumB: r2(lb), delta: la === lb ? 0 : la ? r2(((lb - la) / la) * 100) : null, difierenPct: r2((d / n) * 100) };
  };
  const zs = Object.entries(zonas || {}).map(([nombre, z]) => {
    if (!Array.isArray(z) || z.length !== 4 || !z.every(Number.isFinite)) throw new Error(`zona "${nombre}": debe ser [x, y, ancho, alto]`);
    const e = z.every((v) => v <= 1) ? [W, H, W, H] : [1, 1, 1, 1];
    const x = Math.max(0, Math.round(z[0] * e[0])), y = Math.max(0, Math.round(z[1] * e[1]));
    const w = Math.min(W - x, Math.round(z[2] * e[2])), h = Math.min(H - y, Math.round(z[3] * e[3]));
    if (w <= 0 || h <= 0) throw new Error(`zona "${nombre}" queda fuera de la imagen (${W}×${H})`);
    return { nombre, caja: [x, y, w, h], ...medir(x, y, w, h) };
  });
  const r = { ancho: W, alto: H, umbral, total: medir(0, 0, W, H), zonas: zs };
  if (diff) { // A en gris tenue; en rojo, los píxeles que difieren
    const o = new Uint8Array(W * H * 4);
    for (let i = 0; i < o.length; i += 4) {
      const g = lum(a, i) * 0.35, d = difiere(a, b, i, umbral);
      o[i] = d ? 255 : g; o[i + 1] = o[i + 2] = d ? 0 : g; o[i + 3] = 255;
    }
    r.diffPng = escribirPng(W, H, o);
  }
  return r;
}

export function capturasMd(nA, nB, r) {
  const fila = (n, z) => `| ${n} | ${z.lumA} | ${z.lumB} | ${z.delta ?? '–'} | ${z.difierenPct} |`;
  return [`# Comparación de capturas`, '', `- A: ${nA}`, `- B: ${nB}`, `- ${r.ancho}×${r.alto} · umbral ${r.umbral} (0–255, canal más distinto)`, '',
    '| zona | luminancia A | luminancia B | Δ% | píxeles que difieren % |', '|---|---|---|---|---|',
    fila('total', r.total), ...r.zonas.map((z) => fila(`${z.nombre} [${z.caja.join(', ')}]`, z)), '',
    '_Luminancia media 0–255, Rec. 601 sobre sRGB (como el modo "L" de PIL). Δ% = (B − A) / A._', ''].join('\n');
}
