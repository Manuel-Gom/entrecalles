# Entrecalles · menú previo a la partida

Menú de un juego de aventura urbana original, en español: crear y editar personajes con modelos 3D realistas, elegir dificultad, ajustar audio, controles y accesibilidad, y revisar la partida antes de empezar. Todo se guarda en el navegador. «Comenzar aventura» abre un barrio de prueba con teclado, ratón o mando: el protagonista anda y corre, se sienta en los bancos, entra en un café, y unos vecinos se esquivan, hacen sus cosas y charlan con subtítulos y sonido (ver [docs/mundo.md](docs/mundo.md)); la historia y las misiones todavía no existen.

Vite · React 19 · TypeScript · Three.js.

## Uso

```bash
npm install
npm run dev        # servidor de desarrollo
npm run build      # comprueba tipos y genera dist/
```

## Pruebas

```bash
npm run verificar        # todo: tipos, unitarias + cobertura, licencias y extremo a extremo
npm run test:unit        # solo unitarias y de catálogo (segundos)
npm run test:e2e         # solo extremo a extremo (Chromium real, unos 6 minutos)
npm run test:e2e:ui      # extremo a extremo con el visor interactivo de Playwright
```

La primera vez: `npx playwright install chromium`. Detalles, qué cubre cada capa y cómo añadir pruebas: [docs/pruebas.md](docs/pruebas.md).

## Estructura

| Carpeta | Contenido |
|---|---|
| `src/screens/` | Pantallas: inicio, personajes, editor, dificultad, ajustes, resumen |
| `src/components/` | Diseño común: cabecera y pasos, diálogo accesible, opciones con miniatura, controles |
| `src/state/` | Guardado local validado (con migración), catálogo y avisos |
| `src/avatar/` | Visor 3D: carga de modelos, ensamblado de cuerpo y piezas, pose, estudio, retratos |
| `src/world/` | El barrio jugable: ciudad, zancada, jugador, cámara, mandos, PNJ con actividades y charlas, interior del café y sonido |
| `src/router.ts` | Navegación con la URL (`#/personajes`, `#/dificultad`…): el botón Atrás funciona |
| `src/styles/` | Variables de diseño, base, componentes y pantallas |
| `public/models/modular/` | Cuerpos, piezas y miniaturas en GLB/PNG |
| `public/models/mundo/` | Modelos del barrio hechos con Blender (banco, fachada e interior del café) |
| `e2e/` | Pruebas de extremo a extremo (Playwright Test) |
| `tests/` | Pruebas del catálogo de modelos y de los PNJ (Vitest) |
| `tools/` | Scripts de Blender (generan los modelos), PNJ, comprobación de licencias y herramientas de revisión (`tools/revision/`) |
| `docs/` | `personajes.md` (cómo se crean los personajes), `npcs.md` (PNJ), `mundo.md` (el barrio jugable), `licencias-personajes.md` |

## Personajes

Se generan con Blender + MPFB2 en segundo plano; ver [docs/personajes.md](docs/personajes.md). Todas las piezas usadas son CC0.

## Personajes no jugables

160 diseños de PNJ (hombres y mujeres) en `public/data/npcs.json`, con retratos y una galería en `#/pnj`; ver [docs/npcs.md](docs/npcs.md).

## Accesibilidad

Navegable con teclado (flechas en grupos de opciones y pestañas, foco visible), foco al título al cambiar de pantalla, diálogos que atrapan el foco, alto contraste, texto grande, movimiento reducido (ajuste y preferencia del sistema) y áreas táctiles de al menos 44 px.
