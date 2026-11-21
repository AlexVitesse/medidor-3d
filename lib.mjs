// Funciones puras del medidor: sin navegador ni disco, para poder probarlas con node:assert.

const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);

/** Percentil por rango más cercano: el valor en la posición ceil(p/100·n) de la lista ordenada. */
export function percentil(valores, p) {
  if (!valores.length) return null;
  const o = [...valores].sort((a, b) => a - b);
  return o[Math.min(o.length, Math.max(1, Math.ceil((p / 100) * o.length))) - 1];
}

const mediana = (v) => percentil(v, 50);

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
  };
}

export const esSoftware = (gpu) => /swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpu || '');

const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(2)} MB` : `${(b / 1024).toFixed(1)} KB`);

/** Reporte de una corrida en markdown. */
export function aMarkdown(r) {
  const e = r.entorno, c = r.carga, L = [`# medidor-3d · ${r.etiqueta || r.url}`, '', `- URL: ${r.url}`, `- Fecha: ${r.fecha}`,
    `- Entorno: ${e.plataforma} · ${e.navegador} · viewport ${e.viewport.join('×')} @ dpr ${e.dpr} · vsync ${e.vsync ? 'sí' : 'no'}`, `- GPU: ${e.gpu}`];
  if (e.software) L.push('', '> **AVISO: GPU POR SOFTWARE** (SwiftShader/llvmpipe). Los fps no representan una GPU real.');
  L.push('', '## Carga', '', '| DOMContentLoaded | load | listo | peticiones | transferido | long tasks (n / total / máx ms) |', '|---|---|---|---|---|---|',
    `| ${c.domContentLoadedMs} ms | ${c.loadMs} ms | ${c.listoMs} ms | ${c.peticiones} | ${kb(c.transferidoBytes)} | ${c.longTasks.n} / ${c.longTasks.totalMs} / ${c.longTasks.maxMs} |`);
  if (c.masPesados?.length) L.push('', 'Más pesados:', '', ...c.masPesados.map((m) => `- ${kb(m.bytes)} · ${m.url}`));
  if (c.errores?.length) L.push('', 'Errores:', '', ...c.errores.map((x) => `- ${x}`));
  L.push('', '## Pasos', '', '| paso | s | cuadros | fps media | p50 | p5 | p1 | ms p50 | p95 | p99 | máx | long tasks | calls (máx) | tris (máx) | heap MB ini→fin |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const p of r.pasos) L.push(`| ${p.nombre} | ${p.durS} | ${p.cuadros} | ${p.fps.media} | ${p.fps.p50} | ${p.fps.p5} | ${p.fps.p1} | ${p.ms.p50} | ${p.ms.p95} | ${p.ms.p99} | ${p.ms.max} | ${p.longTasks.n} (${p.longTasks.totalMs} ms) | ${p.gl ? `${p.gl.calls} (${p.gl.callsMax})` : '–'} | ${p.gl ? `${p.gl.tris} (${p.gl.trisMax})` : '–'} | ${p.heapMB ? `${p.heapMB.ini}→${p.heapMB.fin}` : '–'} |`);
  for (const p of r.pasos) if (p.extra != null) L.push('', `Extra de \`${p.nombre}\`:`, '', '```json', JSON.stringify(p.extra).slice(0, 2000), '```');
  if (r.cpu?.length) L.push('', '## CPU (tiempo propio)', '', '| ms | función |', '|---|---|', ...r.cpu.map((f) => `| ${f.ms} | \`${f.fn}\` |`));
  L.push('', '_Se mide la cadencia de requestAnimationFrame, no el tiempo de GPU._', '');
  return L.join('\n');
}

// métricas comparadas: [ruta, más es mejor]
const METRICAS_PASO = [['fps.media', 1], ['fps.p50', 1], ['fps.p5', 1], ['fps.p1', 1], ['ms.p50', 0], ['ms.p95', 0], ['ms.p99', 0], ['ms.max', 0],
  ['longTasks.n', 0], ['longTasks.totalMs', 0], ['gl.calls', 0], ['gl.tris', 0], ['heapMB.fin', 0]];
const METRICAS_CARGA = [['listoMs', 0], ['loadMs', 0], ['peticiones', 0], ['transferidoBytes', 0], ['longTasks.totalMs', 0]];
const leer = (o, ruta) => ruta.split('.').reduce((x, k) => x?.[k], o);
// ponytail: umbral ingenuo del 5 %; correr A contra A para ver el ruido real antes de creerle a una diferencia chica.
const UMBRAL = 5;

function fila(metrica, a, b, masMejor) {
  const delta = a == null || b == null ? null : a === b ? 0 : a === 0 ? null : ((b - a) / Math.abs(a)) * 100;
  const veredicto = delta == null ? '?' : Math.abs(delta) < UMBRAL ? '≈' : (delta > 0) === !!masMejor ? 'mejor' : 'peor';
  return { metrica, a, b, delta: delta == null ? null : r1(delta), veredicto };
}

/** Compara dos reportes: {avisos, filas:[{metrica, a, b, delta, veredicto}]} (veredicto de B respecto a A). */
export function comparar(A, B) {
  const avisos = [];
  for (const k of ['gpu', 'viewport', 'dpr', 'vsync', 'software']) {
    if (JSON.stringify(A.entorno?.[k]) !== JSON.stringify(B.entorno?.[k])) avisos.push(`${k} distinto: ${JSON.stringify(A.entorno?.[k])} vs ${JSON.stringify(B.entorno?.[k])}`);
  }
  const filas = METRICAS_CARGA.map(([m, mm]) => fila(`carga.${m}`, leer(A.carga, m), leer(B.carga, m), mm));
  for (const pa of A.pasos) {
    const pb = B.pasos.find((p) => p.nombre === pa.nombre);
    if (!pb) { avisos.push(`el paso "${pa.nombre}" solo está en A`); continue; }
    for (const [m, mm] of METRICAS_PASO) filas.push(fila(`${pa.nombre}.${m}`, leer(pa, m), leer(pb, m), mm));
  }
  for (const pb of B.pasos) if (!A.pasos.some((p) => p.nombre === pb.nombre)) avisos.push(`el paso "${pb.nombre}" solo está en B`);
  return { avisos, filas };
}

export function comparacionMd(A, B, { avisos, filas }) {
  const L = [`# Comparación`, '', `- A: ${A.etiqueta || A.url} (${A.fecha}) · ${A.entorno.gpu}`, `- B: ${B.etiqueta || B.url} (${B.fecha}) · ${B.entorno.gpu}`, ''];
  if (avisos.length) L.push('**Avisos** (la comparación puede no ser justa):', '', ...avisos.map((a) => `- ${a}`), '');
  L.push('| métrica | A | B | Δ% | |', '|---|---|---|---|---|', ...filas.map((f) => `| ${f.metrica} | ${f.a ?? '–'} | ${f.b ?? '–'} | ${f.delta ?? '–'} | ${f.veredicto} |`));
  return L.join('\n') + '\n';
}
