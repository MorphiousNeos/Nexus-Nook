// Client for the Nexus Nook community API (LFG / Feed / Marketplace).
//
// All list endpoints are public GETs. Create/delete require a bearer token,
// which the app stores in localStorage under `nexus-nook:token` (see ApiStore).
//
// The community features only work against the live backend. In the local demo
// (no VITE_API_URL configured) there is no community server to talk to, so
// `communityAvailable` is false and every call throws a friendly explanation.

const API_BASE = import.meta.env.VITE_API_URL as string | undefined

/** True when a backend is configured; false in the offline demo build. */
export const communityAvailable = !!API_BASE

const TOKEN_KEY = 'nexus-nook:token'

function token(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

/**
 * Defensive fetch wrapper. Prefixes the API base, sends/receives JSON, attaches
 * the bearer token when present, and throws an Error carrying a human-friendly
 * message for HTTP errors, unreadable bodies, and network failures.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!communityAvailable || !API_BASE) {
    throw new Error(
      'Community needs the live server — open the hosted site and sign in.',
    )
  }

  const base = API_BASE.replace(/\/$/, '')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  const t = token()
  if (t) headers.Authorization = `Bearer ${t}`

  let res: Response
  try {
    res = await fetch(`${base}${path}`, { ...init, headers })
  } catch {
    throw new Error(
      "Couldn't reach the community server — check your connection and try again.",
    )
  }

  if (!res.ok) {
    let message = `Request failed (${res.status}).`
    if (res.status === 401 || res.status === 403) {
      message = 'You need to be signed in to do that.'
    }
    try {
      const body = await res.json()
      if (body?.error || body?.message) message = body.error ?? body.message
    } catch {
      /* keep the default message */
    }
    throw new Error(message)
  }

  try {
    return (await res.json()) as T
  } catch {
    throw new Error('The community server returned a response we could not read.')
  }
}

// --- shared helpers -------------------------------------------------------

function toStr(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function toOptNum(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

// --- LFG ------------------------------------------------------------------

export interface LfgPost {
  id: string
  title: string
  activity: string
  region: string
  playersNeeded?: number
  body: string
  createdAt: string
  author: string
}

export interface LfgInput {
  title: string
  activity?: string
  region?: string
  playersNeeded?: number
  body?: string
}

function mapLfg(raw: unknown): LfgPost {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    id: toStr(r.id),
    title: toStr(r.title),
    activity: toStr(r.activity),
    region: toStr(r.region),
    playersNeeded: toOptNum(r.players_needed ?? r.playersNeeded),
    body: toStr(r.body),
    createdAt: toStr(r.created_at ?? r.createdAt),
    author: toStr(r.author),
  }
}

export async function listLfg(): Promise<LfgPost[]> {
  const data = await request<{ posts?: unknown[] }>('/api/lfg')
  return (data.posts ?? []).map(mapLfg)
}

export async function createLfg(input: LfgInput): Promise<void> {
  await request('/api/lfg', {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      activity: input.activity ?? '',
      region: input.region ?? '',
      playersNeeded: input.playersNeeded,
      body: input.body ?? '',
    }),
  })
}

