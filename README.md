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
     [--chrome <ruta>] [--angle <backend>] [--extra "<expr>"] [--cpu 25] [--repetir 3]
     [--captura fin.png [--congelar "<expr>"] [--congelar-cuadros 120]] [--salida reportes/x | -]
     [--intercalar <urlB>] [--caliente] [--limite S]
node medidor.mjs comparar a.json b.json [--md comparacion.md]
node medidor.mjs comparar-capturas a.png|carpetaA b.png|carpetaB [--zonas zonas.json] [--umbral 10] [--diff diff.png] [--md salida.md]
node medidor.mjs capturas <url> --pasos vistas.json --captura carpeta/pref.png [--solo-canvas] [--listo "<expr>"] [--js "<código>"]
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
| `--ab N` | (v0.4) A/B intercalado. Los **dos últimos** pasos de `--pasos` son la variante A y la B; los anteriores corren una vez (preparación, cámara). Se miden A#1 B#1 A#2 … B#N A#N+1 y cada B se compara con la **media de sus dos A vecinas**: si la escena se pone más pesada con el tiempo, pesa igual en los dos lados. Ver "A/B intercalado" abajo. |
| `--intercalar <urlB>` | (v0.5) compara dos URLs **intercalando** corridas: A1 B1 A2 B2 … (`--repetir N` = N pares). Si la máquina se pone más lenta a media prueba (otra app, temperatura), pesa igual en los dos lados. Escribe `<salida>-a.{json,md}`, `<salida>-b.{json,md}` y `<salida>-comparacion.md` con la tabla de `comparar` más una sección "Intercalado": Δ fps p50 de cada par y veredicto ("B mejor/peor" solo si todos los pares van en el mismo sentido y la mediana supera máx(5 %, ruido de A)). No se combina con `--ab` ni con `--captura` (para imágenes, `capturas` con cada URL y `comparar-capturas` de las dos carpetas). |
| `--caliente` | (v0.5) carga la página dos veces en el mismo navegador y mide la **segunda** (con caché HTTP y de shaders), como un usuario que vuelve. La primera queda en `carga.fria`. Sin esta opción, cada corrida es una primera visita. |
| `--limite S` | (v0.5) tope en segundos por corrida. Si se pasa, cierra el navegador, descarta la corrida y sigue con la siguiente; sin corridas completas sale con código 3. Por defecto: 2 × 120 s (carga y `listo`) + 1.5 × (calentar + pasos) + 60 s. |
| `--solo-canvas` | (v0.5, con `capturas`) oculta la interfaz y captura solo el canvas más grande. |
| `--repetir N` | (v0.3) corre la medición completa N veces, cada una en un **navegador nuevo** (perfil temporal limpio: sin caché HTTP ni de shaders, sin calentamiento heredado). El JSON trae las N corridas, y `carga`/`pasos` pasan a ser la **mediana** de cada métrica, con su `[mín, máx]` en `rango`. El `.md` muestra `mediana [mín–máx]`. Sin `--repetir`, el JSON es igual al de la 0.2 (solo cambia `version`). |
| `--captura x.png` | sin congelar: captura al final de la (última) corrida, como en la 0.2. Con `--congelar` o `--congelar-cuadros`: capturas deterministas en una pasada aparte (ver abajo); con varios pasos sale una por paso, `x-<paso>.png`. |
| `--congelar "<expr>"` | (v0.3) expresión que se evalúa en la pasada de capturas, tras `listo`, para que **la app** pause su reloj y fije la cámara (p. ej. `app.pausar(); app.camara([30, 25, 30], [0, 0, 0])`). Es el modo recomendado cuando la app lo permite. |
| `--congelar-cuadros N` | (v0.3) modo genérico de respaldo, sin tocar la app: reloj virtual desde la carga y congelado tras N cuadros (detalles abajo). Se puede combinar con `--congelar`. |

`comparar` acepta las rutas con o sin `.json`.

### Capturas deterministas (v0.3)

Las capturas de un gemelo no se pueden comparar si la simulación sigue corriendo: cambian la hora, los vehículos y las puertas.
Con `--congelar` o `--congelar-cuadros` (y `--captura`), después de las mediciones se abre **otro navegador**, que no mide nada:

1. carga la página y espera `--listo`;
2. con `--congelar-cuadros N`, espera a que la app haya corrido N cuadros de reloj virtual;
3. evalúa `--congelar`, si se dio;
4. por cada paso: evalúa su `js` (la cámara de ese paso), espera `espera`, deja dibujar 2 cuadros y captura.

