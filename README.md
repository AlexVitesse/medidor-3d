# medidor-3d

CLI que abre una página WebGL en Chrome real y mide cómo corre: fps (media, p50, p5, p1 o "1 % low"),
tiempos de cuadro, long tasks, draw calls y triángulos por cuadro, peso transferido, heap JS y, si se pide,
las funciones con más tiempo de CPU. Escribe un `.json` y un `.md`, y compara dos corridas.

No depende del motor: todo se mide con un init script (`sonda.js`), así sirve igual para three.js, Babylon o WebGL crudo.

- Una sola dependencia: `playwright-core` (unos 14 MB en `node_modules`, sin descargar navegador).
- Node ≥ 20.

```
npm i
node prueba.mjs          # unitaria + integración con Chrome
```

## Uso

```
node medidor.mjs <url> [--etiqueta x] [--dur 10] [--calentar 3] [--listo "<expr>"] [--js "<código>"]
     [--pasos pasos.json] [--interactuar] [--ancho 1600 --alto 900 --dpr 1] [--sin-vsync] [--visible] [--sin-gl]
     [--chrome <ruta>] [--angle <backend>] [--extra "<expr>"] [--cpu 25] [--captura fin.png] [--salida reportes/x | -]
node medidor.mjs comparar a.json b.json [--md comparacion.md]
```

| opción | qué hace |
|---|---|
| `--listo "<expr>"` | expresión JS que dice cuándo terminó de cargar. Sin ella: evento `load` + 2 s. Máximo 120 s; si se pasa, se anota en `carga.errores` y la medición sigue. Si la expresión lanza un error, se anota el error real (`[listo] error: …`), no un falso "no se cumplió". |
| `--js "<código>"` | se evalúa una vez, tras la carga y antes de calentar. |
| `--calentar 3` | segundos de espera antes del primer paso (compilación de shaders, texturas). |
| `--dur 10` | segundos de medición por paso (un paso puede sobrescribirlo). |
| `--interactuar` | durante cada paso mueve el ratón de verdad sobre el canvas más grande: arrastres con el botón izquierdo (orbitar) y derecho (desplazar) y rueda. Un paso puede activarlo solo para él con `interactuar: true`. Muchos tirones solo aparecen al mover la cámara. |
| `--pasos pasos.json` | `[{nombre, js, espera, dur, interactuar}]`. Sin pasos hay uno solo, `base`. `js` se evalúa y, si devuelve una promesa, se espera; `espera` son ms extra antes de medir. |
| `--extra "<expr>"` | expresión serializable que se guarda al final de cada paso (p. ej. `window.__inspector3d?.stats` o el contador propio de la app). |
| `--cpu N` | las N funciones con más tiempo propio, del Profiler de CDP, sobre todos los pasos. |
| `--sin-vsync` | agrega `--disable-gpu-vsync --disable-frame-rate-limit`. |
| `--sin-gl` | apaga los wrappers de WebGL (no hay `gl` en el reporte). |
| `--visible` | ventana visible en vez de headless. |
| `--chrome <ruta>` | ejecutable de Chrome/Chromium. También la variable `CHROME`. Sin ninguno: `channel: 'chrome'` (el Chrome instalado). |
| `--angle <backend>` | sustituye el backend ANGLE por defecto. |
| `--salida x` | escribe `x.json` y `x.md`. Por defecto `reportes/<host>-<AAAAMMDD-HHMM>`. Con `-` el JSON va a stdout y los mensajes a stderr. |

`comparar` acepta las rutas con o sin `.json`.

### Flags de GPU por defecto

- Windows: `--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`.
- Linux: `--headless=new --use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist --enable-gpu-rasterization` (en un servidor con NVIDIA, Vulkan suele fallar y `gl-egl` sí da GPU real).

## Qué mide y cómo

