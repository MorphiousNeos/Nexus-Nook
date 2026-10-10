// =============================================================================
// NEXUS NOOK BACKEND - PRODUCTION API SERVER
// Star Citizen Companion App backend with RSI integration (mock)
// =============================================================================

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const crypto = require('crypto');
const { Pool } = require('pg');
const Redis = require('ioredis');
const { computeOpsPayouts } = require('./lib/opsSplit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Render (and most PaaS hosts) sit behind a reverse proxy; trust it so
// req.protocol and client IPs (used by the rate limiter) are correct.
app.set('trust proxy', 1);

// =============================================================================
// DATABASE SETUP
// =============================================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const redis = new Redis(process.env.REDIS_URL);

// =============================================================================
// MIDDLEWARE
// =============================================================================
app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  })
);
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per window
});
app.use('/api/', limiter);

// =============================================================================
// AUTHENTICATION MIDDLEWARE
// =============================================================================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// For endpoints that are public but tell a signed-in caller more than an
// anonymous one — the ops board names which sessions are yours. A bad or
// expired token is treated as no token rather than an error, so the public
// view keeps working for someone whose session has lapsed.
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return next();

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (!err) req.user = user;
    next();
  });
};

// =============================================================================
// RSI PUBLIC PROFILE LOOKUP
// =============================================================================
// IMPORTANT COMPLIANCE NOTE:
// Star Citizen / RSI has no official public API. This client looks up a user's
// PUBLIC RSI handle (the citizen handle anyone can view at
// robertsspaceindustries.com/citizens/<handle>). It must NEVER ask for or store
// a user's RSI password or log into their account on their behalf — doing so
// breaches RSI's Terms of Service and is an unacceptable security risk.
//
// The implementation below is a MOCK for development. A production build must
// source only publicly-available data through a ToS-compliant community API
// (see docs/COMPLIANCE.md) and prominently mark the app as unofficial / not
// affiliated with Cloud Imperium Games.
class RSIApiClient {
  constructor() {
    this.baseUrl = 'https://robertsspaceindustries.com';
    this.sessionCache = new Map();
  }

  // Looks up public data for a citizen handle. No credentials involved.
  async lookupPublicProfile(handle) {
    try {
      console.log('Looking up public RSI handle (mock):', handle);

      // Mock response for development.
      return {
        handle,
        organization: 'Nexus Vanguard',
        uec: 750000,
        ships: [
          {
            id: 'avenger_titan',
            name: 'Aegis Avenger Titan',
            manufacturer: 'Aegis Dynamics',
            type: 'Light Fighter',
            cargo: 8,
            crew: 1,
            speed: 220,
            price: 785000,
            pledge: true,
            status: 'Ready',
            location: 'Port Olisar',
            insurance: 'Active',
          },
        ],
        inventory: [],
      };
    } catch (error) {
      console.error('RSI lookup error:', error);
      throw new Error('Failed to look up RSI handle');
    }
  }

  async fetchProfile(token) {
    const cacheKey = `rsi:profile:${token}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    return {};
  }

  async fetchHangar(handle) {
    const cacheKey = `rsi:hangar:${handle}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    return [];
  }

  async syncUserData(handle) {
    const [profile, ships] = await Promise.all([
      this.fetchProfile(handle),
      this.fetchHangar(handle),
    ]);
    return { profile, ships };
  }
}

const rsiClient = new RSIApiClient();

// =============================================================================
// API ROUTES
// =============================================================================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Nexus Nook API v1.0',
  });
});

// -----------------------------------------------------------------------------
// USER AUTHENTICATION
// -----------------------------------------------------------------------------

