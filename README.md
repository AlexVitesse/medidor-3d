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
     [--pasos pasos.json] [--ancho 1600 --alto 900 --dpr 1] [--sin-vsync] [--visible] [--sin-gl]
     [--chrome <ruta>] [--angle <backend>] [--extra "<expr>"] [--cpu 25] [--captura fin.png] [--salida reportes/x | -]
node medidor.mjs comparar a.json b.json [--md comparacion.md]
```

| opción | qué hace |
|---|---|
| `--listo "<expr>"` | expresión JS que dice cuándo terminó de cargar. Sin ella: evento `load` + 2 s. Máximo 120 s; si se pasa, se anota en `carga.errores` y la medición sigue. Si la expresión lanza un error, se anota el error real (`[listo] error: …`), no un falso "no se cumplió". |
| `--js "<código>"` | se evalúa una vez, tras la carga y antes de calentar. |
| `--calentar 3` | segundos de espera antes del primer paso (compilación de shaders, texturas). |
| `--dur 10` | segundos de medición por paso (un paso puede sobrescribirlo). |
| `--pasos pasos.json` | `[{nombre, js, espera, dur}]`. Sin pasos hay uno solo, `base`. `js` se evalúa y, si devuelve una promesa, se espera; `espera` son ms extra antes de medir. |
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
- **GPU:** `UNMASKED_RENDERER_WEBGL`. Si dice SwiftShader, llvmpipe o similar, `entorno.software = true` y el reporte muestra un aviso.

**CSP:** el contexto se abre con `bypassCSP: true`. `--listo`, `--js`, `--extra` y el `js` de los pasos se evalúan como texto dentro de la página, y una CSP sin `'unsafe-eval'` los rompería. La CSP de la página no se aplica durante la medición.

**Límite:** se mide la cadencia de `requestAnimationFrame`, no el tiempo de GPU. Para tiempo de GPU por cuadro, combinar con
[stats-gl](https://github.com/RenaudRohlinger/stats-gl); para ver qué hay dentro de un cuadro, [Spector.js](https://spector.babylonjs.com/).

### JSON (`version: 1`)

```
{ version, fecha, url, etiqueta,
  entorno:{plataforma,navegador,gpu,software,viewport:[w,h],dpr,vsync},
  carga:{domContentLoadedMs,loadMs,listoMs,peticiones,transferidoBytes,masPesados:[{url,bytes}],longTasks:{n,totalMs,maxMs},errores:[]},
  pasos:[{nombre,durS,cuadros,fps:{media,p50,p5,p1},ms:{p50,p95,p99,max},longTasks:{n,totalMs,maxMs},
          gl:{calls,tris,callsMax,trisMax},heapMB:{ini,fin},extra}],
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

## Fuera de alcance v0.1

`--rep N` con mediana, exit code por regresión, wrapper de ssh y trazas de GPU.

Referencia útil: el e2e de three.js (`test/e2e/puppeteer.js`, `deterministic-injection.js`, MIT).

## Licencia

MIT
