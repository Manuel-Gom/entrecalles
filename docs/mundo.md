# El barrio jugable

«Comenzar aventura» (en `#/resumen`) abre `#/jugar`: un barrio de prueba con tu protagonista, que anda y corre, vecinos que hacen sus cosas y charlan, bancos donde sentarse y un café en el que se puede entrar. No hay historia, misiones ni diálogos del juego todavía: es el escenario sobre el que se construirá.

## Controles

| | Teclado y ratón (clásica) | Teclado y ratón (flechas) | Mando |
|---|---|---|---|
| Moverse | `W A S D` | `↑ ← ↓ →` | palanca izquierda (o cruceta) |
| Correr | `Mayús` | `Mayús` | gatillo derecho (RT / R2) o pulsar la palanca izquierda |
| Girar la cámara | arrastrar con el ratón, o `← →` y `↑ ↓` | arrastrar con el ratón, o `A D` y `W S` | palanca derecha |
| Acercar o alejar la cámara | rueda del ratón | rueda del ratón | LB / RB |
| Interactuar (sentarse, levantarse, entrar, salir) | `E` | `Intro` | `A` (Xbox) / Cruz ✕ (PlayStation) |
| Pausa | `Esc` | `Esc` | Menú (Xbox) / Options (PlayStation) |
| Diagnóstico | `F3` o clic en el contador de FPS | igual | igual |

La distribución se elige en Ajustes. Se puede pasar del teclado al mando (y al revés) en cualquier momento sin reiniciar: la ayuda de abajo cambia a los nombres del último dispositivo usado. Con la palanca a medias se anda más despacio que a tope.

### Mandos
Se usa la Gamepad API del navegador con el mapeo **estándar** del W3C: lo cumplen los mandos de Xbox y de PlayStation en Chrome, Edge y Firefox, por USB o Bluetooth. El navegador no «ve» un mando hasta que se pulsa un botón: si el barrio no lo reconoce, pulsa cualquier botón. Si el mando no usa el mapeo estándar, se avisa en pantalla y puede que algunos botones no coincidan. Al desconectarlo, el control vuelve al teclado; al reconectarlo, se retoma solo.

## Calidad y rendimiento

Arriba a la derecha se elige la calidad:

| | Resolución | Sombras |
|---|---|---|
| Baja | 0,85 × | no |
| Media (por defecto) | 1 × | sí (1024) |
| Alta | hasta 2 × | sí (2048) |

La elección se recuerda en este dispositivo. El número de FPS de arriba es un botón (o `F3`): abre un **diagnóstico** con los FPS medios, los tirones (el 1 % de fotogramas más lento y el peor), la calidad, la resolución, el dispositivo de entrada, la tarjeta gráfica, los triángulos y las llamadas de dibujo, con un botón **Copiar** para pegarlo al comparar mediciones.

Para medir con el mismo recorrido en las tres calidades: `npm run build && node tools/revision/rendimiento.mjs --ventana` (con `--ventana` usa tu tarjeta gráfica; sin ella dibuja por software y los números no valen). Para comparar entre equipos o versiones, usa siempre el mismo navegador, resolución y número de vecinos, y apunta la tarjeta gráfica que sale en el diagnóstico.

## Cómo está hecho

Todo vive en `src/world/`. Se carga bajo demanda (no pesa en el menú) y al salir de la pantalla se libera todo, incluido el contexto de la tarjeta gráfica.

| Archivo | Qué hace |
|---|---|
| `world.ts` | La escena, el bucle y la carga de personajes y modelos. Une todo lo demás. |
| `layout.ts` | Genera el barrio (determinista): 3×3 manzanas de 30 m con calles de 10 m, el parque en el centro, 32 edificios, bancos, árboles y farolas. Devuelve las **colisiones**, la **red de aceras** (80 nodos y `findPath`), los **sitios de actividad** y la puerta del café. |
| `cityMesh.ts` | Convierte ese diseño en geometría fusionada (pocas llamadas de dibujo). Edificios, calles, árboles y farolas se generan por código; los bancos de relleno solo se ven si falla la carga del modelo de Blender. |
| `props.ts` | Carga los modelos de Blender (GLB), separa sus **datos** (colisiones, plazas, luces, puntos) y dibuja el mismo modelo muchas veces con pocas llamadas (`instanceProp`). |
| `storefront.ts`, `interior.ts` | La fachada del café (con la puerta que se abre sola) y su interior, que solo se carga mientras se está dentro. |
| `gait.ts`, `locomotor.ts` | La zancada: ángulos de cada articulación (`gait.ts`, sin Three.js) y su aplicación a los huesos (`locomotor.ts`). |
| `player.ts`, `followCamera.ts` | Movimiento del jugador (aceleración, giro, colisiones con paredes y personas) y cámara en tercera persona que se acerca si un edificio se interpone. |
| `input.ts`, `inputController.ts` | Entrada: la lectura del mando (zona muerta, botones, tipo de mando) es pura y se prueba sin navegador; el controlador junta teclado, ratón y mando. |
| `brain.ts`, `cast.ts` | Qué hace cada vecino, cómo esquiva a los demás y quiénes salen. |
| `seating.ts` | Sentarse y levantarse (jugador y vecinos comparten plazas). |
| `dialogue.ts` | Las charlas de los vecinos. |
| `audio.ts` | El sonido, generado con Web Audio (sin archivos). |
| `perf.ts` | Registro de tiempos de fotograma y texto de diagnóstico. |

