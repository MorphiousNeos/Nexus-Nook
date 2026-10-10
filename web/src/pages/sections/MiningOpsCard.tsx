import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Badge, Button, EmptyState, Field, Skeleton } from '../../components/ui'
import { ActionModule, DataModule } from '../../components/modules'
import {
  ACTIVITY_LABEL,
  closedOps,
  onByYou,
  openOps,
} from '../../services/miningInsights'
import {
  addSharedOpsEntry,
  communityAvailable,
  createSharedOps,
  deleteSharedOps,
  deleteSharedOpsEntry,
  getSharedOps,
  joinSharedOps,
  leaveSharedOps,
  relativeTime,
  setSharedOpsShares,
  toggleSharedOpsClosed,
  type SharedOpsActivity,
  type SharedOpsDetail,
  type SharedOpsSummary,
} from '../../services/community'
import CommunityNotice from '../community/CommunityNotice'

function formatAuec(n: number): string {
  return `${Math.round(n).toLocaleString()} aUEC`
}

/**
 * The Discord-ready payout summary.
 *
 * Every figure here comes from the server. The client used to divide the net
 * itself, which meant two crew members on different devices could paste
 * different numbers into the same channel — and nothing about the arithmetic
 * could be tested. The split now lives in backend/lib/opsSplit.js, where it is.
 */
function buildSummary(detail: SharedOpsDetail): string {
  const lines = [
    `**${detail.name}** — ${detail.activity} op payout`,
    `Net: ${formatAuec(detail.net)}`,
    '',
    ...detail.payouts.map((p) => `${p.name} (${p.shares}×): ${formatAuec(p.payout)}`),
  ]
  if (detail.unallocated !== 0) {
    lines.push('', `Unsplit (nobody holds a share): ${formatAuec(detail.unallocated)}`)
  }
  lines.push('', '— split with Nexus Nook')
  return lines.join('\n')
}

