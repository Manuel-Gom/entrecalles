# Personajes: 20 cuerpos (10 hombres y 10 mujeres) con ropa y pelo intercambiables

Los personajes se crean con Blender (MPFB2) en segundo plano y se muestran en el navegador con Three.js. Cada cuerpo es un archivo `.glb` y cada pieza de pelo, ropa o calzado es otro, ajustado a ese cuerpo y con el mismo esqueleto. El navegador monta el cuerpo y las piezas elegidas y solo descarga lo que cambia.

```
public/models/modular/
  manifest.json                     catálogo: cuerpos, huecos y piezas
  <cuerpo>/body.glb                 cuerpo con piel, ojos, cejas y pestañas (0,5-0,7 MB)
  <cuerpo>/<hueco>/<pieza>.glb      pelo, barba, torso, piernas, conjunto, calzado, cabeza, gafas (0,03-0,5 MB)
  miniaturas/cuerpos/<cuerpo>.png   busto con el atuendo por defecto (256x320)
  miniaturas/<hueco>/<pieza>.png    la pieza puesta sobre un maniquí (192x192)
```

## Qué se puede elegir
- **Cuerpos masculinos (10):** Marcos, Dani, Kenji, Iván, Malik, Hiro, Tomás, Ramón, Nico, Leo.
- **Cuerpos femeninos (10):** Lucía, Sofía, Aisha, Mei, Carmen, Noa, Irene, Zoe, Elena, Rosa. Distintas edades (de unos 19 a unos 80 años), orígenes, alturas y complexiones. Rosa (la mayor, pelo canoso) y Sofía (pelirroja) llevan `color_pelo`, como Ramón; Noa es la más joven.
- Cada cuerpo tiene `genero` (`hombre` o `mujer`) y cada pieza `para` (lista de géneros). El editor solo debe ofrecer las piezas cuyo `para` incluye el género del cuerpo; los archivos solo existen para esas combinaciones.
- **Peinado (27):** 12 para ambos géneros (corto clásico, corto de lado, corto liso, rizado, despeinado, mechones, melena lisa, corto peinado, moño, media melena, melena con flequillo, flequillo de lado) y 15 solo de mujer (bob de lado, bob liso, bob recto, bob con flequillo, bob rizado, bob rizado con flequillo, bob asimétrico, bob asimétrico con flequillo, bob corto, trenza, trenza francesa, trenza desordenada, dos trenzas, melena larga, coleta). Color de pelo en el navegador (el color se aplica conservando la luz y la sombra de la textura).
- **Barba y bigote (4, solo hombre):** barba completa, perilla larga, bigote ancho y barba trenzada. Llevan `"tinte_pelo": true`: el navegador las tiñe con el color de pelo del personaje igual que el pelo.
- **Torso (10):** 3 camisetas/polo solo de hombre, 1 jersey para ambos, 5 tops solo de mujer (camiseta, top de tirantes, estampado animal, corsé, cuello alto) y un top deportivo.
- **Pantalón (8):** cargo y lana para ambos; solo de mujer: short vaquero y 5 faldas (minifalda escocesa, minifalda escocesa con volante, falda de flores, minifalda de volantes y falda larga de volantes). Las faldas combinan con los tops de mujer.
- **Conjuntos completos** (sustituyen a torso y pantalón): 8 de hombre y 4 de mujer de MPFB (camiseta y vaqueros, camiseta y short, traje de chaqueta y falda, conjunto deportivo, jersey azul y vaqueros...), 6 vestidos de mujer (recto, largo de cuello halter, de cuello halter, de volantes, de encaje, de flores sin tirantes) y 6 trajes (traje cruzado, azul marino, gris con corbata y con pajarita para hombre; cruzado y con falda para mujer).
- **Calzado** (obligatorio): 8 para ambos (6 zapatos, zapatillas y botas, botines de cuero y zapatos de correa) y 4 solo de mujer (botines, bailarinas, bailarinas con lazo, merceditas).
- **Sombrero (hueco `cabeza`):** gorra, fedora, fedora ladeado y sombrero de pescador. Todos ocultan el peinado (ver abajo).
- **Gafas (8, para ambos):** de pasta negras, angulares, de montura blanca, burdeos gruesas, burdeos finas, de media montura, sin montura y redondas doradas.
- No hay ropa interior visible: se descargaron `underwear01` y `underwear04` y se descartaron (ver "Piezas descartadas"). En los cuerpos femeninos el editor debe exigir torso o conjunto (y pantalón o conjunto), igual que el calzado. Todos los atuendos por defecto ya lo cumplen.