export async function deleteLfg(id: string): Promise<void> {
  await request(`/api/lfg/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// --- Feed -----------------------------------------------------------------

export interface FeedPost {
  id: string
  body: string
  imageUrl?: string
  createdAt: string
  author: string
}

export interface FeedInput {
  body: string
  imageUrl?: string
}

function mapPost(raw: unknown): FeedPost {
  const r = (raw ?? {}) as Record<string, unknown>
  const imageUrl = toStr(r.image_url ?? r.imageUrl)
  return {
    id: toStr(r.id),
    body: toStr(r.body),
    imageUrl: imageUrl || undefined,
    createdAt: toStr(r.created_at ?? r.createdAt),
    author: toStr(r.author),
  }
}

export async function listPosts(): Promise<FeedPost[]> {
  const data = await request<{ posts?: unknown[] }>('/api/posts')
  return (data.posts ?? []).map(mapPost)
}

export async function createPost(input: FeedInput): Promise<void> {
  await request('/api/posts', {
    method: 'POST',
    body: JSON.stringify({ body: input.body, imageUrl: input.imageUrl ?? '' }),
  })
}

export async function deletePost(id: string): Promise<void> {
  await request(`/api/posts/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// --- Marketplace ----------------------------------------------------------

export type ListingKind = 'sell' | 'buy' | 'trade'

export interface Listing {
  id: string
  kind: ListingKind
  title: string
  price?: number
  body: string
  createdAt: string
  author: string
}

export interface ListingInput {
  kind: ListingKind
  title: string
  price?: number
  body?: string
}

function mapKind(raw: unknown): ListingKind {
  const k = toStr(raw).toLowerCase()
  if (k === 'buy') return 'buy'
  if (k === 'trade') return 'trade'
  return 'sell'
}

function mapListing(raw: unknown): Listing {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    id: toStr(r.id),
    kind: mapKind(r.kind),
    title: toStr(r.title),
    price: toOptNum(r.price),
    body: toStr(r.body),
    createdAt: toStr(r.created_at ?? r.createdAt),
    author: toStr(r.author),
  }
}

export async function listMarket(): Promise<Listing[]> {
  const data = await request<{ listings?: unknown[] }>('/api/market')
  return (data.listings ?? []).map(mapListing)
}

export async function createListing(input: ListingInput): Promise<void> {
  await request('/api/market', {
    method: 'POST',
    body: JSON.stringify({
      kind: input.kind,
      title: input.title,
      price: input.price,
      body: input.body ?? '',
    }),
  })
}

export async function deleteListing(id: string): Promise<void> {
  await request(`/api/market/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// --- Org & Operations -----------------------------------------------------

export interface OrgSummary {
  id: string
  name: string
  tag: string
  description: string
  createdAt: string
  owner: string
  memberCount?: number
  /** Public RSI org SID (e.g. "TEST"). Read-only link to robertsspaceindustries.com. */
  rsiSid?: string
}

export interface OrgMember {
  name: string
  role: string
  joinedAt: string
}

export interface OrgOp {
  id: string
  title: string
  startsAt?: string
  body: string
  createdAt: string
  author: string
}

export interface OrgDetail {
  id: string
  name: string
  tag: string
  description: string
  createdAt: string
  ownerId?: string
  owner: string
  members: OrgMember[]
  ops: OrgOp[]
  /** Public RSI org SID (e.g. "TEST"). Display-only link to robertsspaceindustries.com. */
  rsiSid?: string
}

export interface OrgInput {
  name: string
  tag?: string
  description?: string
  /** Public RSI org SID. Uppercase alphanumeric, validated by normalizeRsiSid. */
  rsiSid?: string
}

export interface OpInput {
  title: string
  startsAt?: string
  body?: string
}

function mapOrgSummary(raw: unknown): OrgSummary {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    id: toStr(r.id),
    name: toStr(r.name),
    tag: toStr(r.tag),
    description: toStr(r.description),
    createdAt: toStr(r.created_at ?? r.createdAt),
    owner: toStr(r.owner),
    memberCount: toOptNum(r.member_count ?? r.memberCount),
    rsiSid: toStr(r.rsi_sid ?? r.rsiSid) || undefined,
  }
}

function mapOrgMember(raw: unknown): OrgMember {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    name: toStr(r.name),
    role: toStr(r.role),
    joinedAt: toStr(r.joined_at ?? r.joinedAt),
  }
}

function mapOrgOp(raw: unknown): OrgOp {
  const r = (raw ?? {}) as Record<string, unknown>
  const startsAt = toStr(r.starts_at ?? r.startsAt)
  return {
    id: toStr(r.id),
    title: toStr(r.title),
    startsAt: startsAt || undefined,
    body: toStr(r.body),
    createdAt: toStr(r.created_at ?? r.createdAt),
    author: toStr(r.author),
  }
}

function mapOrgDetail(raw: unknown): OrgDetail {
  const r = (raw ?? {}) as Record<string, unknown>
  const members = Array.isArray(r.members) ? r.members : []
  const ops = Array.isArray(r.ops) ? r.ops : []
  return {
    id: toStr(r.id),
    name: toStr(r.name),
    tag: toStr(r.tag),
    description: toStr(r.description),
    createdAt: toStr(r.created_at ?? r.createdAt),
    ownerId: toStr(r.owner_id ?? r.ownerId) || undefined,
    owner: toStr(r.owner),
    members: members.map(mapOrgMember),
    ops: ops.map(mapOrgOp),
    rsiSid: toStr(r.rsi_sid ?? r.rsiSid) || undefined,
  }
}

export async function listOrgs(): Promise<OrgSummary[]> {
  const data = await request<{ orgs?: unknown[] }>('/api/orgs')
  return (data.orgs ?? []).map(mapOrgSummary)
}

export async function createOrg(input: OrgInput): Promise<{ id: string }> {
  const data = await request<{ id?: unknown }>('/api/orgs', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      tag: input.tag ?? '',
      description: input.description ?? '',
      rsiSid: input.rsiSid ?? '',
    }),
  })
  return { id: toStr(data.id) }
}

export async function getOrg(id: string): Promise<OrgDetail> {
  const data = await request<Record<string, unknown>>(
    `/api/orgs/${encodeURIComponent(id)}`,
  )
  const org = (data.org ?? {}) as Record<string, unknown>
  return mapOrgDetail({ ...org, members: data.members, ops: data.ops })
}

export async function joinOrg(id: string): Promise<void> {
  await request(`/api/orgs/${encodeURIComponent(id)}/join`, { method: 'POST' })
}

export async function leaveOrg(id: string): Promise<void> {
  await request(`/api/orgs/${encodeURIComponent(id)}/leave`, { method: 'POST' })
}

export async function deleteOrg(id: string): Promise<void> {
  await request(`/api/orgs/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function createOp(orgId: string, input: OpInput): Promise<void> {
  await request(`/api/orgs/${encodeURIComponent(orgId)}/ops`, {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      startsAt: input.startsAt,
      body: input.body ?? '',
    }),
  })
}

export async function deleteOp(orgId: string, eventId: string): Promise<void> {
  await request(
    `/api/orgs/${encodeURIComponent(orgId)}/ops/${encodeURIComponent(eventId)}`,
    { method: 'DELETE' },
  )
}

// --- Content reports --------------------------------------------------------

export type ReportKind = 'lfg' | 'post' | 'market' | 'org' | 'op'

/** Flag content for the moderators. Requires sign-in; rate-limited. */
export async function reportContent(
  kind: ReportKind,
  contentId: string,
  reason?: string,
): Promise<void> {
  await request('/api/report', {
    method: 'POST',
    body: JSON.stringify({ kind, contentId, reason: reason ?? '' }),
  })
}

// --- Shared ops sessions (community mining/salvage crews) --------------------

export type SharedOpsActivity = 'mining' | 'salvage' | 'cargo' | 'other'

export interface SharedOpsSummary {
  id: string
  name: string
  activity: SharedOpsActivity
  closed: boolean
  createdAt: string
  owner: string
  /** Owner's user id. The reliable ownership test — display names change. */
  ownerId: string
  /** True when the signed-in caller is on this op's crew. Server-supplied. */
  isCrew: boolean
  crewCount: number
  net: number
}

export interface SharedOpsCrew {
  userId: string
  name: string
  shares: number
}

export interface SharedOpsEntry {
  id: string
  label: string
  amount: number
  createdAt: string
  author: string
  /** Author's user id. '' when the author deleted their account. */
  authorId: string
}

/** One crew member's cut, as computed by the server. */
export interface SharedOpsPayout {
  userId: string
  name: string
  shares: number
  /** Whole aUEC. Negative when the op ran at a loss. */
  payout: number
}

export interface SharedOpsDetail {
  id: string
  name: string
  activity: SharedOpsActivity
  closed: boolean
  createdAt: string
  owner: string
  ownerId: string
  crew: SharedOpsCrew[]
  entries: SharedOpsEntry[]
  /** Ledger total in aUEC, from the server. */
  net: number
  totalShares: number
  /**
   * aUEC the server could not divide — only ever non-zero when the whole crew
   * sits at zero shares. Surfaced rather than silently dropped.
   */
  unallocated: number
  /** Per-member cuts. The client does not compute these; it renders them. */
  payouts: SharedOpsPayout[]
}

function mapOpsActivity(raw: unknown): SharedOpsActivity {
  const a = toStr(raw)
  if (a === 'salvage' || a === 'cargo' || a === 'other') return a
  return 'mining'
}

function mapOpsSummary(raw: unknown): SharedOpsSummary {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    id: toStr(r.id),
    name: toStr(r.name),
    activity: mapOpsActivity(r.activity),
    closed: r.closed === true || r.closed === 't',
    createdAt: toStr(r.created_at ?? r.createdAt),
    owner: toStr(r.owner),
    ownerId: toStr(r.owner_id ?? r.ownerId),
    isCrew: r.is_crew === true || r.is_crew === 't',
    crewCount: toOptNum(r.crew_count ?? r.crewCount) ?? 0,
    net: toOptNum(r.net) ?? 0,
  }
}

