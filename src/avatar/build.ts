import { AvatarAssembly } from './assembler'
import { isOptional, SLOTS, TINT_SLOTS, tintFor, visiblePieces, type AvatarSpec, type Catalog, type Slot } from './catalog'

/**
 * Monta el aspecto completo de un personaje (cuerpo + todas sus piezas teñidas).
 * Devuelve null si `isCurrent()` pasa a ser falso mientras carga (la petición quedó obsoleta);
 * en ese caso, y si algo falla, libera lo que hubiera cargado.
 */
export async function buildAssembly(
  spec: AvatarSpec,
  catalog: Catalog,
  isCurrent: () => boolean = () => true,
): Promise<AvatarAssembly | null> {
  const wanted = visiblePieces(spec, catalog)
  let staging: AvatarAssembly | null = null
  try {
    staging = await AvatarAssembly.create(spec.cuerpo)
    staging.setHairColor(spec.colorPelo ?? null)
    for (const slot of TINT_SLOTS) staging.setPieceColor(slot, tintFor(spec, catalog, slot))

    const results = await Promise.allSettled(
      SLOTS.map((slot) => staging!.setPiece(slot, wanted[slot] ?? null, isCurrent)),
    )
    if (!isCurrent()) {
      staging.dispose()
      return null
    }
    const failedPiece = results.find((result) => result.status === 'rejected')
    if (failedPiece?.status === 'rejected') throw failedPiece.reason

    const body = catalog.cuerpos.find((item) => item.id === spec.cuerpo)
    const requiredSlots: Slot[] = wanted.conjunto
      ? ['conjunto', 'calzado']
      : ['piernas', 'calzado', ...(!isOptional('torso', body) ? ['torso' as const] : [])]
    const missingRequired = requiredSlots.filter((slot) => {
      const id = wanted[slot]
      return !id || staging!.pieceId(slot) !== id
    })
    if (missingRequired.length > 0) {
      throw new Error(`Faltan prendas obligatorias: ${missingRequired.join(', ')}`)
    }
    return staging
  } catch (error) {
    staging?.dispose()
    throw error
  }
}
