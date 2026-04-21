/**
 * TurboIcon — custom centrifugal compressor wheel icon.
 * Matches lucide-react API: accepts size and className props.
 * 6 swept-back blades inside a housing ring, with a center hub.
 */
export default function TurboIcon({ size = 24, className = '' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Outer housing ring */}
      <circle cx="12" cy="12" r="10" />

      {/*
        6 swept-back compressor blades — quadratic bezier curves.
        Each blade root is at r=3.2 from center, tip at r=9, swept +35° forward.
        Blade roots at 0°, 60°, 120°, 180°, 240°, 300°.
      */}

      {/* Blade 1 — root at 0° (right), tip sweeps to 35° */}
      <path d="M15.2 12Q17.8 13.6 19.4 17.2" />

      {/* Blade 2 — root at 60°, tip sweeps to 95° */}
      <path d="M13.6 14.8Q13.6 17.8 11.2 21" />

      {/* Blade 3 — root at 120°, tip sweeps to 155° */}
      <path d="M10.4 14.8Q7.8 16.2 3.8 15.8" />

      {/* Blade 4 — root at 180° (left), tip sweeps to 215° */}
      <path d="M8.8 12Q6.2 10.5 4.6 6.8" />

      {/* Blade 5 — root at 240°, tip sweeps to 275° */}
      <path d="M10.4 9.2Q10.5 6.2 12.8 3" />

      {/* Blade 6 — root at 300°, tip sweeps to 335° */}
      <path d="M13.6 9.2Q16.2 7.8 20.2 8.2" />

      {/* Center hub */}
      <circle cx="12" cy="12" r="2.2" />
    </svg>
  )
}