/**
 * List ops.
 *
 * `mine` asks the server for only the ops you own or crew. Filtering the
 * public board client-side is not an alternative: the board is capped at 100
 * rows, so an op you joined can fall off it entirely.
 */
export async function listSharedOps(
  options: { mine?: boolean } = {},
): Promise<SharedOpsSummary[]> {
  const data = await request<{ sessions?: unknown[] }>(
    options.mine ? '/api/ops?mine=1' : '/api/ops',
  )
  return (data.sessions ?? []).map(mapOpsSummary)
}

export async function createSharedOps(
  name: string,
  activity: SharedOpsActivity,
): Promise<{ id: string }> {
  const data = await request<{ id?: unknown }>('/api/ops', {
    method: 'POST',
    body: JSON.stringify({ name, activity }),
  })
  return { id: toStr(data.id) }
}

export async function getSharedOps(id: string): Promise<SharedOpsDetail> {
  const data = await request<Record<string, unknown>>(`/api/ops/${encodeURIComponent(id)}`)
  const s = (data.session ?? {}) as Record<string, unknown>
  const crew = Array.isArray(data.crew) ? data.crew : []
  const entries = Array.isArray(data.entries) ? data.entries : []
  const payouts = Array.isArray(data.payouts) ? data.payouts : []
  return {
    id: toStr(s.id),
    name: toStr(s.name),
    activity: mapOpsActivity(s.activity),
    closed: s.closed === true || s.closed === 't',
    createdAt: toStr(s.created_at),
    owner: toStr(s.owner),
    ownerId: toStr(s.owner_id ?? s.ownerId),
    net: toOptNum(data.net) ?? 0,
    totalShares: toOptNum(data.totalShares) ?? 0,
    unallocated: toOptNum(data.unallocated) ?? 0,
    payouts: payouts.map((p) => {
      const r = (p ?? {}) as Record<string, unknown>
      return {
        userId: toStr(r.userId ?? r.user_id),
        name: toStr(r.name),
        shares: toOptNum(r.shares) ?? 0,
        payout: toOptNum(r.payout) ?? 0,
      }
    }),
    crew: crew.map((c) => {
      const r = (c ?? {}) as Record<string, unknown>
      return {
        userId: toStr(r.user_id ?? r.userId),
        name: toStr(r.name),
        shares: toOptNum(r.shares) ?? 1,
      }
    }),
    entries: entries.map((e) => {
      const r = (e ?? {}) as Record<string, unknown>
      return {
        id: toStr(r.id),
        label: toStr(r.label),
        amount: toOptNum(r.amount) ?? 0,
        createdAt: toStr(r.created_at ?? r.createdAt),
        author: toStr(r.author),
        authorId: toStr(r.author_id ?? r.authorId),
      }
    }),
  }
}

