import { lazy, Suspense, useEffect, useRef, useState } from 'react'

// Split into its own chunk: the 3D renderer is only fetched on devices that
// will actually run it, and never blocks the app shell.
const ShipScene3D = lazy(() => import('./ShipScene3D'))

/** True when real-time 3D is both supported and appropriate here. */
function canRender3D(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  const conn = (navigator as { connection?: { saveData?: boolean } }).connection
  if (conn?.saveData) return false
  const mem = (navigator as { deviceMemory?: number }).deviceMemory
  if (typeof mem === 'number' && mem < 2) return false
  try {
    const probe = document.createElement('canvas')
    return !!(probe.getContext('webgl2') || probe.getContext('webgl'))
  } catch {
    return false
  }
}

/**
 * Cinematic deep-space scene behind the landing hero.
 *
 * Layers, back to front:
 *  1. Canvas — three parallax star depths, tumbling debris, shooting stars.
 *  2. Nebula glows and a capital ship far enough back to read as kilometres away.
 *  3. Traffic — original ship designs banking across on varied paths with
 *     afterburner bloom, plus quantum streaks.
 *  4. HUD chrome — corner brackets, a tracking reticle, scanlines, vignette.
 *
 * Pointer movement shifts each layer by a different amount for depth. All of
 * it is inert under prefers-reduced-motion: the canvas paints one static frame
 * and the moving craft are hidden in CSS.
 */

type Star = { x: number; y: number; z: number; tw: number }

type Debris = {
  x: number
  y: number
  z: number
  rot: number
  spin: number
  size: number
  pts: number[]
}

type Meteor = { x: number; y: number; vx: number; vy: number; life: number; max: number }

function SceneCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let stars: Star[] = []
    let debris: Debris[] = []
    let meteor: Meteor | null = null
    let nextMeteorAt = performance.now() + 2500 + Math.random() * 4000
    let width = 0
    let height = 0

    function makeDebris(w: number, h: number): Debris {
      // Irregular chunk: radii jittered around a circle so no two repeat.
      const pts = Array.from({ length: 7 }, () => 0.55 + Math.random() * 0.5)
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        z: 0.25 + Math.random() * 0.75,
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.006,
        size: 2 + Math.random() * 7,
        pts,
      }
    }

    function resize() {
      if (!canvas || !ctx) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const starCount = Math.min(220, Math.floor((width * height) / 7000))
      stars = Array.from({ length: starCount }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        z: Math.random(),
        tw: Math.random() * Math.PI * 2,
      }))
      const debrisCount = Math.min(26, Math.floor((width * height) / 60000))
      debris = Array.from({ length: debrisCount }, () => makeDebris(width, height))
    }

    function drawFrame(t: number) {
      if (!ctx) return
      ctx.clearRect(0, 0, width, height)

      for (const s of stars) {
        if (!reduced) {
          s.x -= 0.03 + s.z * 0.14
          if (s.x < -2) {
            s.x = width + 2
            s.y = Math.random() * height
          }
        }
        const twinkle = reduced ? 0.8 : 0.5 + 0.5 * Math.sin(s.tw + t / (600 + s.z * 800))
        const r = 0.4 + s.z * 1.5
        ctx.beginPath()
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
        ctx.fillStyle =
          s.z > 0.9
            ? `rgba(196, 181, 253, ${0.6 * twinkle})`
            : `rgba(255, 255, 255, ${(0.28 + s.z * 0.6) * twinkle})`
        ctx.fill()
        // Brightest stars get a cross-flare so the field reads as lit, not dotted.
        if (s.z > 0.86) {
          const g = 0.35 * twinkle
          ctx.strokeStyle = `rgba(191, 219, 254, ${g})`
          ctx.lineWidth = 0.7
          const len = 2.5 + s.z * 4
          ctx.beginPath()
          ctx.moveTo(s.x - len, s.y)
          ctx.lineTo(s.x + len, s.y)
          ctx.moveTo(s.x, s.y - len)
          ctx.lineTo(s.x, s.y + len)
          ctx.stroke()
        }
      }

      for (const d of debris) {
        if (!reduced) {
          d.x -= 0.15 + d.z * 0.85
          d.rot += d.spin
          if (d.x < -30) {
            d.x = width + 30
            d.y = Math.random() * height
          }
        }
        const r = d.size * (0.5 + d.z)
        ctx.save()
        ctx.translate(d.x, d.y)
        ctx.rotate(d.rot)
        ctx.beginPath()
        d.pts.forEach((mult, i) => {
          const a = (i / d.pts.length) * Math.PI * 2
          const px = Math.cos(a) * r * mult
          const py = Math.sin(a) * r * mult
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        })
        ctx.closePath()
        ctx.fillStyle = `rgba(51, 65, 85, ${0.25 + d.z * 0.4})`
        ctx.fill()
        ctx.strokeStyle = `rgba(148, 163, 184, ${0.12 + d.z * 0.18})`
        ctx.lineWidth = 0.8
        ctx.stroke()
        ctx.restore()
      }

      if (!reduced) {
        if (!meteor && t > nextMeteorAt) {
          const fromLeft = Math.random() < 0.5
          meteor = {
            x: fromLeft ? -20 : Math.random() * width * 0.7 + width * 0.3,
            y: Math.random() * height * 0.5,
            vx: (fromLeft ? 1 : 0.85) * (9 + Math.random() * 7),
            vy: 3 + Math.random() * 2.5,
            life: 70,
            max: 70,
          }
        }
        if (meteor) {
          const m = meteor
          const fade = m.life / m.max
          const grad = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 9, m.y - m.vy * 9)
          grad.addColorStop(0, `rgba(255, 255, 255, ${0.95 * fade})`)
          grad.addColorStop(0.4, `rgba(165, 180, 252, ${0.5 * fade})`)
          grad.addColorStop(1, 'rgba(165, 180, 252, 0)')
          ctx.strokeStyle = grad
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(m.x, m.y)
          ctx.lineTo(m.x - m.vx * 9, m.y - m.vy * 9)
          ctx.stroke()
          m.x += m.vx
          m.y += m.vy
          m.life -= 1
          if (m.life <= 0 || m.x > width + 60 || m.y > height + 60) {
            meteor = null
            nextMeteorAt = t + 3500 + Math.random() * 7000
          }
        }
      }
    }

    function loop(t: number) {
      if (!document.hidden) drawFrame(t)
      raf = requestAnimationFrame(loop)
    }

    resize()
    window.addEventListener('resize', resize)
    if (reduced) drawFrame(0)
    else raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
}

