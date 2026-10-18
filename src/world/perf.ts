/** Registro de lo que tarda cada fotograma, para medir el rendimiento real y compararlo entre calidades y equipos. */
export interface FrameSummary {
  frames: number
  fps: number
  avgMs: number
  /** el 1 % de los fotogramas más lentos: lo que se nota como tirones */
  p99Ms: number
  worstMs: number
}

export class FrameStats {
  private readonly samples: number[] = []
  private next = 0
  private readonly capacity: number

  constructor(capacity = 300) {
    this.capacity = capacity
  }

  /** `ms`: tiempo real entre dos fotogramas (sin recortar). */
  record(ms: number) {
    if (!Number.isFinite(ms) || ms <= 0) return
    if (this.samples.length < this.capacity) this.samples.push(ms)
    else this.samples[this.next] = ms
    this.next = (this.next + 1) % this.capacity
  }

  reset() {
    this.samples.length = 0
    this.next = 0
  }

  summary(): FrameSummary {
    const n = this.samples.length
    if (n === 0) return { frames: 0, fps: 0, avgMs: 0, p99Ms: 0, worstMs: 0 }
    const sorted = [...this.samples].sort((a, b) => a - b)
    const avg = sorted.reduce((sum, value) => sum + value, 0) / n
    return {
      frames: n,
      fps: 1000 / avg,
      avgMs: avg,
      p99Ms: sorted[Math.min(n - 1, Math.floor(n * 0.99))],
      worstMs: sorted[n - 1],
    }
  }
}

export interface DiagnosticsInfo {
  summary: FrameSummary
  quality: string
  width: number
  height: number
  pixelRatio: number
  device: string
  gpu: string
  triangles: number
  calls: number
  npcs: number
}

/** Texto para copiar y pegar al comparar mediciones. */
export function formatDiagnostics(info: DiagnosticsInfo): string {
  const { summary } = info
  return [
    `FPS medios: ${summary.fps.toFixed(0)} (${summary.avgMs.toFixed(1)} ms por fotograma, ${summary.frames} fotogramas)`,
    `Tirones (1 % más lento): ${summary.p99Ms.toFixed(1)} ms · peor: ${summary.worstMs.toFixed(1)} ms`,
    `Calidad: ${info.quality}`,
    `Resolución: ${info.width}×${info.height} px (escala ${info.pixelRatio.toFixed(2)})`,
    `Escena: ${info.triangles.toLocaleString('es')} triángulos · ${info.calls} llamadas de dibujo · ${info.npcs} vecinos`,
    `Dispositivo de entrada: ${info.device}`,
    `Tarjeta gráfica: ${info.gpu}`,
  ].join('\n')
}