Cada personaje se guarda como una lista de ids del catálogo (`AvatarSpec`, en `src/avatar/catalog.ts`), nunca como modelo.

### Esquema de `manifest.json`
```jsonc
{
  "cuerpos": [{ "id": "lucia", "nombre": "Lucía", "genero": "mujer", "descripcion": "...",
                "defecto": { "pelo": "long01", "conjunto": "female_casualsuit01", "calzado": "shoes05" },
                "colorPelo": "#a8501f",   // opcional
                "miniatura": true }],     // ruta fija: miniaturas/cuerpos/<id>.png
  "huecos": { "pelo": "Peinado", "barba": "Barba y bigote", "torso": "...", "piernas": "...", "conjunto": "...", "calzado": "...", "cabeza": "Gorra o sombrero", "gafas": "Gafas" },
  "piezas": [{ "id": "long01", "slot": "pelo", "nombre": "Melena larga", "para": ["mujer"],
               "oculta": ["pelo"],        // los sombreros ocultan el peinado
               "tinte": true,             // la prenda se puede teñir multiplicando su textura por un color
               "tinte_pelo": true,        // barbas: se tiñen con el color de pelo, como el pelo
               "miniatura": true }]       // ruta fija: miniaturas/<slot>/<id>.png
}
```

## Regenerar los modelos

Desde la raíz del proyecto, en PowerShell (Blender 5.2 con MPFB2 instalado):

```powershell
$bl = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
# todos los cuerpos y piezas (unos 20 minutos para los 20 cuerpos):
& $bl --background --python tools/blender/crear_modular.py
# solo algunos cuerpos (se borra y rehace su carpeta):
& $bl --background --python tools/blender/crear_modular.py -- marcos lucia
# solo reescribir el catálogo (nombres, valores por defecto) sin exportar modelos:
& $bl --background --python tools/blender/crear_modular.py -- ninguno
```

- Los cuerpos (género, piel, edad, altura, complexión, ropa por defecto) están en `tools/blender/personajes.json`. `macro.gender` se deduce de `genero` (hombre 1,0; mujer 0,0).
- Las piezas disponibles, sus nombres en español y para qué géneros valen (`para`), en `tools/blender/piezas.json`. Claves opcionales: `pies` (ver abajo), `textura` (tamaño máximo en píxeles de sus texturas, para piezas que pesarían demasiado), `oculta`, `tinte`, `tinte_pelo` y `colorDefecto` (estas se copian al manifest) y las que solo usa el exportador y no llegan al manifest: `desaturar`, `gamma`, `mate` y `sin_logo` (ver "Telas teñibles", "Brillo" y "Logotipos"), `material` (archivo .mhmat de la carpeta de la pieza, para los .mhclo que no enlazan su material: la gorra salía blanca y sin textura), `brillo` (multiplica los colores de la textura; oscurece la barba completa para que se tiña como el pelo) y `lente` (multiplica la opacidad de las zonas casi transparentes, las lentes de las gafas).
- Para ver qué piezas hay en MPFB: `tools/blender/hoja_de_miniaturas.py` (hojas de miniaturas por categoría; imprime índice y nombre).
- `tools/blender/previsualizar_glb.py` renderiza un `.glb` (vistas `frente`, `lateral`, `cara`, `cintura`, `pies`).
- `tools/blender/previsualizar_todos.py` hace una hoja de contacto de los cuerpos con su atuendo por defecto montando `body.glb` y las piezas:
  `& $bl --background --python tools/blender/previsualizar_todos.py -- docs/previews/personajes-mujeres.png frente --genero mujer` (también `--ids lucia,sofia`, `lateral`).
- `tools/blender/vista.py` (utilidades de montaje y render) lo usan `previsualizar_todos.py` y `miniaturas.py`; no se ejecuta solo.
- `tools/blender/previsualizar_piezas.py` dibuja piezas sueltas sobre cuerpos (hoja de contacto de barbas, gafas, sombreros, prendas teñidas con `tinc:RRGGBB`, pelo y barba teñidos con `tinte:RRGGBB`). Ejemplo: `-- salida.png "marcos|pelo:short01,barba:wdg_scruffy_beard;lucia|gafas:kwnet_at_optical_glasses" --azimut 0,40 --zona cara`.
- `crear_personajes.py` genera personajes completos (ropa fusionada) y contiene las funciones comunes; ya no se usa en la aplicación.
- Con `SALIDA_DIR=<carpeta>` los scripts leen y escriben en otra carpeta (útil para probar sin tocar `public/`); con `SOLO_PIEZAS=a,b` solo se exportan esas piezas (pruebas).