`--congelar-cuadros N` instala, antes que cualquier script de la página:

- `performance.now`, `Date.now` y `new Date()` en un **reloj virtual** que empieza en 0 (`Date` en 2026-01-15 18:00 UTC) y avanza exactamente 1/60 s por cada cuadro en que la app pidió `requestAnimationFrame`. Lo que tarde la carga no cuenta.
- `Math.random` con semilla fija.
- `requestAnimationFrame` controlado: tras N cuadros el tiempo se detiene y la app deja de recibir cuadros, salvo los 2 que se le dan antes de cada captura (con el tiempo quieto, para que se vea el cambio de cámara del paso).

Así, dos versiones de la misma app quedan en el mismo instante de su simulación, aunque una cargue más lento.

**Límites del modo genérico:**

- `setTimeout`, `setInterval`, `fetch` y los eventos siguen en tiempo real. Si la app avanza su estado con un `setInterval` que usa `Math.random`, la secuencia con semilla se intercala distinto y algo puede moverse (en SILO 3D, dos trabajadores). Para medir el brillo, usa zonas que no los incluyan.
- Las animaciones por tiempo que lance un paso (`flyTo` de 3 s) no avanzan con el tiempo detenido: en la pasada de capturas, el `js` del paso debe poner la cámara de golpe.
- Lo que la app hace "por cuadro" y no "por tiempo" (`OrbitControls` con `autoRotate` o `enableDamping` sin `deltaTime`) sí avanza en los 2 cuadros previos a cada captura. Es igual en A y B, así que no afecta la comparación.
- `Date()` llamado como función (sin `new`) lanza un error con el reloj virtual.
- Las mediciones de fps nunca usan el reloj virtual: van en sus propias corridas.

**Cuál usar:** `--congelar` si la app expone cómo pausarse y mover la cámara (es lo más fiel). `--congelar-cuadros 120` si no expone nada (un solo archivo con todo en módulos, como SILO 3D). N debe ser suficiente para que la escena termine de armarse; 120 son 2 s de simulación.

### Escena que cambia sola (v0.4)

Los pasos se miden uno tras otro. Si la escena cambia mientras tanto (gente o vehículos que entran en cámara, módulos que despiertan, una obra que se sigue armando), los fps de dos pasos seguidos no se pueden comparar, aunque la cámara sea la misma. Pasó en la migración del hotel: los fps bajaban paso a paso igual con radio de sombra 1, 2 o 4, también en r160, donde el radio ni se usa. Los draw calls habían subido de 196 a 354. La causa más probable no era la escena sino la app: un recorrido automático (modo kiosco) que arrancaba a los 25 s sin interacción y movía la cámara de zona en zona. Con el kiosco apagado, los draw calls quedaron estables. **Antes de medir más de unos segundos sin `--interactuar`, apaga cualquier modo demo, kiosco o autorrotación de la app.**

- **Deriva por paso:** `gl.deriva` es el % de cambio de la mediana de draw calls del último tercio del paso respecto al primero. Se usan medianas por tercio, no mín/máx, porque los cuadros con pasada de sombras dan picos periódicos que no son un cambio de escena. Si pasa de ±20 % y el paso no es `--interactuar`, sale la alerta *"la escena cambió durante el paso"*.
- **A/B intercalado (`--ab N`):** para probar un ajuste (radio de sombra, calidad, un material), pon un paso de preparación, luego A y B, que solo cambian el ajuste:

  ```json
  [
    { "nombre": "camara", "espera": 60000, "js": "…pone la cámara…" },
    { "nombre": "r2", "espera": 1500, "dur": 6, "js": "app.sun.shadow.radius = 2" },
    { "nombre": "r1", "espera": 1500, "dur": 6, "js": "app.sun.shadow.radius = 1" }
  ]
  ```

  ```
  node medidor.mjs <url> --pasos ab.json --ab 3 --repetir 2 --sin-vsync --dpr 1
  ```

  El reporte trae `ab: {a, b, pares: [{corrida, i, fpsA, fpsB, dFps, callsA, callsB, dCalls, dEntreA}], dFps, ruidoA, veredicto}` y una sección "A/B" en el `.md`.
  - **Veredicto:** "B mejor" o "B peor" solo si **todos** los pares van en el mismo sentido y la mediana de Δ supera el 5 % y el ruido entre las A vecinas. Si no, sale "sin diferencia clara".
  - **Alertas:** si los draw calls de un B difieren más de 20 % de sus A vecinas, la escena cambió y esa diferencia no es de la variante. Si las A vecinas difieren más de 15 % entre sí, la escena no está estable: calienta más o congela la simulación.

