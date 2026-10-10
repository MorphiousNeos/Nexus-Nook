import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../../SessionContext'
import { Badge, Skeleton } from '../../components/ui'
import PageContainer from '../../components/PageContainer'
import {
  ActivityModule,
  AlertModule,
  DataModule,
  HeroModule,
  SummaryModule,
  type SummaryStat,
} from '../../components/modules'
import { DISCORD_INVITE, type ServerStatus } from '../../services/store'
import {
  communityAvailable,
  listSharedOps,
  type SharedOpsSummary,
} from '../../services/community'
import { ACTIVITY_LABEL, openOps } from '../../services/miningInsights'
import { relativeTime } from '../../services/community'
import { readiness } from '../../services/fleetInsights'
import {
  formatAuec,
  inFlight,
  inventoryUnits,
  isNewOperation,
  overviewAlerts,
} from '../../services/overviewInsights'
import {
  EXEC_PHASE_STYLE,
  formatCountdown,
  isLightLit,
  useExecTimer,
  type ExecPhase,
  type ExecPhaseInfo,
} from '../../services/execTimer'
import { getCommLinks, type CommLink } from '../../services/scwiki'

const PHASE_BAR: Record<ExecPhase, string> = {
  open: 'bg-positive-500',
  charging: 'bg-danger-500',
  blackout: 'bg-hull-500',
}

/** Last time the dashboard showed Comm-Links; anything newer gets a "New" badge. */
const COMM_SEEN_KEY = 'nexus-nook:comm-links-seen'

function isHttpUrl(url?: string): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url)
}

