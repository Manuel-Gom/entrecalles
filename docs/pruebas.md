# Pruebas

Hay tres capas, de la más rápida a la más completa. `npm run verificar` las ejecuta todas (más tipos y licencias).

| Capa | Herramienta | Dónde | Qué protege | Tiempo |
|---|---|---|---|---|
| Unitarias | Vitest | `src/**/*.test.ts(x)` | Lógica pura: reglas del aspecto (`normalizeSpec`, `visiblePieces`, tintes), validación y migración de lo guardado, router, componentes accesibles (diálogo, grupos de opciones, interruptores); del barrio, `src/world/`: colisiones (con paredes y con personas), ciudad y red de aceras, zancada y sus transiciones, jugador, cámara, comportamiento y evitación de los PNJ, asientos, entrada con mando, diálogos y las partes puras del sonido | < 10 s |
| Catálogo | Vitest | `tests/catalogo.test.ts`, `tests/npcs.test.ts`, `tests/reparto.test.ts`, `tests/mundo-modelos.test.ts` | Los modelos generados con Blender: nada falta ni sobra, tamaños, esqueleto, miniaturas, atuendos por defecto, licencias; los 160 PNJ y su generador; los modelos de Blender del barrio (peso, triángulos, sin texturas, escala y orientación, y que sus plazas, colisiones y puntos cuadren con el código) | < 10 s |
| Extremo a extremo | Playwright Test | `e2e/*.spec.ts` | La aplicación real en Chromium: flujos, teclado, accesibilidad (axe), persistencia, 3D y memoria | ~6 min por software (bastante menos con la tarjeta gráfica, ver abajo) |

## Comandos

```bash
npm run test:unit          # unitarias + catálogo (vitest run)
npm run test:unit:watch    # modo vigilancia mientras se programa
npm run test:cobertura     # con cobertura (umbral: 90 % líneas y 80 % ramas en catalog.ts, save.ts, router.ts y la lógica pura de src/world/)
npm run test:catalogo      # solo catálogo y PNJ
npm run test:e2e           # extremo a extremo (arranca solo el servidor: compila y sirve dist/)
npm run test:e2e -- e2e/mundo.spec.ts          # solo un archivo (lo que va tras «--» se le pasa a Playwright)
E2E_SOFTWARE=1 npm run test:e2e                # con el 3D por software, como en la integración continua
npm run test:e2e:ui        # visor interactivo de Playwright (depurar paso a paso)
npx playwright test -g "dificultad"            # solo las pruebas cuyo nombre contenga "dificultad"
npx playwright test --project=movil            # solo el móvil (390 px)
npx playwright show-report                     # informe HTML de la última ejecución
npm run verificar          # todo, en local (incluye las licencias, que necesitan Blender+MPFB instalado)
npm run verificar:ci       # lo mismo sin licencias (lo que ejecuta GitHub Actions)
```

La primera vez: `npx playwright install chromium`.

## Cómo funcionan las pruebas de extremo a extremo
- `playwright.config.ts` compila la aplicación y la sirve con `vite preview` en el puerto 4173; si ya hay un servidor en marcha lo reutiliza (fuera de integración continua).
- Hay dos proyectos: `escritorio` (1440×900, todas las pruebas) y `movil` (390×844, solo `pantallas.spec.ts`).
- `e2e/fixtures.ts` aporta:
  - `sembrar(estado)`: guarda un estado en `localStorage` solo la primera vez que se abre la pestaña (recargar no lo pisa);
  - `visor`: espera a que el 3D esté listo y detecta cuándo cambian el cuerpo o las piezas mostradas (usa `window.__avatarStudio().stats()`);
  - vigilancia automática de la consola: cualquier error o aviso hace fallar la prueba, salvo los que se declaren con `ignorarConsola(/patrón/)`.
- **Sin saturar el equipo.** En local, Chromium dibuja el 3D con la tarjeta gráfica (`--enable-gpu`, aunque sea integrada y sin ventana), corren 2 navegadores a la vez y `test:e2e` y `test:cobertura` pasan por `tools/pruebas-suaves.mjs`, que los lanza con prioridad baja (en Windows la heredan el build, vite y Chromium): lo que estés usando va antes. Con `e2e/mundo.spec.ts` en un Ryzen 7 5700G (gráfica Radeon integrada) se pasó de 296 s con la CPU al 79 % de media (39 % del tiempo por encima del 90 %) a 52 s con el 32 % de media y un máximo del 64 %.
- En la integración continua (o con `E2E_SOFTWARE=1`) no hay tarjeta gráfica y el 3D se dibuja por software (SwiftShader), que ocupa varios núcleos por navegador. GitHub Actions pasa la batería completa en cada push a `main`: en local basta con las unitarias y el archivo de extremo a extremo del área que se toca.
- Ni con la tarjeta ni por software sirven estas pruebas para medir rendimiento (el navegador va cargado con varias pruebas a la vez): para eso está `tools/revision/rendimiento.mjs`.

