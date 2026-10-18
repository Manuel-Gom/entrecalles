/**
 * Matemática del paso, sin Three.js: dado el recorrido y la velocidad, calcula los ángulos de cada articulación.
 * Convenciones (sistema del personaje: X lateral, Y arriba, Z hacia delante), ángulos en radianes:
 *  - muslo, brazo: giro sobre X; positivo = hacia atrás
 *  - rodilla: positivo = flexiona (el pie va hacia atrás)
 *  - codo: positivo = flexiona (el antebrazo va hacia delante)
 *  - inclinación del tronco: positivo = hacia delante
 */

export const WALK_SPEED = 1.5
export const RUN_SPEED = 4.6

export interface GaitDims {
  /** largo del muslo y de la pantorrilla (de cadera a rodilla y de rodilla a tobillo), en metros */
  thigh: number
  shin: number
  /** altura de la cadera sobre el suelo */
  hipHeight: number
}

export interface GaitInput {
  /** ciclo completo de zancada (0-1); la pierna izquierda va por delante cuando sube de 0 a 0,25 */
  phase: number
  speed: number
  /** 0 de pie, 1 sentado */
  sit: number
  /** 0 callado, 1 hablando */
  talk: number
  /** segundos, para los pequeños movimientos de quien está parado */
  time: number
  /** número estable por personaje, para que no se muevan todos igual */
  seed: number
  /** velocidad de giro (rad/s): positivo = hacia su izquierda. Opcional: 0 */
  turn?: number
  /** altura de la superficie del asiento (m), si está sentado. Opcional: la de un banco de calle */
  seatHeight?: number
}