/* =============================================================================
   ORIGINAL SHIP DESIGNS — ours, not CIG assets.
   ========================================================================== */

function InterceptorSvg({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 80" className={className} aria-hidden>
      <defs>
        <linearGradient id="nn-hull-a" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#94a3b8" />
          <stop offset="0.4" stopColor="#475569" />
          <stop offset="1" stopColor="#0f172a" />
        </linearGradient>
        <linearGradient id="nn-exh-a" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="rgba(186,230,253,1)" />
          <stop offset="0.25" stopColor="rgba(56,189,248,0.75)" />
          <stop offset="1" stopColor="rgba(56,189,248,0)" />
        </linearGradient>
        <radialGradient id="nn-nozzle-a" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.4" stopColor="#7dd3fc" />
          <stop offset="1" stopColor="rgba(56,189,248,0)" />
        </radialGradient>
      </defs>

      <rect x="-96" y="29.5" width="122" height="9" rx="4.5" fill="url(#nn-exh-a)" />
      <rect x="-80" y="42.5" width="106" height="7.5" rx="3.75" fill="url(#nn-exh-a)" opacity="0.85" />

      <path d="M62 46 L44 72 L58 70 L78 48 Z" fill="#1e293b" />
      <path
        d="M24 34 L48 24 L118 18 L196 26 L234 38 L196 50 L118 54 L48 50 Z"
        fill="url(#nn-hull-a)"
      />
      <path d="M78 24 L96 4 L108 6 L98 22 Z" fill="#334155" />
      <path d="M60 27 L150 22 L196 28 L150 32 Z" fill="#64748b" opacity="0.9" />
      <path d="M70 44 L150 46 L120 52 L80 50 Z" fill="#020617" opacity="0.6" />

      <g stroke="#020617" strokeWidth="0.9" opacity="0.55" fill="none">
        <path d="M64 28 L64 48" />
        <path d="M96 24 L96 51" />
        <path d="M132 21 L132 52" />
        <path d="M168 24 L168 50" />
        <path d="M48 26 L196 30" />
      </g>
      <path d="M100 36 L160 37 L158 40 L102 39 Z" fill="#020617" opacity="0.3" />
      <path d="M118 20 L150 21 L150 24 L118 23 Z" fill="#f97316" opacity="0.5" />

      <path d="M176 26 L206 30 L212 37 L200 42 L176 40 Z" fill="#22d3ee" opacity="0.95" />
      <path d="M180 28 L202 31 L205 34 L182 32 Z" fill="#ecfeff" opacity="0.85" />

      <circle cx="27" cy="33.5" r="8" fill="url(#nn-nozzle-a)" />
      <circle cx="28" cy="46" r="7" fill="url(#nn-nozzle-a)" />
      <path d="M54 38 L74 36 L74 42 L54 43 Z" fill="#020617" opacity="0.85" />

      <circle className="nn-strobe" cx="102" cy="5" r="2.2" fill="#f87171" />
      <circle className="nn-strobe-slow" cx="46" cy="70" r="2" fill="#ffffff" />
    </svg>
  )
}

