import type { SharedOpsActivity, SharedOpsSummary } from './community'

/**
 * Derived ops insight.
 *
 * Pure functions over what the ops endpoint returns, because ops never enter
 * AppState — they are fetched, not persisted. Nothing here is stored.
 *
 * One thing shapes every figure below: the public GET /api/ops returns *every*
 * session from every player, not yours. So a bare count off that list describes
 * the community board, not your operation. Anything presented as personal is
 * therefore scoped with `ownedBy` or `onByYou`.
 *
 * Scoping is by user id, never by display name. A name match was wrong in two
 * ways: it broke the moment a player renamed their account, and two players
 * with the same display name saw each other's ops as their own.
 *
 * Ops you *joined* used to be invisible here, because the board rows carried no
 * crew membership. They now carry `isCrew`, and the server offers a `mine`
 * view, so a crew member can find their own op without scrolling the board.
 */

export const ACTIVITY_LABEL: Record<SharedOpsActivity, string> = {
  mining: 'Mining',
  salvage: 'Salvage',
  cargo: 'Cargo',
  other: 'Ops',
}

function list(sessions: SharedOpsSummary[] | null | undefined): SharedOpsSummary[] {
  return Array.isArray(sessions) ? sessions : []
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Ops this player created, matched on user id. */
export function ownedBy(sessions: SharedOpsSummary[], myId: string): SharedOpsSummary[] {
  if (!myId) return []
  return list(sessions).filter((s) => s?.ownerId === myId)
}

/** Ops this player is on at all — ones they started, and ones they crew. */
export function onByYou(sessions: SharedOpsSummary[], myId: string): SharedOpsSummary[] {
  if (!myId) return []
  return list(sessions).filter((s) => s?.ownerId === myId || s?.isCrew === true)
}

export function openOps(sessions: SharedOpsSummary[]): SharedOpsSummary[] {
  return list(sessions).filter((s) => !s?.closed)
}

export function closedOps(sessions: SharedOpsSummary[]): SharedOpsSummary[] {
  return list(sessions).filter((s) => s?.closed)
}

export type OpsBoard = {
  /** Open ops this player is on — ones they started and ones they crew. */
  yoursOpen: SharedOpsSummary[]
  yoursClosedCount: number
  /** Open ops across everyone, this player included. */
  boardOpenCount: number
  boardTotal: number
  /**
   * Net logged against the open ops this player is on. This is each op's
   * total, not the player's cut — a cut depends on crew shares, which the
   * board rows do not carry. The session detail reports the real cut.
   */
  loggedOnYours: number
  /** Crew across the open ops this player is on. */
  crewOnYours: number
}

/**
 * @param sessions the public board
 * @param myId the signed-in player's user id
 * @param myOps ops the server returned for `?mine=1`, when signed in. These
 *   are authoritative for "yours": the board is capped at 100 rows, so an op
 *   you are on may not appear on it at all.
 */
export function opsBoard(
  sessions: SharedOpsSummary[],
  myId: string,
  myOps?: SharedOpsSummary[] | null,
): OpsBoard {
  const all = list(sessions)
  const mine = Array.isArray(myOps) ? list(myOps) : onByYou(all, myId)
  const yoursOpen = openOps(mine)

  return {
    yoursOpen,
    yoursClosedCount: closedOps(mine).length,
    boardOpenCount: openOps(all).length,
    boardTotal: all.length,
    loggedOnYours: yoursOpen.reduce((sum, s) => sum + num(s.net), 0),
    crewOnYours: yoursOpen.reduce((sum, s) => sum + num(s.crewCount), 0),
  }
}

export type MiningAlert = {
  id: string
  tone: 'caution' | 'danger'
  title: string
  detail: string
}

/**
 * Ops waiting on a decision.
 *
 * Only one condition qualifies from list data alone. Creating an op enrols the
 * creator, so an open op of yours with nobody on it means the crew emptied —
 * worth knowing, and there is something to do about it.
 *
 * Deliberately absent: "no earnings logged". A net of zero cannot be told
 * apart from entries that cancel out, and guessing would be inventing.
 */
export function miningAlerts(
  sessions: SharedOpsSummary[],
  myId: string,
): MiningAlert[] {
  // Owner-scoped, not crew-scoped: only the owner can act on an empty crew.
  return openOps(ownedBy(list(sessions), myId))
    .filter((s) => num(s.crewCount) === 0)
    .map((s) => ({
      id: `ops-nocrew-${s.id}`,
      tone: 'caution' as const,
      title: `${s.name || 'Untitled session'} has no crew`,
      detail: 'Nobody is on this op. Share it with your crew, or close it out.',
    }))
}