### Novedades de la v0.5 (24-nov-2026)

Salieron de las migraciones a three r187 (tres gemelos de plantas industriales), donde el medidor dio falsas alarmas o se calló:

- **Draw calls que alternan.** Un gemelo redibuja sombras cada 2 cuadros: los cuadros van 338, 632, 338, 632… La mediana cae en cualquiera de los dos y el medidor reportó 339 para r160 y 629 para r187, aunque hacían lo mismo cuadro por cuadro. Ahora cada paso trae `gl.callsMedia` y `gl.trisMedia`, `gl.alterna: {bajo, alto, fraccionAlto}` cuando la serie alterna, una nota en el `.md` y un aviso en `comparar`. Compara la media. `gl.deriva` usa la media de cada tercio (con la mediana, la alternancia daba derivas falsas de +87 %).
- **Shaders que compila el `js` de un paso.** Se contaban solo durante la ventana de medición. Si el `js` cambiaba la calidad, la recompilación pasaba antes y salía `links 0`, sin alerta. En un gemelo en r160, de alta a baja a media a alta, los programas subían de 59 a 117 y el medidor no decía nada. Ahora cuentan desde el inicio del paso, con `t` negativo ("al aplicar el paso"), y la alerta dice qué cambió: `SpotLight 10 → 7; DirectionalLight sombra 1 → 0; shadowMap.type 2 → 1`. También `shaders.nuevosProgramas`.
- **`--intercalar`.** Medir r160 y luego r187 con Zoom abierto dio una regresión falsa (p95 de 50 a 67 ms). Intercaladas, las dos daban lo mismo.
- **`--caliente`.** Un gemelo en r187 tardaba 2.4 s más en cargar, pero solo en la primera visita: compilaba el PMREM y los shaders desde cero. Con caché, arrancaba más rápido que r160. El medidor siempre abría un perfil limpio y no lo podía distinguir.
- **`capturas` y `comparar-capturas` con carpetas.** Hubo que escribir un script de capturas para cada gemelo (cargar, fijar hora y clima, mover la cámara, ocultar la interfaz, capturar el canvas). Ahora es `capturas <url> --pasos vistas.json --captura dir/x.png --solo-canvas`, y `comparar-capturas dirA dirB` compara todos los `.png` con el mismo nombre.
- **`--limite`.** Una corrida con `--sin-vsync` se quedó colgada más de 9 minutos.

Ejemplo de vistas para `capturas`, con la cámara expuesta por la app (`?medir`):

```json
[
  { "nombre": "general", "espera": 2500, "js": "const G = window.__app; G.camera.position.set(-112, 78, 102); G.controls.target.set(18, 4, -28); G.controls.update()" },
  { "nombre": "silo", "espera": 2500, "js": "const G = window.__app; G.camera.position.set(-35, 12, 25); G.controls.target.set(0, 10, 0); G.controls.update()" }
]
```

```
node medidor.mjs capturas "http://127.0.0.1:3120/?medir" --listo "!!window.__perf" --js "…fija hora y clima…" --pasos vistas.json --captura mig/r160/x.png --solo-canvas
node medidor.mjs capturas "http://127.0.0.1:3121/?medir" --listo "!!window.__perf" --js "…fija hora y clima…" --pasos vistas.json --captura mig/r187/x.png --solo-canvas
node medidor.mjs comparar-capturas mig/r160 mig/r187 --md mig/capturas.md
node medidor.mjs http://127.0.0.1:3120/ --intercalar http://127.0.0.1:3121/ --repetir 3 --sin-vsync --dur 20 --salida mig/fps
```

### `comparar-capturas` (v0.3)

```
node medidor.mjs comparar-capturas a.png b.png [--zonas zonas.json] [--umbral 10] [--diff diff.png] [--md salida.md]
```

- **Luminancia media** (0–255) de cada imagen, Rec. 601 sobre los valores sRGB (la misma que el modo `L` de PIL), y su **Δ%** = (B − A) / A.
- **% de píxeles que difieren**: píxeles en que el canal más distinto difiere más de `--umbral` (0–255, por defecto 10).
- `--zonas`: `{"piso": [x, y, ancho, alto], "cielo": [...]}` en px, o en fracción de la imagen si los cuatro números son ≤ 1. Da las mismas métricas por zona.
- `--diff`: PNG con A en gris tenue y en rojo los píxeles que difieren. Sirve para ver si la diferencia es sombreado (zonas enteras) o desalineación (bordes dobles).
- Lee PNG RGB o RGBA de 8 bits sin entrelazar (los de Chrome/Playwright) con el `zlib` de Node. Cualquier otro formato, o dos tamaños distintos, falla con un mensaje claro.

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

