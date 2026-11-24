// node prueba.mjs — unitaria de lib.mjs + integración con Chrome real sobre prueba/escena.html.
// Si no hay Chrome o WebGL, la integración se marca OMITIDA y la unitaria cuenta igual.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { percentil, resumirPaso, comparar, comparacionMd, aMarkdown, esSoftware, resumirHuecos, resumirShaders, alertas, medianaReal, agregarCorridas, leerPng, escribirPng, compararCapturas, deriva, alternancia, resumirIntercalado, resumirAB, alertasAB } from './lib.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));

// ---------------- unitaria
const cien = Array.from({ length: 100 }, (_, i) => i + 1);
assert.equal(percentil(cien, 95), 95);
assert.equal(percentil(cien, 50), 50);
assert.equal(percentil([7], 1), 7);
const p = resumirPaso({ nombre: 'x', durS: 1, ms: Array(60).fill(16.67), calls: [3, 3, 3], tris: [3, 3, 3], longTasks: [] });
assert.ok(Math.abs(p.fps.p50 - 60) < 0.5, `p50 ${p.fps.p50}`);
assert.deepEqual(p.gl, { calls: 3, tris: 3, callsMax: 3, trisMax: 3, callsMedia: 3, trisMedia: 3, alterna: null, deriva: null });
assert.equal(resumirPaso({ nombre: 'y', ms: [0, 0, 0.1] }).fps.p50, 10000, 'intervalo 0 (bajo la resolución de rAF): tope, no null');
const ent = { gpu: 'G', viewport: [1, 1], dpr: 1, vsync: true, software: false };
const rep = (fps, ms) => ({ entorno: ent, carga: {}, pasos: [{ nombre: 'base', fps: { p50: fps }, ms: { p50: ms } }] });
const c = comparar(rep(60, 16), rep(90, 20));
const f = (m) => c.filas.find((x) => x.metrica === m);
assert.equal(f('base.fps.p50').veredicto, 'mejor');
assert.equal(f('base.fps.p50').delta, 50);
assert.equal(f('base.ms.p50').veredicto, 'peor');
assert.equal(comparar(rep(60, 16), rep(61, 16)).filas.find((x) => x.metrica === 'base.fps.p50').veredicto, '≈');
assert.equal(c.avisos.length, 0);
assert.ok(comparar(rep(60, 16), { ...rep(60, 16), entorno: { ...ent, gpu: 'H' } }).avisos[0].startsWith('gpu'));
assert.ok(esSoftware('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))') && esSoftware('llvmpipe (LLVM 15)') && !esSoftware('ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti)'));
const md = aMarkdown({ url: 'u', fecha: 'f', entorno: { ...ent, plataforma: 'p', navegador: 'n', software: true }, carga: { longTasks: { n: 0 } }, pasos: [p] });
assert.match(md, /GPU POR SOFTWARE/);
// v2: tirones, ráfagas de shaders y alertas
assert.deepEqual(resumirHuecos([[1, 300], [5, 2000]]), { n: 2, maxMs: 2000, lista: [[5, 2000], [1, 300]] });
const sh = resumirShaders({ links: [1, 1.2, 1.9, 9], programas: 60, recompilaciones: [{ t: 1, nuevos: 3, total: 63, luces: ['SpotLight 1 → 2'], claves: [] }] });
assert.deepEqual(sh.rafagas, [{ t: 1, n: 3 }, { t: 9, n: 1 }]);
const al = alertas({ pasos: [{ nombre: 'orbitar', shaders: sh, huecos: resumirHuecos([[1.1, 11000]]) }] });
assert.equal(al.length, 2);
assert.match(al[0], /4 shaders .* 2 ráfaga.*SpotLight 1 → 2/);
assert.match(al[1], /congelado 11\.0 s/);
assert.deepEqual(alertas({ pasos: [{ nombre: 'x', shaders: resumirShaders({ links: [] }), huecos: resumirHuecos([]) }] }), []);
// v3: --repetir (mediana y rango) y comparar con ruido
assert.equal(medianaReal([3, 1, 2]), 2);
// v0.4: deriva de escena dentro del paso y modo --ab
assert.equal(deriva([...Array(30).fill(100), ...Array(30).fill(100), ...Array(30).fill(150)]), 50);
assert.equal(deriva(Array.from({ length: 90 }, (_, i) => (i % 5 ? 100 : 300))), 0, 'picos periódicos (sombras) no son deriva');
assert.match(alertas({ pasos: [{ nombre: 'quieto', gl: { deriva: 45 }, huecos: resumirHuecos([]) }] })[0], /escena cambió durante el paso: draw calls \+45 %/);
assert.deepEqual(alertas({ pasos: [{ nombre: 'raton', interactuar: true, gl: { deriva: 45 }, huecos: resumirHuecos([]) }] }), [], 'con ratón la escena cambia a propósito');
const pab = (nombre, fps, calls) => ({ nombre, fps: { p50: fps }, gl: { calls } });
// escena que se vuelve más pesada con el tiempo (A: 40 → 30 fps) y B igual a sus vecinas: sin diferencia
const ab1 = resumirAB([[pab('a#1', 40, 100), pab('b#1', 35, 110), pab('a#2', 30, 120)]], 'a', 'b');
assert.equal(ab1.pares[0].dFps, 0); assert.equal(ab1.veredicto, 'sin diferencia clara');
const ab2 = resumirAB([[pab('a#1', 40, 100), pab('b#1', 30, 100), pab('a#2', 40, 100), pab('b#2', 31, 100), pab('a#3', 40, 100)]], 'a', 'b');
assert.equal(ab2.veredicto, 'b peor'); assert.equal(ab2.pares.length, 2);
const ab3 = resumirAB([[pab('a#1', 40, 100), pab('b#1', 30, 200), pab('a#2', 40, 100)]], 'a', 'b');
assert.match(alertasAB(ab3)[0], /b dibuja distinto que sus A vecinas/, 'solo B cambia: puede ser la variante');
const ab4 = resumirAB([[pab('a#1', 40, 100), pab('b#1', 40, 150), pab('a#2', 40, 200)]], 'a', 'b');
assert.match(alertasAB(ab4).join(' '), /la escena cambió sola/, 'las A vecinas difieren: escena inestable');
const ab5 = resumirAB([[pab('a#1', 60, 100), { nombre: 'b#1', fps: { p50: null }, gl: null }, pab('a#2', 60, 100)]], 'a', 'b');
assert.equal(ab5.pares.length, 0); assert.equal(ab5.invalidos, 1); assert.equal(ab5.veredicto, 'sin pares', 'fps vacío no es 0 fps');
const agN = agregarCorridas([{ carga: { listoMs: 1 }, pasos: [{ nombre: 'x', fps: { p50: null }, gl: null }] }, { carga: { listoMs: 2 }, pasos: [{ nombre: 'x', fps: { p50: 60 }, gl: { calls: 100 } }] }]);
assert.equal(agN.pasos[0].fps.p50, 60, "una corrida sin dato no borra las demás"); assert.equal(agN.pasos[0].gl.calls, 100);
assert.equal(medianaReal([1, 2]), 1.5);
const corr = (fps, listo) => ({ carga: { listoMs: listo, errores: ['e'] }, pasos: [{ nombre: 'base', fps: { p50: fps }, huecos: { n: 0, lista: [] } }] });
const ag = agregarCorridas([corr(40, 100), corr(50, 300), corr(45, 200)]);
assert.equal(ag.pasos[0].fps.p50, 45);
assert.deepEqual(ag.rango['base.fps.p50'], [40, 50]);
assert.deepEqual(ag.rango['carga.listoMs'], [100, 300]);
assert.deepEqual(ag.carga.errores, ['e'], 'listas: las de la corrida 1');
const conRuido = (fps, g) => ({ ...rep(fps, 16), repeticiones: 3, rango: { 'base.fps.p50': g } });
// Δ −6.7 %: con una corrida es "peor"; si el ruido de A es 22 %, es "≈"
assert.equal(comparar(rep(45, 16), rep(42, 16)).filas.find((x) => x.metrica === 'base.fps.p50').veredicto, 'peor');
const cr = comparar(conRuido(45, [40, 50]), conRuido(42, [41, 43])), fr = cr.filas.find((x) => x.metrica === 'base.fps.p50');
assert.equal(fr.veredicto, '≈');
assert.equal(fr.ruido, 22.2);
assert.equal(comparar(conRuido(45, [44, 46]), conRuido(30, [29, 31])).filas.find((x) => x.metrica === 'base.fps.p50').veredicto, 'peor', 'Δ fuera del ruido');
assert.match(comparacionMd({ ...rep(45, 16), fecha: 'f' }, { ...rep(42, 16), fecha: 'f' }, comparar(rep(45, 16), rep(42, 16))), /una corrida: sin estimación de ruido/);
assert.match(comparacionMd({ ...conRuido(45, [40, 50]), fecha: 'f' }, { ...conRuido(42, [41, 43]), fecha: 'f' }, cr), /\| 45 \[40–50\] \| 42 \[41–43\] \| -6\.7 \| 22\.2 \| ≈ \|/);
// v3: PNG y comparar capturas
const px = Uint8Array.from({ length: 3 * 2 * 4 }, (_, i) => (i * 37) % 256);
assert.deepEqual(leerPng(escribirPng(3, 2, px)), { ancho: 3, alto: 2, rgba: px }, 'PNG ida y vuelta');
const png16 = escribirPng(1, 1, new Uint8Array(4)); png16[24] = 16; // bit depth del IHDR
assert.throws(() => leerPng(png16), /no soportado \(16 bits/);
const gris = (v) => escribirPng(4, 4, new Uint8Array(64).map((_, i) => (i % 4 === 3 ? 255 : v)));
assert.equal(compararCapturas(gris(100), gris(100)).total.delta, 0);
const cc = compararCapturas(gris(100), gris(120), { zonas: { arriba: [0, 0, 1, 0.5] }, diff: true });
assert.equal(cc.total.delta, 20);
assert.equal(cc.total.difierenPct, 100);
assert.deepEqual(cc.zonas[0].caja, [0, 0, 4, 2], 'zona en fracciones');
assert.equal(leerPng(cc.diffPng).ancho, 4);
assert.throws(() => compararCapturas(gris(1), escribirPng(2, 2, new Uint8Array(16))), /tamaños distintos/);
// v0.5: draw calls que alternan (sombras cada 2 cuadros): deriva ≈ 0, alternancia detectada, comparar avisa y usa la media
const alt = Array.from({ length: 91 }, (_, i) => (i % 2 ? 632 : 338));
assert.ok(Math.abs(deriva(alt)) < 1, `deriva con alternancia: ${deriva(alt)}`);
assert.deepEqual(alternancia(alt), { bajo: 338, alto: 632, fraccionAlto: 0.49 });
assert.equal(alternancia(Array(50).fill(100)), null, 'constante: no alterna');
assert.equal(alternancia(Array.from({ length: 60 }, (_, i) => 100 + (i % 7))), null, 'ruido chico: no alterna');
assert.equal(alternancia([...Array(50).fill(338), ...Array(50).fill(632)]), null, 'un cambio de escena (bloques) no es alternancia');
assert.deepEqual(alternancia([...Array.from({ length: 100 }, (_, i) => (i % 2 ? 632 : 338)), 10000]), { bajo: 338, alto: 632, fraccionAlto: 0.5 }, 'un cuadro suelto no la esconde');
assert.ok(alternancia(Array.from({ length: 90 }, (_, i) => (i % 5 ? 100 : 300))), 'sombras cada 5 cuadros');
const pAlt = resumirPaso({ nombre: 'alt', ms: Array(91).fill(16), calls: alt, tris: alt.map((x) => x * 100) });
assert.equal(pAlt.gl.callsMedia, 483.4); // (46 × 338 + 45 × 632) / 91 assert.ok(pAlt.gl.alterna);
const cAlt = comparar({ entorno: ent, carga: {}, pasos: [{ ...pAlt, gl: { ...pAlt.gl, calls: 338 } }] }, { entorno: ent, carga: {}, pasos: [{ ...pAlt, gl: { ...pAlt.gl, calls: 632 } }] });
assert.match(cAlt.avisos.join(' '), /alternan entre dos niveles/);
assert.equal(cAlt.filas.find((x) => x.metrica === 'alt.gl.callsMedia').veredicto, '≈', 'la media no cambia aunque la mediana salte');
assert.match(aMarkdown({ url: 'u', fecha: 'f', entorno: { ...ent, plataforma: 'p', navegador: 'n' }, carga: { longTasks: { n: 0 } }, pasos: [pAlt] }), /alternan 338 \/ 632/);
// v0.5: compilaciones al aplicar el paso (antes de medir) y programas nuevos sin links (p. ej. --sin-gl)
const shp = resumirShaders({ links: [-0.4, -0.3], programas: 117, programasIni: 59, recompilaciones: [] });
assert.equal(shp.nuevosProgramas, 58);
assert.match(alertas({ pasos: [{ nombre: 'a_baja', shaders: shp, huecos: resumirHuecos([]) }] })[0], /\[a_baja\] 2 shaders compilados después de la carga, en 1 ráfaga\(s\) \(t = al aplicar el paso\)/);
assert.match(alertas({ pasos: [{ nombre: 'x', shaders: resumirShaders({ links: [], programas: 70, programasIni: 60 }), huecos: resumirHuecos([]) }] })[0], /\[x\] 10 programas nuevos después de la carga/);
assert.deepEqual(alertas({ pasos: [{ nombre: 'x', shaders: resumirShaders({ links: [], programas: 60, programasIni: 60 }), huecos: resumirHuecos([]) }] }), []);
// v0.5: intercalado: B peor en todos los pares fuera del ruido; iguales → sin diferencia
const cor = (...f) => f.map((x) => ({ pasos: [{ nombre: 'base', fps: { p50: x } }] }));
const it1 = resumirIntercalado(cor(30, 31, 29), cor(25, 26, 24));
assert.equal(it1[0].veredicto, 'B peor'); assert.deepEqual(it1[0].pares, [-16.7, -16.1, -17.2]); assert.equal(it1[0].ruidoA, 6.7);
assert.equal(resumirIntercalado(cor(30, 38, 29), cor(31, 30, 30))[0].veredicto, 'sin diferencia clara', 'pares en distinto sentido');
assert.equal(resumirIntercalado(cor(30), cor(null))[0].veredicto, 'sin pares');
assert.ok(comparar({ ...rep(60, 16), entorno: { ...ent, caliente: true } }, rep(60, 16)).avisos.some((a) => a.startsWith('caliente')));
console.log('unitaria: OK');

// ---------------- integración
const tmp = mkdtempSync(join(tmpdir(), 'medidor-'));
const srv = createServer((req, res) => {
  // /csp/... sirve lo mismo con una CSP sin 'unsafe-eval' (como muchos servidores reales)
  const ruta = new URL(req.url, 'http://x').pathname, csp = ruta.startsWith('/csp/');
  const f = join(AQUI, 'prueba', ruta.replace(/^\/(csp\/)?/, '') || 'escena.html');
  if (!f.startsWith(join(AQUI, 'prueba')) || !existsSync(f)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...(csp && { 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'" }) }).end(readFileSync(f));
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}/escena.html`;

const correr = (...a) => new Promise((r) => execFile(process.execPath, [join(AQUI, 'medidor.mjs'), a[0]?.startsWith('http') ? a.shift() : url, '--dur', '2', '--calentar', '1', '--listo', 'window.__listo', ...a],
  { timeout: 180000 }, (err, stdout, stderr) => r({ code: err ? err.code ?? 1 : 0, stdout, stderr })));

let omitida = null;
try {
  const salida = join(tmp, 'escena');
  const r = await correr('--salida', salida, '--etiqueta', 'prueba');
  if (r.code === 2) omitida = 'no hay Chrome (usa --chrome o CHROME)';
  else {
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(`${salida}.json`) && existsSync(`${salida}.md`), 'faltan .json/.md');
    const j = JSON.parse(readFileSync(`${salida}.json`, 'utf8')), b = j.pasos[0];
    if (/sin WebGL/.test(j.entorno.gpu)) omitida = 'el navegador no tiene WebGL';
    else {
      console.log(`  gpu: ${j.entorno.gpu}${j.entorno.software ? ' (SOFTWARE)' : ''} · fps p50 ${b.fps.p50}`);
      assert.equal(b.gl.calls, 3, 'gl.calls');
      assert.equal(b.gl.tris, 3, 'gl.tris');
      assert.ok(b.cuadros > 0, 'cuadros');
      assert.ok(j.carga.transferidoBytes > 0, 'transferidoBytes');
      assert.ok(j.carga.listoMs > 0, 'listoMs');
      assert.equal(j.entorno.software, esSoftware(j.entorno.gpu));
      if (j.entorno.software) assert.match(readFileSync(`${salida}.md`, 'utf8'), /GPU POR SOFTWARE/);
      // comparar x x: todo en 0 y sin avisos
      const cmp = comparar(j, j);
      assert.equal(cmp.avisos.length, 0);
      assert.ok(cmp.filas.every((x) => x.delta === 0 || x.delta === null), 'comparar x x');
      // --sin-vsync: más de 60 fps en una escena trivial (solo con GPU real)
      const v = await correr('--sin-vsync', '--salida', '-');
      assert.equal(v.code, 0, v.stderr);
      const jv = JSON.parse(v.stdout);
      console.log(`  --sin-vsync: fps p50 ${jv.pasos[0].fps.p50}`);
      if (!jv.entorno.software) assert.ok(jv.pasos[0].fps.p50 > 60, `--sin-vsync p50 ${jv.pasos[0].fps.p50}`);
      assert.equal(jv.entorno.vsync, false);
      // CSP estricta: --listo (falso en la 1.ª evaluación), --js y --extra deben funcionar igual
      const k = await correr(url.replace('/escena.html', '/csp/escena.html'), '--listo', 'performance.now() > 2500', '--js', 'window.__js = 7', '--extra', '({ js: window.__js })', '--salida', '-');
      assert.equal(k.code, 0, k.stderr);
      const jk = JSON.parse(k.stdout);
      assert.deepEqual(jk.carga.errores.filter((e) => /^\[(listo|--js)\]/.test(e)), [], 'CSP: errores');
      assert.ok(jk.carga.listoMs >= 2500, `CSP: listoMs ${jk.carga.listoMs}`);
      assert.deepEqual(jk.pasos[0].extra, { js: 7 }, 'CSP: --js/--extra');
      console.log(`  CSP sin unsafe-eval: listo ${jk.carga.listoMs} ms, sin errores`);
      // v2: sin recompilar, 0 links tras la carga; con ?recompilar=1 y --interactuar, la alerta aparece
      assert.equal(b.shaders.links, 0, 'links en la escena quieta');
      assert.ok(j.carga.shaders.links >= 1, 'links de la carga');
      const rc = await correr(url + '?recompilar=1', '--dur', '3', '--interactuar', '--salida', join(tmp, 'rc'));
      assert.equal(rc.code, 0, rc.stderr);
      const jr = JSON.parse(readFileSync(join(tmp, 'rc.json'), 'utf8'));
      assert.ok(jr.pasos[0].shaders.links >= 1, `recompilar: links ${jr.pasos[0].shaders.links}`);
      assert.match(rc.stderr, /ALERTA: \[base\] \d+ shaders compilados después de la carga/);
      assert.match(readFileSync(join(tmp, 'rc.md'), 'utf8'), /## Alertas/);
      console.log(`  ?recompilar=1 --interactuar: ${jr.pasos[0].shaders.links} links detectados, alerta OK`);
      // v3: --repetir 2 → corridas, mediana y rango; comparar marca ≈ y no avisa "una corrida"
      const rp = await correr('--repetir', '2', '--dur', '1', '--salida', join(tmp, 'rep'));
      assert.equal(rp.code, 0, rp.stderr);
      const jp = JSON.parse(readFileSync(join(tmp, 'rep.json'), 'utf8'));
      assert.equal(jp.version, 5);
      assert.equal(jp.repeticiones, 2);
      assert.equal(jp.corridas.length, 2);
      const g = jp.rango['base.fps.p50'], vals = jp.corridas.map((x) => x.pasos[0].fps.p50);
      assert.deepEqual(g, [Math.min(...vals), Math.max(...vals)]);
      assert.ok(jp.pasos[0].fps.p50 >= g[0] && jp.pasos[0].fps.p50 <= g[1], 'mediana dentro del rango');
      assert.match(readFileSync(join(tmp, 'rep.md'), 'utf8'), /Repeticiones: 2/);
      const cmd = comparacionMd(jp, jp, comparar(jp, jp));
      assert.doesNotMatch(cmd, /una corrida/);
      assert.ok(comparar(jp, jp).filas.every((x) => x.veredicto === '≈' || x.veredicto === '?'));
      console.log(`  --repetir 2: fps p50 ${vals.join(' / ')} → mediana ${jp.pasos[0].fps.p50}`);
      // v4: --ab 2 → A#1 B#1 A#2 B#2 A#3, pares contra las A vecinas y sección A/B en el .md
      writeFileSync(join(tmp, 'ab.json'), JSON.stringify([{ nombre: 'a', js: '1' }, { nombre: 'b', js: '2' }]));
      const ra = await correr('--pasos', join(tmp, 'ab.json'), '--ab', '2', '--dur', '1', '--calentar', '0', '--salida', join(tmp, 'abr'));
      assert.equal(ra.code, 0, ra.stderr);
      const ja = JSON.parse(readFileSync(join(tmp, 'abr.json'), 'utf8'));
      assert.deepEqual(ja.pasos.map((x) => x.nombre), ['a#1', 'b#1', 'a#2', 'b#2', 'a#3']);
      assert.equal(ja.ab.pares.length, 2);
      assert.match(readFileSync(join(tmp, 'abr.md'), 'utf8'), /## A\/B: a contra b/);
      console.log(`  --ab 2: ${ja.ab.veredicto} (Δ fps ${ja.ab.dFps} %, ruido entre A ${ja.ab.ruidoA} %)`);
      // v3: congelado genérico, dos pasadas con dos pasos → capturas idénticas por paso
      writeFileSync(join(tmp, 'pasos.json'), JSON.stringify([{ nombre: 'a', dur: 0.5 }, { nombre: 'b', dur: 0.5, js: "document.body.style.background = '#225'" }]));
      for (const k of [1, 2]) {
        const cz = await correr('--dur', '0.5', '--calentar', '0', '--pasos', join(tmp, 'pasos.json'), '--congelar-cuadros', '30', '--captura', join(tmp, `cg${k}.png`), '--salida', join(tmp, `cg${k}`));
        assert.equal(cz.code, 0, cz.stderr);
        const cap = JSON.parse(readFileSync(join(tmp, `cg${k}.json`), 'utf8')).capturas;
        assert.deepEqual(cap.archivos, [join(tmp, `cg${k}-a.png`), join(tmp, `cg${k}-b.png`)]);
        assert.deepEqual(cap.errores.filter((e) => /congelar/.test(e)), [], 'errores del congelado');
      }
      const ca = compararCapturas(readFileSync(join(tmp, 'cg1-a.png')), readFileSync(join(tmp, 'cg2-a.png'))).total;
      const cb = compararCapturas(readFileSync(join(tmp, 'cg1-b.png')), readFileSync(join(tmp, 'cg2-b.png'))).total;
      assert.ok(ca.difierenPct < 0.1 && Math.abs(ca.delta) < 0.1, `congelado paso a: ${JSON.stringify(ca)}`);
      assert.ok(cb.difierenPct < 0.1 && Math.abs(cb.delta) < 0.1, `congelado paso b: ${JSON.stringify(cb)}`);
      assert.ok(compararCapturas(readFileSync(join(tmp, 'cg1-a.png')), readFileSync(join(tmp, 'cg1-b.png'))).total.difierenPct > 50, 'cada paso con su escena');
      console.log(`  --congelar-cuadros 30: dos pasadas difieren ${ca.difierenPct} % / ${cb.difierenPct} % de píxeles`);
      // v3: comparar-capturas por CLI: contra sí misma Δ 0; contra una versión aclarada, Δ > 0; zonas y diff
      const P = leerPng(readFileSync(join(tmp, 'cg1-a.png')));
      writeFileSync(join(tmp, 'clara.png'), escribirPng(P.ancho, P.alto, P.rgba.map((v, i) => (i % 4 === 3 ? v : Math.min(255, Math.round(v * 1.2 + 10))))));
      writeFileSync(join(tmp, 'zonas.json'), JSON.stringify({ izquierda: [0, 0, 0.5, 1], derecha: [0.5, 0, 0.5, 1] }));
      const cli = (...a) => new Promise((r) => execFile(process.execPath, [join(AQUI, 'medidor.mjs'), 'comparar-capturas', ...a], (err, stdout, stderr) => r({ code: err ? err.code ?? 1 : 0, stdout, stderr })));
      const igual = await cli(join(tmp, 'cg1-a.png'), join(tmp, 'cg1-a.png'));
      assert.equal(igual.code, 0, igual.stderr);
      assert.match(igual.stdout, /\| total \| ([\d.]+) \| \1 \| 0 \| 0 \|/);
      const cl = await cli(join(tmp, 'cg1-a.png'), join(tmp, 'clara.png'), '--zonas', join(tmp, 'zonas.json'), '--diff', join(tmp, 'diff.png'), '--md', join(tmp, 'cap.md'));
      assert.equal(cl.code, 0, cl.stderr);
      const dl = Number(cl.stdout.match(/\| total \| [\d.]+ \| [\d.]+ \| ([\d.-]+) \|/)[1]);
      assert.ok(dl > 15, `aclarada: Δ ${dl}`);
      assert.match(cl.stdout, /\| izquierda \[0, 0, 800, 900\]/);
      assert.equal(leerPng(readFileSync(join(tmp, 'diff.png'))).ancho, 1600);
      assert.ok(existsSync(join(tmp, 'cap.md')));
      const mal = await cli(join(tmp, 'cg1-a.png'), join(tmp, 'zonas.json'));
      assert.equal(mal.code, 1);
      assert.match(mal.stderr, /no es un PNG/);
      console.log(`  comparar-capturas: sí misma Δ 0; aclarada Δ +${dl} %`);
      // v0.5: draw calls que alternan → alterna detectado y la media
      const al5 = await correr(url + '?alternar=1', '--salida', '-');
      assert.equal(al5.code, 0, al5.stderr);
      const ja5 = JSON.parse(al5.stdout).pasos[0].gl;
      assert.deepEqual([ja5.alterna?.bajo, ja5.alterna?.alto], [3, 6], `alterna: ${JSON.stringify(ja5)}`);
      assert.ok(ja5.callsMedia > 4 && ja5.callsMedia < 5, `callsMedia ${ja5.callsMedia}`);
      assert.match(al5.stderr, /calls [\d.]+ \(media; alterna 3\/6\)/);
      console.log(`  ?alternar=1: alterna ${ja5.alterna.bajo}/${ja5.alterna.alto}, media ${ja5.callsMedia}`);
      // v0.5: el js de un paso que recompila → alerta "al aplicar el paso" (antes: 0 links y sin alerta)
      writeFileSync(join(tmp, 'rjs.json'), JSON.stringify([{ nombre: 'quieto' }, { nombre: 'cambia', js: 'window.__recompilarYa()' }]));
      const rj = await correr('--pasos', join(tmp, 'rjs.json'), '--dur', '1', '--calentar', '0', '--salida', '-');
      assert.equal(rj.code, 0, rj.stderr);
      const pj = JSON.parse(rj.stdout).pasos;
      assert.equal(pj[0].shaders.links, 0, 'paso quieto'); assert.equal(pj[1].shaders.links, 1, 'el js del paso compiló 1');
      assert.match(rj.stderr, /ALERTA: \[cambia\] 1 shaders compilados después de la carga, en 1 ráfaga\(s\) \(t = al aplicar el paso\)/);
      console.log('  js de paso que recompila: alerta OK');
      // v0.5: --limite: una corrida colgada se descarta y sale con código 3
      const t0 = Date.now(), lim = await correr('--js', 'new Promise(() => {})', '--limite', '15', '--salida', '-');
      assert.equal(lim.code, 3, lim.stderr); assert.match(lim.stderr, /pasó el límite de 15 s/);
      assert.ok(Date.now() - t0 < 60000, 'no esperó de más');
      console.log(`  --limite 15: corrida colgada cortada en ${Math.round((Date.now() - t0) / 1000)} s`);
      // v0.5: --caliente: mide la segunda visita y guarda la fría
      const ca5 = await correr('--caliente', '--salida', '-');
      assert.equal(ca5.code, 0, ca5.stderr);
      const jc5 = JSON.parse(ca5.stdout);
      assert.equal(jc5.entorno.caliente, true); assert.ok(jc5.carga.fria?.listoMs > 0, 'carga.fria');
      console.log(`  --caliente: fría ${jc5.carga.fria.listoMs} ms, caliente ${jc5.carga.listoMs} ms`);
      // v0.5: --intercalar: A1 B1 A2 B2 y comparación con sección Intercalado
      const ic = await correr('--intercalar', url + '?alternar=1', '--repetir', '2', '--dur', '1', '--calentar', '0', '--salida', join(tmp, 'ic'));
      assert.equal(ic.code, 0, ic.stderr);
      assert.ok(existsSync(join(tmp, 'ic-a.json')) && existsSync(join(tmp, 'ic-b.json')));
      const icmd = readFileSync(join(tmp, 'ic-comparacion.md'), 'utf8');
      assert.match(icmd, /## Intercalado/); assert.match(icmd, /alternan entre dos niveles/);
      assert.deepEqual(ic.stderr.match(/par \d\/2: [AB]/g), ['par 1/2: A', 'par 1/2: B', 'par 2/2: A', 'par 2/2: B']);
      const icc = await correr('--intercalar', url, '--captura', join(tmp, 'x.png'), '--salida', '-');
      assert.equal(icc.code, 1); assert.match(icc.stderr, /--intercalar no captura/);
      console.log('  --intercalar: A1 B1 A2 B2 OK; con --captura, error claro');
      // v0.5: subcomando capturas con --solo-canvas y comparar-capturas de dos carpetas
      writeFileSync(join(tmp, 'vistas.json'), JSON.stringify([{ nombre: 'v1' }, { nombre: 'v2', js: "document.body.style.background = '#522'" }]));
      for (const d of ['ca', 'cb']) {
        const cp = await new Promise((r) => execFile(process.execPath, [join(AQUI, 'medidor.mjs'), 'capturas', url, '--pasos', join(tmp, 'vistas.json'), '--captura', join(tmp, d, 'x.png'), '--solo-canvas', '--listo', 'window.__listo', '--calentar', '0'],
          { timeout: 120000 }, (err, stdout, stderr) => r({ code: err ? err.code ?? 1 : 0, stderr })));
        assert.equal(cp.code, 0, cp.stderr);
      }
      assert.ok(existsSync(join(tmp, 'ca', 'x-v1.png')) && existsSync(join(tmp, 'ca', 'x-v2.png')));
      const dirs = await cli(join(tmp, 'ca'), join(tmp, 'cb'));
      assert.equal(dirs.code, 0, dirs.stderr);
      writeFileSync(join(tmp, 'cb', 'roto.png'), 'no'); writeFileSync(join(tmp, 'ca', 'roto.png'), 'no');
      const dmal = await cli(join(tmp, 'ca'), join(tmp, 'cb'));
      assert.equal(dmal.code, 1, 'una comparación fallida en carpetas: código 1'); assert.match(dmal.stderr, /1 de 3 comparaciones fallaron/);
      rmSync(join(tmp, 'ca', 'roto.png')); rmSync(join(tmp, 'cb', 'roto.png'));
      assert.match(dirs.stdout, /\| x-v1\.png \|/); assert.match(dirs.stdout, /\| x-v2\.png \|/); assert.match(dirs.stdout, /2 archivo\(s\)/);
      const solo = leerPng(readFileSync(join(tmp, 'ca', 'x-v1.png')));
      assert.ok(solo.ancho > 0 && solo.alto > 0);
      console.log(`  capturas --solo-canvas + comparar-capturas de carpetas: ${solo.ancho}×${solo.alto}, 2 archivos`);
    }
  }
} finally {
  srv.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(omitida ? `integración: OMITIDA: ${omitida}` : 'integración: OK');