### Miniaturas

```powershell
# todas (cuerpos y piezas), unos 2 minutos; rehace también la hoja de contacto
& $bl --background --python tools/blender/miniaturas.py -- --hoja docs/previews/miniaturas.png
# solo las de las piezas, o solo algunas
& $bl --background --python tools/blender/miniaturas.py -- --solo piezas --ids long01,shoes05
```

Hay que exportar los modelos antes. Las miniaturas son PNG con fondo transparente (8 bits con paleta, 5-30 KB). Cada pieza se dibuja sobre un maniquí gris del primer cuerpo masculino (Marcos) o, si es solo de mujer, del primero femenino (Lucía): pelo y sombrero encuadran la cabeza, barba y gafas la cara (no la pieza, que sola saldría enorme), torso/pantalón/conjunto/calzado la propia pieza. El script añade `"miniatura": true` en `manifest.json` (y `crear_modular.py` lo conserva si los PNG existen). `--escala 3` renderiza más grande (sin cuantizar) para revisar detalles y `--referencia <cuerpo>` prueba una pieza sobre otro cuerpo.

## Cómo se ajustan las prendas
- Cada capa de ropa se separa unos milímetros del cuerpo (camiseta 6 mm, pantalón 3 mm, calzado 2 mm) y el bajo de camisetas y jerséis cae algo más holgado, para que ni el cuerpo ni el pantalón atraviesen la tela. El pelo no se infla.
- No se borra el cuerpo bajo la ropa, salvo los pies bajo el calzado (los dedos asomarían por zapatos cerrados). Por eso el calzado es obligatorio.
- El calzado bajo de mujer deja ver el pie, que el cuerpo no tiene. Las piezas con `"pies": true` (bailarinas, merceditas) llevan dentro una copia de pies y tobillos con la piel del cuerpo (textura de 512 px); las de `"pies": "tobillo"` (botines) llevan solo el tramo de tobillo por encima de la bota, para que los dedos no atraviesen el cuero.
- Las ropas de hombre que quedan mal sobre un cuerpo femenino (el pezón atraviesa camisetas ajustadas, la camiseta metida hace bulto) están marcadas solo `hombre`.
- Las texturas se reducen (cuerpo 2048 px, resto 1024 px, ojos y cejas 512 px), se guardan en WebP y la geometría se comprime con meshopt.

## Sombreros y peinados
- **Regla:** todos los sombreros (hueco `cabeza`) llevan `"oculta": ["pelo"]` y el editor quita el peinado al ponerlos. Se probaron con pelo corto (asoma por debajo del ala, sin problema), medio y largo: el pelo no se infla y atraviesa la copa del sombrero (se vio con melena larga y media melena), así que no se permite ninguna combinación. Si un día se quiere una pieza que deje ver el pelo (una diadema, por ejemplo), basta con no poner `oculta`.
- La **gorra** (`jujube_newsboy_cap`) salía blanca y lisa en las versiones anteriores: su .mhclo no enlaza el material. Ahora `"material": "newsboy_cap.mhmat"` en `piezas.json` le pone su textura de tela (gris). Es teñible.
- Descartados: botas altas `culturalibre_male_boots` y `culturalibre_heroine_boots_1` (llegan a la rodilla o al muslo y atraviesan cualquier pantalón largo; solo valdrían con shorts), `culturalibre_hero_boots_1..5` y `heroine_boots_2..3` (colores de fantasía, algunas con el pie al aire), `culturalibre_heroine_boots_4` (CC-BY), `toigo_harem_pants` (estampado floral chillón y marca en la bragueta), `skalldyrssuppe_tube_top_funky_colors` (estampado psicodélico), `grinsegold_uncle_joshis_hat` (el modelo es una corona de espinas), `toigo_maga_hat`, el gorro navideño y el cojín en la cabeza (por petición), `culturalibre_hair_06` (rosa fosforito y aspecto de plumas), `elvs_reverse_french_braid_bun` (reflejos morados de fantasía), `o4saken_long01` (0,65 MB), `toigo_flats` (0,95 MB) y los peinados de colores de fantasía (morado, rosa, verde, anime).