function publishedTs(link: CommLink): number {
  if (!link.publishedAt) return Number.NEGATIVE_INFINITY
  const t = Date.parse(link.publishedAt)
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/* ------------------------------------------------------------ progress -- */

function ProgressBar({ ratio, tone }: { ratio: number; tone: string }) {
  const pct = Math.min(100, Math.max(0, Number.isFinite(ratio) ? ratio * 100 : 0))
  return (
    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-hull-800">
      <div
        className={`h-full rounded-full transition-all duration-ui ease-ui motion-reduce:transition-none ${tone}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/* -------------------------------------------------------- exec hangar -- */

/** The five in-game hangar status lights. */
function ExecLights({ info }: { info: ExecPhaseInfo }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => {
        const lit = isLightLit(info, i)
        return (
          <span
            key={i}
            className={`h-2.5 w-2.5 rounded-full border ${
              lit
                ? 'border-positive-400 bg-positive-500'
                : info.phase === 'blackout'
                  ? 'border-hull-700 bg-hull-800'
                  : 'border-danger-800 bg-danger-950'
            }`}
          />
        )
      })}
    </div>
  )
}

/**
 * The Executive Hangar cycle — a world clock, not the player's own state, so
 * it sits below their operational modules rather than above them. Carried in
 * its own component so the once-a-second tick never re-renders the page.
 */
function ExecHangarModule() {
  const { info, source, communityReports } = useExecTimer()
  const style = info ? EXEC_PHASE_STYLE[info.phase] : null

  return (
    <DataModule
      title="Executive Hangar"
      description="Pyro · in-game hangar cycle"
      action={
        <Link
          to="/servers"
          className="font-mono text-label uppercase text-brand-300 transition-colors duration-ui ease-ui hover:text-brand-200"
        >
          Servers →
        </Link>
      }
    >
      {info && style ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Badge tone={style.tone} dot>
                {style.label}
              </Badge>
              <span className="text-sm text-hull-400">{style.short}</span>
            </div>
            <div className="flex items-center gap-4">
              <ExecLights info={info} />
              {/* Tabular figures so the seconds tick without the line reflowing. */}
              <span className="font-display text-3xl font-semibold tabular-nums leading-none text-hull-100">
                {formatCountdown(info.msToNext)}
              </span>
            </div>
          </div>
          <ProgressBar ratio={info.progress} tone={PHASE_BAR[info.phase]} />
          {source === 'community' && (
            <p className="mt-2 text-xs text-hull-500">
              Community-calibrated from {plural(communityReports, 'report', 'reports')}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-hull-400">
          Needs a one-tap calibration — set it on the Servers tab.
        </p>
      )}
    </DataModule>
  )
}

/* --------------------------------------------------------- comm-links -- */

/**
 * Three newest official Comm-Links, as a chronology rather than a card grid.
 * Never blocks or breaks the dashboard: any API failure renders nothing.
 */
function CommLinksModule() {
  const [items, setItems] = useState<CommLink[] | null>(null)
  const [failed, setFailed] = useState(false)
  // Captured once on mount so the badges survive this visit's own timestamp write.
  const [lastSeen] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(COMM_SEEN_KEY)
      const n = raw ? Number(raw) : NaN
      return Number.isFinite(n) ? n : null
    } catch {
      return null
    }
  })

  useEffect(() => {
    let active = true
    getCommLinks(8)
      .then((list) => {
        if (!active) return
        const rows = (Array.isArray(list) ? list : [])
          .map((item, i) => ({ item, i }))
          .sort((a, b) => publishedTs(b.item) - publishedTs(a.item) || a.i - b.i)
          .map(({ item }) => item)
          .slice(0, 3)
        setItems(rows)
        try {
          localStorage.setItem(COMM_SEEN_KEY, String(Date.now()))
        } catch {
          /* storage unavailable */
        }
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [])

  if (failed) return null
  if (items !== null && items.length === 0) return null

  return (
    <ActivityModule
      title="Latest Comm-Links"
      action={
        <Link
          to="/news"
          className="font-mono text-label uppercase text-brand-300 transition-colors duration-ui ease-ui hover:text-brand-200"
        >
          All news →
        </Link>
      }
    >
      {items === null ? (
        <ul className="space-y-4" aria-hidden>
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex gap-3">
              <Skeleton className="h-12 w-20 shrink-0" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="mt-2 h-3 w-1/3" />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-4">
          {items.map((item, i) => {
            const ts = publishedTs(item)
            const isNew = lastSeen !== null && Number.isFinite(ts) && ts > lastSeen
            const when = item.publishedAt ? relativeTime(item.publishedAt) : ''
            const body = (
              <div className="flex gap-3">
                {isHttpUrl(item.imageUrl) && (
                  <img
                    src={item.imageUrl}
                    alt=""
                    loading="lazy"
                    className="h-12 w-20 shrink-0 rounded-control object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-2 text-sm font-medium text-hull-100">
                      {item.title}
                    </h3>
                    {isNew && (
                      <span className="shrink-0">
                        <Badge tone="purple" dot>
                          New
                        </Badge>
                      </span>
                    )}
                  </div>
                  {(when || item.channel) && (
                    <p className="mt-1 text-xs text-hull-500">
                      {[item.channel, when].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              </div>
            )
            return (
              <li key={`${item.id ?? item.url ?? item.title}:${i}`}>
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-control outline-none transition-colors duration-ui ease-ui hover:bg-hull-900 focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    {body}
                  </a>
                ) : (
                  body
                )}
              </li>
            )
          })}
        </ul>
      )}

      <p className="mt-4 text-xs leading-snug text-hull-600">
        Comm-Link data via the Star Citizen Wiki API (CC BY-SA 4.0) — content © Cloud
        Imperium Games.
      </p>
    </ActivityModule>
  )
}

/* -------------------------------------------------------------- page -- */

/**
 * Overview — the command centre.
 *
 * Answers one question the individual pages cannot: what should I do next.
 * Ordered accordingly — what is my state, what needs a decision, what is
 * already in flight, then the world outside my operation.
 *
 * Every figure is derived at read time from data the app already holds. The
 * model still carries no timestamps, so nothing here claims recency.
 */
export default function OverviewPage() {
  const { state, getServerStatus } = useSession()
  const [servers, setServers] = useState<ServerStatus[] | null>(null)
  const [ops, setOps] = useState<SharedOpsSummary[] | null>(null)

  useEffect(() => {
    let active = true
    getServerStatus()
      .then((s) => active && setServers(s))
      .catch(() => active && setServers([]))
    return () => {
      active = false
    }
  }, [getServerStatus])

  // Ops live on the server, not in session state. Same posture as the shard
  // tile: fetch on mount, and on failure show nothing rather than a wrong zero.
  //
  // We ask the server for *our* ops rather than filtering the public board:
  // the board is capped at 100 rows, so a busy board used to hide a player's
  // own op from their briefing.
  const myUserId = state?.profile?.id ? String(state.profile.id) : ''
  useEffect(() => {
    if (!communityAvailable || !myUserId) return
    let active = true
    listSharedOps({ mine: true })
      .then((rows) => active && setOps(rows))
      .catch(() => active && setOps(null))
    return () => {
      active = false
    }
  }, [myUserId])

  const view = useMemo(() => {
    const fleet = Array.isArray(state?.fleet) ? state!.fleet : []
    return {
      r: readiness(fleet),
      alerts: overviewAlerts(state),
      flight: inFlight(state),
      units: inventoryUnits(state),
      fresh: isNewOperation(state),
    }
  }, [state])

  const { r, alerts, flight, units, fresh } = view

  const onlineCount = servers?.filter((s) => s.status === 'online').length ?? 0

  // `ops` is already scoped to this player by the server — ops they started
  // and ops they crew — so nothing here needs to guess from display names.
  const myOps = ops ? openOps(ops) : []
  const inFlightCount = flight.count + myOps.length

  const stats: SummaryStat[] = [
    {
      label: 'Fleet ready',
      value: r.operationalCount ? `${r.ready}/${r.operationalCount}` : '—',
      note: r.operationalCount
        ? r.ready
          ? 'Ready to fly'
          : 'Nothing marked ready'
        : 'No ships tracked',
      tone: r.ready > 0 ? 'positive' : 'default',
    },
    {
      label: 'In flight',
      value: String(inFlightCount),
      note: inFlightCount
        ? `${plural(flight.contracts.length, 'contract', 'contracts')}${myOps.length ? ` · ${plural(myOps.length, 'op', 'ops')}` : ''}`
        : 'Nothing running',
    },
    {
      label: 'Pending payout',
      value: flight.pendingReward > 0 ? Math.round(flight.pendingReward).toLocaleString() : '—',
      note: flight.pendingReward > 0 ? 'From active contracts' : 'No payouts logged',
    },
    {
      label: 'Shards online',
      value:
        servers === null
          ? '…'
          : servers.length > 0
            ? `${onlineCount}/${servers.length}`
            : '—',
      note:
        servers === null
          ? 'Checking shards…'
          : servers.length > 0
            ? onlineCount === servers.length
              ? 'All regions up'
              : 'Some regions degraded'
            : 'No shard data',
      tone:
        servers && servers.length > 0 && onlineCount < servers.length ? 'caution' : 'default',
    },
  ]

  const firstName = (state?.profile?.displayName ?? '').split(' ')[0] || 'Citizen'

  const headline = fresh
    ? 'Nothing tracked yet'
    : alerts.length > 0
      ? `${plural(alerts.length, 'thing needs', 'things need')} your attention`
      : flight.count > 0
        ? `${plural(flight.count, 'job', 'jobs')} in progress`
        : 'All clear'

  const lede = fresh
    ? `Welcome, ${firstName}. Add a ship, log a hauling contract, or open an ops session — Nexus Nook keeps the rest straight.`
    : alerts.length > 0
      ? `Welcome back, ${firstName}. Everything below is waiting on a decision from you.`
      : flight.count > 0
        ? `Welcome back, ${firstName}. Nothing is blocked — here is what you have running.`
        : r.primary
          ? `Welcome back, ${firstName}. Nothing needs a decision. Primary hull is ${r.primary.name}.`
          : `Welcome back, ${firstName}. Nothing needs a decision right now.`

  const bothRunning = flight.contracts.length > 0 && myOps.length > 0

  return (
    <PageContainer>
      <HeroModule
        eyebrow="Command centre"
        title={headline}
        lede={lede}
      >
        <SummaryModule stats={stats} />
      </HeroModule>

      {alerts.length > 0 && (
        <section className="mb-8 sm:mb-10">
          <h2 className="mb-3 font-mono text-label uppercase text-hull-400">
            Needs attention
          </h2>
          <div className="space-y-2">
            {alerts.slice(0, 5).map((item) => (
              <AlertModule
                key={item.id}
                tone={item.tone}
                title={item.title}
                action={
                  <Link
                    to={item.to}
                    className="font-mono text-label uppercase text-brand-300 transition-colors duration-ui ease-ui hover:text-brand-200"
                  >
                    Open →
                  </Link>
                }
              >
                {item.detail}
              </AlertModule>
            ))}
            {alerts.length > 5 && (
              <p className="pl-4 text-xs text-hull-400">
                and {alerts.length - 5} more
              </p>
            )}
          </div>
        </section>
      )}

      {inFlightCount > 0 && (
        <section className="mb-8 sm:mb-10">
          <div className={`grid gap-6 ${bothRunning ? 'lg:grid-cols-2' : ''}`}>
            {flight.contracts.length > 0 && (
              <DataModule
                title="Hauling contracts"
                description="Nearest to finishing first."
                action={
                  <Link
                    to="/hauling"
                    className="font-mono text-label uppercase text-brand-300 transition-colors duration-ui ease-ui hover:text-brand-200"
                  >
                    Open →
                  </Link>
                }
              >
                <ul className="space-y-4">
                  {flight.contracts.slice(0, 4).map((c) => (
                    <li key={c.id}>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="min-w-0 truncate text-sm font-medium text-hull-100">
                          {c.name}
                        </p>
                        {c.reward > 0 && (
                          <span className="shrink-0 text-xs tabular-nums text-hull-400">
                            {formatAuec(c.reward)}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-hull-400">
                        {c.total === 0
                          ? 'No stops logged'
                          : c.remaining === 0
                            ? `All ${plural(c.total, 'stop', 'stops')} done`
                            : `${c.done}/${c.total} stops · ${c.remaining} left`}
                      </p>
                      {c.total > 0 && (
                        <ProgressBar
                          ratio={c.done / c.total}
                          tone={c.remaining === 0 ? 'bg-positive-500' : 'bg-brand-500'}
                        />
                      )}
                    </li>
                  ))}
                </ul>
                {flight.contracts.length > 4 && (
                  <p className="mt-4 text-xs text-hull-500">
                    and {flight.contracts.length - 4} more
                  </p>
                )}
              </DataModule>
            )}

            {myOps.length > 0 && (
              <DataModule
                title="Your open ops"
                description="Ops you're on. Open one to log the take and see the split."
                action={
                  <Link
                    to="/mining"
                    className="font-mono text-label uppercase text-brand-300 transition-colors duration-ui ease-ui hover:text-brand-200"
                  >
                    Open →
                  </Link>
                }
              >
                <ul className="space-y-3">
                  {myOps.slice(0, 4).map((o) => (
                    <li key={o.id} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-hull-100">
                          {o.name || 'Untitled session'}
                        </span>
                        <span className="text-xs text-hull-400">
                          {ACTIVITY_LABEL[o.activity]} ·{' '}
                          {plural(o.crewCount, 'crew', 'crew')}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 text-sm font-semibold tabular-nums ${
                          o.net >= 0 ? 'text-positive-300' : 'text-danger-300'
                        }`}
                      >
                        {formatAuec(o.net)}
                      </span>
                    </li>
                  ))}
                </ul>
                {myOps.length > 4 && (
                  <p className="mt-4 text-xs text-hull-500">
                    and {myOps.length - 4} more
                  </p>
                )}
              </DataModule>
            )}
          </div>
        </section>
      )}

      {units > 0 && (
        <p className="mb-8 text-xs text-hull-500 sm:mb-10">
          Manifest holds {plural(units, 'unit', 'units')} across{' '}
          {plural(state?.inventory?.length ?? 0, 'line', 'lines')}.{' '}
          <Link
            to="/inventory"
            className="text-brand-300 transition-colors duration-ui ease-ui hover:text-brand-200"
          >
            Open inventory →
          </Link>
        </p>
      )}

      <div className="space-y-8 sm:space-y-10">
        <ExecHangarModule />
        <CommLinksModule />
      </div>

      {/* A quiet line, not a panel. The only non-operational element on an
          operational page should not compete with the modules above it. */}
      <p className="mt-10 border-t border-line-subtle pt-6 text-xs text-hull-500">
        Share routes and fleet tips with other players.{' '}
        {DISCORD_INVITE && DISCORD_INVITE.trim() !== '' && (
          <a
            href={DISCORD_INVITE}
            target="_blank"
            rel="noreferrer noopener"
            className="text-brand-300 transition-colors duration-ui ease-ui hover:text-brand-200"
          >
            Join the Discord →
          </a>
        )}
      </p>
    </PageContainer>
  )
}
