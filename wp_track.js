const express = require("express")
const path = require("path")
const fs = require("fs-extra")
const crypto = require("crypto")
const http = require("http")

const SESSIONS_DIR = path.join(__dirname, "sessions")
const PUBLIC_DIR = path.join(__dirname, "public")
const MEDIA_CACHE_DIR = path.join(__dirname, "media_cache")
const PORT = process.env.WP_TRACK_PORT || process.env.PORT || 3000

// Auto-detect deployment URL from common platform environment variables
const PLATFORM_HOSTS = [
  process.env.WP_TRACK_HOST,
  process.env.PUBLIC_URL,
  process.env.APP_URL,
  process.env.RAILWAY_PUBLIC_DOMAIN,
  process.env.RENDER_EXTERNAL_URL,
  process.env.KOYEB_PUBLIC_DOMAIN,
  process.env.KOYEB_URL,
  process.env.FLY_APP_NAME ? (process.env.FLY_APP_NAME + ".fly.dev") : null,
  process.env.HEROKU_APP_NAME ? (process.env.HEROKU_APP_NAME + ".herokuapp.com") : null,
  process.env.HOSTNAME,
  process.env.DOMAIN,
  process.env.HOST
].filter(Boolean)

const RAW_HOST = (PLATFORM_HOSTS[0] || "").replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/\s/g, "")
const getURL = () => {
  if (RAW_HOST && RAW_HOST !== "localhost" && !RAW_HOST.includes("localhost") && !RAW_HOST.includes("127.0.0.1") && !RAW_HOST.startsWith("0."))
    return "https://" + RAW_HOST
  // Try environment-specific URL construction
  if (process.env.RAILWAY_STATIC_URL) return process.env.RAILWAY_STATIC_URL
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL
  if (process.env.KOYEB_URL) return process.env.KOYEB_URL
  if (process.env.HEROKU_APP_NAME) return "https://" + process.env.HEROKU_APP_NAME + ".herokuapp.com"
  if (process.env.FLY_APP_NAME) return "https://" + process.env.FLY_APP_NAME + ".fly.dev"
  // Check for common reverse proxy headers
  return "http://localhost:" + PORT
}

const tokens = new Map()
function generateToken(phone) {
  const token = crypto.randomBytes(24).toString("hex")
  tokens.set(token, phone)
  setTimeout(() => tokens.delete(token), 86400000)
  return token
}
function validateToken(token) {
  return tokens.has(token) ? tokens.get(token) : null
}

// Long-polling listeners
const updateListeners = new Map()
function notifyUpdate(phone) {
  const listeners = updateListeners.get(phone)
  if (listeners) {
    for (const res of listeners) {
      try { res.json({ updated: true, time: Date.now() }) } catch(e) {}
    }
    listeners.clear()
  }
}

// Data cache per phone with TTL
const dataCache = new Map()
function getCachedData(phone) {
  const cached = dataCache.get(phone)
  if (cached && Date.now() - cached.time < 3000) return cached.data
  const filePath = path.join(SESSIONS_DIR, phone, "messages.json")
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"))
      dataCache.set(phone, { data, time: Date.now() })
      return data
    }
  } catch(e) { console.error("loadChatData error:", e.message) }
  return null
}

function getProfilePic(phone, jid) {
  try {
    const ppPath = path.join(SESSIONS_DIR, phone, "profiles.json")
    if (fs.existsSync(ppPath)) {
      const data = JSON.parse(fs.readFileSync(ppPath, "utf-8"))
      return data[jid]?.url || null
    }
  } catch(e) {}
  return null
}

function getCachedMediaPath(phone, msgId) {
  // Direct check in media_cache directory
  const phoneDir = path.join(MEDIA_CACHE_DIR, phone)
  if (fs.existsSync(phoneDir)) {
    try {
      const files = fs.readdirSync(phoneDir)
      for (const file of files) {
        if (file.startsWith(msgId + ".")) return path.join(phoneDir, file)
      }
    } catch(e) {}
  }
  // Fallback: search in messages.json (slow, avoid if possible)
  const data = getCachedData(phone)
  if (!data) return null
  for (const [jid, chat] of Object.entries(data)) {
    if (jid === "_contacts") continue
    for (const msg of chat.messages || []) {
      if (msg.id === msgId && msg.cachedMedia && fs.existsSync(msg.cachedMedia))
        return msg.cachedMedia
    }
  }
  return null
}

