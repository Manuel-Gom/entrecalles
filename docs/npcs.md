# Personajes no jugables (PNJ)

Catálogo de 160 diseños de personas de la ciudad (80 hombres y 80 mujeres), fuera de los personajes jugables. Cada PNJ es solo una lista de ids del catálogo de piezas (cuerpo, peinado, ropa, calzado, gafas, barba, colores): usa los mismos modelos que el editor y no añade archivos 3D nuevos.

```
public/data/npcs.json              catálogo (id, nombre, género, edad, estilo, oficio, aspecto)
public/npcs/retratos/<id>.webp     retrato de busto de cada PNJ (240×300)
tools/npcs/config.json             nombres, apellidos, estilos, oficios, etiquetas de piezas y paletas
tools/npcs/generar.mjs             generador (determinista: misma semilla, mismo resultado)
tools/revision/retratos.mjs                 crea los retratos con el visor 3D en un Chromium real
```

Para verlos: `#/pnj` en la aplicación (enlace "Galería de personajes no jugables" en el pie de página). Tiene filtros por género, estilo y edad, búsqueda por nombre u oficio y vista 3D del elegido.

## Cómo se generan
1. Se reparte el catálogo entre los 20 cuerpos (8 PNJ por cuerpo) alternando hombres y mujeres.
2. Para cada uno se elige un **estilo** según su edad (Casual, Urbano, Elegante, Deportivo, Trabajo, Verano, Noche, Clásico).
3. Se elige un atuendo cuyas prendas lleven la etiqueta de ese estilo (`etiquetas` en `config.json`; si una pieza nueva no tiene etiqueta, se deduce de las palabras de su nombre). Las prendas menos usadas tienen más probabilidad, para que no se repitan.
4. Se añaden calzado, sombrero, gafas, barba y peinado con probabilidades que dependen de la edad y del género; el color de pelo depende de la edad y el origen (canas en los mayores).
5. Las prendas teñibles reciben colores de la paleta del estilo (traje: neutros; deportivo: vivos…).
6. Se rechaza todo PNJ idéntico a otro o con el mismo cuerpo, peinado, ropa y calzado que otro.
7. Se le da un nombre (nombre y apellidos, sin repetir) y un oficio acorde al estilo y al género.

`config.json` tiene `excluir`: piezas que no se usan en PNJ (ahora, las que llevan el logotipo azul de MakeHuman), y `maxUsosPorPrenda`.

## Regenerar
```bash
npm run build
node tools/npcs/generar.mjs          # reescribe public/data/npcs.json
node tools/revision/retratos.mjs --todos      # rehace los 160 retratos (unos 5 minutos)
node tools/revision/retratos.mjs              # solo los que faltan
```
Cada vez que cambie el catálogo de piezas (nuevas prendas, tintes) conviene regenerar y rehacer los retratos. `npm run test:catalogo` (`tests/npcs.test.ts`) comprueba que hay entre 100 y 200 diseños, que no se repite ninguno, que los nombres son únicos, que hombres y mujeres están equilibrados, que cada aspecto es válido, que existe el retrato de cada uno y que `public/data/npcs.json` está al día con el generador.

## Límites conocidos
- La variedad visual depende de las piezas disponibles: hoy hay pocas prendas de tela lisa teñibles y los PNJ comparten algunas (camisas a rayas, jerséis rojos, pantalón cargo). Más piezas CC0 (faldas, vestidos, trajes) y más telas teñibles mejorarían mucho el resultado.
- Los oficios son orientativos: no hay uniformes (médico, policía…).
- Solo hay 2 cuerpos «mayores» (Ramón y Rosa), así que los PNJ de edad avanzada son pocos (unos 17).