// Register user
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existingUser = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (username, email, password, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, username, email, created_at`,
      [username, email, hashedPassword]
    );

    const user = result.rows[0];

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      token,
      user: { id: user.id, username: user.username, email: user.email },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Login user
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        rsiConnected: user.rsi_connected,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// -----------------------------------------------------------------------------
// DISCORD OAUTH
// -----------------------------------------------------------------------------
// Sign in with Discord (identify + email scopes only — we never touch guilds,
// messages, or anything else). Configure with DISCORD_CLIENT_ID and
// DISCORD_CLIENT_SECRET; the redirect URI registered in the Discord developer
// portal must be <API_PUBLIC_URL>/api/auth/discord/callback.

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const discordConfigured = !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET);

// Where to send the browser back to after auth. WEB_APP_URL is the full app
// URL including any path (GitHub Pages project sites live under a subpath);
// FRONTEND_URL is the bare origin used for CORS. Trailing slash normalized.
const frontendUrl = () =>
  (process.env.WEB_APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(
    /\/$/,
    '',
  );

const apiPublicUrl = (req) =>
  (process.env.API_PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

// One-time OAuth state tokens. Redis when available, in-memory fallback so
// local dev without Redis still works.
const oauthStateFallback = new Map();
async function storeOauthState(state) {
  try {
    await redis.set(`oauth:state:${state}`, '1', 'EX', 600);
  } catch {
    oauthStateFallback.set(state, Date.now());
    // Prune anything older than 10 minutes.
    for (const [k, t] of oauthStateFallback) {
      if (Date.now() - t > 600000) oauthStateFallback.delete(k);
    }
  }
}
async function consumeOauthState(state) {
  if (!state) return false;
  try {
    const key = `oauth:state:${state}`;
    const found = await redis.get(key);
    if (found) {
      await redis.del(key);
      return true;
    }
  } catch {
    /* fall through to memory */
  }
  if (oauthStateFallback.has(state)) {
    const fresh = Date.now() - oauthStateFallback.get(state) < 600000;
    oauthStateFallback.delete(state);
    return fresh;
  }
  return false;
}

const issueToken = (user) =>
  jwt.sign({ userId: user.id, username: user.username }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });

// Kick off the OAuth dance.
app.get('/api/auth/discord', async (req, res) => {
  if (!discordConfigured) {
    // Full-page navigation lands here, so bounce back to the app with a
    // readable message rather than a raw JSON error.
    return res.redirect(
      `${frontendUrl()}/#/auth?error=${encodeURIComponent(
        'Discord sign-in is not configured on this server yet.',
      )}`,
    );
  }
  const state = crypto.randomBytes(24).toString('hex');
  await storeOauthState(state);
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    response_type: 'code',
    redirect_uri: `${apiPublicUrl(req)}/api/auth/discord/callback`,
    scope: 'identify email',
    state,
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

// Handle the callback: exchange code, upsert user, hand a JWT to the web app
// via the URL hash (never a query string — hashes aren't sent to servers or
// logged by intermediaries).
app.get('/api/auth/discord/callback', async (req, res) => {
  const fail = (msg) =>
    res.redirect(`${frontendUrl()}/#/auth?error=${encodeURIComponent(msg)}`);

  try {
    if (!discordConfigured) return fail('Discord sign-in is not configured.');
    const { code, state } = req.query;
    if (!code) return fail('Discord did not return a sign-in code.');
    if (!(await consumeOauthState(state))) {
      return fail('Sign-in session expired — please try again.');
    }

    const tokenResp = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: `${apiPublicUrl(req)}/api/auth/discord/callback`,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
    );

    const me = (
      await axios.get('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${tokenResp.data.access_token}` },
        timeout: 10000,
      })
    ).data;

    const discordId = String(me.id);
    const displayName = (me.global_name || me.username || 'Citizen').slice(0, 60);
    const email = me.verified && me.email ? String(me.email).toLowerCase() : null;

    // 1) Existing Discord-linked account.
    let result = await pool.query('SELECT * FROM users WHERE discord_id = $1', [discordId]);
    let user = result.rows[0];

    // 2) Existing email account (verified email only) — link Discord to it.
    if (!user && email) {
      result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      if (result.rows.length > 0) {
        user = result.rows[0];
        await pool.query('UPDATE users SET discord_id = $1, updated_at = NOW() WHERE id = $2', [
          discordId,
          user.id,
        ]);
      }
    }

    // 3) Brand new account. Username must be unique; suffix on collision.
    if (!user) {
      let username = displayName;
      const clash = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
      if (clash.rows.length > 0) username = `${displayName}-${discordId.slice(-4)}`;
      // Random unusable password — Discord is the credential for this account.
      const password = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      const placeholderEmail = email || `discord-${discordId}@users.nexusnook.invalid`;
      result = await pool.query(
        `INSERT INTO users (username, email, password, discord_id, created_at)
         VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
        [username, placeholderEmail, password, discordId]
      );
      user = result.rows[0];
    }

    const token = issueToken(user);
    res.redirect(`${frontendUrl()}/#/auth?token=${encodeURIComponent(token)}`);
  } catch (error) {
    console.error('Discord OAuth error:', error?.response?.data || error.message);
    return fail('Discord sign-in failed — please try again.');
  }
});

// -----------------------------------------------------------------------------
// RSI INTEGRATION ROUTES
// -----------------------------------------------------------------------------

// Link a public RSI handle (no credentials — see compliance note above)
app.post('/api/rsi/connect', authenticateToken, async (req, res) => {
  try {
    const { rsiHandle } = req.body;
    const userId = req.user.userId;

    if (!rsiHandle || typeof rsiHandle !== 'string' || !rsiHandle.trim()) {
      return res.status(400).json({ error: 'A public RSI handle is required' });
    }

    const rsiData = await rsiClient.lookupPublicProfile(rsiHandle.trim());

    await pool.query(
      `UPDATE users
       SET rsi_connected = true,
           rsi_handle = $1,
           rsi_organization = $2,
           last_rsi_sync = NOW()
       WHERE id = $3`,
      [rsiData.handle, rsiData.organization, userId]
    );

    for (const ship of rsiData.ships) {
      await pool.query(
        `INSERT INTO user_ships (user_id, ship_name, manufacturer, type, pledge, data)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, ship_name) DO UPDATE
         SET data = $6, updated_at = NOW()`,
        [userId, ship.name, ship.manufacturer, ship.type, ship.pledge, JSON.stringify(ship)]
      );
    }

    res.json({
      success: true,
      message: 'RSI account connected successfully',
      data: {
        handle: rsiData.handle,
        organization: rsiData.organization,
        shipsImported: rsiData.ships.length,
      },
    });
  } catch (error) {
    console.error('RSI connection error:', error);
    res.status(500).json({ error: 'Failed to connect RSI account', details: error.message });
  }
});

// Sync RSI data
app.post('/api/rsi/sync', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const userResult = await pool.query('SELECT rsi_handle FROM users WHERE id = $1', [userId]);

    if (!userResult.rows[0]?.rsi_handle) {
      return res.status(400).json({ error: 'RSI account not connected' });
    }

    const handle = userResult.rows[0].rsi_handle;
    await rsiClient.syncUserData(handle);

    await pool.query('UPDATE users SET last_rsi_sync = NOW() WHERE id = $1', [userId]);

    res.json({
      success: true,
      message: 'Data synced successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('RSI sync error:', error);
    res.status(500).json({ error: 'Failed to sync RSI data' });
  }
});

// Get user ships
app.get('/api/ships', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT * FROM user_ships WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    const ships = result.rows.map((row) => ({ id: row.id, ...row.data }));

    res.json({ ships });
  } catch (error) {
    console.error('Get ships error:', error);
    res.status(500).json({ error: 'Failed to fetch ships' });
  }
});