// MIME type mapping
const MIME_TYPES = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", mp4: "video/mp4", ogg: "audio/ogg", opus: "audio/ogg",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", pdf: "application/pdf",
  bin: "application/octet-stream"
}

function startServer() {
  const app = express()
  const server = http.createServer(app)

  // Serve static frontend
  app.use(express.static(PUBLIC_DIR, { maxAge: "1h", etag: true }))

  // ====== PUBLIC ======
  app.get("/api/health", (req, res) => res.json({ status: "ok", server: getURL() }))

  app.get("/api/debug_token/:phone", (req, res) => {
    const phone = req.params.phone
    const token = generateToken(phone)
    res.json({ token, phone, link: getURL() + "/track/" + phone + "?token=" + token, expiresIn: "24 hours" })
  })

  // ====== AUTH MIDDLEWARE ======
  function authenticate(req, res, next) {
    const token = req.query.token || req.headers.authorization?.replace("Bearer ", "")
    if (!token) return res.status(401).json({ error: "Missing token" })
    const phone = validateToken(token)
    if (!phone) return res.status(403).json({ error: "Invalid or expired token" })
    req.authPhone = phone
    next()
  }

  // ====== AUTHENTICATED API ======
  app.get("/api/check", authenticate, (req, res) => {
    res.json({ valid: true, phone: req.authPhone, server: getURL() })
  })

  // GET /api/chats - list all chats (lightweight, only metadata)
  app.get("/api/chats", authenticate, (req, res) => {
    const phone = req.authPhone
    const data = getCachedData(phone)
    if (!data) return res.json({ chats: [] })

    const chats = []
    for (const [jid, chat] of Object.entries(data)) {
      if (jid === "_contacts") continue
      const msgs = chat.messages || []
      const last = msgs.length > 0 ? msgs[msgs.length - 1] : null
      let name = chat.name || jid.split("@")[0]
      if (data._contacts && data._contacts[jid]) name = data._contacts[jid].name || name
      chats.push({
        jid, name,
        type: chat.type || (jid.endsWith("@g.us") ? "group" : "individual"),
        lastMsg: last ? { text: (last.text || "").slice(0, 80), time: last.time || 0, fromMe: last.fromMe, type: last.type } : null,
        msgCount: msgs.length,
        updated: chat.lastUpdate || (last ? last.time : 0)
      })
    }
    chats.sort((a, b) => (b.updated || 0) - (a.updated || 0))

    res.set("Cache-Control", "no-cache")
    res.json({ chats, contacts: data._contacts || {} })
  })

  // GET /api/messages - paginated messages for a chat
  app.get("/api/messages", authenticate, (req, res) => {
    const phone = req.authPhone
    const jid = req.query.jid
    const limit = Math.min(parseInt(req.query.limit) || 30, 100)
    const before = parseInt(req.query.before) || 0

    if (!jid) return res.status(400).json({ error: "Missing jid" })

    const data = getCachedData(phone)
    if (!data || !data[jid]) return res.json({ messages: [], name: jid.split("@")[0], hasMore: false })

    const chat = data[jid]
    let msgs = chat.messages || []

    // Filter by 'before' timestamp for pagination
    if (before > 0) msgs = msgs.filter(m => m.time < before)

    // Take last N messages
    const hasMore = msgs.length > limit
    msgs = msgs.slice(-limit)

    res.set("Cache-Control", "no-cache")
    res.json({
      messages: msgs,
      name: chat.name || jid.split("@")[0],
      type: chat.type || "individual",
      jid,
      hasMore,
      total: (chat.messages || []).length,
      pic: getProfilePic(phone, jid),
      contacts: data._contacts || {}
    })
  })

  // Long-polling
  app.get("/api/poll", authenticate, (req, res) => {
    const phone = req.authPhone
    const timeout = parseInt(req.query.timeout) || 25000
    if (!updateListeners.has(phone)) updateListeners.set(phone, new Set())
    const listeners = updateListeners.get(phone)
    const timer = setTimeout(() => {
      listeners.delete(res)
      if (!res.headersSent) res.json({ updated: false, time: Date.now() })
    }, timeout)
    listeners.add(res)
    res.on("close", () => { clearTimeout(timer); listeners.delete(res) })
  })

  // GET /api/media - serve cached media with range support for streaming
  app.get("/api/media", authenticate, (req, res) => {
    const phone = req.authPhone
    const msgId = req.query.msgId

    if (!msgId) return res.status(400).json({ error: "Missing msgId" })

    // Try direct path from query
    if (req.query.path && fs.existsSync(req.query.path)) {
      return sendFileWithRange(req, res, path.resolve(req.query.path))
    }

    // Look up cached media
    const cachedPath = getCachedMediaPath(phone, msgId)
    if (cachedPath && fs.existsSync(cachedPath)) {
      return sendFileWithRange(req, res, cachedPath)
    }

    // Try media_cache by phone directory
    const phoneDir = path.join(MEDIA_CACHE_DIR, phone)
    if (fs.existsSync(phoneDir)) {
      try {
        const files = fs.readdirSync(phoneDir)
        for (const file of files) {
          if (file.startsWith(msgId + ".")) {
            return sendFileWithRange(req, res, path.join(phoneDir, file))
          }
        }
      } catch(e) {}
    }

    res.status(404).json({ error: "Media not cached" })
  })

  // GET /api/profile
  app.get("/api/profile", authenticate, (req, res) => {
    const phone = req.authPhone
    const jid = req.query.jid
    if (!jid) return res.status(400).json({ error: "Missing jid" })
    res.json({ jid, url: getProfilePic(phone, jid) })
  })

  // GET /api/statuses - Get stored statuses (stories)
  app.get("/api/statuses", authenticate, (req, res) => {
    const phone = req.authPhone
    const wa = require("./wa_manager")
    const statusData = wa.getStoredStatuses(phone)
    const statuses = statusData.statuses || []
    
    // Group by contact (from)
    const byContact = {}
    for (const s of statuses) {
      const from = s.from || "unknown"
      if (!byContact[from]) byContact[from] = { from, name: s.pushName || from.split("@")[0], statuses: [] }
      byContact[from].statuses.push(s)
    }
    
    // Sort each contact's statuses by time
    for (const k of Object.keys(byContact)) {
      byContact[k].statuses.sort((a, b) => (a.time || 0) - (b.time || 0))
      byContact[k].latest = byContact[k].statuses[byContact[k].statuses.length - 1].time || 0
    }
    
    // Convert to array sorted by latest
    const result = Object.values(byContact).sort((a, b) => (b.latest || 0) - (a.latest || 0))
    
    res.json({ statuses: result })
  })

  // ====== FRONTEND PAGES ======
  app.get("/track/:phone", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"))
  })

  app.get(["/wp/:phone"], (req, res) => {
    const qs = req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : ""
    res.redirect("/track/" + req.params.phone + qs)
  })

  app.get("/", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"))
  })

  server.listen(PORT, "0.0.0.0", () => {
    console.log("✅ WP Track server running on port " + PORT)
    console.log("🔗 URL: " + getURL() + "/track/[phone]?token=[token]")
  })

  return { app, server }
}

// Helper: send file with Range support for video/audio streaming
function sendFileWithRange(req, res, filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  const mime = MIME_TYPES[ext] || "application/octet-stream"

  fs.stat(filePath, (err, stat) => {
    if (err) return res.status(404).json({ error: "File not found" })

    const fileSize = stat.size
    const range = req.headers.range

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-")
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
      const chunkSize = end - start + 1

      if (start >= fileSize) {
        res.status(416).set("Content-Range", "bytes */" + fileSize).end()
        return
      }

      const stream = fs.createReadStream(filePath, { start, end })
      res.writeHead(206, {
        "Content-Range": "bytes " + start + "-" + end + "/" + fileSize,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": mime,
        "Cache-Control": "public, max-age=86400"
      })
      stream.pipe(res)
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": mime,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=86400"
      })
      fs.createReadStream(filePath).pipe(res)
    }
  })
}

module.exports = { startServer, generateToken, validateToken, getURL, notifyUpdate }