export interface GaitPose {
  thighL: number
  thighR: number
  kneeL: number
  kneeR: number
  footL: number
  footR: number
  armL: number
  armR: number
  /** apertura lateral del brazo (positivo = se separa del cuerpo) */
  armOutL: number
  armOutR: number
  elbowL: number
  elbowR: number
  spineLean: number
  spineTwist: number
  pelvisYaw: number
  pelvisRoll: number
  /** inclinación del tronco hacia el lado al que gira (giro sobre Z: negativo = hacia la izquierda) */
  spineRoll: number
  headPitch: number
  headYaw: number
  /** desplazamiento de la pelvis (metros): bajar, y echarla hacia atrás al sentarse */
  pelvisDrop: number
  pelvisBack: number
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smooth = (a: number, b: number, value: number) => {
  const t = clamp01((value - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** Cuánto es correr (0 = andando, 1 = corriendo a tope). */
export const runFactor = (speed: number) => smooth(WALK_SPEED * 1.15, RUN_SPEED * 0.9, speed)

/** Amplitud del paso (giro del muslo) según la velocidad, sin el recorte para velocidades bajas. */
export function swingAmplitude(speed: number): number {
  const run = runFactor(speed)
  const walk = lerp(0.14, 0.45, clamp01(speed / WALK_SPEED))
  return lerp(walk, 0.7, run)
}

/** Forma del vaivén de la pierna: casi lineal al pasar por la vertical, para que el pie de apoyo avance al ritmo del cuerpo. */
const SWING_SHAPE = 0.85
const shaped = (wave: number) => Math.asin(SWING_SHAPE * wave) / Math.asin(SWING_SHAPE)

/** Ciclos de zancada por metro recorrido. Andando, el paso es tan largo como lo que recorre el pie de apoyo hacia atrás
 * (así no resbala); al correr hay fase de vuelo y se alarga un poco. */
export function cyclesPerMeter(speed: number, dims: GaitDims): number {
  const reach = dims.thigh + dims.shin
  const step = 2 * reach * Math.sin(Math.max(0.2, swingAmplitude(speed)))
  return lerp(1, 0.78, runFactor(speed)) / (2 * step)
}

/** Extensión vertical de una pierna (cadera → tobillo) en el plano sagital. */
export function legExtent(thigh: number, knee: number, dims: GaitDims): number {
  return dims.thigh * Math.cos(thigh) + dims.shin * Math.cos(thigh + knee)
}

/** Posición horizontal del tobillo respecto a la cadera (positivo = delante). */
export function ankleForward(thigh: number, knee: number, dims: GaitDims): number {
  return -(dims.thigh * Math.sin(thigh) + dims.shin * Math.sin(thigh + knee))
}

interface LegAngles {
  thigh: number
  knee: number
  foot: number
  arm: number
}

function leg(phase: number, amplitude: number, kneeBend: number, armSwing: number): LegAngles {
  const angle = 2 * Math.PI * phase
  const forward = shaped(Math.sin(angle)) // 1 = pierna lo más adelantada posible
  const thigh = -amplitude * forward
  // la rodilla se flexiona mientras la pierna pasa hacia delante (cos > 0) y un poco al recibir el peso
  const swing = Math.max(0, Math.cos(angle + 0.35))
  // y se dobla un poco al apoyar el talón para amortiguar
  const knee = kneeBend * Math.pow(swing, 1.4) + 0.05 + 0.08 * kneeBend * Math.max(0, forward)
  const foot = -(thigh + knee) * 0.85
  // el brazo del mismo lado va hacia atrás cuando esta pierna va hacia delante
  return { thigh, knee, foot, arm: armSwing * forward }
}

export function computeGait(input: GaitInput, dims: GaitDims): GaitPose {
  const { speed, phase, time, seed } = input
  const run = runFactor(speed)
  const moving = smooth(0.05, 0.6, speed)
  const amplitude = swingAmplitude(speed) * moving
  const kneeBend = lerp(0.95, 1.75, run) * moving
  const armSwing = lerp(0.2, 0.9, run) * (0.5 + 0.5 * moving) * moving
  const left = leg(phase, amplitude, kneeBend, armSwing)
  const right = leg(phase + 0.5, amplitude, kneeBend, armSwing)

  // la pelvis baja lo justo para que la pierna de apoyo (la más extendida) llegue al suelo
  const extentL = legExtent(left.thigh, left.knee, dims)
  const extentR = legExtent(right.thigh, right.knee, dims)
  let pelvisDrop = Math.max(extentL, extentR) - (dims.thigh + dims.shin)
  // al correr hay un pequeño salto entre zancadas
  pelvisDrop += run * 0.035 * Math.abs(Math.cos(2 * Math.PI * phase * 2 + 1.2)) * moving

  const idleSway = Math.sin(time * 0.9 + seed * 6.1)
  const idleLook = Math.sin(time * 0.37 + seed * 3.3)
  const forwardPhase = Math.sin(2 * Math.PI * phase)

  const pose: GaitPose = {
    thighL: left.thigh,
    thighR: right.thigh,
    kneeL: left.knee,
    kneeR: right.knee,
    footL: left.foot,
    footR: right.foot,
    armL: left.arm - 0.18 * run * moving,
    armR: right.arm - 0.18 * run * moving,
    armOutL: lerp(0.06, 0.16, run),
    armOutR: lerp(0.06, 0.16, run),
    elbowL: lerp(0.18, 1.65, run) * moving + 0.08 * (1 - moving),
    elbowR: lerp(0.18, 1.65, run) * moving + 0.08 * (1 - moving),
    spineLean: lerp(0.04, 0.38, run) * moving,
    spineTwist: -0.16 * forwardPhase * moving * (0.6 + 0.4 * run),
    pelvisYaw: 0.1 * forwardPhase * moving * (0.6 + 0.4 * run),
    pelvisRoll: 0.03 * Math.cos(2 * Math.PI * phase) * moving,
    // al girar en marcha el cuerpo se inclina hacia dentro de la curva (más cuanto más rápido), y la cabeza se adelanta
    spineRoll: -Math.min(0.14, Math.max(-0.14, (input.turn ?? 0) * speed * 0.028)) * moving,
    headPitch: -lerp(0.03, 0.2, run) * moving,
    headYaw: idleLook * 0.12 * (1 - moving) + Math.min(0.35, Math.max(-0.35, (input.turn ?? 0) * 0.18)) * moving,
    pelvisDrop,
    pelvisBack: 0,
  }

  // parado: leve cambio de peso de una pierna a otra
  const still = 1 - moving
  pose.pelvisRoll += idleSway * 0.025 * still
  pose.thighL += idleSway * 0.03 * still
  pose.thighR -= idleSway * 0.03 * still
  pose.kneeL += 0.04 * still * Math.max(0, idleSway)
  pose.kneeR += 0.04 * still * Math.max(0, -idleSway)

  // hablando: gestos con la mano y cabeceo (solo si está parado)
  const talk = input.talk * still
  if (talk > 0) {
    const beat = Math.sin(time * 2.3 + seed * 9.7) * Math.sin(time * 0.7 + seed)
    pose.armR = lerp(pose.armR, -0.3 - 0.25 * Math.max(0, beat), talk)
    pose.elbowR = lerp(pose.elbowR, 1.25 + 0.25 * beat, talk)
    pose.armOutR = lerp(pose.armOutR, 0.3, talk)
    pose.armL = lerp(pose.armL, -0.1, talk)
    pose.elbowL = lerp(pose.elbowL, 0.5 + 0.25 * Math.max(0, -beat), talk)
    pose.headPitch += 0.05 * Math.sin(time * 3.1 + seed) * talk
    pose.spineTwist += 0.06 * beat * talk
  }

  // sentado: los muslos sobre el asiento, rodillas flexionadas, pelvis asentada sin levitar y pies planos
  const sit = input.sit
  if (sit > 0) {
    // la cadera queda ~4,5 cm sobre la superficie del asiento (0,505 m en un banco de 0,46 m) para que los glúteos descansen en la madera
    const drop = Math.max(0.2, dims.hipHeight - ((input.seatHeight ?? 0.46) + 0.045))
    // muslos un poco por debajo de la horizontal: acercan las rodillas al asiento y dejan caer la pelvis
    const thigh = -1.61
    const knee = 1.62
    pose.thighL = lerp(pose.thighL, thigh, sit)
    pose.thighR = lerp(pose.thighR, thigh, sit)
    pose.kneeL = lerp(pose.kneeL, knee, sit)
    pose.kneeR = lerp(pose.kneeR, knee, sit)
    pose.footL = lerp(pose.footL, -(thigh + knee), sit)
    pose.footR = lerp(pose.footR, -(thigh + knee), sit)

    // la pelvis desciende guiada por la longitud efectiva de las piernas para que los pies no atraviesen el suelo al sentarse ni levantarse
    const extent = legExtent(pose.thighL, pose.kneeL, dims)
    const footDrop = extent - (dims.thigh + dims.shin)
    pose.pelvisDrop = lerp(pose.pelvisDrop, -drop, sit)
    pose.pelvisDrop = Math.max(pose.pelvisDrop, footDrop)
    // 0.12 m lleva las caderas al fondo del asiento
    pose.pelvisBack = 0.12 * sit

    // postura relajada: espalda apoyada y antebrazos suavemente flexionados sobre los muslos
    pose.armL = lerp(pose.armL, -0.14, sit)
    pose.armR = lerp(pose.armR, -0.14, sit)
    pose.elbowL = lerp(pose.elbowL, 0.1, sit)
    pose.elbowR = lerp(pose.elbowR, 0.1, sit)
    pose.armOutL = lerp(pose.armOutL, -0.04, sit)
    pose.armOutR = lerp(pose.armOutR, -0.04, sit)
    pose.spineLean = lerp(pose.spineLean, -0.25, sit)
    pose.headPitch = lerp(pose.headPitch, 0.08, sit)
    pose.pelvisRoll *= 1 - sit
  }
  return pose
}