function FreighterSvg({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 340 100" className={className} aria-hidden>
      <defs>
        <linearGradient id="nn-hull-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#78716c" />
          <stop offset="0.5" stopColor="#44403c" />
          <stop offset="1" stopColor="#0c0a09" />
        </linearGradient>
        <linearGradient id="nn-exh-b" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="rgba(221,214,254,1)" />
          <stop offset="0.3" stopColor="rgba(167,139,250,0.65)" />
          <stop offset="1" stopColor="rgba(167,139,250,0)" />
        </linearGradient>
        <radialGradient id="nn-nozzle-b" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.4" stopColor="#c4b5fd" />
          <stop offset="1" stopColor="rgba(167,139,250,0)" />
        </radialGradient>
      </defs>

      <rect x="-110" y="33" width="136" height="10" rx="5" fill="url(#nn-exh-b)" />
      <rect x="-96" y="47" width="122" height="10" rx="5" fill="url(#nn-exh-b)" opacity="0.9" />
      <rect x="-82" y="61" width="108" height="9" rx="4.5" fill="url(#nn-exh-b)" opacity="0.75" />

      <path d="M30 40 L60 32 L300 34 L332 48 L300 64 L60 66 Z" fill="url(#nn-hull-b)" />

      <g>
        <rect x="82" y="24" width="34" height="24" rx="2" fill="#3f3f46" />
        <rect x="120" y="24" width="34" height="24" rx="2" fill="#57534e" />
        <rect x="158" y="24" width="34" height="24" rx="2" fill="#3f3f46" />
        <rect x="196" y="24" width="34" height="24" rx="2" fill="#57534e" />
        <rect x="82" y="52" width="34" height="22" rx="2" fill="#57534e" />
        <rect x="120" y="52" width="34" height="22" rx="2" fill="#3f3f46" />
        <rect x="158" y="52" width="34" height="22" rx="2" fill="#57534e" />
        <rect x="196" y="52" width="34" height="22" rx="2" fill="#3f3f46" />
        <g stroke="#0c0a09" strokeWidth="1.1" opacity="0.75">
          <path d="M99 24 L99 48 M137 24 L137 48 M175 24 L175 48 M213 24 L213 48" />
          <path d="M99 52 L99 74 M137 52 L137 74 M175 52 L175 74 M213 52 L213 74" />
        </g>
        <rect x="84" y="27" width="10" height="3" rx="1" fill="#fbbf24" opacity="0.45" />
        <rect x="160" y="55" width="10" height="3" rx="1" fill="#fbbf24" opacity="0.45" />
      </g>

      <path d="M238 26 L282 28 L300 40 L300 58 L282 68 L238 70 Z" fill="#78716c" />
      <path d="M262 34 L292 40 L292 46 L262 42 Z" fill="#22d3ee" opacity="0.9" />
      <path d="M264 36 L286 40 L286 42 L264 39 Z" fill="#ecfeff" opacity="0.75" />

      <path d="M30 36 L58 30 L58 70 L30 64 Z" fill="#1c1917" />
      <circle cx="33" cy="38" r="8.5" fill="url(#nn-nozzle-b)" />
      <circle cx="32" cy="52" r="9" fill="url(#nn-nozzle-b)" />
      <circle cx="33" cy="65" r="7.5" fill="url(#nn-nozzle-b)" />

      <g stroke="#0c0a09" strokeWidth="1" opacity="0.55" fill="none">
        <path d="M64 40 L296 42" />
        <path d="M64 58 L296 60" />
      </g>
      <path d="M90 44 L200 46 L198 50 L92 48 Z" fill="#000000" opacity="0.35" />

      <g fill="#fbbf24" opacity="0.9">
        <circle cx="90" cy="50" r="1.4" />
        <circle cx="130" cy="50" r="1.4" />
        <circle cx="170" cy="50" r="1.4" />
        <circle cx="210" cy="50" r="1.4" />
      </g>

      <circle className="nn-strobe" cx="332" cy="48" r="2.4" fill="#4ade80" />
      <circle className="nn-strobe-slow" cx="30" cy="40" r="2.2" fill="#f87171" />
    </svg>
  )
}