function SessionDetail({
  sessionId,
  myId,
  onBack,
  onChanged,
}: {
  sessionId: string
  /** The signed-in player's user id, or '' when signed out. */
  myId: string
  onBack: () => void
  onChanged: () => void
}) {
  const [detail, setDetail] = useState<SharedOpsDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [entryLabel, setEntryLabel] = useState('')
  const [entryAmount, setEntryAmount] = useState('')
  const [entryKind, setEntryKind] = useState<'income' | 'expense'>('income')
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setDetail(await getSharedOps(sessionId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this session.')
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function run(fn: () => Promise<void>, fallback: string) {
    setBusy(true)
    setActionError(null)
    try {
      await fn()
      await refresh()
      onChanged()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : fallback)
    } finally {
      setBusy(false)
    }
  }

  async function submitEntry(e: FormEvent) {
    e.preventDefault()
    if (!detail) return
    const raw = Math.abs(parseInt(entryAmount, 10) || 0)
    const label = entryLabel.trim()
    if (!label || raw <= 0) return
    await run(
      () => addSharedOpsEntry(detail.id, label, entryKind === 'expense' ? -raw : raw),
      'Could not add that entry.',
    )
    setEntryLabel('')
    setEntryAmount('')
  }

  async function copySummary() {
    if (!detail) return
    try {
      await navigator.clipboard.writeText(buildSummary(detail))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable */
    }
  }

  if (loading && !detail) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div>
        <Button variant="ghost" onClick={onBack}>
          ← Back to sessions
        </Button>
        <EmptyState icon="⚠️">{error ?? 'Session unavailable.'}</EmptyState>
      </div>
    )
  }

  // By user id, not display name: a rename used to silently strip the owner of
  // their own controls, and two players sharing a name each saw the other's.
  const isOwner = !!myId && detail.ownerId === myId
  const isCrew = !!myId && detail.crew.some((c) => c.userId === myId)
  const { net, payouts, unallocated } = detail

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          ← Back to sessions
        </Button>
        <Button variant="ghost" onClick={refresh} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      <div className="rounded-xl border border-hull-800 bg-hull-950/50 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-hull-100">
            {detail.name}
          </p>
          {detail.closed && <Badge tone="slate">Closed</Badge>}
          <Badge tone="purple">Run by {detail.owner || 'Unknown'}</Badge>
          {detail.createdAt && (
            <span className="text-xs text-hull-500">
              started {relativeTime(detail.createdAt)}
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {!isCrew && !detail.closed && (
            <Button
              onClick={() => run(() => joinSharedOps(detail.id), 'Could not join.')}
              disabled={busy || !myId}
            >
              {busy ? 'Working…' : 'Join crew'}
            </Button>
          )}
          {isCrew && !isOwner && (
            <Button
              variant="ghost"
              onClick={() => run(() => leaveSharedOps(detail.id), 'Could not leave.')}
              disabled={busy}
            >
              Leave crew
            </Button>
          )}
          {isOwner && (
            <>
              <Button
                variant="ghost"
                onClick={() =>
                  run(() => toggleSharedOpsClosed(detail.id), 'Could not update.')
                }
                disabled={busy}
              >
                {detail.closed ? 'Reopen session' : 'Close session'}
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  if (window.confirm(`Delete "${detail.name}"? This cannot be undone.`)) {
                    void run(() => deleteSharedOps(detail.id), 'Could not delete.').then(
                      onBack,
                    )
                  }
                }}
                disabled={busy}
              >
                Delete
              </Button>
            </>
          )}
          {!myId && <span className="text-xs text-hull-500">Sign in to join.</span>}
        </div>
        {actionError && <p className="mt-2 text-sm text-caution-300">{actionError}</p>}
      </div>

      {/* Crew & shares */}
      <div className="rounded-xl border border-hull-800 bg-hull-950/50 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-widest text-hull-500">
          Crew &amp; shares
        </h4>
        <ul className="mt-2 space-y-1.5">
          {detail.crew.map((c) => (
            <li key={c.userId} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-hull-200">
                {c.name}
                {c.userId === detail.ownerId && (
                  <span className="ml-1.5 text-[10px] uppercase text-brand-300">owner</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {isOwner ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        run(
                          () => setSharedOpsShares(detail.id, c.userId, c.shares - 0.5),
                          'Could not update shares.',
                        )
                      }
                      disabled={busy}
                      className="grid h-6 w-6 place-items-center rounded border border-hull-700 text-hull-300 hover:bg-hull-800 disabled:opacity-50"
                      aria-label={`Lower ${c.name}'s share`}
                    >
                      −
                    </button>
                    <span className="min-w-[2.5rem] text-center tabular-nums text-hull-300">
                      {c.shares}×
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        run(
                          () => setSharedOpsShares(detail.id, c.userId, c.shares + 0.5),
                          'Could not update shares.',
                        )
                      }
                      disabled={busy}
                      className="grid h-6 w-6 place-items-center rounded border border-hull-700 text-hull-300 hover:bg-hull-800 disabled:opacity-50"
                      aria-label={`Raise ${c.name}'s share`}
                    >
                      +
                    </button>
                  </>
                ) : (
                  <span className="tabular-nums text-hull-400">{c.shares}×</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Ledger */}
      <div className="rounded-xl border border-hull-800 bg-hull-950/50 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-widest text-hull-500">
          Shared ledger
        </h4>
        {detail.entries.length === 0 ? (
          <p className="mt-2 text-xs text-hull-500">Nothing logged yet.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {detail.entries.map((e) => {
              const canDelete = isOwner || (!!myId && e.authorId === myId)
              return (
                <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-hull-300">
                    {e.label}
                    <span className="ml-1.5 text-[11px] text-hull-500">· {e.author}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span
                      className={`tabular-nums ${e.amount >= 0 ? 'text-positive-400' : 'text-danger-400'}`}
                    >
                      {e.amount >= 0 ? '+' : '−'}
                      {formatAuec(Math.abs(e.amount))}
                    </span>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() =>
                          run(
                            () => deleteSharedOpsEntry(detail.id, e.id),
                            'Could not delete entry.',
                          )
                        }
                        disabled={busy}
                        className="text-xs text-hull-600 hover:text-danger-400"
                        aria-label={`Remove ${e.label}`}
                      >
                        ✕
                      </button>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        {isCrew && !detail.closed && (
          <form onSubmit={submitEntry} className="mt-3 flex flex-wrap gap-2">
            <select
              value={entryKind}
              onChange={(e) => setEntryKind(e.target.value as 'income' | 'expense')}
              className="rounded-lg border border-hull-700 bg-hull-950/60 px-2 py-1.5 text-sm text-hull-100 focus:border-brand-500 focus:outline-none"
            >
              <option value="income">+ Sale</option>
              <option value="expense">− Expense</option>
            </select>
            <input
              placeholder={entryKind === 'income' ? 'Quantanium haul' : 'Refinery fee'}
              value={entryLabel}
              onChange={(e) => setEntryLabel(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-hull-700 bg-hull-950/60 px-3 py-1.5 text-sm text-hull-100 placeholder-hull-500 focus:border-brand-500 focus:outline-none"
            />
            <input
              type="number"
              min={1}
              placeholder="aUEC"
              value={entryAmount}
              onChange={(e) => setEntryAmount(e.target.value)}
              className="w-28 rounded-lg border border-hull-700 bg-hull-950/60 px-3 py-1.5 text-sm text-hull-100 placeholder-hull-500 focus:border-brand-500 focus:outline-none"
            />
            <Button
              type="submit"
              variant="ghost"
              disabled={busy || !entryLabel.trim() || !entryAmount}
            >
              Add
            </Button>
          </form>
        )}
        {!isCrew && !detail.closed && (
          <p className="mt-3 text-xs text-hull-500">Join the crew to log entries.</p>
        )}
      </div>

      {/* Payouts */}
      <div className="rounded-xl border border-positive-900/40 bg-positive-950/10 p-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-widest text-positive-400">
            Payouts
          </h4>
          <span
            className={`text-sm font-semibold tabular-nums ${net >= 0 ? 'text-positive-300' : 'text-danger-400'}`}
          >
            Net {formatAuec(net)}
          </span>
        </div>
        <ul className="mt-2 space-y-1">
          {payouts.map((p) => (
            <li key={p.userId} className="flex items-baseline justify-between text-sm">
              <span className="text-hull-200">
                {p.name} <span className="text-xs text-hull-500">({p.shares}×)</span>
              </span>
              <span className="tabular-nums text-positive-300">{formatAuec(p.payout)}</span>
            </li>
          ))}
        </ul>
        {unallocated !== 0 && (
          <p className="mt-2 text-xs text-caution-300">
            {formatAuec(unallocated)} is unsplit — nobody on the crew holds a share.
            Give someone a share to divide it.
          </p>
        )}
        <Button
          variant="ghost"
          className="mt-3"
          onClick={copySummary}
          disabled={payouts.length === 0}
        >
          {copied ? 'Copied ✓' : '📋 Copy payout summary'}
        </Button>
      </div>
    </div>
  )
}

/**
 * The ops board.
 *
 * The session list is fetched by the page and passed in, so the briefing above
 * and the board below are always the same data.
 *
 * `myOps` is a second, server-filtered list of the ops this player is on. It
 * exists because `sessions` is the public board, capped at 100 rows: an op you
 * joined can fall off it as other players start theirs, and before this the op
 * simply vanished from your view. Your own ops are therefore never derived by
 * filtering the board.
 */
export default function MiningOpsCard({
  myId,
  myOps,
  sessions,
  loading,
  error,
  onRefresh,
}: {
  myId: string
  myOps: SharedOpsSummary[] | null
  sessions: SharedOpsSummary[]
  loading: boolean
  error: string | null
  onRefresh: () => Promise<void>
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [activity, setActivity] = useState<SharedOpsActivity>('mining')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  if (!communityAvailable) return <CommunityNotice />

  if (selectedId) {
    return (
      <DataModule title="Session detail">
        <SessionDetail
          sessionId={selectedId}
          myId={myId}
          onBack={() => setSelectedId(null)}
          onChanged={onRefresh}
        />
      </DataModule>
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setFormError(null)
    try {
      const { id } = await createSharedOps(name.trim(), activity)
      setName('')
      setActivity('mining')
      setFormOpen(false)
      await onRefresh()
      if (id) setSelectedId(id)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create the session.')
    } finally {
      setBusy(false)
    }
  }

  // Prefer the server's answer about which ops are yours; fall back to reading
  // it off the board only when signed out or the request failed.
  const yours = myOps ?? onByYou(sessions, myId)
  const yoursOpen = openOps(yours)
  // The board minus your own open ops, so nothing appears twice on the page.
  const others = openOps(sessions).filter((s) => !yoursOpen.some((y) => y.id === s.id))
  // Closed ops from both lists: one of yours may have aged off the public board.
  const closed = [...closedOps(yours), ...closedOps(sessions)].filter(
    (s, i, all) => all.findIndex((o) => o.id === s.id) === i,
  )

  function renderRow(s: SharedOpsSummary) {
    return (
      <li key={s.id}>
        <button
          type="button"
          onClick={() => setSelectedId(s.id)}
          className="w-full rounded-control px-3 py-3 text-left transition-colors duration-ui ease-ui hover:bg-hull-800/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-hull-100">
                {s.name || 'Untitled session'}
                {s.closed && (
                  <span className="ml-2 font-mono text-label uppercase text-hull-500">
                    closed
                  </span>
                )}
              </p>
              <p className="mt-0.5 truncate text-xs text-hull-400">
                {ACTIVITY_LABEL[s.activity]} · {s.owner || 'Unknown'} · {s.crewCount}{' '}
                {s.crewCount === 1 ? 'crew' : 'crew'} · {relativeTime(s.createdAt)}
              </p>
            </div>
            <span
              className={`shrink-0 text-sm font-semibold tabular-nums ${
                s.net >= 0 ? 'text-positive-300' : 'text-danger-300'
              }`}
            >
              {formatAuec(s.net)}
            </span>
          </div>
        </button>
      </li>
    )
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      {error && (
        <DataModule title="Ops board">
          <EmptyState icon="⚠️">{error}</EmptyState>
          <div className="mt-4">
            <Button variant="ghost" onClick={() => void onRefresh()}>
              Try again
            </Button>
          </div>
        </DataModule>
      )}

      {!error && loading && sessions.length === 0 && (
        <DataModule title="Ops board">
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </DataModule>
      )}

      {!error && !loading && sessions.length === 0 && (
        <DataModule title="Ops board">
          <EmptyState>
            No sessions yet. Start one and your crew can join from their own devices.
          </EmptyState>
        </DataModule>
      )}

      {!error && yoursOpen.length > 0 && (
        <DataModule title="Your open ops" description="Ops you started, and ops you crew.">
          <ul className="-mx-3 space-y-1">{yoursOpen.map(renderRow)}</ul>
        </DataModule>
      )}

      {!error && others.length > 0 && (
        <DataModule
          title="Community board"
          description="Open crews from across the community. Anyone can browse and join."
        >
          <ul className="-mx-3 space-y-1">{others.map(renderRow)}</ul>
        </DataModule>
      )}

      {!error && closed.length > 0 && (
        <DataModule title="Closed" description={`${closed.length} finished.`}>
          <ul className="-mx-3 space-y-1">{closed.map(renderRow)}</ul>
        </DataModule>
      )}

      <ActionModule title="Start an op">
        {!formOpen ? (
          <Button onClick={() => setFormOpen(true)}>New session</Button>
        ) : (
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Session name"
              placeholder="Sunday Quantanium run"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <label className="block">
              <span className="mb-1 block font-mono text-label uppercase text-hull-400">
                Activity
              </span>
              <select
                value={activity}
                onChange={(e) => setActivity(e.target.value as SharedOpsActivity)}
                className="w-full rounded-control border border-line-subtle bg-hull-950 px-3 py-2 text-sm text-hull-100 transition-colors duration-snap ease-ui focus:border-brand-500 focus:outline-none"
              >
                {(Object.keys(ACTIVITY_LABEL) as SharedOpsActivity[]).map((a) => (
                  <option key={a} value={a}>
                    {ACTIVITY_LABEL[a]}
                  </option>
                ))}
              </select>
            </label>
            {formError && (
              <p className="text-sm text-caution-300 sm:col-span-2">{formError}</p>
            )}
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy || !name.trim()}>
                {busy ? 'Creating…' : 'Start session'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setFormOpen(false)
                  setFormError(null)
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </ActionModule>
    </div>
  )
}