## Barbas y bigotes
- Vienen del paquete CC0 **bodyparts05** (barbas y bigotes). Se descargó de https://files2.makehumancommunity.org/asset_packs/bodyparts05/bodyparts05_cc0.zip y se descomprimió dentro de la carpeta `data` de MPFB (`%APPDATA%\Blender Foundation\Blender\5.2\extensions\.user\blender_org\mpfb\data`), que crea `clothes/<pieza>/` y el registro de licencias `packs/bodyparts05.json` que lee `tools/licencias.mjs`.
- Hueco `barba` (carpeta `<cuerpo>/barba/`), solo `hombre`. No se inflan como la ropa (`SIN_INFLAR` en `crear_modular.py`: siguen la cara tal cual). Se pueden combinar con cualquier peinado o sombrero.
- **Tinte:** llevan `"tinte_pelo": true`. El navegador las tiñe con la misma fórmula que el pelo (color x luminosidad de la textura / 0,08, entre 0,35 y 2,4), que supone texturas oscuras como las del pelo. La textura de la barba completa era gris claro (luminosidad lineal 0,26, saldría con el color multiplicado por 2,4 y demasiado brillante, anaranjada con un castaño): se oscurece al exportar con `"brillo": 0.65` (0,10). Las otras tres ya estaban en rango. Sin teñir, la barba completa queda gris oscuro.
- Descartada: `culturalibre_faun_beard` (barba de fauno, por petición). La barba trenzada (`wdg_scruffy_beard`) tiene un aspecto de cuerdas algo estilizado, pero se mantiene por variedad.

## Gafas
- Hueco `gafas` (carpeta `<cuerpo>/gafas/`), para ambos géneros, sin inflar. Salen de `glasses01` (CC0).
- Las gafas que se probaron antes "enormes y con el material mal" no se han podido reproducir en Blender: con los datos del .mhclo miden unos 15,6 cm de ancho y 4 cm de alto y se ajustan a cuerpos de todos los tamaños (revisadas en Mei, Malik, Rosa, Elena, Marcos, Iván, Ramón y Lucía). Causas probables, ya corregidas: (1) `kwnet_at_optical_glasses` trae una textura de 4096 px y `toigo_round_glasses_leopard` una de 2048 px, ambos materiales con `opacity 0`: ahora las texturas se reducen a 512 px; (2) si el exportador las inflaba 6 mm como a la ropa, los marcos salían más gruesos: ahora no se inflan; (3) las lentes tienen píxeles semitransparentes (alfa 0,2-0,35) y `lente` los vuelve aún más transparentes (x0,6-0,7). **No se ha comprobado en el navegador**: ahí el material es `alphaMode: BLEND` con `doubleSided`, igual que el pelo, y las lentes pueden ordenarse mal respecto al pelo según el `depthWrite` de la escena.
- Descartadas: `ews_3d_glasses` y `culturalibre_doc_ock_glasses` (por petición).

## Tinte (`"tinte": true`)
En el navegador se tiñe una prenda multiplicando su textura difusa por un color (`material.color` de Three.js). Solo funciona bien en telas lisas y claras. Cada pieza se midió leyendo su textura en el centro de cada triángulo de la malla (media y desviación ponderadas por área) y se comprobó con un render de la prenda teñida de azul, rojo, verde y amarillo (`vista.tenir_prenda`, que multiplica igual que Three.js).

| Pieza | Luminosidad sRGB | Desviación | Resultado |
|---|---|---|---|
| `elvs_crude_t-shirt_male` (camiseta) | 0,97 | 0,00 | teñible, perfecta |
| `joepal_crude_t-shirt_female` (camiseta de mujer) | 1,00 | 0,00 | teñible, perfecta |
| `toigo_basic_tucked_t-shirt` (camiseta metida) | 0,51 | 0,03 | teñible |
| `namuhekam_male_polo_shirt` (polo) | 0,57 | 0,03 | teñible (algo de brillo) |
| `jujube_newsboy_cap` (gorra) | 0,39 | 0,08 | teñible |
| `fedora01` y `fedora_cocked` | 0,44 | 0,09 | teñibles |
| `toigo_wool_pants` (pantalón de lana) | 0,25 | 0,02 | teñible; ahora desaturado (ver "Telas teñibles"), da cualquier color |
| `toigo_fisherman_sweater` | 0,26 | 0,05 | teñible tras desaturarlo (antes no: la lana es roja) |
| top de tirantes y cuello alto | 0,33-0,54 | 0,14-0,27 | teñibles tras desaturarlos; estampado animal: no |
| pantalón cargo, short vaquero | 0,12-0,19 | | teñibles tras desaturarlos; top corsé: no |
| calzado (los 6 originales) | 0,07-0,46 | 0,05-0,27 | no: llevan calcetín, suela y cordones en la misma textura y al teñir se tiñe todo |
| `aethelraed_unraed_cloche_hat` | 0,33 | 0,14 | no: estampado de camuflaje |
| conjuntos y piezas nuevas de calzado | | | no |

