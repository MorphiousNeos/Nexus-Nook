import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../SessionContext'
import { Button, Field } from '../components/ui'
import DiscordButton from '../components/DiscordButton'
import SpaceBackdrop from '../components/SpaceBackdrop'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')

export default function Landing() {
  const { enter, state, isDemo } = useSession()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rsiHandle, setRsiHandle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [waking, setWaking] = useState(false)
  // Discord is the main way in. Email stays one click away for anyone without it.
  const [showEmail, setShowEmail] = useState(false)
  // The API sleeps when idle on its current host and takes up to a minute to
  // boot. Warming it while the visitor reads the page means sign-in is usually
  // instant by the time they click; the promise is reused so a click that
  // arrives early can wait on the same request instead of firing another.
  const warmup = useRef<Promise<void> | null>(null)

  useEffect(() => {
    if (state) navigate('/overview', { replace: true })
  }, [state, navigate])

  useEffect(() => {
    if (isDemo || !API_BASE || warmup.current) return
    warmup.current = fetch(`${API_BASE}/health`, { cache: 'no-store' })
      .then(() => undefined)
      .catch(() => undefined)
  }, [isDemo])

  // Surface a Discord sign-in failure stashed by main.tsx during boot.
  useEffect(() => {
    const stashed = sessionStorage.getItem('nexus-nook:oauth-error')
    if (stashed) {
      sessionStorage.removeItem('nexus-nook:oauth-error')
      setError(stashed)
    }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!displayName.trim() || !email.trim()) {
      setError('A display name and email are required.')
      return
    }
    if (!isDemo && password.length < 8) {
      setError('Please use a password of at least 8 characters.')
      return
    }
    setBusy(true)
    try {
      await enter({ displayName, email, rsiHandle, password })
      navigate('/overview', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not enter. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const features: { icon: IconName; label: string }[] = [
    { icon: 'fleet', label: 'Fleet' },
    { icon: 'trade', label: 'Trade routes' },
    { icon: 'hauling', label: 'Hauling' },
    { icon: 'mining', label: 'Mining crews' },
    { icon: 'crafting', label: 'Crafting' },
    { icon: 'timer', label: 'Hangar timers' },
    { icon: 'community', label: 'Community' },
  ]

  // What a signed-in player actually gets, shown under the hero so visitors
  // see the product before they hand over anything.
  const highlights: { icon: IconName; title: string; body: string }[] = [
    {
      icon: 'mining',
      title: 'Crew ops, split fairly',
      body: 'Log a mining, salvage or cargo run with your crew and get everyone\'s cut, ready to paste into Discord.',
    },
    {
      icon: 'timer',
      title: 'Executive Hangar timer',
      body: 'A live countdown kept accurate by the community, so you know when the doors open.',
    },
    {
      icon: 'fleet',
      title: 'Your fleet in one place',
      body: 'Track the ships you own and plan loadouts, from your phone or your desk.',
    },
  ]

  return (
    <div className="relative">
      <SpaceBackdrop />
      <main className="relative mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-2 md:items-center md:py-16">
      <section className="text-center md:text-left">
        <div className="nn-rise nn-rise-1 mb-6 inline-flex items-center gap-2 border border-accent-400/30 bg-accent-950/20 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-accent-300/90 backdrop-blur">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-400 shadow-[0_0_8px_rgba(34,211,238,0.9)]" aria-hidden />
          Unofficial fan companion
        </div>
        <div className="nn-rise nn-rise-2 mb-5">
          <img
            src="./icon.svg"
            alt="Nexus Nook"
            width={64}
            height={64}
            className="nn-float mx-auto mb-4 h-14 w-14 drop-shadow-[0_0_28px_rgba(124,58,237,0.75)] md:mx-0 md:h-16 md:w-16"
          />
          <h1 className="font-display text-[3.25rem] font-black uppercase leading-[0.85] tracking-tighter sm:text-6xl lg:text-7xl">
            <span className="nn-title-gradient drop-shadow-[0_0_40px_rgba(124,58,237,0.5)]">
              Nexus
              <br />
              Nook
            </span>
          </h1>
        </div>
        <div className="nn-rise nn-rise-3 mb-6 flex items-center justify-center gap-3 md:justify-start">
          <span
            className="h-px w-10 bg-gradient-to-r from-accent-400 to-transparent"
            aria-hidden
          />
          <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-hull-400 [text-shadow:0_2px_10px_rgb(2_6_23)]">
            Star Citizen Companion
          </span>
        </div>
        <p className="nn-rise nn-rise-3 mt-4 text-lg font-medium text-hull-200 md:text-xl">
          Your cockpit for the whole verse. Fleet, trade routes, hauling, crafting,
          mining crews, live timers, and a community — one app, in your pocket.
        </p>
        <p className="nn-rise nn-rise-3 mt-3 text-sm text-hull-400">
          A companion app for Star Citizen players. Bring your own public RSI handle; we
          never ask for a password.
        </p>

        <ul className="nn-rise nn-rise-4 mt-6 flex flex-wrap justify-center gap-2 md:justify-start">
          {features.map((f) => (
            <li
              key={f.label}
              className="inline-flex items-center gap-1.5 rounded-full border border-hull-700/80 bg-hull-900/80 px-3 py-1 text-xs font-medium text-hull-200 backdrop-blur"
            >
              <Icon name={f.icon} className="h-3.5 w-3.5 text-accent-300" />
              {f.label}
            </li>
          ))}
        </ul>

        <div className="nn-rise nn-rise-5 mt-8 flex flex-col items-center gap-3 sm:flex-row md:items-start">
          <DiscordButton />
          {isDemo && (
            <span className="text-xs text-hull-500">
              Running in demo mode — your data stays in this browser.
            </span>
          )}
        </div>
      </section>

      <section className="nn-rise nn-rise-3 relative rounded-2xl border border-hull-700/70 bg-hull-950/90 p-6 shadow-2xl shadow-black/40 backdrop-blur sm:p-7">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-500/50 to-transparent"
        />
        <h2 className="font-display text-xl font-semibold">Enter the Nook</h2>
        <p className="mt-1 text-sm text-hull-400">
          {isDemo
            ? 'Demo mode creates a local profile on this device. No account needed.'
            : 'Sign in with Discord to create or resume your account.'}
        </p>

        {!isDemo && API_BASE && (
          <div className="mt-5">
            <a
              href={`${API_BASE}/api/auth/discord`}
              onClick={(e) => {
                // A cold API would otherwise leave the browser on a blank page
                // for up to a minute with no explanation. Hold the navigation
                // until the warm-up settles, and never wait forever.
                if (!warmup.current || waking) return
                e.preventDefault()
                setWaking(true)
                const go = () => {
                  window.location.href = `${API_BASE}/api/auth/discord`
                }
                Promise.race([
                  warmup.current,
                  new Promise((resolve) => setTimeout(resolve, 20000)),
                ]).then(go, go)
              }}
              aria-busy={waking}
              className="flex w-full items-center justify-center gap-2.5 rounded-lg bg-[#5865F2] px-4 py-3.5 text-base font-semibold text-white shadow-lg shadow-[#5865F2]/25 transition hover:bg-[#4752c4] focus:outline-none focus:ring-2 focus:ring-[#5865F2]/60"
            >
              <DiscordMark className="h-5 w-5" />
              {waking ? 'Waking the server…' : 'Sign in with Discord'}
            </a>
            <p className="mt-2 text-center text-[11px] text-hull-500">
              {waking
                ? 'The server sleeps when idle — this can take up to a minute the first time.'
                : 'We only read your Discord display name — never your servers or messages.'}
            </p>
          </div>
        )}

        {error && !showEmail && !isDemo && (
          <p className="mt-4 text-center text-sm text-danger-400">{error}</p>
        )}

        {!isDemo && API_BASE && !showEmail ? (
          <button
            type="button"
            onClick={() => setShowEmail(true)}
            className="mt-5 w-full text-center text-sm text-hull-400 underline-offset-4 transition hover:text-hull-200 hover:underline"
          >
            Use email instead
          </button>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <Field
              label="Display name"
              placeholder="Citizen name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="nickname"
            />
            <Field
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            {!isDemo && (
              <Field
                label="Password"
                type="password"
                placeholder="At least 8 characters"
                hint="Your Nexus Nook password — never your RSI password."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            )}
            <Field
              label="Public RSI handle (optional)"
              placeholder="e.g. StarHopper"
              hint="Your public citizen handle, display only. Never a password."
              value={rsiHandle}
              onChange={(e) => setRsiHandle(e.target.value)}
            />
            {error && <p className="text-sm text-danger-400">{error}</p>}
            <Button
              type="submit"
              disabled={busy}
              variant={isDemo || !API_BASE ? 'primary' : 'ghost'}
              className="w-full"
            >
              {busy ? 'Entering…' : 'Enter Nexus Nook'}
            </Button>
          </form>
        )}

        <p className="mt-5 text-center text-xs text-hull-500">
          {isDemo
            ? 'No password required. This is a free, fan-made tool.'
            : 'Free, fan-made tool. We never ask for your RSI password.'}
        </p>
      </section>
      </main>

      <section
        aria-label="What's inside"
        className="relative mx-auto max-w-6xl px-4 pb-16"
      >
        <h2 className="mb-5 text-center font-mono text-[11px] uppercase tracking-[0.3em] text-hull-400 md:text-left">
          What's inside
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {highlights.map((h) => (
            <article
              key={h.title}
              className="rounded-xl border border-hull-800/80 bg-hull-950/85 p-5 backdrop-blur"
            >
              <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-accent-400/25 bg-accent-950/30">
                <Icon name={h.icon} className="h-[18px] w-[18px] text-accent-300" />
              </div>
              <h3 className="font-display text-base font-semibold text-hull-100">{h.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-hull-400">{h.body}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

type IconName = 'fleet' | 'trade' | 'hauling' | 'mining' | 'crafting' | 'timer' | 'community'

// One consistent line-icon set in place of emoji, which render differently on
// every device and read as placeholder art.
const ICON_PATHS: Record<IconName, string> = {
  fleet: 'M12 2l3 7 6 2-6 2-3 9-3-9-6-2 6-2z',
  trade: 'M4 7h13l-3-3M20 17H7l3 3',
  hauling: 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-.01M17 19a2 2 0 1 0 0-.01',
  mining: 'M14 4l6 6M4 20l9-9M11 6c3-2 7-2 9 0-1 3-4 6-8 7',
  crafting: 'M4 20h16M6 20V9l6-5 6 5v11M10 20v-6h4v6',
  timer: 'M12 8v5l3 2M9 2h6M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  community: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 3-5 6-5s6 2 6 5M16 5a3 3 0 0 1 0 6M18 15c2 .5 3 2 3 5',
}

function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  )
}

function DiscordMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
    </svg>
  )
}