### Ganchos de prueba en el código de la aplicación
- `window.__avatarStudio()` (`src/avatar/studio.ts`): `stats()` devuelve estado, cuerpo, piezas montadas, tintes aplicados y memoria; `setAvatar()` muestra un aspecto.
- `window.__world()` (`src/world/world.ts`, solo mientras se está en `#/jugar`): `stats()` (posición y animación del jugador, PNJ y qué hace cada uno, memoria), `advance(segundos)` para simular tiempo sin esperar, `teleport()`, `orbitCamera()` y `inputOverride` para fijar la entrada de movimiento. Las pruebas mueven al jugador con el teclado real y usan `advance` para lo que tardaría demasiado en el 3D por software.
- Las pruebas de mando (`e2e/mandos.spec.ts`) sustituyen `navigator.getGamepads` por un mando inventado (ejes, botones y eventos de conexión) y lo cambian desde la página. **No sustituyen** probar con un mando real.
- `window.__world().stats()` también devuelve el estado del sonido (`audio`: estado del contexto, ambiente, cuántos pasos y eventos se han pedido y el último suelo y evento), las charlas (`chats`) y el subtítulo actual. Los pasos y eventos se cuentan aunque el navegador aún no deje sonar, así que las pruebas no dependen de un altavoz.
- `window.__WORLD_NPC_LIMIT__`: si se define antes de abrir el barrio, limita cuántos PNJ se cargan (el 3D por software es lento).
- `window.__renderThumbnail()` (`src/avatar/thumbnail.ts`): se carga con `?herramientas` en la URL y sirve para generar los retratos de los PNJ.

## Qué hacer cuando falla algo
- **Una prueba de catálogo falla tras regenerar con Blender**: el mensaje dice qué archivo falta o sobra, qué pieza pesa de más o qué atuendo por defecto no es válido. Corrige `tools/blender/piezas.json` o `personajes.json` y vuelve a generar (ver `docs/personajes.md`).
- **`public/data/npcs.json está desactualizado`**: ejecuta `npm run pnj` y rehaz los retratos con `npm run retratos` (necesita `npm run build` antes).
- **Falla una prueba de extremo a extremo**: abre `npx playwright show-report`; trae captura, traza y vídeo del paso que falló. Con `npm run test:e2e:ui` se puede repetir paso a paso.
- **Una prueba de memoria falla**: suele significar que una pieza o su textura no se libera al cambiar de personaje (`src/avatar/assembler.ts`, `loader.ts`).

## Cómo añadir pruebas
- Lógica nueva y pura → un `*.test.ts` junto al archivo, con el catálogo mínimo de `src/test/fixtures.ts`.
- Componente con comportamiento de teclado → `// @vitest-environment jsdom` al principio y Testing Library.
- Pantalla o flujo nuevo → un `test()` en `e2e/` (usa `sembrar` y `visor`). Añade la pantalla a la lista de `e2e/pantallas.spec.ts` para que pase axe y el control de desbordamiento.
- Piezas nuevas de ropa → no hace falta tocar pruebas: las de catálogo recorren todo el manifest.

## Herramientas de revisión (no son pruebas)
`tools/revision/rendimiento.mjs` mide los FPS, los tirones, la resolución y la carga de la escena en las tres calidades con la misma ruta (`--ventana` para usar la tarjeta gráfica real). `tools/revision/`: `cuerpos.mjs` (todos los cuerpos con su atuendo en el visor del navegador), `retratos.mjs` (retratos de PNJ), `mundo.mjs` (capturas del barrio: `marcha` = fotogramas de andar y correr, `calle` = vistas generales, `pnj` = vecinos haciendo cosas, `sentado` = el protagonista en un banco, `tienda` = la fachada del café y los bancos, `interior` = el café por dentro) y `montaje.mjs` (junta capturas en una hoja de contacto). Las capturas se guardan en `docs/previews/web/`, que no se versiona.

## Integración continua
`.github/workflows/ci.yml` ejecuta en cada push y pull request: instalación, tipos y build, unitarias con cobertura, catálogo y extremo a extremo (informe de Playwright como artefacto si algo falla). Los modelos (`public/models/**`) y los retratos van con Git LFS: el flujo los descarga con `lfs: true`.

## Límites conocidos
- Las licencias se comprueban de verdad solo donde está instalado MPFB (`tools/licencias.mjs`); en integración continua esa prueba se omite.
- No hay pruebas visuales de píxeles (el 3D por software cambia entre máquinas).
- Solo Chromium; Firefox y WebKit se pueden añadir como proyectos en `playwright.config.ts`.
