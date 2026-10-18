import { makeRng, type Rng } from './layout'

/** Una conversación corta: las líneas se alternan entre las dos personas (la primera la dice quien tiene el índice 0). */
export interface Conversation {
  id: string
  lines: string[]
}

/**
 * Charlas ambientales de vecinos: breves, cotidianas y sin trama. No tienen nombres propios para valer con cualquier pareja,
 * y están pensadas para leerse en pocos segundos (son subtítulos, no diálogos del juego).
 */
export const CONVERSATIONS: Conversation[] = [
  { id: 'tiempo', lines: ['¡Qué buen día para pasear!', 'Sí, por fin ha salido el sol.', 'Con la semana de lluvia que llevamos…', 'Pues aprovechemos antes de que vuelva.'] },
  { id: 'cafe', lines: ['¿Tomamos algo en el café de la plaza?', 'Si el camarero no se ha quedado sin tostadas…', 'Siempre se queda, pero el café está buenísimo.', 'Vale, pero invitas tú.', 'Trato hecho.'] },
  { id: 'obras', lines: ['¿Has visto las obras de la esquina?', 'Llevan meses. Ya ni oigo el ruido.', 'A mí me despiertan a las ocho.', 'Dicen que acaban antes del verano.', 'Eso dijeron el verano pasado.'] },
  { id: 'panaderia', lines: ['Hoy la panadería huele que alimenta.', 'Pasé antes y ya no quedaban cruasanes.', '¡Cómo no! Hay que madrugar.', 'Mañana madrugo, te lo prometo.'] },
  { id: 'perro', lines: ['¿Has visto al perro del tercero?', 'El que se escapa cada tarde.', 'Ese. Vuelve solo, es más listo que todos nosotros.', 'Ya le podían dar un premio al barrio.'] },
  { id: 'futbol', lines: ['¿Viste el partido de anoche?', 'No me lo recuerdes, el árbitro fue una vergüenza.', 'Pues yo creo que el penalti era penalti.', 'Tú siempre tan imparcial…', 'Es mi equipo, ¡no me pidas imparcialidad!'] },
  { id: 'mercado', lines: ['En el mercado han traído unas naranjas muy buenas.', 'Ahora que lo dices, tengo la nevera vacía.', 'Vamos antes de comer y me cuentas.', 'Y compramos algo de pan.'] },
  { id: 'vecinos', lines: ['Los del quinto han pintado el portal.', 'Ya era hora, estaba hecho un desastre.', 'Les ha quedado de un verde un poco atrevido.', 'Mejor eso que el gris de antes.'] },
  { id: 'bici', lines: ['Me he comprado una bici para ir al trabajo.', '¿Y te atreves con el tráfico?', 'Voy por las calles tranquilas, tardo diez minutos más.', 'Pero llegas sin cabrearte. Eso no tiene precio.'] },
  { id: 'musica', lines: ['Anoche tocaban en el bar de la esquina.', '¿Sí? ¿Y qué tal?', 'Muy bien, un grupo de chavales del barrio.', 'La próxima vez me avisas y voy.', 'Hecho. Viernes, a las diez.'] },
  { id: 'calor', lines: ['Entre el calor y las cuestas, voy a necesitar un helado.', 'Conozco una heladería que abre hasta tarde.', '¿La de las cuatro esquinas?', 'Esa misma. La de pistacho es de otro mundo.'] },
  { id: 'trabajo', lines: ['¿Qué tal en el trabajo?', 'Mucho lío, pero no me quejo.', 'Al menos tienes plan para el fin de semana.', 'Dormir. Mi único plan es dormir.'] },
  { id: 'libreria', lines: ['He encontrado una librería pequeñita por aquí cerca.', '¿De las de olor a papel viejo?', 'Justo. Y el dueño te recomienda sin que se lo pidas.', 'Esas son las mejores. Llévame un día.'] },
  { id: 'jardin', lines: ['Mira cómo ha crecido el parque.', 'Han plantado flores nuevas junto a la fuente.', 'Da gusto pasear así.', 'Que no las pise nadie, por favor.'] },
  { id: 'lluvia', lines: ['Dicen que mañana vuelve a llover.', 'Siempre dicen lo mismo y luego hace sol.', 'Yo me llevo el paraguas por si acaso.', 'Y yo me quedo sin él y tentando a la suerte.'] },
  { id: 'cena', lines: ['¿Qué hacemos de cenar?', 'Algo rápido. ¿Una tortilla?', 'Siempre tortilla.', 'Es que no falla nunca.'] },
]

/** Segundos que se muestra una línea: lo que se tarda en leerla, con un mínimo. */
export function lineSeconds(text: string): number {
  return Math.max(2.2, 1.0 + text.length * 0.055)
}

/** Pausa entre una conversación y la siguiente, mientras la pareja sigue parada. */
const PAUSE_BETWEEN = 2.5

export interface SpokenLine {
  /** quién habla: 0 o 1 (el índice de la pareja) */
  speaker: 0 | 1
  text: string
  conversation: string
  /** línea actual dentro de la conversación y total de líneas */
  index: number
  total: number
}

/**
 * Lo que dicen dos vecinos que charlan: elige conversaciones al azar (con semilla, así que es reproducible), nunca repite
 * una de las últimas que ha dicho y las va diciendo línea a línea mientras se les avisa de que están hablando.
 */
export class PairDialogue {
  private readonly rng: Rng
  private readonly history: string[] = []
  private conversation: Conversation | null = null
  private lineIndex = 0
  private lineTimer = 0
  private pause = 0
  private readonly conversations: readonly Conversation[]
  /** cuántas conversaciones ha empezado (para las pruebas) */
  started = 0

  constructor(seed: number, conversations: readonly Conversation[] = CONVERSATIONS) {
    this.rng = makeRng(seed)
    this.conversations = conversations
  }

  /** Cuántas de las últimas conversaciones no se repiten: nunca más de la mitad de las que hay. */
  private get memory(): number {
    return Math.min(6, Math.floor(this.conversations.length / 2))
  }

  private pick(): Conversation {
    const candidates = this.conversations.filter((c) => !this.history.includes(c.id))
    const pool = candidates.length > 0 ? candidates : this.conversations
    const chosen = pool[Math.floor(this.rng() * pool.length)]
    this.history.push(chosen.id)
    while (this.history.length > this.memory) this.history.shift()
    this.started++
    return chosen
  }

  /** Quien habla primero en la conversación actual: se alterna para que no hable siempre la misma persona. */
  private firstSpeaker = 0

  /** Avanza `dt` segundos. Con `talking` en false (la pareja se ha ido a otro sitio) la conversación se corta. */
  update(dt: number, talking: boolean): SpokenLine | null {
    if (!talking) {
      this.conversation = null
      this.pause = 0
      return null
    }
    if (!this.conversation) {
      if (this.pause > 0) {
        this.pause -= dt
        return null
      }
      this.conversation = this.pick()
      this.lineIndex = 0
      this.lineTimer = 0
      this.firstSpeaker = (this.firstSpeaker + 1) % 2
    }
    const lines = this.conversation.lines
    this.lineTimer += dt
    if (this.lineTimer >= lineSeconds(lines[this.lineIndex])) {
      this.lineTimer = 0
      this.lineIndex++
      if (this.lineIndex >= lines.length) {
        this.conversation = null
        this.pause = PAUSE_BETWEEN
        return null
      }
    }
    return {
      speaker: ((this.lineIndex + this.firstSpeaker) % 2) as 0 | 1,
      text: lines[this.lineIndex],
      conversation: this.conversation.id,
      index: this.lineIndex,
      total: lines.length,
    }
  }
}