- **Cuadros:** rAF propio. `fps.p50 = 1000 / ms.p50`, `fps.p5 = 1000 / ms.p95`, `fps.p1 = 1000 / ms.p99`. Percentil por rango más cercano. Los tiempos de rAF tienen resolución de ~0.1 ms: un intervalo de 0 cuenta como 0.1 ms, así que el tope es 10000 fps.
- **Long tasks:** `PerformanceObserver({type: 'longtask', buffered: true})`; las de la carga son las anteriores a `listo`.
- **Draw calls y triángulos:** wrappers sobre `drawArrays`, `drawElements`, `drawArraysInstanced`, `drawElementsInstanced` y `drawRangeElements` de WebGL1 y WebGL2. Triángulos: n/3 en TRIANGLES, n−2 en STRIP/FAN, por el número de instancias. Se reporta la **mediana por cuadro** (`calls`, `tris`) y el **máximo** (`callsMax`, `trisMax`). No cuenta `WEBGL_multi_draw` ni `ANGLE_instanced_arrays`.
- **Peso:** CDP `Network.loadingFinished.encodedDataLength` hasta `listo`, con la caché del navegador desactivada. Total, número de peticiones y las 10 más pesadas.
- **Heap JS:** CDP `HeapProfiler.collectGarbage` + `Runtime.getHeapUsage`, al inicio y al final de cada paso.
- **Tirones** (v0.2): cada cuadro de más de 250 ms, con su hora (s desde el inicio del paso). `huecos.lista` guarda los 10 más largos y `longTasksT` las 10 tareas largas más largas, también con hora.
- **Shaders** (v0.2): se envuelve `linkProgram`. Cada link después de la carga es una **recompilación**, con cualquier motor: el hilo principal se detiene mientras compila (segundos en D3D11 con muchas luces). Se agrupan en ráfagas (links a menos de 1 s entre sí).
- **Causa de la recompilación (three.js):** la sonda engancha `__THREE_DEVTOOLS__` y cada 0.5 s compara `renderer.info.programs` y la firma de luces (luces visibles por tipo, cuántas con `castShadow` y `shadowMap.type`). Si aparecen programas nuevos, guarda qué cambió (`SpotLight 1 → 2`) y, como pista, el campo del `cacheKey` que cambió respecto al programa viejo más parecido. Para saber **qué objeto** fue y en qué línea se agregó, abre la página con inspector-3d (`?debug=1`, sección "Recompilaciones").
- **Alertas** (v0.2): al final de la corrida (en stderr y en la sección "Alertas" del `.md`) se avisa de las recompilaciones después de la carga y de los cuadros de más de 1 s.
- **GPU:** `UNMASKED_RENDERER_WEBGL`. Si dice SwiftShader, llvmpipe o similar, `entorno.software = true` y el reporte muestra un aviso.

**CSP:** el contexto se abre con `bypassCSP: true`. `--listo`, `--js`, `--extra` y el `js` de los pasos se evalúan como texto dentro de la página, y una CSP sin `'unsafe-eval'` los rompería. La CSP de la página no se aplica durante la medición.

