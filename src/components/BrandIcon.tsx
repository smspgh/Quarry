/**
 * Quarry mark: code braces crossed by a shovel on a blue tile. `public/quarry.svg` is the source of
 * the app icon (src-tauri/icons) and the favicon; the tile carries its own colours, so it reads on
 * light and dark backgrounds alike.
 */
export function BrandIcon({ size = 18 }: { size?: number }) {
  return <img src="/quarry.svg" width={size} height={size} alt="" aria-hidden draggable={false} className="brand-icon" />;
}
