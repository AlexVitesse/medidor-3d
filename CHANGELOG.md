# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [0.1.0] - 2026-11-20

### Agregado
- `medidor.mjs`: comando `medir` (fps media/p50/p5/p1, ms p50/p95/p99/máx, long tasks, draw calls y triángulos por cuadro, peso transferido, heap JS, perfil de CPU, captura) y comando `comparar`.
- `sonda.js`: init script independiente del motor 3D (rAF propio, PerformanceObserver de long tasks, wrappers de WebGL).
- `lib.mjs`: percentil, resumen de pasos, reporte markdown y comparación.
- `prueba.mjs`: prueba unitaria e integración con Chrome real sobre `prueba/escena.html`.
