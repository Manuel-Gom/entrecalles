# El barrio jugable

«Comenzar aventura» (en `#/resumen`) abre `#/jugar`: un barrio de prueba con tu protagonista, que anda y corre, vecinos que hacen sus cosas y charlan, bancos donde sentarse, un café y **todos los edificios explorables por dentro**: portal, escalera, ascensor, pisos amueblados, locales y azotea. No hay historia, misiones ni diálogos del juego todavía: es el escenario sobre el que se construirá.

## Controles

| | Teclado y ratón (clásica) | Teclado y ratón (flechas) | Mando |
|---|---|---|---|
| Moverse | `W A S D` | `↑ ← ↓ →` | palanca izquierda (o cruceta) |
| Correr | `Mayús` | `Mayús` | gatillo derecho (RT / R2) o pulsar la palanca izquierda |
| Girar la cámara | arrastrar con el ratón, o `← →` y `↑ ↓` | arrastrar con el ratón, o `A D` y `W S` | palanca derecha |
| Acercar o alejar la cámara | rueda del ratón | rueda del ratón | LB / RB |
| Interactuar (sentarse, levantarse, entrar, salir, usar el ascensor) | `E` | `Intro` | `A` (Xbox) / Cruz ✕ (PlayStation) |
| Pausa | `Esc` | `Esc` | Menú (Xbox) / Options (PlayStation) |
| Diagnóstico | `F3` o clic en el contador de FPS | igual | igual |

La distribución se elige en Ajustes. Se puede pasar del teclado al mando (y al revés) en cualquier momento sin reiniciar: la ayuda de abajo cambia a los nombres del último dispositivo usado. Con la palanca a medias se anda más despacio que a tope.

### Mandos
Se usa la Gamepad API del navegador con el mapeo **estándar** del W3C: lo cumplen los mandos de Xbox y de PlayStation en Chrome, Edge y Firefox, por USB o Bluetooth. El navegador no «ve» un mando hasta que se pulsa un botón: si el barrio no lo reconoce, pulsa cualquier botón. Si el mando no usa el mapeo estándar, se avisa en pantalla y puede que algunos botones no coincidan. Al desconectarlo, el control vuelve al teclado; al reconectarlo, se retoma solo.

## Calidad y rendimiento

Arriba a la derecha se elige la calidad:

| | Resolución | Sombras | Luces reales de farola (de noche) |
|---|---|---|---|
| Baja | 0,85 × | no | 0 |
| Media (por defecto) | 1 × | sí (1024) | 4 |
| Alta | hasta 2 × | sí (2048) | 8 |

La elección se recuerda en este dispositivo. El número de FPS de arriba es un botón (o `F3`): abre un **diagnóstico** con los FPS medios, los tirones (el 1 % de fotogramas más lento y el peor), la calidad, la resolución, el dispositivo de entrada, la tarjeta gráfica, los triángulos y las llamadas de dibujo, con un botón **Copiar** para pegarlo al comparar mediciones.

Para medir con el mismo recorrido en las tres calidades: `npm run build && node tools/revision/rendimiento.mjs --ventana` (con `--ventana` usa tu tarjeta gráfica; sin ella dibuja por software y los números no valen). Para comparar entre equipos o versiones, usa siempre el mismo navegador, resolución y número de vecinos, y apunta la tarjeta gráfica que sale en el diagnóstico. Como el reloj del barrio empieza con la hora del ordenador, fija la hora para que las medidas se puedan repetir: por ejemplo `--ventana --sin-limite --resolucion=1920x1080 --sitios=centro,borde --hora=23:30 --etiqueta=noche` mide de noche en la plaza y en el borde, sin el tope de FPS del monitor, y guarda `docs/previews/web/rendimiento-noche.json` (las opciones están al principio de la herramienta). Sin tope, Chromium da un fotograma lento cada ~150 ms aunque no pase nada: con `--sin-limite` valen los FPS medios, no los tirones. Los tirones se miden sin esa opción; `--anochecer` mide el peor fotograma al encenderse y apagarse las farolas, en frío.