function GunshipSvg({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 70" className={className} aria-hidden>
      <defs>
        <linearGradient id="nn-hull-c" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6b7280" />
          <stop offset="0.5" stopColor="#374151" />
          <stop offset="1" stopColor="#030712" />
        </linearGradient>
        <linearGradient id="nn-exh-c" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="rgba(250,232,255,1)" />
          <stop offset="0.3" stopColor="rgba(232,121,249,0.6)" />
          <stop offset="1" stopColor="rgba(217,70,239,0)" />
        </linearGradient>
        <radialGradient id="nn-nozzle-c" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.4" stopColor="#f0abfc" />
          <stop offset="1" stopColor="rgba(232,121,249,0)" />
        </radialGradient>
      </defs>

      <rect x="-76" y="29.5" width="98" height="7.5" rx="3.75" fill="url(#nn-exh-c)" />
      <rect x="-64" y="40.5" width="86" height="6.5" rx="3.25" fill="url(#nn-exh-c)" opacity="0.85" />

      <circle cx="96" cy="20" r="7.5" fill="#374151" />
      <rect x="96" y="16" width="24" height="3.5" rx="1.5" fill="#111827" />
      <rect x="96" y="21" width="24" height="3.5" rx="1.5" fill="#111827" />

      <path
        d="M22 32 L44 22 L120 18 L168 26 L194 36 L168 48 L120 54 L44 50 Z"
        fill="url(#nn-hull-c)"
      />
      <path d="M158 26 L186 35 L158 46 L150 44 L172 36 L150 28 Z" fill="#111827" />
      <path d="M56 48 L84 50 L80 62 L60 60 Z" fill="#111827" />
      <circle cx="60" cy="56" r="4" fill="url(#nn-nozzle-c)" />

      <path d="M126 26 L156 30 L156 36 L126 34 Z" fill="#22d3ee" opacity="0.9" />
      <path d="M128 27 L150 30 L150 32 L128 30 Z" fill="#ecfeff" opacity="0.7" />
      <path d="M96 28 L126 29 L126 32 L96 31 Z" fill="#f97316" opacity="0.45" />

      <g stroke="#020617" strokeWidth="0.9" opacity="0.55" fill="none">
        <path d="M72 22 L72 50" />
        <path d="M104 19 L104 53" />
        <path d="M140 22 L140 50" />
      </g>

      <circle cx="25" cy="33" r="6.5" fill="url(#nn-nozzle-c)" />
      <circle cx="26" cy="43.5" r="5.5" fill="url(#nn-nozzle-c)" />

      <circle className="nn-strobe" cx="96" cy="12" r="2" fill="#f87171" />
      <circle className="nn-strobe-slow" cx="194" cy="36" r="2" fill="#4ade80" />
    </svg>
  )
}

function CapitalSvg({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 480 90" className={className} aria-hidden>
      <defs>
        <linearGradient id="nn-hull-d" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1e293b" />
          <stop offset="1" stopColor="#020617" />
        </linearGradient>
        <radialGradient id="nn-nozzle-d" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#e0f2fe" />
          <stop offset="0.55" stopColor="rgba(56,189,248,0.55)" />
          <stop offset="1" stopColor="rgba(56,189,248,0)" />
        </radialGradient>
      </defs>

      <path d="M14 46 L70 34 L360 28 L470 44 L360 62 L70 58 Z" fill="url(#nn-hull-d)" />
      <path d="M150 30 L300 26 L330 34 L160 36 Z" fill="#16213a" />
      <path d="M250 14 L282 12 L290 28 L252 30 Z" fill="#1e293b" />
      <path d="M110 56 L330 54 L300 66 L140 64 Z" fill="#020617" />

      <circle cx="18" cy="42" r="7" fill="url(#nn-nozzle-d)" />
      <circle cx="16" cy="50" r="8" fill="url(#nn-nozzle-d)" />
      <circle cx="19" cy="57" r="6" fill="url(#nn-nozzle-d)" />

      <g fill="#93c5fd" opacity="0.8">
        {Array.from({ length: 22 }, (_, i) => (
          <rect key={`w1-${i}`} x={92 + i * 13} y={40} width={3.4} height={1.8} rx={0.5} />
        ))}
        {Array.from({ length: 17 }, (_, i) => (
          <rect key={`w2-${i}`} x={120 + i * 13} y={48} width={3.4} height={1.8} rx={0.5} />
        ))}
        {Array.from({ length: 3 }, (_, i) => (
          <rect key={`w3-${i}`} x={258 + i * 9} y={18} width={3} height={2} rx={0.5} />
        ))}
      </g>

      <circle className="nn-strobe-slow" cx="470" cy="44" r="2.2" fill="#ffffff" />
      <circle className="nn-strobe" cx="268" cy="10" r="2" fill="#f87171" />
    </svg>
  )
}

