# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [Sin publicar]

### Documentación
- README, "Escena que cambia sola": la deriva de draw calls del caso de migración venía de un modo kiosco de la app (recorrido automático tras 25 s sin interacción), no de la escena. Se agrega la regla: apagar modos demo, kiosco o autorrotación antes de medir más de unos segundos.

## [0.5.0] - 2026-11-24

Motivo: en las migraciones a three r187 de tres gemelos de plantas industriales el medidor dio falsas alarmas (draw calls al doble, regresiones que eran ruido de la máquina, +2.4 s de carga que solo pasan en la primera visita), se calló ante un congelamiento real (cambio de calidad en un gemelo en r160) y una corrida se colgó más de 9 minutos.

### Agregado
- `--intercalar <urlB>`: corridas A1 B1 A2 B2 …, reportes `-a`, `-b` y `-comparacion.md` con la sección "Intercalado" (Δ por par y veredicto).
- `--caliente`: mide la segunda visita (con caché HTTP y de shaders); la primera queda en `carga.fria`.
- `--limite S`: tope por corrida; la corrida colgada se descarta y se sigue. Código 3 si no queda ninguna.
- Subcomando `capturas <url> --pasos vistas.json --captura dir/x.png [--solo-canvas]`: solo capturas, sin medir.
- `comparar-capturas carpetaA carpetaB`: una fila por cada `.png` que esté en las dos.
- `gl.callsMedia`, `gl.trisMedia` y `gl.alterna` por paso; nota en el `.md` y aviso en `comparar` cuando los draw calls alternan.
- `shaders.nuevosProgramas` por paso.

### Corregido
- Las compilaciones que dispara el `js`/`espera` de un paso ya cuentan para ese paso (`t` negativo = "al aplicar el paso"). Antes un cambio de calidad en el `js` daba `links 0` y ninguna alerta.
- `gl.deriva` usa la media de cada tercio: con draw calls que alternan, la mediana daba derivas falsas.
- Con `--salida -` también se imprime el resumen por paso en stderr.
- Auditoría de Codex (7 hallazgos, todos corregidos):
  - un Chrome que terminaba de abrir después de vencer `--limite` se quedaba vivo y contaminaba la corrida siguiente; ahora se cierra solo;
  - `--intercalar` con `--captura` perdía o sobrescribía la captura; ahora es un error que remite a `capturas`;
  - `alternancia` confundía un cambio de escena en bloque con alternancia, y un cuadro suelto la escondía; ahora usa p5/p95 y exige cambios frecuentes de nivel;
  - las capturas congeladas fallidas salían con código 0; ahora 3;
  - `comparar-capturas` por carpetas salía con 0 aunque fallaran comparaciones; ahora 1.

### Cambiado
- JSON `version: 5` (solo agrega campos).

## [0.4.1] - 2026-11-23

### Corregido (auditoría externa)
- A/B: un paso sin cuadros medidos (fps vacío) contaba como 0 fps y daba "b peor". Ahora el par se descarta y se avisa.
- A/B: la alerta de draw calls distingue dos casos:
  - las A vecinas difieren entre sí: la escena cambió sola;
  - solo B dibuja distinto: puede ser el efecto de la variante (LOD, calidad).
- `--repetir`: si la primera corrida traía un valor vacío, se perdían los de las demás.
- `--pasos` exige nombres únicos, porque los rangos y `comparar` se emparejan por nombre.

## [0.4.0] - 2026-11-23

Motivo: en la migración del hotel, los pasos seguidos daban fps distintos con cualquier ajuste (también en r160) porque la escena cambiaba sola. Con eso casi se concluye que el radio de sombra bajaba los fps.

### Agregado
- `gl.deriva` por paso: cambio de la mediana de draw calls del primer al último tercio. Alerta si pasa de ±20 % en un paso sin ratón.
- `--ab N`: A/B intercalado (A#1 B#1 … A#N+1). Cada B se compara con sus dos A vecinas, con veredicto, ruido entre A y alertas si la escena cambió en medio. Sección "A/B" en el `.md`.
- Pruebas: unitarias de `deriva` y `resumirAB`, e integración de `--ab 2`.

### Cambiado
- JSON `version: 4` (solo agrega campos).

## [0.3.0] - 2026-11-23

Motivo: la migración de three r160 → r187 de SILO 3D y CuartoFrio. `comparar` marcaba como "peor" diferencias que cabían en el ruido de la iGPU (hasta 25 % entre corridas iguales), y las capturas de las dos versiones no se podían comparar porque la simulación seguía corriendo.

### Agregado
- Versión del motor en `entorno.motor` (`{three, babylon}`, leída de `window.__THREE__` y `BABYLON.Engine.Version`). El `.md` y `comparar` la muestran ("three r160" vs "three r187"); con reportes viejos sale "?".
- `--repetir N`: N corridas completas, cada una en un navegador nuevo (perfil limpio). `carga` y `pasos` pasan a ser medianas, con `rango` (`[mín, máx]` por métrica) y `corridas`. El `.md` muestra `mediana [mín–máx]`. Las alertas se dan por corrida.
- `comparar` con ruido: si hay repeticiones, `≈` cuando |Δ de medianas| < máx(5 %, ruido), donde ruido = (máx − mín) / mediana del lado más disperso. Nueva columna "ruido %". Con una corrida se mantiene el 5 % y el `.md` advierte "una corrida: sin estimación de ruido".
- Capturas deterministas en una pasada aparte, después de medir:
  - `--congelar "<expr>"`: la app pausa su reloj y fija su cámara;
  - `--congelar-cuadros N`: respaldo genérico. Pone `performance.now`, `Date` y `Math.random` (con semilla) en un reloj virtual de 1/60 s por cuadro y detiene el tiempo y `requestAnimationFrame` tras N cuadros.
  - Con varios pasos sale una captura por paso (`<captura>-<paso>.png`), cada una con la cámara que pone el `js` del paso.
- `comparar-capturas a.png b.png [--zonas] [--umbral] [--diff] [--md]`: luminancia media y Δ%, % de píxeles que difieren y PNG de diferencias, en total y por zona. Decodifica y codifica PNG con el `zlib` de Node (RGB/RGBA de 8 bits sin entrelazar; con otro formato falla con un mensaje claro).

### Cambiado
- JSON `version: 3`. Solo agrega campos opcionales (`repeticiones`, `rango`, `corridas`, `capturas`): sin `--repetir` ni captura congelada, el contenido es el de la 0.2.
- La sonda mide con su propio `requestAnimationFrame` y `performance.now`, aunque la página los tenga congelados.

### Pruebas
- Unitaria: mediana, agregación de corridas, `≈` por ruido contra "peor" sin él, PNG de ida y vuelta, PNG de 16 bits rechazado, zonas en fracción y tamaños distintos.
- Integración: `--repetir 2` (corridas, mediana dentro del rango); dos pasadas con `--congelar-cuadros 30` y dos pasos dan capturas idénticas (sin congelar difieren ~0.5 % de los píxeles); `comparar-capturas` por CLI de una imagen contra sí misma (Δ 0), contra una versión aclarada (Δ > 0) y contra algo que no es PNG.

## [0.2.1] - 2026-11-20

### Corregido
- La sonda perdía la causa de una recompilación si revisaba entre el cambio de luz y el render: la firma base ahora es la de la última compilación.
- Las alertas también salen en stderr con `--salida -`.

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
