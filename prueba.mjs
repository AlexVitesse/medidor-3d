// node prueba.mjs — unitaria de lib.mjs + integración con Chrome real sobre prueba/escena.html.
// Si no hay Chrome o WebGL, la integración se marca OMITIDA y la unitaria cuenta igual.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { percentil, resumirPaso, comparar, aMarkdown, esSoftware, resumirHuecos, resumirShaders, alertas } from './lib.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));

// ---------------- unitaria
const cien = Array.from({ length: 100 }, (_, i) => i + 1);
assert.equal(percentil(cien, 95), 95);
assert.equal(percentil(cien, 50), 50);
assert.equal(percentil([7], 1), 7);
const p = resumirPaso({ nombre: 'x', durS: 1, ms: Array(60).fill(16.67), calls: [3, 3, 3], tris: [3, 3, 3], longTasks: [] });
assert.ok(Math.abs(p.fps.p50 - 60) < 0.5, `p50 ${p.fps.p50}`);
assert.deepEqual(p.gl, { calls: 3, tris: 3, callsMax: 3, trisMax: 3 });
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
    }
  }
} finally {
  srv.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(omitida ? `integración: OMITIDA: ${omitida}` : 'integración: OK');