// -----------------------------------------------------------------------------
// USER DATA ROUTES
// -----------------------------------------------------------------------------

// Get user profile
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT id, username, email, rsi_connected, rsi_handle,
              rsi_organization, last_rsi_sync, created_at
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Delete the signed-in user's account and all their data. Every user-owned
// table references users(id) with ON DELETE CASCADE (reports keep the row but
// null the reporter), so a single delete removes ships, progress, posts,
// listings, org memberships, and orgs they own.
app.delete('/api/user', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [
      req.user.userId,
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Account delete error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// Save user progress
app.post('/api/user/save', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { gameData } = req.body;

    await pool.query(
      `INSERT INTO user_progress (user_id, data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE
       SET data = $2, updated_at = NOW()`,
      [userId, JSON.stringify(gameData)]
    );

    res.json({ success: true, message: 'Progress saved' });
  } catch (error) {
    console.error('Save progress error:', error);
    res.status(500).json({ error: 'Failed to save progress' });
  }
});

// Load user progress
app.get('/api/user/load', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query('SELECT data FROM user_progress WHERE user_id = $1', [userId]);

    if (result.rows.length === 0) {
      return res.json({ gameData: null });
    }

    res.json({ gameData: result.rows[0].data });
  } catch (error) {
    console.error('Load progress error:', error);
    res.status(500).json({ error: 'Failed to load progress' });
  }
});

// -----------------------------------------------------------------------------
// SERVER STATUS ROUTES
// -----------------------------------------------------------------------------

// Get live server status (mock data, cached 30s)
// Map RSI/cstate status strings onto our four levels.
const mapRsiStatus = (raw) => {
  const s = String(raw || '').toLowerCase();
  if (/(ok|operational|online)/.test(s)) return 'online';
  if (/(maintenance)/.test(s)) return 'maintenance';
  if (/(down|major|outage)/.test(s)) return 'offline';
  if (/(notice|degraded|disrupted|partial)/.test(s)) return 'degraded';
  return 'online';
};

// Pull the official public status feed (status.robertsspaceindustries.com is
// a static status page that publishes index.json — the same document the
// status site itself renders). Read-only public data; cached 5 minutes.
async function fetchRsiPlatformStatus() {
  const resp = await axios.get('https://status.robertsspaceindustries.com/index.json', {
    timeout: 10000,
    headers: { Accept: 'application/json', 'User-Agent': 'NexusNook/1.0 (unofficial companion app)' },
  });
  const body = resp.data || {};
  // Tolerate both flat and cState-nested layouts.
  const systems = Array.isArray(body.systems)
    ? body.systems
    : Array.isArray(body.cState?.systems)
      ? body.cState.systems
      : [];
  const platform = systems
    .map((sys) => ({
      name: String(sys?.name || '').slice(0, 80),
      status: mapRsiStatus(sys?.status),
      category: sys?.category ? String(sys.category).slice(0, 80) : undefined,
    }))
    .filter((sys) => sys.name);
  if (platform.length === 0) throw new Error('RSI status feed had no systems');
  return platform;
}

app.get('/api/servers/status', async (req, res) => {
  try {
    const cached = await redis.get('server:status:v2').catch(() => null);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Official platform status (real data, gracefully absent on failure).
    let platform = null;
    let platformSource = 'unavailable';
    try {
      platform = await fetchRsiPlatformStatus();
      platformSource = 'rsi';
    } catch (err) {
      console.error('RSI status fetch failed:', err.message);
    }

    // Regional shard sample — CIG publishes no per-shard population/latency
    // numbers, so these are illustrative and labeled as such in the UI.
    const servers = [
      { region: 'US East', status: 'Online', players: Math.floor(Math.random() * 700), latency: 35, capacity: 700 },
      { region: 'US West', status: 'Online', players: Math.floor(Math.random() * 700), latency: 52, capacity: 700 },
      { region: 'EU', status: 'Online', players: Math.floor(Math.random() * 700), latency: 78, capacity: 700 },
      { region: 'Asia', status: 'Online', players: Math.floor(Math.random() * 700), latency: 145, capacity: 700 },
      { region: 'AU', status: 'Online', players: Math.floor(Math.random() * 700), latency: 180, capacity: 700 },
    ];

    const payload = { servers, platform, platformSource, fetchedAt: new Date().toISOString() };
    await redis.setex('server:status:v2', 300, JSON.stringify(payload)).catch(() => {});
    res.json(payload);
  } catch (error) {
    console.error('Server status error:', error);
    res.status(500).json({ error: 'Failed to fetch server status' });
  }
});

// =============================================================================
// SHARED OPS SESSIONS (community mining / salvage crews)
// =============================================================================
// Sessions are visible to everyone; any signed-in player can join an open
// crew, and crew members log the shared ledger together. The owner adjusts
// share weights and closes the session.