Cambiar **cuántas** luces hay en la escena (sale la luna, se pone el sol, se encienden las farolas) obliga a recompilar todos los materiales: más de un segundo de parón en una gráfica integrada. Por eso el barrio prepara el nuevo estado en segundo plano y cambia cuando está listo; cambiar la **intensidad** de una luz no cuesta nada. Si añades luces, sigue la misma regla.

## Cómo está hecho

Todo vive en `src/world/`. Se carga bajo demanda (no pesa en el menú) y al salir de la pantalla se libera todo, incluido el contexto de la tarjeta gráfica.

| Archivo | Qué hace |
|---|---|
| `world.ts` | La escena, el bucle y la carga de personajes y modelos. Une todo lo demás. |
| `layout.ts` | Genera el barrio (determinista): 3×3 manzanas de 30 m con calles de 16 m (acera de 4 m a cada lado y calzada de 8 m, dos carriles), el parque en el centro, 32 edificios (con sus plantas, su portal y su local), bancos, árboles y farolas. Devuelve las **colisiones**, la **red de aceras** (80 nodos y `findPath`), los **pasos de peatones** (`crossings`), los **sitios de actividad** y la puerta del café. |
| `cityMesh.ts` | Convierte ese diseño en geometría fusionada (pocas llamadas de dibujo). Edificios, calles, árboles y farolas se generan por código; los bancos de relleno solo se ven si falla la carga del modelo de Blender. |
| `props.ts` | Carga los modelos de Blender (GLB), separa sus **datos** (colisiones, plazas, luces, puntos) y dibuja el mismo modelo muchas veces con pocas llamadas (`instanceProp`). |
| `storefront.ts`, `interior.ts` | La fachada del café (con la puerta que se abre sola) y su interior, que solo se carga mientras se está dentro. |
| `buildingPlan.ts` | El plano de cada edificio, sin Three.js: núcleo de escalera y ascensor, portal, local, pisos con sus estancias, azotea, huecos de puertas y ventanas, colocación de muebles, y la altura en la escalera (`heightAt`). |
| `buildingInterior.ts`, `buildings.ts` | El interior del edificio más cercano (mallas por planta, colisiones, plazas, puertas y ascensor) y el gestor que lo monta y lo suelta, con los portales y escaparates de todas las fachadas. |
| `doors.ts`, `interiorMaterials.ts` | Modelos instanciados con hojas de puerta que se abren por separado; y los acabados de suelos y paredes (parqué, baldosa, terrazo, azulejo, pintura) dibujados por shader. |
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

- **Bancos y sillas**: cada banco tiene dos plazas, también los del parque (a los que llegan los vecinos por unas diagonales de la red de aceras). Se llega por delante en los bancos y **por detrás** en las sillas con mesa y los taburetes. Sentarse y levantarse recorren el mismo camino en sentidos opuestos, desde la posición real del jugador; se calculan rutas laterales que respetan las colisiones de mesas y muebles, en vez de cambiar de sitio al empezar o acabar. La transición adapta gradualmente la altura del asiento (46 cm el banco, 67 cm el taburete), la pelvis y las piernas, y apoya las manos sobre los muslos. La postura se calcula sobre el esqueleto y los marcadores del modelo, sin simulación física rígida. Si te sientas, ningún vecino ocupa tu plaza. Estando sentado, `E` o empujar una dirección te levanta.
- **El café**: delante de su puerta se ofrece entrar. Hay un fundido a negro, la calle desaparece y apareces en la sala (con luces de interior, ambiente de café y suelo de baldosa). La sala no se puede abandonar andando (la puerta tiene colisión y la cámara no la atraviesa): se sale junto a la puerta con la misma tecla, a la calle y de cara a ella. El interior se carga al entrar y se **libera al salir**. Con «movimiento reducido» no hay fundido.

### Edificios por dentro
Los 32 edificios se visitan enteros, de la planta baja a la azotea, y la altura de fuera es la de dentro: plantas de 3 m (`FLOOR_HEIGHT`) más el antepecho, con las ventanas pintadas de la fachada en el mismo sitio que las de verdad. El plano (`buildingPlan.ts`) sale del solar, de las plantas y de una semilla, así que es siempre el mismo:

- **Planta baja**: el portal (buzones, felpudo, planta) llega hasta el núcleo, en el rincón de las medianeras; el resto es un **local** con su escaparate y su puerta a la otra calle (tienda de alimentación, farmacia, panadería o peluquería, cada uno con sus muebles y su rótulo) y, si es largo, un almacén al fondo. En el edificio del café, esa zona es el café (que sigue siendo aparte, con fundido).
- **Escalera** de ida y vuelta en todos: dos tramos de 10 peldaños (15 × 27 cm) y meseta. Se sube andando: la altura sigue la línea de las huellas y, de las plantas posibles, se toma la más cercana a la actual, así que nunca salta. **Ascensor** en los de 5 plantas o más: se llama solo al acercarse a su puerta, y dentro `E` abre el panel (arriba y abajo eligen la planta, `E` va, a los lados se cierra).
- **Plantas de pisos**: 1, 2 o 3 pisos según la superficie, con puerta al rellano, que se alarga como pasillo común; detrás queda un patio de luces. Cada piso tiene recibidor y pasillo, salón (en la esquina, con dos fachadas en el de la esquina), cocina, de 1 a 3 dormitorios y 1 o 2 baños; los pequeños tienen la cocina en el salón. Los dormitorios y salones van a la fachada; los baños pueden ser interiores.
- **Azotea**: casetón de la escalera, barandilla alrededor del patio, depósito, antenas, tendedero y máquinas de aire.
- **Muebles**: cada estancia se amuebla con reglas (contra las paredes, sin tapar puertas ni ventanas, con paso libre delante de cada puerta). Se puede sentar en sofás, sillones, sillas y en el borde de la cama.

Cómo funciona: solo hay un edificio montado a la vez, el de la puerta más cercana (a menos de 14 m) o en el que se está. Las colisiones, plazas y luces de todas sus plantas se calculan al montarlo; las mallas, solo de la planta actual y las de al lado. Los muros, suelos y techos se generan por código y los muebles de una planta se **fusionan por material** (unas pocas decenas de llamadas de dibujo por planta). Se entra andando, sin fundido: la fachada tiene huecos de verdad para el portal y el local, y por las ventanas se ve la calle (la carcasa de fuera no se ve desde dentro). Dentro se ven la planta actual y la de abajo, y nada por encima (como un corte), así que la cámara puede mirar desde arriba; los muros de fachada no la dejan salir. Las luces de dentro (0, 2 o 4 según la calidad) se compilan al acercarse a una puerta, con el mismo mecanismo que las farolas, para que entrar no dé un tirón. Las puertas se abren solas al acercarse.

### Modelos de Blender
`tools/blender/crear_props.py` genera, por código y sin nada de terceros (CC0), los modelos de `public/models/mundo/`:

| Modelo | Qué es | Peso | Triángulos |
|---|---|---|---|
| `banco.glb` | Banco de listones de madera con bastidor de hierro; se dibuja decenas de veces con 2 llamadas | 22 KB | ~880 |
| `fachada_cafe.glb` | Módulo de 5 m con ventana, puerta con hoja que gira, toldo a rayas y cartel «CAFÉ» | 47 KB | ~1.700 |
| `cafe_interior.glb` | Sala de 8 × 7 m (sin techo, para la cámara) con mostrador, taburetes, 4 mesas y 8 sillas | 71 KB | ~3.300 |
| `fuente.glb` | Fuente central de piedra con pilón de borde grueso, dos tazas torneadas sobre un pie, cortinas de agua, un chorro central y ocho arcos | 58 KB | ~6.500 |
| `arbol.glb` | Árbol con tronco ahusado, ramas y copas de hojas en tonos variados; se instancia en el parque y las calles | 20 KB | ~1.760 |
| `farola.glb` | Farola de hierro con base escalonada, brazo curvo y luminaria de vidrio | 10 KB | ~900 |
| `sol.glb` | Disco solar con corona y rayos cortos; recorre el cielo según la hora local | 21 KB | ~2.560 |
| `luna.glb` | Esfera lunar con relieve y cráteres modelados; recorre el cielo opuesta al sol | 16 KB | ~1.760 |
| `luna_nueva.glb` | Disco oscuro con cráteres en relieve, sin cara iluminada | ~16 KB | ~1.680 |
| `luna_creciente.glb` | Cuarto creciente con relieve de cráteres en la zona iluminada | ~28 KB | ~3.120 |
| `luna_llena.glb` | Disco completo brillante con cráteres en relieve | ~38 KB | ~4.570 |
| `luna_menguante.glb` | Cuarto menguante con la iluminación en el lado opuesto | ~28 KB | ~3.120 |

