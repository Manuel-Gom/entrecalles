# Entrecalles (juego-urbano)

Proyecto personal: un juego urbano en Vite + React + TypeScript + Three.js. Responde siempre en español.

- Verificación completa: `npm run verificar` (tipos, pruebas unitarias con cobertura, licencias y e2e).
- No hagas commits sin que te lo pida.

## Control de horas

Las horas y subtareas de este proyecto se registran con la app de `../control-horas`, que tiene que estar en marcha con `npm start` (http://localhost:4300).

- Cuando empecemos un trabajo nuevo que no encaje en ninguna subtarea existente, **propón una**: título corto, descripción de una línea y 1–3 etiquetas.
  - Antes de proponerla, consulta las que ya hay con `node ../control-horas/bin/horas.mjs tareas`.
  - Reutiliza las etiquetas existentes siempre que encajen (por ejemplo `mundo`, `rendimiento`, `personajes`, `ui`, `herramientas`).
- **Solo si acepto**, créala con:
  ```
  node ../control-horas/bin/horas.mjs nueva --titulo "…" --descripcion "…" --etiquetas a,b --por claude
  ```
  Si el comando dice que no hay conexión, avísame de que la app está cerrada y sigue con el trabajo.
- No empieces, pauses ni pares el cronómetro: eso lo hago yo.