// List sessions, newest first, with owner/crew/net rollups.
//
// Two views from one route:
//   GET /api/ops          the public community board (no auth needed)
//   GET /api/ops?mine=1   only sessions the caller owns or crews (auth needed)
//
// The second exists because the board is capped at 100 rows. Without it, a
// player who joined someone else's op had no way to find it again once the
// board moved on — and crew membership is not visible in the board rows at all.
// Every row now carries `owner_id`, and a signed-in caller also gets `is_crew`,
// so clients can tell whose op it is without comparing display names.
app.get('/api/ops', optionalAuth, async (req, res) => {
  try {
    const mine = req.query.mine === '1' || req.query.mine === 'true';
    if (mine && !req.user) {
      return res.status(401).json({ error: 'Sign in to see your own ops' });
    }

    const viewerId = req.user?.userId ?? null;
    const selectColumns = `s.id, s.name, s.activity, s.closed, s.created_at, s.owner_id,
              u.username AS owner,
              (SELECT COUNT(*) FROM shared_ops_crew c WHERE c.session_id = s.id) AS crew_count,
              (SELECT COALESCE(SUM(e.amount), 0) FROM shared_ops_entries e WHERE e.session_id = s.id) AS net,
              ($1::int IS NOT NULL AND EXISTS (
                 SELECT 1 FROM shared_ops_crew c
                 WHERE c.session_id = s.id AND c.user_id = $1
               )) AS is_crew`;

    // "Mine" means ops I started *or* ops I am crewing — both are ops I am on.
    const result = mine
      ? await pool.query(
          `SELECT ${selectColumns}
           FROM shared_ops_sessions s JOIN users u ON u.id = s.owner_id
           WHERE s.owner_id = $1 OR EXISTS (
             SELECT 1 FROM shared_ops_crew c
             WHERE c.session_id = s.id AND c.user_id = $1
           )
           ORDER BY s.closed ASC, s.created_at DESC LIMIT 100`,
          [viewerId]
        )
      : await pool.query(
          `SELECT ${selectColumns}
           FROM shared_ops_sessions s JOIN users u ON u.id = s.owner_id
           ORDER BY s.closed ASC, s.created_at DESC LIMIT 100`,
          [viewerId]
        );

    res.json({ sessions: result.rows });
  } catch (error) {
    console.error('Ops list error:', error);
    res.status(500).json({ error: 'Failed to load sessions' });
  }
});

// Create a session; the creator joins the crew automatically.
app.post('/api/ops', authenticateToken, communityWriteLimit, async (req, res) => {
  const client = await pool.connect();
  try {
    const name = clamp(req.body.name, 120);
    if (!name) return res.status(400).json({ error: 'A session name is required' });
    const allowed = ['mining', 'salvage', 'cargo', 'other'];
    const activity = allowed.includes(req.body.activity) ? req.body.activity : 'mining';

    await client.query('BEGIN');
    const created = await client.query(
      `INSERT INTO shared_ops_sessions (owner_id, name, activity) VALUES ($1, $2, $3) RETURNING id`,
      [req.user.userId, name, activity]
    );
    const sessionId = created.rows[0].id;
    await client.query(
      `INSERT INTO shared_ops_crew (session_id, user_id) VALUES ($1, $2)`,
      [sessionId, req.user.userId]
    );
    await client.query('COMMIT');
    res.status(201).json({ success: true, id: sessionId });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Ops create error:', error);
    res.status(500).json({ error: 'Failed to create session' });
  } finally {
    client.release();
  }
});

// Session detail: crew (with shares) + ledger entries.
app.get('/api/ops/:id', async (req, res) => {
  try {
    const sessionResult = await pool.query(
      `SELECT s.id, s.name, s.activity, s.closed, s.created_at, s.owner_id,
              u.username AS owner
       FROM shared_ops_sessions s JOIN users u ON u.id = s.owner_id WHERE s.id = $1`,
      [req.params.id]
    );
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const crew = await pool.query(
      `SELECT c.user_id, u.username AS name, c.shares, c.joined_at
       FROM shared_ops_crew c JOIN users u ON u.id = c.user_id
       WHERE c.session_id = $1 ORDER BY c.joined_at ASC`,
      [req.params.id]
    );
    const entries = await pool.query(
      `SELECT e.id, e.label, e.amount, e.created_at, e.user_id AS author_id,
              u.username AS author
       FROM shared_ops_entries e LEFT JOIN users u ON u.id = e.user_id
       WHERE e.session_id = $1 ORDER BY e.created_at ASC LIMIT 500`,
      [req.params.id]
    );

    // The split is computed here, once, rather than in each client. Two crew
    // members looking at the same op on different devices must not be able to
    // arrive at different numbers, and a split nobody can test is a split
    // nobody should trust. See lib/opsSplit.js for the rounding rules.
    const { net, totalShares, unallocated, payouts } = computeOpsPayouts(
      crew.rows,
      entries.rows
    );

    res.json({
      session: sessionResult.rows[0],
      crew: crew.rows,
      entries: entries.rows,
      net,
      totalShares,
      unallocated,
      payouts,
    });
  } catch (error) {
    console.error('Ops detail error:', error);
    res.status(500).json({ error: 'Failed to load session' });
  }
});