### JSON (`version: 5`; cada versión solo agrega campos a la anterior; v4: `gl.deriva`, `interactuar` por paso y `ab`; v5: `gl.callsMedia`, `gl.trisMedia`, `gl.alterna`, `shaders.nuevosProgramas`, `entorno.caliente` y `carga.fria`)

`entorno.motor` trae la versión del motor detectada en la página: `three` (de `window.__THREE__`, que three escribe al importarse, p. ej. `"187"`) y `babylon` (`BABYLON.Engine.Version`, solo si Babylon está en `window`). Si la app carga dos copias de three, `__THREE__` queda con la primera y three avisa en consola.

```
{ version, fecha, url, etiqueta,
  entorno:{plataforma,navegador,gpu,software,viewport:[w,h],dpr,vsync},
  carga:{domContentLoadedMs,loadMs,listoMs,peticiones,transferidoBytes,masPesados:[{url,bytes}],longTasks:{n,totalMs,maxMs},shaders:{links,programas},errores:[]},
  pasos:[{nombre,durS,cuadros,fps:{media,p50,p5,p1},ms:{p50,p95,p99,max},longTasks:{n,totalMs,maxMs},
          gl:{calls,tris,callsMax,trisMax},heapMB:{ini,fin},extra,
          huecos:{n,maxMs,lista:[[t,ms]]},longTasksT:[[t,ms]],
          shaders:{links,programas,rafagas:[{t,n}],causas:[{t,nuevos,total,luces:[],claves:[]}]}}],
  cpu:[{ms,fn}],
  // v3, solo con --repetir N (N ≥ 2): carga y pasos son medianas (las listas y textos, de la corrida 1)
  repeticiones, rango:{'carga.listoMs':[mín,máx], '<paso>.fps.p50':[mín,máx], …}, corridas:[{carga,pasos,cpu}],
  // v3, solo con captura congelada
  capturas:{archivos:[], errores:[]} }
```

Las claves de `rango` son los mismos nombres de métrica que usa `comparar`. Con N par, la mediana es el promedio de las dos centrales.

### `comparar`

Tabla `métrica | A | B | Δ% | veredicto` con los pasos emparejados por nombre. En fps más es mejor; en lo demás, menos.
Avisa si difieren `gpu`, `viewport`, `dpr`, `vsync` o `software`.

**Ruido (v0.3).** Si los reportes traen repeticiones, cada fila tiene un ruido:

- ruido de un lado = (máx − mín) / |mediana| · 100 de esa métrica;
- ruido de la fila = el del lado más disperso;
- veredicto `≈` si |Δ| < máx(5 %, ruido), donde Δ es la diferencia de medianas. Si no, `mejor` o `peor`.

O sea: una diferencia que cabe en lo que varió una misma versión entre sus propias corridas no se cuenta. Las celdas muestran `mediana [mín–máx]`.
Con una sola corrida por lado se mantiene el umbral fijo del 5 % y el `.md` lo advierte ("una corrida: sin estimación de ruido").
Si solo un lado trae repeticiones, cuenta solo su ruido. Con 3 corridas la regla es tosca: un rango de 3 valores subestima el ruido real. Si una diferencia importa, sube a `--repetir 5`.

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

Usa `--repetir 3` (o más) en las dos: `comparar` marcará `≈` lo que quede dentro del ruido.

## Receta: comparar dos versiones de un gemelo (migraciones)

Caso típico: subir three de r160 a r187 y ver si algo se rompió, en rendimiento o en la imagen. Se dejan las dos versiones lado a lado
(`index.r160.html` y `index.html`) y se sirven por HTTP desde la carpeta del gemelo.

1. **Pasos con las cámaras que importan.** El `js` de cada paso pone la vista **de golpe** (sin vuelos animados), para que la misma lista sirva para medir y para capturar:
   ```json
   [
     { "nombre": "rayosx", "dur": 8 },
     { "nombre": "exterior", "dur": 8, "js": "document.getElementById('xray').click()" }
   ]
   ```
2. **Medir las dos con repeticiones y captura congelada** (desde la v0.5, mejor `--intercalar` para los fps y `capturas` para las imágenes: ver "Novedades de la v0.5"):
   ```
   node medidor.mjs http://127.0.0.1:3122/index.r160.html --repetir 3 --sin-vsync --dpr 1 --pasos pasos.json \
        --congelar-cuadros 120 --captura mig/r160.png --etiqueta r160 --salida mig/r160
   node medidor.mjs http://127.0.0.1:3122/index.html      --repetir 3 --sin-vsync --dpr 1 --pasos pasos.json \
        --congelar-cuadros 120 --captura mig/r187.png --etiqueta r187 --salida mig/r187
   ```
   Si la app expone cómo pausarse, usa `--congelar "<expr>"` en lugar de `--congelar-cuadros`, o junto con él.