Teñir de blanco (#ffffff) deja la textura original, así que sirve como "sin teñir".

## Telas teñibles: `"desaturar": true`
Muchas prendas útiles no se podían teñir porque su textura es de un color fuerte u oscuro (el jersey rojo, el cargo casi negro). Con `"desaturar": true`, `crear_modular.py` convierte al exportar la textura de color (solo la del Base Color; normales y AO no se tocan) a gris claro conservando el relieve: calcula la luminancia lineal, la normaliza para que su media (ponderada por el área de la malla que usa cada zona de la textura) sea 0,68, comprime las luces desde 0,8 con una tanh para que el blanco no se queme y la guarda como gris. Se trabaja sobre una copia: el original de MPFB no se toca. `"gamma"` (menor que 1 aclara las sombras) y `"brillo"` (multiplicador final) son opcionales. La pieza se marca `"tinte": true`.

Sin teñir, una pieza desaturada sale gris claro. Por eso el exportador calcula el color medio original y se escribe en `piezas.json` como `"colorDefecto"` (llega al manifest): es el tinte que devuelve el aspecto original. **La aplicación debe teñir con `colorDefecto` cuando el personaje no tenga color elegido**; las miniaturas y las hojas de `vista.py` ya lo hacen (`tenir_defecto`). Se comprobaron con renders teñidos en azul marino, rojo, verde, beige, mostaza y burdeos (`docs/previews/ropa-nueva.png`).

| Pieza | colorDefecto | Notas |
|---|---|---|
| `toigo_fisherman_sweater` (jersey de punto) | #ac3b3b | conserva el punto |
| `cortu_cargo_pants` (cargo) | #272720 | |
| `cortu_jeans_shorts` (short vaquero) | #333b4b | |
| `toigo_camisole_top` (top de tirantes) | #ac5f8b | |
| `toigo_turtleneck_halter_top` (cuello alto) | #f098e7 | |
| `toigo_wool_pants` (pantalón de lana) | #4c4e50 | antes solo tonos oscuros |
| `wolgade_female_top_01` (top deportivo) | #c3daff | |
| `toigo_tiered_mini_skirt` / `toigo_tiered_skirt` (faldas de volantes) | #515151 / #eeaee7 | |
| `toigo_shift_dress`, `toigo_halter_dress_midi`, `toigo_halter_dress_knee_length` (vestidos) | #353535 / #741c2b / #6e1d1d | |

No se desaturaron los estampados (animal print, corsé con bordado, faldas escocesas y de flores, vestidos de flores), los conjuntos (sus vaqueros se quedan como están) ni el calzado.

## Brillo (`"mate": 0.8`)
Los trajes `toigo_male_double-breasted_suit`, `toigo_male_suit_3` y `toigo_female_double-breasted_suit` tienen un shininess alto en MPFB y salían como plástico. `"mate": 0.8` desconecta la rugosidad y el especular de sus mapas y fija esa rugosidad.

## Logotipos (`"sin_logo"`)
`female_casualsuit01`, `female_casualsuit02`, `male_casualsuit02` y `male_casualsuit04` llevaban el logotipo de MakeHuman en el pecho. `"sin_logo": {"zona": [x0,y0,x1,y1], "desde": [dx,dy]}` (fracciones de la textura, origen arriba a la izquierda) sustituye la zona por un trozo de tela lisa desplazado (dx, dy), copiado en la copia de la textura, así que conserva el grano. Se revisó de frente y de espalda en 4 cuerpos. Siguen con el mismo id. Quedan las franjas naranjas de las costuras (no son el logo).

## Paquetes de ropa añadidos (CC0)
Descargados de `https://files2.makehumancommunity.org/asset_packs/<paquete>/<paquete>_cc0.zip` y descomprimidos en la carpeta `data` de MPFB como bodyparts05 (se comprobó antes que el zip solo traía `clothes/` y `packs/`; `licencias.mjs` lee `packs/<paquete>.json`):
- `skirts01`: minifaldas escocesas 01 y 02, falda de flores (`toigo_skirt_with_lace_ruffle`), minifalda y falda larga de volantes. Hueco `piernas`, solo mujer.
- `dress01`: vestidos recto, largo halter, halter, de volantes, de encaje y de flores sin tirantes. Hueco `conjunto`, solo mujer.
- `suits01`: 4 trajes de hombre y 2 de mujer (cruzado y con falda). Hueco `conjunto`.
- `underwear01`: solo se usa `wolgade_female_top_01` (top deportivo). `underwear04` (calcetines) está instalado pero no se usa.
- `gloves01`: no se evaluó.

### Piezas descartadas de estos paquetes
- `toigo_long_full_skirt`: camuflaje verde y azul.
- `aethelraed_flapper_dress` (estampado y corte de época), `mindfront_kimono` (es una bata), `toigo_cut_out_dress` (leopardo), `toigo_halter_dress_with_fluted_skirt` y `toigo_keyhole_neck_dress` (cebra), `wdg_mycenaean_tunic` (túnica histórica), `toigo_camisole_dress_with_full_skirt` (falda con rayas lilas deformes).
- `toigo_female_suit_2` (fucsia) y `toigo_suit_with_dinner_jacket` (esmoquin blanco de gala).
- Ropa interior: pantis, medias y mangas de rejilla, tanga y braga no se añaden como piezas visibles (no encajan en los huecos y el editor ya exige torso a las mujeres).
- Calcetines (`underwear04`): el calzado ya lleva calcetín y el hueco `calzado` no admite combinación. Los calentadores (`toigo_leg_warmer_socks`) chocan con el pantalón.

## Licencias
Todas las piezas usadas son CC0 (sin obligación de dar crédito). `node tools/licencias.mjs` genera `docs/licencias-personajes.md` leyendo los registros de los paquetes instalados y **falla si aparece una pieza con otra licencia**, por ejemplo al añadir un paquete CC-BY.

## Hojas de revisión
- `docs/previews/miniaturas.png`: todas las miniaturas (cuerpos y piezas), la genera `miniaturas.py --hoja`.
- `docs/previews/ropa-nueva.png`: 25 atuendos con las faldas, vestidos, trajes y telas teñidas nuevas (`previsualizar_piezas.py --zona cuerpo` con `tinc_torso:RRGGBB`, `tinc_piernas:`, `tinc_conjunto:`).
- `docs/previews/piezas-nuevas.png`: barbas (con distintos tintes), gafas, sombreros (algunos teñidos) y peinados nuevos puestos sobre cuerpos distintos, hecha con `previsualizar_piezas.py --zona busto`.

## Pruebas
`npm run build && node tests/modular.mjs` abre la aplicación en un Chromium real (Playwright), recorre los cuerpos y todas las pestañas del editor, comprueba guardado y recarga, mide memoria tras 40 cambios y guarda capturas en `docs/previews/web/`. El Chromium de la prueba dibuja sin tarjeta gráfica, así que los fotogramas por segundo que mide no son representativos.

## Pendiente
- Gafas, barbas y tinte solo están comprobados en renders de Blender (Cycles), no en el navegador.
- Sin ropa interior visible: hay que obligar a elegir torso/conjunto y pantalón/conjunto en el editor.
- No comprobado en el navegador: el teñido de las telas desaturadas con `colorDefecto`, el aspecto mate de los trajes ni los trajes de hombre sobre cuerpos femeninos (y viceversa).

## Problemas conocidos
- Lucía con `female_casualsuit01` (su atuendo por defecto): dos manchas de piel en la espalda baja, donde el cuerpo atraviesa la camiseta. Ya estaba antes de las piezas nuevas y no se ha corregido.
- Botas altas (`grinsegold_female_pirate_boots`), bailarinas de leopardo (`toigo_flats`) y botines de tacón (`toigo_stiletto_booties`) funcionan pero pesan 0,7-1,3 MB por cuerpo y no se incluyen. Los modelos (20 cuerpos, 97 piezas, 1.320 combinaciones) ocupan unos 316 MB en total (antes 236 MB); cada cuerpo ronda 0,6-0,8 MB y cada pieza 0,03-0,57 MB. Si hubiera que recortar: quitar piezas poco usadas (cada pieza se exporta una vez por cuerpo del género al que va, o sea 10 copias si es solo de un género y 20 si es de ambos) o bajar a 512 px las texturas del pelo.
- Pequeños pliegues en el bajo del jersey de Iván y algo de volumen en la cintura del top corsé de Mei (se infla 12 mm para que el pantalón no asome).
- Fuentes alojadas en local, navegación con la URL y refactor de `src/app.tsx` en pantallas y componentes.
