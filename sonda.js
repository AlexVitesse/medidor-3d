// Init script que medidor.mjs inyecta antes que cualquier script de la página (page.addInitScript).
// Cuenta cuadros con un rAF propio, long tasks con PerformanceObserver, draw calls / triángulos y shaders enlazados
// (linkProgram) envolviendo WebGL; nada de eso depende del motor 3D. Si la página usa three.js, además engancha
// __THREE_DEVTOOLS__ para seguir renderer.info.programs y la firma de luces y sombras (la causa típica de una
// recompilación). Expone window.__medidor.
(() => {
  if (window.top !== window || window.__medidor) return;
  const cfg = window.__medidorCfg || {};
  const HUECO = 250; // ms: un cuadro más largo que esto es un tirón visible
  const S = { activo: false, ms: [], calls: [], tris: [], c: 0, t: 0, ult: 0, longTasks: [], huecos: [], links: [], recomp: [] };
  // la sonda usa el reloj y el rAF reales aunque la página los tenga congelados
  const raf = window.requestAnimationFrame.bind(window), ahora = performance.now.bind(performance);

  // --congelar-cuadros N (solo en la pasada de capturas): reloj virtual de 1/60 s por cuadro de la app y Math.random con semilla.
  // Tras N cuadros el tiempo se detiene y la app deja de recibir rAF; avanzar(k) le da k cuadros más con el tiempo quieto.
  // ponytail: setTimeout/setInterval siguen en tiempo real; virtualizarlos si una app avanza su estado con ellos.
  const congelar = (N) => {
    const PASO = 1000 / 60, EPOCA = Date.UTC(2026, 0, 15, 18), D = Date, cola = new Map();
    let t = 0, n = 0, extra = 0, id = 0, s = 0x2545f491;
    performance.now = () => t;
    window.Date = class extends D { constructor(...a) { super(...(a.length ? a : [EPOCA + t])); } static now() { return EPOCA + t; } };
    Math.random = () => { s = (s + 0x6d2b79f5) | 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    window.requestAnimationFrame = (cb) => (cola.set(++id, cb), id);
    window.cancelAnimationFrame = (i) => cola.delete(i);
    const bucle = () => {
      // el tiempo solo avanza en cuadros en que la app pidió rAF: lo que tarde la carga no cuenta
      if (n < N ? cola.size : extra > 0) {
        if (n < N) { n++; t += PASO; } else extra--;
        const cbs = [...cola.values()]; cola.clear();
        for (const cb of cbs) try { cb(t); } catch (e) { setTimeout(() => { throw e; }); }
      }
      raf(bucle);
    };
    raf(bucle);
    return { congelado: () => n >= N, avanzar: (k) => new Promise((r) => { extra += k; const f = () => (extra > 0 ? raf(f) : raf(() => r())); raf(f); }) };
  };
  const C = cfg.congelarCuadros == null ? null : congelar(cfg.congelarCuadros);

  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) S.longTasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
  } catch { /* navegador sin longtask */ }

  if (!cfg.sinGl) {
    // TRIANGLES = 4, TRIANGLE_STRIP = 5, TRIANGLE_FAN = 6; líneas y puntos cuentan como llamada pero no como triángulo
    const tri = (modo, n) => (modo === 4 ? Math.floor(n / 3) : modo === 5 || modo === 6 ? Math.max(0, n - 2) : 0);
    const envolver = (proto, nombre, iCount, iInst) => {
      const orig = proto?.[nombre];
      if (typeof orig !== 'function') return;
      proto[nombre] = function (...a) { S.c++; S.t += tri(a[0], a[iCount]) * (iInst == null ? 1 : a[iInst]); return orig.apply(this, a); };
    };
    // ponytail: no cuenta WEBGL_multi_draw ni ANGLE_instanced_arrays (WebGL1); agregarlos cuando se use BatchedMesh o instancias en WebGL1.
    for (const P of [window.WebGL2RenderingContext?.prototype, window.WebGLRenderingContext?.prototype]) {
      envolver(P, 'drawArrays', 2);
      envolver(P, 'drawElements', 1);
      envolver(P, 'drawArraysInstanced', 2, 3);
      envolver(P, 'drawElementsInstanced', 1, 4);
      envolver(P, 'drawRangeElements', 3);
      // cada shader nuevo pasa por linkProgram: después de la carga, es una recompilación (con cualquier motor)
      const link = P?.linkProgram;
      if (typeof link === 'function') P.linkProgram = function (p) { S.links.push(ahora()); return link.call(this, p); };
    }
  }

  // ---------- three.js: programas y su causa probable
  const T = { r: null, escenas: [], vistos: new Set(), claves: [], firma: null, nProg: 0 };
  try {
    const dt = (window.__THREE_DEVTOOLS__ ??= new EventTarget());
    dt.addEventListener('observe', (e) => { const d = e.detail; if (d?.isWebGLRenderer) T.r ??= d; else if (d?.isScene) T.escenas.push(new WeakRef(d)); });
  } catch { /* sin EventTarget o sin WeakRef */ }
  // visible de verdad: three no junta una luz si ella o algún padre está oculto
  const visible = (o) => { for (let a = o; a; a = a.parent) if (!a.visible) return false; return true; };
  function firma() { // { 'SpotLight': n visibles, 'SpotLight sombra': n con castShadow, ..., 'shadowMap.type': x }
    const f = {};
    for (const w of T.escenas) {
      const s = w.deref(); if (!s) continue;
      s.traverse((o) => { if (o.isLight && visible(o)) { f[o.type] = (f[o.type] || 0) + 1; if (o.castShadow) f[o.type + ' sombra'] = (f[o.type + ' sombra'] || 0) + 1; } });
    }
    if (T.r) f['shadowMap.type'] = T.r.shadowMap.type;
    return f;
  }
  const cambios = (a, b) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter((k) => a?.[k] !== b?.[k]).map((k) => `${k} ${a?.[k] ?? 0} → ${b?.[k] ?? 0}`);
  setInterval(() => {
    if (!T.r || document.hidden) return;
    const progs = T.r.info.programs || [], f = firma(), nuevos = [];
    for (const p of progs) if (!T.vistos.has(p.id)) { T.vistos.add(p.id); nuevos.push(p.cacheKey); }
    if (nuevos.length && T.nProg) { // los primeros programas (T.nProg = 0) son la carga normal, no una recompilación
      // campo del cacheKey que cambió respecto al programa viejo más parecido (pista cruda: el índice depende del material)
      const dif = [];
      for (const k of nuevos.slice(0, 6)) {
        const c = k.split(','); let best = null, bd = 1e9;
        for (const v of T.claves) { if (v.length !== c.length || v[0] !== c[0]) continue; let d = 0; for (let i = 0; i < c.length; i++) if (v[i] !== c[i]) d++; if (d < bd) { bd = d; best = v; } }
        dif.push(best ? `${c[0]}: ` + c.map((x, i) => (x !== best[i] ? `[${i}] ${best[i].slice(0, 24)}→${x.slice(0, 24)}` : null)).filter(Boolean).slice(0, 4).join(', ') : `${c[0]}: material nuevo`);
      }
      S.recomp.push({ t: ahora(), nuevos: nuevos.length, total: progs.length, luces: cambios(T.firma, f), claves: [...new Set(dif)] });
    }
    for (const k of nuevos) T.claves.push(k.split(','));
    // la base es la firma de la última compilación: la revisión puede caer entre el cambio de luz y el render que compila
    if (nuevos.length || !T.nProg) T.firma = f;
    T.nProg = progs.length;
  }, 500);

  const cuadro = (ts) => {
    if (S.activo) {
      if (S.ult) { const d = ts - S.ult; S.ms.push(d); S.calls.push(S.c); S.tris.push(S.t); if (d > HUECO) S.huecos.push([ts - d, d]); }
      S.ult = ts;
    }
    S.c = S.t = 0;
    raf(cuadro);
  };
  raf(cuadro);

  const desde = (lista, t0) => lista.filter((x) => (Array.isArray(x) ? x[0] : x.t ?? x) >= t0);
  window.__medidor = {
    ...C,
    // empieza un paso: borra muestras; el primer cuadro solo fija la referencia
    // v0.5: antes del js/espera del paso. Lo que ese js compile (p. ej. cambiar la calidad) es del paso, aunque pase antes de medir.
    prepararPaso() { S.tPaso = ahora(); S.progIni = T.r ? (T.r.info.programs || []).length : null; },
    marcar() { Object.assign(S, { activo: true, ms: [], calls: [], tris: [], huecos: [], ult: 0, c: 0, t: 0, t0: ahora() }); },
    // termina el paso y devuelve las muestras crudas; los tiempos van en s desde el inicio del paso
    leer() {
      S.activo = false;
      const t0 = S.t0, tp = Math.min(S.tPaso ?? t0, t0), rel = (t) => (t < t0 ? Math.min(-0.1, Math.round((t - t0) / 100) / 10) : Math.round((t - t0) / 100) / 10);   // t < 0: al aplicar el paso
      return {
        ms: S.ms, calls: cfg.sinGl ? null : S.calls, tris: cfg.sinGl ? null : S.tris, durS: (ahora() - t0) / 1000,
        longTasks: desde(S.longTasks, t0).map(([, d]) => d), longTasksT: desde(S.longTasks, t0).map(([t, d]) => [rel(t), Math.round(d)]),
        huecos: S.huecos.map(([t, d]) => [rel(t), Math.round(d)]),
        links: cfg.sinGl ? null : desde(S.links, tp).map(rel),
        recompilaciones: desde(S.recomp, tp).map((r) => ({ ...r, t: rel(r.t) })),
        programas: T.r ? (T.r.info.programs || []).length : null, programasIni: S.progIni ?? null,
      };
    },
    longTasksHasta: (t) => S.longTasks.filter(([s]) => s <= t).map(([, d]) => d),
    linksHasta: (t) => S.links.filter((s) => s <= t).length,
    programas: () => (T.r ? (T.r.info.programs || []).length : null),
  };
})();