3. **Rendimiento:** `node medidor.mjs comparar mig/r160 mig/r187 --md mig/comparacion.md`. Solo cuenta lo que sale `peor` o `mejor` con ruido bajo. En la iGPU, los fps varían 15–40 % entre corridas de la misma versión.
4. **Imagen:** por cada paso,
   ```
   node medidor.mjs comparar-capturas mig/r160-exterior.png mig/r187-exterior.png --zonas zonas.json --diff mig/diff-exterior.png
   ```
   con zonas que separen materiales (metal, piso, muros, cielo) y una zona de control en el HTML (debe dar Δ ≈ 0). Abre el `--diff`: si los bordes salen dobles, la cámara o los objetos no coinciden y el Δ no sirve.
5. **Lectura:** un Δ total pequeño puede esconder zonas que se compensan. Revisa siempre las zonas.

**Resultado en SILO 3D, r160 contra r187 ya calibrado (23-nov-2026, laptop Intel UHD, 1600×900, `--repetir 3 --sin-vsync --dpr 1 --congelar-cuadros 120`):**

| | r160 | r187 | Δ | veredicto |
|---|---|---|---|---|
| rayosx fps p50 | 42.2 [34.2–42.4] | 34.5 [32.1–45.9] | −18.2 % (ruido 40 %) | ≈ |
| exterior fps p50 | 54.9 [51.8–57.5] | 51.5 [44.8–53.2] | −6.2 % (ruido 16 %) | ≈ |
| transferido | 434 KB | 551 KB | +26.8 % (ruido 0) | peor (el split `three.core.js` + `three.module.js`) |
| draw calls rayosx | 583 | 583 | 0 | ≈ |
| luminancia total, exterior / rayos X | 58.76 / 59.16 | 59.04 / 59.06 | +0.48 % / −0.16 % | calibrado |
| zonas exterior: techo / cuerpo / tanque | 152.9 / 130.2 / 78.7 | 138.9 / 140.1 / 95.8 | −9.2 % / +7.5 % / +21.7 % | el metal cambia de carácter |

Con la versión **sin ajuste** (capturas del piloto, `r187-sinajuste`), el Δ total es **+12.1 %** (exterior) y **+10.2 %** (rayos X), y el tanque llega a +43.7 %.
En v0.2, con una corrida por lado, `comparar` había marcado `fps.p50 −6.5 %` como **peor**.

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
- **Horas de las recompilaciones:** una recompilación lleva la hora en que se detectó, no la del link, y uno al final del paso puede quedar sin causa. (v0.5: los links desde el inicio del paso, incluido su `js`/`espera`, ya cuentan para ese paso; antes un cambio de calidad en el `js` daba `links 0`.) Además, las tareas largas se filtran por su hora de inicio y `marcar()` descarta el primer intervalo. *A futuro:* guardar la hora de cada link en el envoltorio de `linkProgram` y cerrar el paso con una última revisión antes de `leer()`.
- **Ráfagas:** se redondea a décimas antes de agrupar, y una cadena continua de links forma una sola ráfaga aunque dure mucho. *A futuro:* agrupar con las horas sin redondear y partir las ráfagas de más de 5 s.
- **Nombres:** "link", "programa nuevo" y "recompilación que congeló" se reportan como lo mismo, pero un link puede ser la primera vez que se dibuja un material, o una compilación asíncrona que no bloqueó. *A futuro:* marcar como "bloqueó" solo los links que coinciden con un hueco o una tarea larga.
- **Coste:** la sonda recorre las escenas cada 0.5 s. No se ha medido su coste en escenas grandes. *A futuro:* medirlo con y sin sonda en el gemelo más pesado.
- **Pruebas:** `prueba/escena.html?recompilar=1` recompila con un temporizador, no al mover el ratón, y no prueba el enganche de three. *A futuro:* una escena three que oculte un foco al arrastrar.

## Fuera de alcance

Exit code por regresión, wrapper de ssh y trazas de GPU. (`--repetir N` con mediana llegó en la 0.3.)

Referencia útil: el e2e de three.js (`test/e2e/puppeteer.js`, `deterministic-injection.js`, MIT).

## Licencia

MIT
