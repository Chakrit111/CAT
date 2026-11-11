/**
 * Where the running wheel and the pet inside it go, for a square window of edge `size` (any unit:
 * DIP in the main process, device pixels in the renderer). Shared so that what the renderer draws
 * and what the main process hit-tests are the same shape.
 */
export interface WheelGeometry {
  cx: number;
  cy: number;
  /** Radius of the rim's centre line. */
  radius: number;
  /** Thickness of the rim. */
  ring: number;
  /** The pet's frame, drawn `scale` times smaller with its feet on the inside of the rim. */
  spriteX: number;
  spriteY: number;
  spriteSize: number;
}

/**
 * @param floor   where the pet's feet go, fraction of `size` from the top (0.9325 = on the inside of
 *                the drawn rim)
 * @param centerX the pet's horizontal centre, fraction of `size`
 */
export function wheelGeometry(size: number, scale: number, floor = 0.9325, centerX = 0.5): WheelGeometry {
  const radius = 0.46 * size;
  const spriteSize = size * scale;
  return {
    cx: size / 2,
    cy: 0.95 * size - radius,
    radius,
    ring: 0.035 * size,
    spriteX: centerX * size - spriteSize / 2,
    spriteY: floor * size - spriteSize,
    spriteSize,
  };
}