// Join an open session's crew.
app.post('/api/ops/:id/join', authenticateToken, async (req, res) => {
  try {
    const s = await pool.query('SELECT closed FROM shared_ops_sessions WHERE id = $1', [
      req.params.id,
    ]);
    if (s.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    if (s.rows[0].closed) return res.status(400).json({ error: 'This session is closed' });
    await pool.query(
      `INSERT INTO shared_ops_crew (session_id, user_id) VALUES ($1, $2)
       ON CONFLICT (session_id, user_id) DO NOTHING`,
      [req.params.id, req.user.userId]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Ops join error:', error);
    res.status(500).json({ error: 'Failed to join session' });
  }
});

// Leave a session (owner cannot leave their own).
app.post('/api/ops/:id/leave', authenticateToken, async (req, res) => {
  try {
    const s = await pool.query('SELECT owner_id FROM shared_ops_sessions WHERE id = $1', [
      req.params.id,
    ]);
    if (s.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    if (s.rows[0].owner_id === req.user.userId) {
      return res.status(400).json({ error: 'The owner cannot leave — close or delete instead' });
    }
    await pool.query(
      'DELETE FROM shared_ops_crew WHERE session_id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Ops leave error:', error);
    res.status(500).json({ error: 'Failed to leave session' });
  }
});

// Owner: set a crew member's share weight (0-99.5 in 0.5 steps).
app.post('/api/ops/:id/shares', authenticateToken, async (req, res) => {
  try {
    const s = await pool.query('SELECT owner_id FROM shared_ops_sessions WHERE id = $1', [
      req.params.id,
    ]);
    if (s.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    if (s.rows[0].owner_id !== req.user.userId) {
      return res.status(403).json({ error: 'Only the session owner can set shares' });
    }
    const targetId = parseInt(req.body.userId, 10);
    const shares = Math.max(0, Math.min(99.5, Math.round((Number(req.body.shares) || 0) * 2) / 2));
    if (!Number.isFinite(targetId)) {
      return res.status(400).json({ error: 'A crew member userId is required' });
    }
    await pool.query(
      'UPDATE shared_ops_crew SET shares = $1 WHERE session_id = $2 AND user_id = $3',
      [shares, req.params.id, targetId]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Ops shares error:', error);
    res.status(500).json({ error: 'Failed to update shares' });
  }
});

// Crew: add a ledger entry (positive income, negative expense).
app.post('/api/ops/:id/entries', authenticateToken, communityWriteLimit, async (req, res) => {
  try {
    const member = await pool.query(
      'SELECT 1 FROM shared_ops_crew WHERE session_id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    if (member.rows.length === 0) {
      return res.status(403).json({ error: 'Join the session to log entries' });
    }
    const s = await pool.query('SELECT closed FROM shared_ops_sessions WHERE id = $1', [
      req.params.id,
    ]);
    if (s.rows[0]?.closed) return res.status(400).json({ error: 'This session is closed' });
    const label = clamp(req.body.label, 140);
    const amount = Math.trunc(Number(req.body.amount) || 0);
    if (!label || amount === 0) {
      return res.status(400).json({ error: 'A label and non-zero amount are required' });
    }
    await pool.query(
      `INSERT INTO shared_ops_entries (session_id, user_id, label, amount) VALUES ($1, $2, $3, $4)`,
      [req.params.id, req.user.userId, label, amount]
    );
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Ops entry error:', error);
    res.status(500).json({ error: 'Failed to add entry' });
  }
});

// Entry author or session owner: remove a ledger entry.
app.delete('/api/ops/:id/entries/:entryId', authenticateToken, async (req, res) => {
  try {
    const s = await pool.query('SELECT owner_id FROM shared_ops_sessions WHERE id = $1', [
      req.params.id,
    ]);
    if (s.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    const isOwner = s.rows[0].owner_id === req.user.userId;
    const result = isOwner
      ? await pool.query(
          'DELETE FROM shared_ops_entries WHERE id = $1 AND session_id = $2 RETURNING id',
          [req.params.entryId, req.params.id]
        )
      : await pool.query(
          'DELETE FROM shared_ops_entries WHERE id = $1 AND session_id = $2 AND user_id = $3 RETURNING id',
          [req.params.entryId, req.params.id, req.user.userId]
        );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Ops entry delete error:', error);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

// Owner: close/reopen a session.
app.post('/api/ops/:id/close', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE shared_ops_sessions SET closed = NOT closed WHERE id = $1 AND owner_id = $2 RETURNING closed',
      [req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, closed: result.rows[0].closed });
  } catch (error) {
    console.error('Ops close error:', error);
    res.status(500).json({ error: 'Failed to update session' });
  }
});

// Owner or moderator: delete a session.
app.delete('/api/ops/:id', authenticateToken, async (req, res) => {
  try {
    const admin = await isAdmin(req.user.userId);
    const result = admin
      ? await pool.query('DELETE FROM shared_ops_sessions WHERE id = $1 RETURNING id', [
          req.params.id,
        ])
      : await pool.query(
          'DELETE FROM shared_ops_sessions WHERE id = $1 AND owner_id = $2 RETURNING id',
          [req.params.id, req.user.userId]
        );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Ops delete error:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// =============================================================================
// EVENT TIMER CALIBRATION (Executive Hangar)
// =============================================================================
// The Executive Hangar cycle is a public game fact: 185 minutes, globally
// synchronized (120m charging / 60m open / 5m blackout). What shifts after
// every patch is the anchor — when an OPEN phase starts. Signed-in players
// report "it just opened"; we blend recent reports with a circular mean over
// the cycle and serve one shared anchor to everyone. Entirely our own
// crowd-sourced data — nothing scraped from anyone.

const EXEC_CYCLE_MS = 185 * 60 * 1000;
const EXEC_OBS_MAX_AGE_DAYS = 14; // patches reset the anchor; old reports are noise

// Report an open-phase start. Optional minutesAgo (0-185) backdates the
// observation ("it opened about 10 minutes ago").
app.post('/api/timers/exec/observe', authenticateToken, communityWriteLimit, async (req, res) => {
  try {
    const minutesAgo = Math.max(0, Math.min(185, Number(req.body.minutesAgo) || 0));
    const observedAt = new Date(Date.now() - minutesAgo * 60000);
    await pool.query(
      `INSERT INTO timer_observations (user_id, kind, observed_at) VALUES ($1, 'exec_hangar', $2)`,
      [req.user.userId, observedAt]
    );
    await redis.del('timers:exec').catch(() => {});
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Timer observe error:', error);
    res.status(500).json({ error: 'Failed to record observation' });
  }
});

// Shared anchor: circular mean of recent observations' cycle offsets. Returns
// an anchor timestamp whose residue mod the cycle matches the blended phase.
app.get('/api/timers/exec', async (req, res) => {
  try {
    const cached = await redis.get('timers:exec').catch(() => null);
    if (cached) return res.json(JSON.parse(cached));

    const result = await pool.query(
      `SELECT observed_at FROM timer_observations
       WHERE kind = 'exec_hangar' AND created_at > NOW() - INTERVAL '${EXEC_OBS_MAX_AGE_DAYS} days'
       ORDER BY created_at DESC LIMIT 50`
    );

    let payload;
    if (result.rows.length === 0) {
      payload = { anchor: null, observations: 0 };
    } else {
      // Circular mean of offsets within the cycle (handles wraparound).
      let sumSin = 0;
      let sumCos = 0;
      for (const row of result.rows) {
        const ts = new Date(row.observed_at).getTime();
        const theta = ((ts % EXEC_CYCLE_MS) / EXEC_CYCLE_MS) * 2 * Math.PI;
        sumSin += Math.sin(theta);
        sumCos += Math.cos(theta);
      }
      const meanTheta = Math.atan2(sumSin, sumCos);
      const residue =
        ((meanTheta / (2 * Math.PI)) * EXEC_CYCLE_MS + EXEC_CYCLE_MS) % EXEC_CYCLE_MS;
      const lastReport = new Date(result.rows[0].observed_at).getTime();
      payload = {
        anchor: Math.round(residue),
        observations: result.rows.length,
        lastReportAt: new Date(lastReport).toISOString(),
        cycleMs: EXEC_CYCLE_MS,
      };
    }

    await redis.setex('timers:exec', 60, JSON.stringify(payload)).catch(() => {});
    res.json(payload);
  } catch (error) {
    console.error('Timer anchor error:', error);
    res.status(500).json({ error: 'Failed to load timer calibration' });
  }
});

// =============================================================================
// COMMUNITY ROUTES (LFG, feed, marketplace)
// =============================================================================
// All listings are public to read; creating/deleting requires auth. Authors are
// surfaced by their public username only. User-generated content — keep it
// civil; no RSI account data is involved.

const clamp = (s, n) => (typeof s === 'string' ? s.trim().slice(0, n) : '');

// --- Write-abuse protection -------------------------------------------------
// Per-user cap on community writes: 12 per 5 minutes. Redis-backed with an
// in-memory fallback so a Redis hiccup degrades to per-instance limiting
// rather than an open door (or a closed community).
const WRITE_LIMIT = 12;
const WRITE_WINDOW_SEC = 300;
const writeCountFallback = new Map();

async function communityWriteLimit(req, res, next) {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ error: 'Access token required' });
  try {
    const key = `rl:community:${userId}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, WRITE_WINDOW_SEC);
    if (count > WRITE_LIMIT) {
      return res
        .status(429)
        .json({ error: 'Slow down a little — try again in a few minutes.' });
    }
  } catch {
    const now = Date.now();
    const entry = writeCountFallback.get(userId) || { count: 0, resetAt: now + WRITE_WINDOW_SEC * 1000 };
    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + WRITE_WINDOW_SEC * 1000;
    }
    entry.count += 1;
    writeCountFallback.set(userId, entry);
    if (entry.count > WRITE_LIMIT) {
      return res
        .status(429)
        .json({ error: 'Slow down a little — try again in a few minutes.' });
    }
  }
  next();
}

// Moderators: comma-separated ADMIN_EMAILS env var. Admins may delete any
// community content (not accounts).
const adminEmails = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

async function isAdmin(userId) {
  if (adminEmails.length === 0) return false;
  try {
    const r = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    const email = r.rows[0]?.email?.toLowerCase();
    return !!email && adminEmails.includes(email);
  } catch {
    return false;
  }
}

// Accepts either a SID alone (e.g. "TEST") or a pasted RSI org URL and
// extracts the SID portion. Returns null if nothing usable is found.
// RSI SIDs are uppercase alphanumeric, 1-30 chars.
const normalizeRsiSid = (input) => {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/\/orgs\/([A-Z0-9]+)/i);
  const candidate = urlMatch ? urlMatch[1] : trimmed;
  const sid = candidate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (sid.length < 1 || sid.length > 30) return null;
  return sid;
};

// --- Looking For Group ---
app.get('/api/lfg', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT l.id, l.title, l.activity, l.region, l.players_needed, l.body,
              l.created_at, u.username AS author
       FROM lfg_posts l JOIN users u ON u.id = l.user_id
       ORDER BY l.created_at DESC LIMIT 100`
    );
    res.json({ posts: result.rows });
  } catch (error) {
    console.error('LFG list error:', error);
    res.status(500).json({ error: 'Failed to load LFG posts' });
  }
});

app.post('/api/lfg', authenticateToken, communityWriteLimit, async (req, res) => {
  try {
    const title = clamp(req.body.title, 140);
    if (!title) return res.status(400).json({ error: 'A title is required' });
    const activity = clamp(req.body.activity, 60) || null;
    const region = clamp(req.body.region, 60) || null;
    const body = clamp(req.body.body, 2000) || null;
    const playersNeeded = Number.isFinite(+req.body.playersNeeded)
      ? Math.max(0, Math.min(100, parseInt(req.body.playersNeeded, 10)))
      : null;

    const result = await pool.query(
      `INSERT INTO lfg_posts (user_id, title, activity, region, players_needed, body)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
      [req.user.userId, title, activity, region, playersNeeded, body]
    );
    res.status(201).json({ success: true, id: result.rows[0].id });
  } catch (error) {
    console.error('LFG create error:', error);
    res.status(500).json({ error: 'Failed to create LFG post' });
  }
});

app.delete('/api/lfg/:id', authenticateToken, async (req, res) => {
  try {
    const admin = await isAdmin(req.user.userId);
    const result = admin
      ? await pool.query('DELETE FROM lfg_posts WHERE id = $1 RETURNING id', [req.params.id])
      : await pool.query(
          'DELETE FROM lfg_posts WHERE id = $1 AND user_id = $2 RETURNING id',
          [req.params.id, req.user.userId]
        );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('LFG delete error:', error);
    res.status(500).json({ error: 'Failed to delete LFG post' });
  }
});

// --- Community feed ---
app.get('/api/posts', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.body, p.image_url, p.created_at, u.username AS author
       FROM community_posts p JOIN users u ON u.id = p.user_id
       ORDER BY p.created_at DESC LIMIT 100`
    );
    res.json({ posts: result.rows });
  } catch (error) {
    console.error('Posts list error:', error);
    res.status(500).json({ error: 'Failed to load posts' });
  }
});

app.post('/api/posts', authenticateToken, communityWriteLimit, async (req, res) => {
  try {
    const body = clamp(req.body.body, 2000);
    if (!body) return res.status(400).json({ error: 'Post body is required' });
    const imageUrl = clamp(req.body.imageUrl, 500) || null;

    const result = await pool.query(
      `INSERT INTO community_posts (user_id, body, image_url)
       VALUES ($1, $2, $3) RETURNING id, created_at`,
      [req.user.userId, body, imageUrl]
    );
    res.status(201).json({ success: true, id: result.rows[0].id });
  } catch (error) {
    console.error('Post create error:', error);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

app.delete('/api/posts/:id', authenticateToken, async (req, res) => {
  try {
    const admin = await isAdmin(req.user.userId);
    const result = admin
      ? await pool.query('DELETE FROM community_posts WHERE id = $1 RETURNING id', [
          req.params.id,
        ])
      : await pool.query(
          'DELETE FROM community_posts WHERE id = $1 AND user_id = $2 RETURNING id',
          [req.params.id, req.user.userId]
        );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Post delete error:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

// --- Marketplace ---
app.get('/api/market', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.id, m.kind, m.title, m.price, m.body, m.created_at, u.username AS author
       FROM market_listings m JOIN users u ON u.id = m.user_id
       ORDER BY m.created_at DESC LIMIT 100`
    );
    res.json({ listings: result.rows });
  } catch (error) {
    console.error('Market list error:', error);
    res.status(500).json({ error: 'Failed to load listings' });
  }
});

app.post('/api/market', authenticateToken, communityWriteLimit, async (req, res) => {
  try {
    const title = clamp(req.body.title, 140);
    if (!title) return res.status(400).json({ error: 'A title is required' });
    const allowed = ['sell', 'buy', 'trade'];
    const kind = allowed.includes(req.body.kind) ? req.body.kind : 'sell';
    const body = clamp(req.body.body, 2000) || null;
    const price = Number.isFinite(+req.body.price)
      ? Math.max(0, Math.round(+req.body.price))
      : null;

    const result = await pool.query(
      `INSERT INTO market_listings (user_id, kind, title, price, body)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [req.user.userId, kind, title, price, body]
    );
    res.status(201).json({ success: true, id: result.rows[0].id });
  } catch (error) {
    console.error('Market create error:', error);
    res.status(500).json({ error: 'Failed to create listing' });
  }
});

app.delete('/api/market/:id', authenticateToken, async (req, res) => {
  try {
    const admin = await isAdmin(req.user.userId);
    const result = admin
      ? await pool.query('DELETE FROM market_listings WHERE id = $1 RETURNING id', [
          req.params.id,
        ])
      : await pool.query(
          'DELETE FROM market_listings WHERE id = $1 AND user_id = $2 RETURNING id',
          [req.params.id, req.user.userId]
        );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Market delete error:', error);
    res.status(500).json({ error: 'Failed to delete listing' });
  }
});

// --- Content reports ---------------------------------------------------------
// Anyone signed in can flag content for review; reports are stored for the
// moderators (see ADMIN_EMAILS). Rate-limited like other community writes.
app.post('/api/report', authenticateToken, communityWriteLimit, async (req, res) => {
  try {
    const allowedKinds = ['lfg', 'post', 'market', 'org', 'op'];
    const kind = allowedKinds.includes(req.body.kind) ? req.body.kind : null;
    const contentId = parseInt(req.body.contentId, 10);
    const reason = clamp(req.body.reason, 500) || null;
    if (!kind || !Number.isFinite(contentId)) {
      return res.status(400).json({ error: 'A content kind and id are required' });
    }
    await pool.query(
      `INSERT INTO content_reports (reporter_id, kind, content_id, reason)
       VALUES ($1, $2, $3, $4)`,
      [req.user.userId, kind, contentId, reason]
    );
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

// Moderators: list recent reports.
app.get('/api/reports', authenticateToken, async (req, res) => {
  try {
    if (!(await isAdmin(req.user.userId))) {
      return res.status(403).json({ error: 'Moderator access required' });
    }
    const result = await pool.query(
      `SELECT r.id, r.kind, r.content_id, r.reason, r.created_at,
              u.username AS reporter
       FROM content_reports r LEFT JOIN users u ON u.id = r.reporter_id
       ORDER BY r.created_at DESC LIMIT 200`
    );
    res.json({ reports: result.rows });
  } catch (error) {
    console.error('Reports list error:', error);
    res.status(500).json({ error: 'Failed to load reports' });
  }
});

// =============================================================================
// ORG / OPERATIONS ROUTES
// =============================================================================

// List all orgs (public) with member counts.
app.get('/api/orgs', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.id, o.name, o.tag, o.description, o.rsi_sid, o.created_at,
              u.username AS owner,
              (SELECT COUNT(*) FROM org_members m WHERE m.org_id = o.id) AS member_count
       FROM orgs o JOIN users u ON u.id = o.owner_id
       ORDER BY o.created_at DESC LIMIT 100`
    );
    res.json({ orgs: result.rows });
  } catch (error) {
    console.error('Orgs list error:', error);
    res.status(500).json({ error: 'Failed to load orgs' });
  }
});

// Create an org (creator becomes owner + first member).
app.post('/api/orgs', authenticateToken, communityWriteLimit, async (req, res) => {
  const client = await pool.connect();
  try {
    const name = clamp(req.body.name, 120);
    if (!name) return res.status(400).json({ error: 'An org name is required' });
    const tag = clamp(req.body.tag, 20) || null;
    const description = clamp(req.body.description, 2000) || null;
    const rsiSid = normalizeRsiSid(req.body.rsiSid ?? req.body.rsi_sid);

    await client.query('BEGIN');
    const orgResult = await client.query(
      `INSERT INTO orgs (owner_id, name, tag, description, rsi_sid)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.user.userId, name, tag, description, rsiSid]
    );
    const orgId = orgResult.rows[0].id;
    await client.query(
      `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [orgId, req.user.userId]
    );
    await client.query('COMMIT');
    res.status(201).json({ success: true, id: orgId });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Org create error:', error);
    res.status(500).json({ error: 'Failed to create org' });
  } finally {
    client.release();
  }
});

// Org detail: members + scheduled ops.
app.get('/api/orgs/:id', async (req, res) => {
  try {
    const orgResult = await pool.query(
      `SELECT o.id, o.name, o.tag, o.description, o.rsi_sid, o.created_at, o.owner_id,
              u.username AS owner
       FROM orgs o JOIN users u ON u.id = o.owner_id WHERE o.id = $1`,
      [req.params.id]
    );
    if (orgResult.rows.length === 0) return res.status(404).json({ error: 'Org not found' });

    const members = await pool.query(
      `SELECT u.username AS name, m.role, m.joined_at
       FROM org_members m JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $1 ORDER BY m.joined_at ASC`,
      [req.params.id]
    );
    const ops = await pool.query(
      `SELECT e.id, e.title, e.starts_at, e.body, e.created_at, u.username AS author
       FROM ops_events e JOIN users u ON u.id = e.user_id
       WHERE e.org_id = $1 ORDER BY e.starts_at NULLS LAST, e.created_at DESC LIMIT 100`,
      [req.params.id]
    );
    res.json({ org: orgResult.rows[0], members: members.rows, ops: ops.rows });
  } catch (error) {
    console.error('Org detail error:', error);
    res.status(500).json({ error: 'Failed to load org' });
  }
});

// Join an org.
app.post('/api/orgs/:id/join', authenticateToken, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO org_members (org_id, user_id) VALUES ($1, $2)
       ON CONFLICT (org_id, user_id) DO NOTHING`,
      [req.params.id, req.user.userId]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Org join error:', error);
    res.status(500).json({ error: 'Failed to join org' });
  }
});

// Leave an org (the owner cannot leave their own org).
app.post('/api/orgs/:id/leave', authenticateToken, async (req, res) => {
  try {
    const owner = await pool.query('SELECT owner_id FROM orgs WHERE id = $1', [req.params.id]);
    if (owner.rows[0]?.owner_id === req.user.userId) {
      return res.status(400).json({ error: 'The owner cannot leave; delete the org instead.' });
    }
    await pool.query('DELETE FROM org_members WHERE org_id = $1 AND user_id = $2', [
      req.params.id,
      req.user.userId,
    ]);
    res.json({ success: true });
  } catch (error) {
    console.error('Org leave error:', error);
    res.status(500).json({ error: 'Failed to leave org' });
  }
});

// Delete an org (owner only).
app.delete('/api/orgs/:id', authenticateToken, async (req, res) => {
  try {
    const admin = await isAdmin(req.user.userId);
    const result = admin
      ? await pool.query('DELETE FROM orgs WHERE id = $1 RETURNING id', [req.params.id])
      : await pool.query(
          'DELETE FROM orgs WHERE id = $1 AND owner_id = $2 RETURNING id',
          [req.params.id, req.user.userId]
        );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Org delete error:', error);
    res.status(500).json({ error: 'Failed to delete org' });
  }
});

// Schedule an operation/event (members only).
app.post('/api/orgs/:id/ops', authenticateToken, communityWriteLimit, async (req, res) => {
  try {
    const member = await pool.query(
      'SELECT 1 FROM org_members WHERE org_id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    if (member.rows.length === 0) {
      return res.status(403).json({ error: 'Join the org to schedule operations.' });
    }
    const title = clamp(req.body.title, 140);
    if (!title) return res.status(400).json({ error: 'A title is required' });
    const body = clamp(req.body.body, 2000) || null;
    let startsAt = null;
    if (req.body.startsAt) {
      const d = new Date(req.body.startsAt);
      if (!isNaN(d.getTime())) startsAt = d.toISOString();
    }

    const result = await pool.query(
      `INSERT INTO ops_events (org_id, user_id, title, starts_at, body)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.params.id, req.user.userId, title, startsAt, body]
    );
    res.status(201).json({ success: true, id: result.rows[0].id });
  } catch (error) {
    console.error('Ops create error:', error);
    res.status(500).json({ error: 'Failed to schedule operation' });
  }
});

// Delete an operation (its author or the org owner).
app.delete('/api/orgs/:id/ops/:eventId', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM ops_events e
       USING orgs o
       WHERE e.id = $1 AND e.org_id = $2 AND o.id = e.org_id
         AND (e.user_id = $3 OR o.owner_id = $3)
       RETURNING e.id`,
      [req.params.eventId, req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Ops delete error:', error);
    res.status(500).json({ error: 'Failed to delete operation' });
  }
});

// =============================================================================
// ERROR HANDLING
// =============================================================================
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// =============================================================================
// START SERVER
// =============================================================================
app.listen(PORT, () => {
  console.log(`Nexus Nook API server v1.0 listening on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});

module.exports = app;
