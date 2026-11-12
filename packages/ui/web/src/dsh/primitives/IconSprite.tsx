import { ICON_SYMBOLS } from './icons/artwork.ts'

/** Hidden sprite required by the DSH product icons (`<use href="#dsw-icon-…">`). */
export function IconSprite() {
  return (
    <svg aria-hidden="true" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
      {Object.entries(ICON_SYMBOLS).map(([id, markup]) => (
        <symbol key={id} id={id} dangerouslySetInnerHTML={{ __html: markup }} />
      ))}
    </svg>
  )
}
