// node prueba.mjs — unitaria de lib.mjs + integración con Chrome real sobre prueba/escena.html.
// Si no hay Chrome o WebGL, la integración se marca OMITIDA y la unitaria cuenta igual.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { percentil, resumirPaso, comparar, aMarkdown, esSoftware } from './lib.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));

// ---------------- unitaria
const cien = Array.from({ length: 100 }, (_, i) => i + 1);
assert.equal(percentil(cien, 95), 95);
assert.equal(percentil(cien, 50), 50);
assert.equal(percentil([7], 1), 7);
const p = resumirPaso({ nombre: 'x', durS: 1, ms: Array(60).fill(16.67), calls: [3, 3, 3], tris: [3, 3, 3], longTasks: [] });
assert.ok(Math.abs(p.fps.p50 - 60) < 0.5, `p50 ${p.fps.p50}`);
assert.deepEqual(p.gl, { calls: 3, tris: 3, callsMax: 3, trisMax: 3 });
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
console.log('unitaria: OK');

// ---------------- integración
const tmp = mkdtempSync(join(tmpdir(), 'medidor-'));
const srv = createServer((req, res) => {
  const f = join(AQUI, 'prueba', new URL(req.url, 'http://x').pathname.replace(/^\/+/, '') || 'escena.html');
  if (!f.startsWith(join(AQUI, 'prueba')) || !existsSync(f)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(f));
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}/escena.html`;

const correr = (...a) => new Promise((r) => execFile(process.execPath, [join(AQUI, 'medidor.mjs'), url, '--dur', '2', '--calentar', '1', '--listo', 'window.__listo', ...a],
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
    }
  }
} finally {
  srv.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(omitida ? `integración: OMITIDA: ${omitida}` : 'integración: OK');