Los de los edificios (53: muebles, puertas, ventanas, escalera, ascensor, portal, escaparate y rótulos; de 3 a 41 KB y menos de 2.000 triángulos cada uno) salen de `tools/blender/crear_interiores.py`, que usa las utilidades de `crear_props.py`. Sus huellas deben coincidir con `FURNITURE` en `buildingPlan.ts`.

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python tools/blender/crear_props.py
# solo uno:  ... -- banco | fachada | interior | fuente | arbol | farola | sol | luna | luna_nueva | luna_creciente | luna_llena | luna_menguante
& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python tools/blender/crear_interiores.py
# solo algunos:  ... -- sofa cama_doble escalera
```

Convenciones (la lee `props.ts`; las comprueba `tests/mundo-modelos.test.ts`):
- Sin texturas: solo colores de material. Los límites de peso y triángulos están en la prueba. Todo lo que parece una textura (piedra desgastada, agua, chorros) lo pone el código con shaders, según el nombre del material (`PiedraFuente`, `PiedraClara`, `AguaFuente`, `ChorroFuente`).
- Se modela con el frente hacia −Y de Blender (+Z en glTF), con los pies en el suelo y en metros.
- Los **objetos vacíos** son datos: `COL_*` caja de colisión (la escala es la mitad del tamaño; los que empiezan por `COL_pared` tapan además la vista de la cámara), `SEAT_*` plaza (mira hacia donde apunta), `LUZ_*` punto de luz, `ENTRADA`/`SALIDA`/`PUERTA_CENTRO` puntos de referencia. Un objeto llamado `PUERTA_HOJA` es la hoja de una puerta, con la bisagra como origen.
- Los datos de los modelos se **comprueban contra el código**: las plazas del banco coinciden con las de la ciudad, se puede trazar una ruta libre para cada asiento, cada silla mira a una mesa, y las sillas, taburetes, estantería y planta-lámpara tienen colisión. Los taburetes dejan más espacio frente a la barra y la sala no tiene huecos.
- **Calles**: las farolas van en el bordillo, dos por lado de manzana y con el brazo siempre hacia la calzada; las de las dos aceras de una calle van al tresbolillo (`LAMP_OFFSETS`). Entre las dos farolas de un lado hay como mucho un árbol, a 5 m o más de cualquier farola. Los pasos de peatones son cebras de 7 bandas paralelas a la calzada, solo en las esquinas (junto al cruce, sin entrar en él), y la raya central se corta antes de cada cruce y de sus pasos (`roadMarkings` en `cityMesh.ts`, que comprueban las pruebas: nada se pisa y todo queda sobre la calzada).
- La fuente, los árboles y las farolas usan modelos de Blender instanciados; sus colisiones siguen saliendo del diseño del barrio. Edificios y calles aún se generan por código.
- El reloj empieza con la hora local del ordenador y avanza a **un minuto de juego por cada segundo real**; se muestra como HH:MM en la barra superior y se detiene al pausar. El sol, la iluminación, el cielo y la niebla cambian gradualmente. La fase lunar se calcula con la fecha del juego y selecciona uno de cuatro modelos detallados. De noche, cada farola pinta un **charco de luz** cálido en el suelo (todos en una sola llamada de dibujo, con niebla), que es lo que deja ver iluminadas las calles lejanas; además, las farolas más cercanas al protagonista (0, 4 u 8 según la calidad) proyectan **luz real** de intensidad moderada (18) y alcance de 28 m, con atenuación física inversa al cuadrado, que se apaga y se enciende con un fundido corto al pasar de una farola a otra. Son pocas a propósito: cada luz real se calcula en cada píxel iluminado y 24 bajaban los FPS a la mitad en una gráfica integrada (ver `src/world/streetLights.ts`). El vidrio de las luminarias también reduce su brillo emisivo por la noche para evitar sobreexponer personajes y edificios. Para mantener el rendimiento, el agua se calcula en el shader (ver «Parque: suelo, agua y fuente»), no con una simulación física de fluidos.
- La cámara puede inclinarse hacia arriba para mirar el cielo y ver el recorrido de los cuerpos celestes.

### Parque: suelo, agua y fuente
- **Suelo** (`src/world/ground.ts`, `cityMesh.ts`): las aceras son losas de hormigón de 1,2 m con juntas, tono propio por losa y **bordillo** (la acera sube `SIDEWALK_HEIGHT` = 5 cm sobre la calzada); el césped lleva textura con manchas de tono y franjas de siega muy suaves, y los dos paseos del parque son de gravilla con un borde de piedra que los separa del césped. Las texturas son de ambientCG (CC0, `public/textures/suelo/`, ~540 KB en total) y se repiten por metros del mundo; el shader las mezcla a dos escalas y orientaciones para que no se vea el mosaico. Mientras cargan (o si fallan) se ve el color plano de antes. `stats().groundTextured` dice si ya están puestas. En calidad baja el suelo no lleva relieve (mapa de normales) y lee la textura una sola vez; en media y alta lleva las dos cosas (anisotropía 4 y 8). Los personajes pisan a la altura del suelo que tienen debajo (`footHeight` en `layout.ts`), y los bancos se apoyan sobre la acera o el paseo.
- **Agua** (`src/world/water.ts`): ondas que se mueven (normales calculadas en el shader), reflejo del color del cielo según el ángulo de visión (Fresnel; de noche refleja el cielo oscuro), más fondo hacia el centro, espuma en el borde y donde caen las cascadas, y cortinas y chorros con hilos que bajan. Con «Reducir movimiento» el agua se queda quieta. No da sombra.
- **Fuente** (`fuente.glb`): tres láminas de agua (alturas y radios en `FOUNTAIN_LEVELS` y `FOUNTAIN_RADII`, que `tests/mundo-modelos.test.ts` comprueba contra el modelo; si cambias la fuente en Blender, cámbialos a la vez). La piedra se viste con manchas, humedad y algas bajo la línea de agua.
- **Medición**: `node tools/revision/mundo.mjs parque` (y `ciclo`, con `--etiqueta=` para comparar antes y después) y `tools/revision/rendimiento.mjs` (ver arriba).

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
- Los vecinos no entran en los edificios ni viven en los pisos; el café sigue siendo una sala aparte (con fundido).
- Desde fuera, las ventanas de los pisos están pintadas: no se ve el interior a través de ellas.
- Vehículos, ciclo de día y noche, música, y todo lo que da sentido al juego: historia, misiones, diálogos del juego, dificultad.
- Los 160 PNJ a la vez: harían falta modelos más sencillos para los lejanos.
- Probar con mandos reales: las pruebas usan un mando simulado (ver [pruebas.md](pruebas.md)); la validación con un mando de Xbox y uno de PlayStation en los navegadores de destino, y las mediciones de rendimiento, las tiene que hacer quien tenga el equipo.

## Revisar el resultado
`npm run build && node tools/revision/mundo.mjs <marcha|calle|parque|ciclo|pnj|pnj-sentado|sentado|tienda|interior> [cuerpo]` deja capturas en `docs/previews/web/` (que no se versiona). `parque` saca una vista de detalle y otra general de los modelos de Blender; `ciclo` captura el parque de día y de noche y, además, la iluminación cerca de una farola, a lo largo de una calle, a lo lejos y desde arriba, con el brillo medio de cada vista (`--etiqueta=antes` añade un sufijo a las capturas para comparar antes y después de un cambio). Ver [pruebas.md](pruebas.md).
