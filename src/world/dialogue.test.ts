import { describe, expect, it } from 'vitest'
import { CONVERSATIONS, PairDialogue, lineSeconds, type Conversation, type SpokenLine } from './dialogue'

const DT = 0.1

/** Deja hablar a una pareja `seconds` segundos y devuelve cada línea nueva que se oye. */
function listen(dialogue: PairDialogue, seconds: number) {
  const heard: SpokenLine[] = []
  let last = ''
  for (let t = 0; t < seconds; t += DT) {
    const line = dialogue.update(DT, true)
    if (line && `${line.conversation}:${line.index}` !== last) {
      heard.push(line)
      last = `${line.conversation}:${line.index}`
    }
  }
  return heard
}

describe('las conversaciones', () => {
  it('hay variedad: al menos 12, con ids distintos', () => {
    expect(CONVERSATIONS.length).toBeGreaterThanOrEqual(12)
    expect(new Set(CONVERSATIONS.map((c) => c.id)).size).toBe(CONVERSATIONS.length)
  })

  it('son breves (3 a 6 líneas de menos de 80 caracteres) y están bien escritas', () => {
    for (const { id, lines } of CONVERSATIONS) {
      expect(lines.length, id).toBeGreaterThanOrEqual(3)
      expect(lines.length, id).toBeLessThanOrEqual(6)
      for (const line of lines) {
        expect(line.length, `${id}: "${line}"`).toBeGreaterThan(8)
        expect(line.length, `${id}: "${line}"`).toBeLessThan(80)
        expect(line, id).toMatch(/[.!?…]$/)
        // los signos de apertura del español van con su cierre
        expect((line.match(/¿/g) ?? []).length, `${id}: ${line}`).toBe((line.match(/\?/g) ?? []).length)
        expect((line.match(/¡/g) ?? []).length, `${id}: ${line}`).toBe((line.match(/!/g) ?? []).length)
        expect(line, `${id}: ${line}`).not.toMatch(/\s{2,}|^\s|\s$/)
      }
    }
  })

  it('no repiten líneas entre conversaciones', () => {
    const all = CONVERSATIONS.flatMap((c) => c.lines)
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('lineSeconds', () => {
  it('es el tiempo de leerla, con un mínimo, y crece con la longitud', () => {
    expect(lineSeconds('Hola.')).toBe(2.2)
    expect(lineSeconds('x'.repeat(60))).toBeGreaterThan(lineSeconds('x'.repeat(30)))
    expect(lineSeconds('x'.repeat(79))).toBeLessThan(6)
  })
})

describe('PairDialogue', () => {
  it('dice las líneas de una conversación en orden, cada una el tiempo que se tarda en leerla', () => {
    const dialogue = new PairDialogue(3)
    const heard = listen(dialogue, 60)
    const first = CONVERSATIONS.find((c) => c.id === heard[0].conversation)!
    expect(heard.slice(0, first.lines.length).map((line) => line.text)).toEqual(first.lines)
    expect(heard[0].index).toBe(0)
    expect(heard[0].total).toBe(first.lines.length)
  })

  it('los dos se alternan al hablar', () => {
    const heard = listen(new PairDialogue(4), 30)
    const firstConversation = heard.filter((line) => line.conversation === heard[0].conversation)
    firstConversation.forEach((line, i) => expect(line.speaker).toBe(i % 2 === 0 ? heard[0].speaker : 1 - heard[0].speaker))
  })

  it('quien empieza cambia de una conversación a la siguiente', () => {
    const heard = listen(new PairDialogue(5), 200)
    const starters = heard.filter((line) => line.index === 0).map((line) => line.speaker)
    expect(starters.length).toBeGreaterThan(2)
    starters.slice(1).forEach((speaker, i) => expect(speaker).not.toBe(starters[i]))
  })

  it('entre una conversación y la siguiente hay un silencio', () => {
    const dialogue = new PairDialogue(6)
    let silent = 0
    let maxSilent = 0
    let seenAny = false
    for (let t = 0; t < 120; t += DT) {
      const line = dialogue.update(DT, true)
      if (line) {
        seenAny = true
        silent = 0
      } else if (seenAny) {
        silent += DT
        maxSilent = Math.max(maxSilent, silent)
      }
    }
    expect(maxSilent).toBeGreaterThan(2)
    expect(maxSilent).toBeLessThan(3.5)
  })

  it('no repite una conversación hasta que han salido otras', () => {
    const dialogue = new PairDialogue(7)
    const order = listen(dialogue, 1500).filter((line) => line.index === 0).map((line) => line.conversation)
    expect(order.length).toBeGreaterThan(20)
    const window = Math.min(6, Math.floor(CONVERSATIONS.length / 2))
    order.forEach((id, i) => {
      for (let back = 1; back <= window - 1 && i - back >= 0; back++) expect(order[i - back], `repetida a las ${back} anteriores`).not.toBe(id)
    })
    // y tampoco hay dos seguidas iguales
    order.slice(1).forEach((id, i) => expect(id).not.toBe(order[i]))
  })

  it('con pocas conversaciones también evita repetir la anterior', () => {
    const two: Conversation[] = [
      { id: 'a', lines: ['Primera línea de a.', 'Segunda línea de a.', 'Tercera línea de a.'] },
      { id: 'b', lines: ['Primera línea de b.', 'Segunda línea de b.', 'Tercera línea de b.'] },
    ]
    const order = listen(new PairDialogue(1, two), 300).filter((line) => line.index === 0).map((line) => line.conversation)
    expect(order.length).toBeGreaterThan(5)
    order.slice(1).forEach((id, i) => expect(id).not.toBe(order[i]))
  })

  it('si la pareja deja de hablar, la conversación se corta, y al volver empieza otra', () => {
    const dialogue = new PairDialogue(8)
    const first = dialogue.update(DT, true)!
    for (let t = 0; t < 5; t += DT) dialogue.update(DT, true)
    expect(dialogue.update(DT, false)).toBeNull()
    const again = dialogue.update(DT, true)!
    expect(again.index).toBe(0)
    expect(again.conversation).not.toBe(first.conversation)
  })

  it('es reproducible: la misma semilla dice lo mismo; otra, distinto', () => {
    const texts = (seed: number) => listen(new PairDialogue(seed), 120).map((line) => line.text)
    expect(texts(11)).toEqual(texts(11))
    expect(texts(11)).not.toEqual(texts(12))
  })

  it('no dice nada si nadie habla', () => {
    const dialogue = new PairDialogue(9)
    for (let t = 0; t < 30; t += DT) expect(dialogue.update(DT, false)).toBeNull()
    expect(dialogue.started).toBe(0)
  })
})