### La zancada
No hay animaciones guardadas: los modelos no traen ninguna. El paso se calcula:

- la **fase** del ciclo avanza con la **distancia recorrida**, no con el tiempo, así que el pie de apoyo no resbala; hay una prueba que lo mide;
- la amplitud y la cadencia dependen de la velocidad: unos 115 pasos por minuto andando (1,5 m/s) y 185 corriendo (4,6 m/s);
- la pelvis baja lo justo para que la pierna de apoyo llegue siempre al suelo, y al correr hay un pequeño vuelo;
- los brazos contrarrestan a las piernas, el tronco contragira, se inclina hacia delante al correr y **hacia dentro de las curvas** al girar;
- arrancar, frenar y pasar de andar a correr no dan saltos mayores que correr a ritmo constante (prueba);
- parado hay respiración (`pose.ts`) y un leve cambio de peso.

### Colisiones y vecinos que se esquivan
El jugador choca con paredes, mobiliario y **con las personas** (círculos de 0,3 y 0,25 m): se desliza por ellas. Los vecinos andan por las aceras y se esquivan entre sí y al jugador con una regla local y determinista: cada uno se aparta hacia **su derecha** (así dos que se cruzan no se bloquean), frena si hay alguien justo delante y se separa a la fuerza si se acercan demasiado; si llevan más de 4 s sin avanzar, replanifican y buscan otro destino. Los bancos y los sitios de las esquinas y los escaparates se **reservan**: dos personas no eligen el mismo. Las pruebas sueltan a 12 vecinos durante 10 minutos de juego y comprueban que ninguno se mete en una pared ni se acerca a otro a menos de 0,3 m.

### Interacción y asientos
Una sola tecla (o botón) hace lo que corresponda donde estés, y un aviso en pantalla (`Pulsa E para sentarte`, `…para entrar al café`) lo dice antes:

- **Bancos y sillas**: cada banco tiene dos plazas, también los del parque (a los que llegan los vecinos por unas diagonales de la red de aceras). Se llega por delante en los bancos y **por detrás** en las sillas con mesa y los taburetes. Sentarse y levantarse son graduales, con la altura del asiento de cada uno (46 cm el banco, 67 el taburete). Si te sientas, ningún vecino ocupa tu plaza. Estando sentado, `E` o empujar una dirección te levanta.
- **El café**: delante de su puerta se ofrece entrar. Hay un fundido a negro, la calle desaparece y apareces en la sala (con luces de interior, ambiente de café y suelo de baldosa). La sala no se puede abandonar andando (la puerta tiene colisión y la cámara no la atraviesa): se sale junto a la puerta con la misma tecla, a la calle y de cara a ella. El interior se carga al entrar y se **libera al salir**. Con «movimiento reducido» no hay fundido.

### Modelos de Blender
`tools/blender/crear_props.py` genera, por código y sin nada de terceros (CC0), los tres modelos de `public/models/mundo/`:

| Modelo | Qué es | Peso | Triángulos |
|---|---|---|---|
| `banco.glb` | Banco de listones de madera con bastidor de hierro; se dibuja decenas de veces con 2 llamadas | 22 KB | ~880 |
| `fachada_cafe.glb` | Módulo de 5 m con ventana, puerta con hoja que gira, toldo a rayas y cartel «CAFÉ» | 47 KB | ~1.700 |
| `cafe_interior.glb` | Sala de 8 × 7 m (sin techo, para la cámara) con mostrador, taburetes, 4 mesas y 8 sillas | 69 KB | ~3.300 |

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python tools/blender/crear_props.py
# solo uno:  ... -- banco | fachada | interior
```

Convenciones (la lee `props.ts`; las comprueba `tests/mundo-modelos.test.ts`):
- Sin texturas: solo colores de material. Los límites de peso y triángulos están en la prueba.
- Se modela con el frente hacia −Y de Blender (+Z en glTF), con los pies en el suelo y en metros.
- Los **objetos vacíos** son datos: `COL_*` caja de colisión (la escala es la mitad del tamaño; los que empiezan por `COL_pared` tapan además la vista de la cámara), `SEAT_*` plaza (mira hacia donde apunta), `LUZ_*` punto de luz, `ENTRADA`/`SALIDA`/`PUERTA_CENTRO` puntos de referencia. Un objeto llamado `PUERTA_HOJA` es la hoja de una puerta, con la bisagra como origen.
- Los datos de los modelos se **comprueban contra el código**: las plazas del banco coinciden con las de la ciudad, el punto de acercamiento de cada silla está libre, cada silla mira a una mesa, la sala no tiene huecos.
- El resto de la ciudad (edificios, calles, árboles) sigue siendo procedural. Se irán sustituyendo por modelos de Blender solo los elementos que destaquen, midiendo antes el coste.

### Vecinos y charlas
`cast.ts` reparte 16 vecinos: 3 que se sientan (mejor si son mayores), 2 que hacen footing, 2 parejas que charlan, 2 que miran escaparates, 2 que esperan en una esquina y 3 que pasean. Se cargan de dos en dos; los que están a más de 48 m no se animan y a más de 80 m se ocultan.

Las parejas caminan juntas, se paran y **hablan**: `dialogue.ts` tiene 16 conversaciones cortas, de 3 a 5 líneas (revisadas por una prueba: longitud, signos de apertura y cierre, sin líneas repetidas). Cada pareja las elige al azar con su propia semilla, **no repite** las últimas 6, se turna para empezar y deja un silencio entre conversaciones. Quien habla gesticula; quien escucha, menos. La charla más cercana a menos de 11 m se **subtitula** (con el nombre de quien habla) y suena como un murmullo con volumen y lado según dónde esté. Los subtítulos se activan en Ajustes (por defecto, sí): sin ellos, la charla sigue pero no se escribe.

### Sonido
Todo se genera con Web Audio en el navegador: no hay archivos de sonido ni licencias.

| Sonido | Cómo |
|---|---|
| Pasos del protagonista y de los vecinos cercanos | un golpe de ruido filtrado por cada vez que un pie toca el suelo (la fase de la zancada lo marca), distinto en **acera, calzada, hierba y baldosa**; más fuerte y rápido al correr; los de los vecinos bajan con la distancia y salen por el lado correspondiente |
| Ambiente de calle | zumbido grave de tráfico lejano que sube y baja, y pájaros de vez en cuando |
| Ambiente del café | murmullo de sala y tazas, con fundido al entrar y salir |
| Puerta, sentarse, levantarse | chirrido y clic; golpe suave |
| Charla cercana | murmullo de voces con ritmo de sílabas |

«Volumen general» multiplica a «Efectos» (pasos, puertas, voces) y a «Música» (que aquí controla el ambiente, porque aún no hay música). El navegador no deja sonar hasta que el usuario hace un gesto: se intenta al entrar (el clic de «Comenzar aventura» cuenta) y en la primera tecla o clic; mientras tanto se avisa con «Pulsa una tecla o haz clic para activar el sonido». La pausa suspende el sonido. Nada de lo que se transmite solo por sonido es imprescindible: las charlas llevan subtítulos y las puertas y asientos se ven.

## Requisitos de navegador
Navegador de escritorio con WebGL 2 y Web Audio (Chrome, Edge, Firefox o Safari recientes). Para el mando, la Gamepad API con mapeo estándar (los mismos, salvo Safari con algunos mandos). Por ahora no hay controles táctiles.

## Qué falta
- Controles táctiles; reasignar teclas.
- El resto de edificios sin interior (solo el café se puede visitar); el interior no tiene vecinos.
- Vehículos, ciclo de día y noche, música, y todo lo que da sentido al juego: historia, misiones, diálogos del juego, dificultad.
- Los 160 PNJ a la vez: harían falta modelos más sencillos para los lejanos.
- Probar con mandos reales: las pruebas usan un mando simulado (ver [pruebas.md](pruebas.md)); la validación con un mando de Xbox y uno de PlayStation en los navegadores de destino, y las mediciones de rendimiento, las tiene que hacer quien tenga el equipo.

## Revisar el resultado
`npm run build && node tools/revision/mundo.mjs <marcha|calle|pnj|sentado|tienda|interior> [cuerpo]` deja capturas en `docs/previews/web/` (que no se versiona). Ver [pruebas.md](pruebas.md).
