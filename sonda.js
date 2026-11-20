// Init script que medidor.mjs inyecta antes que cualquier script de la página (page.addInitScript).
// No sabe nada del motor 3D: cuenta cuadros con un rAF propio, long tasks con PerformanceObserver y
// draw calls / triángulos envolviendo los métodos de dibujo de WebGL. Expone window.__medidor.
(() => {
  if (window.top !== window || window.__medidor) return;
  const cfg = window.__medidorCfg || {};
  const S = { activo: false, ms: [], calls: [], tris: [], c: 0, t: 0, ult: 0, longTasks: [] };

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
    }
  }

  const cuadro = (ts) => {
    if (S.activo) {
      if (S.ult) { S.ms.push(ts - S.ult); S.calls.push(S.c); S.tris.push(S.t); }
      S.ult = ts;
    }
    S.c = S.t = 0;
    requestAnimationFrame(cuadro);
  };
  requestAnimationFrame(cuadro);

  window.__medidor = {
    // empieza un paso: borra muestras; el primer cuadro solo fija la referencia
    marcar() { Object.assign(S, { activo: true, ms: [], calls: [], tris: [], ult: 0, c: 0, t: 0, t0: performance.now() }); },
    // termina el paso y devuelve las muestras crudas
    leer() {
      S.activo = false;
      const lt = S.longTasks.filter(([t]) => t >= S.t0).map(([, d]) => d);
      return { ms: S.ms, calls: cfg.sinGl ? null : S.calls, tris: cfg.sinGl ? null : S.tris, longTasks: lt, durS: (performance.now() - S.t0) / 1000 };
    },
    longTasksHasta: (t) => S.longTasks.filter(([s]) => s <= t).map(([, d]) => d),
  };
})();