**Límite:** se mide la cadencia de `requestAnimationFrame`, no el tiempo de GPU. Para tiempo de GPU por cuadro, combinar con
[stats-gl](https://github.com/RenaudRohlinger/stats-gl); para ver qué hay dentro de un cuadro, [Spector.js](https://spector.babylonjs.com/).

### JSON (`version: 2`; la 2 solo agrega campos a la 1)

```
{ version, fecha, url, etiqueta,
  entorno:{plataforma,navegador,gpu,software,viewport:[w,h],dpr,vsync},
  carga:{domContentLoadedMs,loadMs,listoMs,peticiones,transferidoBytes,masPesados:[{url,bytes}],longTasks:{n,totalMs,maxMs},shaders:{links,programas},errores:[]},
  pasos:[{nombre,durS,cuadros,fps:{media,p50,p5,p1},ms:{p50,p95,p99,max},longTasks:{n,totalMs,maxMs},
          gl:{calls,tris,callsMax,trisMax},heapMB:{ini,fin},extra,
          huecos:{n,maxMs,lista:[[t,ms]]},longTasksT:[[t,ms]],
          shaders:{links,programas,rafagas:[{t,n}],causas:[{t,nuevos,total,luces:[],claves:[]}]}}],
  cpu:[{ms,fn}] }
```

### `comparar`

Tabla `métrica | A | B | Δ% | veredicto` con los pasos emparejados por nombre. En fps más es mejor; en lo demás, menos.
Marca `≈` si la diferencia es menor de 5 % (umbral ingenuo: correr A contra A para ver el ruido real).
Avisa si difieren `gpu`, `viewport`, `dpr`, `vsync` o `software`.

## Ejemplo con pasos

```json
[
  { "nombre": "base", "dur": 6 },
  { "nombre": "vuelo", "js": "void window.miApp.flyTo([30, 25, 30], [0, 0, 0], 3000)", "dur": 3 },
  { "nombre": "destino", "espera": 1000, "dur": 6 }
]
```

`void` hace que el paso no espere la promesa del vuelo: se mide *durante* el vuelo. Sin `void`, se mediría al llegar.

## En un servidor con GPU (VPS)

El CLI corre donde está la GPU. El repo no trae wrapper de ssh; la receta es:

```
# 1. subir (o clonar) y preparar
tar czf - --exclude node_modules --exclude reportes --exclude .git . | ssh usuario@mi-vps 'mkdir -p ~/herramientas-3d/medidor-3d && tar xzf - -C ~/herramientas-3d/medidor-3d'
ssh usuario@mi-vps 'cd ~/herramientas-3d/medidor-3d && npm i --omit=dev && CHROME=/ruta/a/chrome node prueba.mjs'

# 2. medir (la página debe ser accesible desde el VPS, p. ej. servida ahí mismo en 127.0.0.1)
ssh usuario@mi-vps 'cd ~/herramientas-3d/medidor-3d && CHROME=/ruta/a/chrome node medidor.mjs "http://127.0.0.1:8080/" --salida -' > reportes/mi-gemelo-vps.json
```

Con Chromium de Playwright, la ruta suele ser `~/.cache/ms-playwright/chromium-<n>/chrome-linux64/chrome`. No hace falta `playwright install`.

## Experimento three vs Babylon

Para que la comparación sea justa, las dos corridas deben compartir todo menos el motor:

1. La misma escena (mismas mallas, materiales, luces y sombras) en las dos versiones.
2. Mismo viewport y `--dpr 1`.
3. La misma máquina y GPU (el reporte avisa si difieren).
4. `--sin-vsync`, para que el tope de 60 Hz no empate a los dos.
5. Los mismos `--pasos` (mismos nombres, mismas cámaras) y el mismo `--listo`.

```
node medidor.mjs http://localhost:8080/three.html   --sin-vsync --dpr 1 --pasos pasos.json --etiqueta three   --salida reportes/three
node medidor.mjs http://localhost:8080/babylon.html --sin-vsync --dpr 1 --pasos pasos.json --etiqueta babylon --salida reportes/babylon
node medidor.mjs comparar reportes/three reportes/babylon --md reportes/three-vs-babylon.md
```

Corre cada una dos veces y compara A contra A antes de creerle a una diferencia menor al 10 %.

## Resultados de referencia (20-nov-2026)

Una demo three.js r160 propia (≈2 900 objetos, sombras, GTAO, Bloom, SMAA), `calidad=alta`, 1600×900 @ dpr 1, 10 s:

| | laptop (Intel UHD, D3D11) | servidor (RTX 5070 Ti, gl-egl) |
|---|---|---|
| listo | 36.4 s | 7.4 s |
| fps p50 / p1 | 7.5 / 4.0 | 20.0 / 7.5 |
| ms p50 / p99 | 133 / 250 | 50 / 133 |
| calls / tris (mediana por cuadro) | 370 / 1.00 M | 370 / 1.00 M |
| calls / tris (máx) | – | 602 / 1.82 M |
| fps p50 con `--sin-vsync` | – | 35.3 |

En la escena de prueba (3 triángulos), `--sin-vsync` da ~300–480 fps p50 en la laptop y llega a 10 000 en el servidor headless
(el intervalo de rAF baja a la resolución del reloj, 0.1 ms): ahí `--sin-vsync` mide el bucle, no la GPU.

## Notas de implementación (dónde el plan original no se cumplió tal cual)

- **`gl.calls` contra el contador propio de la app.** El plan esperaba que la mediana por cuadro coincidiera con el contador de la app.
  En la demo de referencia la app actualiza el mapa de sombras solo en algunos cuadros: la mediana (370 calls) es el cuadro sin sombras
  y el contador de la app toma el cuadro que le toque (601 o 370). Por eso se agregó `callsMax`/`trisMax`, que sí coincide con el
  cuadro con sombras (602 vs 601). Con `calidad=media` coinciden directo (327 vs 328).
- **Peso transferido:** se desactiva la caché del navegador (`Network.setCacheDisabled`) para que dos corridas transfieran lo mismo.
- **Errores de la página:** `pageerror` y `console.error` también van a `carga.errores` (máximo 30), no solo el timeout de `--listo`.
- **`prueba.mjs`** también prueba `--sin-vsync` (p50 > 60 si la GPU no es por software) y `comparar x x`.

## Por qué existe la v0.2

En nov-2026 un gemelo digital industrial se congelaba de 3 a 58 s al mover la cámara: dos vehículos animados llevaban un `SpotLight` y se ocultaban con `visible = false`, y el modo de calidad Auto y las luces nocturnas también cambiaban el número de luces. Cada cambio recompilaba todos los shaders. La v0.1 no lo vio: medía 10 s con la cámara quieta, los vehículos tardan 2–4 min en dar la vuelta y las tareas largas solo salían resumidas. Para casos así: `--interactuar --dur 180`.

## Límites conocidos y pendientes (revisión externa, nov-2026)

Se aceptan por ahora; se resolverán si un caso real los necesita.

- **Cambios de menos de 0.5 s:** si una luz cambia, se dibuja y vuelve a su estado en menos de 0.5 s, se ve el link pero no la causa. *A futuro:* envolver `renderer.compile`/`getProgram` para guardar la firma en el momento exacto del link, no por muestreo.
- **Escenas y capas:** la firma suma todas las escenas que vio `__THREE_DEVTOOLS__` (también las que no se dibujan) y no toma en cuenta `light.layers` ni `camera.layers`. Un cambio de capas puede recompilar sin causa visible. *A futuro:* firmar solo la escena y la cámara del último `render()`, filtrando por capas como hace three.
- **Horas de las recompilaciones:** una recompilación lleva la hora en que se detectó, no la del link. Un link justo antes de `marcar()` puede salir en el paso siguiente, y uno al final del paso puede quedar sin causa. Además, las tareas largas se filtran por su hora de inicio y `marcar()` descarta el primer intervalo. *A futuro:* guardar la hora de cada link en el envoltorio de `linkProgram` y cerrar el paso con una última revisión antes de `leer()`.
- **Ráfagas:** se redondea a décimas antes de agrupar, y una cadena continua de links forma una sola ráfaga aunque dure mucho. *A futuro:* agrupar con las horas sin redondear y partir las ráfagas de más de 5 s.
- **Nombres:** "link", "programa nuevo" y "recompilación que congeló" se reportan como lo mismo, pero un link puede ser la primera vez que se dibuja un material, o una compilación asíncrona que no bloqueó. *A futuro:* marcar como "bloqueó" solo los links que coinciden con un hueco o una tarea larga.
- **Coste:** la sonda recorre las escenas cada 0.5 s. No se ha medido su coste en escenas grandes. *A futuro:* medirlo con y sin sonda en el gemelo más pesado.
- **Pruebas:** `prueba/escena.html?recompilar=1` recompila con un temporizador, no al mover el ratón, y no prueba el enganche de three. *A futuro:* una escena three que oculte un foco al arrastrar.

## Fuera de alcance v0.1

`--rep N` con mediana, exit code por regresión, wrapper de ssh y trazas de GPU.

Referencia útil: el e2e de three.js (`test/e2e/puppeteer.js`, `deterministic-injection.js`, MIT).

## Licencia

MIT
