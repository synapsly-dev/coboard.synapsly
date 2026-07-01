/**
 * The Syna family "synapse" mark: three flat, ink nodes ascending small → large
 * with the middle node bowed off the chord. Draws in `currentColor` so the
 * consumer controls the colour (e.g. an ink tile with light foreground).
 * Geometry mirrors syna-core's Logo / favicon so coboard reads as one family.
 */
export function SynapseMark({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="Synapsly"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <g stroke="currentColor" strokeLinecap="round" fill="none">
        <line x1="15" y1="47" x2="49" y2="18" strokeWidth="1.5" opacity="0.26" />
        <line x1="15" y1="47" x2="29" y2="31" strokeWidth="2.8" opacity="0.6" />
        <line x1="29" y1="31" x2="49" y2="18" strokeWidth="2.8" opacity="0.6" />
      </g>
      <g fill="currentColor">
        <circle cx="15" cy="47" r="4" />
        <circle cx="29" cy="31" r="5.6" />
        <circle cx="49" cy="18" r="7.6" />
      </g>
    </svg>
  );
}