/** Corner brackets + tracking reticle + scanlines: the HUD read. */
function HudChrome() {
  return (
    <div className="nn-hud" aria-hidden>
      <svg className="nn-hud-corner nn-hud-tl" viewBox="0 0 60 60">
        <path d="M2 22 L2 2 L22 2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M2 30 L2 38" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      </svg>
      <svg className="nn-hud-corner nn-hud-tr" viewBox="0 0 60 60">
        <path d="M58 22 L58 2 L38 2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M58 30 L58 38" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      </svg>
      <svg className="nn-hud-corner nn-hud-bl" viewBox="0 0 60 60">
        <path d="M2 38 L2 58 L22 58" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <svg className="nn-hud-corner nn-hud-br" viewBox="0 0 60 60">
        <path d="M58 38 L58 58 L38 58" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>

      <div className="nn-reticle">
        <svg viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="26" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.55" />
          <path
            d="M40 6 L40 16 M40 64 L40 74 M6 40 L16 40 M64 40 L74 40"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path d="M22 22 L30 22 M22 22 L22 30" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M58 58 L50 58 M58 58 L58 50" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </div>

      <div className="nn-scanlines" />
      <div className="nn-vignette" />
    </div>
  )
}

export default function SpaceBackdrop() {
  const sceneRef = useRef<HTMLDivElement | null>(null)
  // Decided after mount so the probe runs in the browser, not during render.
  const [use3D, setUse3D] = useState(false)

  useEffect(() => {
    setUse3D(canRender3D())
  }, [])

  // Pointer parallax: publish a normalized offset the layers scale differently.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return

    let raf = 0
    let tx = 0
    let ty = 0
    let cx = 0
    let cy = 0

    function onMove(e: PointerEvent) {
      tx = e.clientX / window.innerWidth - 0.5
      ty = e.clientY / window.innerHeight - 0.5
      if (!raf) raf = requestAnimationFrame(tick)
    }

    function tick() {
      // Ease toward the pointer so the parallax glides instead of snapping.
      cx += (tx - cx) * 0.06
      cy += (ty - cy) * 0.06
      scene!.style.setProperty('--nn-px', cx.toFixed(4))
      scene!.style.setProperty('--nn-py', cy.toFixed(4))
      raf =
        Math.abs(tx - cx) > 0.0005 || Math.abs(ty - cy) > 0.0005
          ? requestAnimationFrame(tick)
          : 0
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div
      ref={sceneRef}
      className="nn-scene pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      <div className="nn-plx nn-plx-far absolute inset-0">
        <SceneCanvas />
      </div>

      <div className="nn-plx nn-plx-deep absolute inset-0">
        <div className="nn-ship nn-ship-cap">
          <CapitalSvg className="h-16 w-[26rem] opacity-35 blur-[0.5px] sm:h-24 sm:w-[38rem]" />
        </div>
        <div className="nn-nebula nn-nebula-1" />
        <div className="nn-nebula nn-nebula-2" />
        <div className="nn-nebula nn-nebula-3" />
        <div className="nn-planet" />
      </div>

      <div className="nn-plx nn-plx-mid nn-edge-only absolute inset-0">
        {!use3D && (
          <>
            <div className="nn-ship nn-ship-2">
              <FreighterSvg className="nn-bloom-violet h-16 w-64 opacity-70 sm:h-20 sm:w-80" />
            </div>
            <div className="nn-ship nn-ship-4">
              <InterceptorSvg className="nn-bloom-cyan h-8 w-28 opacity-55" />
            </div>
          </>
        )}
        <div className="nn-warp nn-warp-1" />
        <div className="nn-warp nn-warp-2" />
      </div>

      {use3D ? (
        <div className="nn-edge-only absolute inset-0">
          <Suspense fallback={null}>
            <ShipScene3D />
          </Suspense>
        </div>
      ) : (
        <div className="nn-plx nn-plx-near nn-edge-only absolute inset-0">
          <div className="nn-ship nn-ship-1">
            <InterceptorSvg className="nn-bloom-cyan h-14 w-48 opacity-95 sm:h-16 sm:w-56" />
          </div>
          <div className="nn-ship nn-ship-3">
            <GunshipSvg className="nn-bloom-magenta h-12 w-40 opacity-90" />
          </div>
          <div className="nn-ship nn-ship-5">
            <InterceptorSvg className="nn-bloom-cyan h-20 w-72 opacity-100 sm:h-24 sm:w-[22rem]" />
          </div>
        </div>
      )}

      <HudChrome />
    </div>
  )
}
