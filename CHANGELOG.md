# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [0.2.0] - 2026-11-20

### Agregado
- `--interactuar` (y `interactuar` por paso): arrastres reales con el ratón (izquierdo y derecho) y rueda sobre el canvas más grande durante la medición.
- Recompilaciones: `sonda.js` envuelve `linkProgram` (con cualquier motor) y, si la página es three.js, sigue `renderer.info.programs` y la firma de luces y sombras por `__THREE_DEVTOOLS__`. Cada paso trae `shaders: {links, programas, rafagas, causas}` y la carga trae `shaders: {links, programas}`.
- Tirones con hora: `huecos` (cuadros de más de 250 ms) y `longTasksT`.
- Alertas al final (stderr) y sección "Alertas" en el `.md`: shaders compilados después de la carga, con la causa (p. ej. `SpotLight 1 → 2`), y cuadros de más de 1 s.
- `comparar` también compara `huecos.n`, `huecos.maxMs` y `shaders.links`.
- `prueba/escena.html?recompilar=1` enlaza un programa nuevo cada ~1 s, y `prueba.mjs` comprueba que se detecte con `--interactuar`.

### Cambiado
- JSON `version: 2` (solo agrega campos).

## [0.1.1] - 2026-11-20

### Corregido
- `--listo`, `--js`, `--extra` y los `js` de los pasos fallaban en páginas con CSP sin `'unsafe-eval'`: `--listo` se reportaba como "no se cumplió en 120 s" aunque fallaba en ~0.3 s, y se medía la pantalla de carga. El contexto de Playwright ahora usa `bypassCSP: true`.
- Con miles de fps (sin vsync en una GPU rápida) los intervalos de rAF valen 0 y `fps.p50` salía `null`. Ahora un intervalo de 0 cuenta como 0.1 ms (la resolución de rAF), con tope de 10000 fps.
- `--listo` anota el error real en `carga.errores` (`[listo] error: …`) cuando no es un timeout.

### Pruebas
- `prueba.mjs` sirve la escena también con una CSP estricta (`/csp/`) y comprueba `--listo` (falso en la primera evaluación), `--js` y `--extra`.

## [0.1.0] - 2026-11-20

### Agregado
- `medidor.mjs`: comando `medir` (fps media/p50/p5/p1, ms p50/p95/p99/máx, long tasks, draw calls y triángulos por cuadro, peso transferido, heap JS, perfil de CPU, captura) y comando `comparar`.
- `sonda.js`: init script independiente del motor 3D (rAF propio, PerformanceObserver de long tasks, wrappers de WebGL).
- `lib.mjs`: percentil, resumen de pasos, reporte markdown y comparación.
- `prueba.mjs`: prueba unitaria e integración con Chrome real sobre `prueba/escena.html`.