export async function joinSharedOps(id: string): Promise<void> {
  await request(`/api/ops/${encodeURIComponent(id)}/join`, { method: 'POST' })
}

export async function leaveSharedOps(id: string): Promise<void> {
  await request(`/api/ops/${encodeURIComponent(id)}/leave`, { method: 'POST' })
}

export async function setSharedOpsShares(
  id: string,
  userId: string,
  shares: number,
): Promise<void> {
  await request(`/api/ops/${encodeURIComponent(id)}/shares`, {
    method: 'POST',
    body: JSON.stringify({ userId, shares }),
  })
}

export async function addSharedOpsEntry(
  id: string,
  label: string,
  amount: number,
): Promise<void> {
  await request(`/api/ops/${encodeURIComponent(id)}/entries`, {
    method: 'POST',
    body: JSON.stringify({ label, amount }),
  })
}

export async function deleteSharedOpsEntry(id: string, entryId: string): Promise<void> {
  await request(
    `/api/ops/${encodeURIComponent(id)}/entries/${encodeURIComponent(entryId)}`,
    { method: 'DELETE' },
  )
}

export async function toggleSharedOpsClosed(id: string): Promise<void> {
  await request(`/api/ops/${encodeURIComponent(id)}/close`, { method: 'POST' })
}

export async function deleteSharedOps(id: string): Promise<void> {
  await request(`/api/ops/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// --- Event timer calibration ------------------------------------------------

export interface ExecAnchor {
  /** Anchor whose residue mod the 185-min cycle marks an OPEN-phase start. */
  anchor: number | null
  observations: number
  lastReportAt?: string
}

/** Fetch the community-blended Executive Hangar anchor. Null when offline/demo. */
export async function getExecAnchor(): Promise<ExecAnchor | null> {
  if (!communityAvailable) return null
  try {
    const d = await request<Record<string, unknown>>('/api/timers/exec')
    return {
      anchor: typeof d.anchor === 'number' ? d.anchor : null,
      observations: toOptNum(d.observations) ?? 0,
      lastReportAt: toStr(d.lastReportAt) || undefined,
    }
  } catch {
    return null
  }
}

/** Share an "it just opened" observation (optionally backdated). Needs sign-in. */
export async function reportExecOpen(minutesAgo = 0): Promise<void> {
  await request('/api/timers/exec/observe', {
    method: 'POST',
    body: JSON.stringify({ minutesAgo }),
  })
}

// --- presentation helpers -------------------------------------------------

/** Render an ISO timestamp as a compact relative time, e.g. "3h ago". */
export function relativeTime(iso: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  if (diff < 0) return 'just now'
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  const wk = Math.floor(day / 7)
  if (wk < 5) return `${wk}w ago`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(day / 365)}y ago`
}

/** Format an ISO datetime for display, e.g. "Jun 25, 2026, 8:00 PM". Guards bad input. */
export function formatDateTime(iso: string | undefined): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  return new Date(t).toLocaleString()
}

/** True if a string looks like an http(s) URL we can render as an image. */
export function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Normalize a user-supplied RSI org SID — accepts the SID alone (e.g. "TEST")
 * or a pasted RSI org URL and extracts the SID. RSI SIDs are uppercase
 * alphanumeric, 1-30 chars. Returns empty string when nothing usable is found.
 */
export function normalizeRsiSid(input: string | undefined): string {
  if (!input) return ''
  const trimmed = input.trim()
  if (!trimmed) return ''

  // Handle pasted URLs like https://robertsspaceindustries.com/orgs/TEST
  const urlMatch = trimmed.match(/\/orgs\/([A-Z0-9]+)/i)
  const candidate = urlMatch ? urlMatch[1] : trimmed

  const sid = candidate.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (sid.length < 1 || sid.length > 30) return ''
  return sid
}

/** Public RSI org page URL for a given SID. */
export function rsiOrgUrl(sid: string): string {
  return `https://robertsspaceindustries.com/orgs/${encodeURIComponent(sid)}`
}

/** Public Spectrum community link for a given SID. */
export function rsiSpectrumUrl(sid: string): string {
  return `https://robertsspaceindustries.com/spectrum/community/${encodeURIComponent(sid)}`
}
