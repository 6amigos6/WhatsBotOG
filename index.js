const path = require("path")
const fs = require("fs-extra")
const chalk = require("chalk")
const settings = require("./settings")
require("./config")
const tgBot = require("./telegram_bot")
const wp = require("./wp_track")

const TEMP_DIR = path.join(__dirname, "temp")
fs.ensureDirSync(TEMP_DIR)
process.env.TMPDIR = TEMP_DIR
process.env.TEMP = TEMP_DIR
process.env.TMP = TEMP_DIR

const TELEGRAM_TOKEN = settings.telegramToken || process.env.TELEGRAM_TOKEN || (() => {
  try { return fs.readFileSync(path.join(__dirname, "token.txt"), "utf-8").trim() } catch (e) { return null }
})()

if (!TELEGRAM_TOKEN) {
  console.error(chalk.red("TELEGRAM_TOKEN not set!"))
  console.error(chalk.yellow("Add telegramToken to settings.js or create token.txt"))
  process.exit(1)
}


// Auto-reconnect to previously connected WhatsApp sessions on startup
// This preserves sessions across restarts, updates, and redeploys
// Session data is only deleted on explicit user logout
async function autoReconnect() {
  const wa = require('./wa_manager')
  const sessionsData = wa.sessionsData || {}
  const sessionsDir = path.join(__dirname, 'sessions')
  
  let reconnected = false
  
  // Check sessions.json for connected sessions
  for (const [phone, session] of Object.entries(sessionsData)) {
    if (session.status === 'connected' || session.status === 'reconnecting' || session.status === 'disconnected') {
      console.log('🔄 Auto-reconnecting to +' + phone + '...')
      const method = session.method || 'qr'
      try {
        await wa.connectWithPhone(phone, method, null, null)
        reconnected = true
        console.log('✅ Auto-reconnected +' + phone)
      } catch (e) {
        console.error('❌ Auto-reconnect failed for +' + phone + ': ' + e.message)
      }
    }
  }
  
  // Also check for auth directories that might have valid sessions
  try {
    const dirs = fs.readdirSync(sessionsDir)
    for (const dir of dirs) {
      if (dir === 'sessions.json') continue
      if (dir.startsWith('.')) continue
      
      // Check if this dir has auth files (creds.json)
      const authPath = path.join(sessionsDir, dir, 'creds.json')
      if (fs.existsSync(authPath)) {
        const phone = dir.replace(/[^0-9]/g, '')
        if (phone && (!sessionsData[phone] || sessionsData[phone]?.status !== 'connected')) {
          // Update sessions.json to trigger reconnect
          if (sessionsData[phone]) {
            sessionsData[phone].status = 'reconnecting'
          } else {
            sessionsData[phone] = { phone, status: 'reconnecting' }
          }
          console.log('🔄 Found stored auth for ' + dir + ', reconnecting...')
          try {
            await wa.connectWithPhone(phone, 'qr', null, null)
            reconnected = true
            console.log('✅ Auto-reconnected ' + dir)
          } catch (e) {
            console.error('❌ Auto-reconnect failed for ' + dir + ': ' + e.message)
          }
        }
      }
    }
  } catch (e) {
    console.log('No sessions to auto-reconnect: ' + e.message)
  }
  
  // Note: stale sessions are kept for potential reactivation by user
  
  if (!reconnected) console.log('No previous WhatsApp sessions found. Use Telegram to connect.')
}

setInterval(() => { if (global.gc) global.gc() }, 60000)

setInterval(() => {
  const used = process.memoryUsage().rss / 1024 / 1024
  if (used > 450) {
    console.log(`⚠️ RAM high (${used.toFixed(1)}MB), cleaning...`)
    if (global.gc) global.gc()
  }
}, 30000)

// Global temp & cache cleaner: clean temp/ dir every 5 min, media_cache/ every 15 min
const MEDIA_CACHE_DIR = path.join(__dirname, "media_cache");
setInterval(() => {
  // Clean temp/ - remove all files (temp files are transient)
  try {
    const files = fs.readdirSync(TEMP_DIR);
    let n = 0;
    for (const f of files) {
      try { const fp = path.join(TEMP_DIR, f); if (fs.statSync(fp).isFile()) { fs.unlinkSync(fp); n++; } } catch {}
    }
    if (n > 0) console.log(`🧹 Temp cleaned: ${n} files`);
  } catch {}
}, 300000);

setInterval(() => {
  // Clean media_cache/ - only files older than 30 minutes
  try {
    const phones = fs.readdirSync(MEDIA_CACHE_DIR);
    const cutoff = Date.now() - 1800000; // 30 min
    let n = 0;
    for (const phone of phones) {
      const dir = path.join(MEDIA_CACHE_DIR, phone);
      try {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          try {
            const fp = path.join(dir, f);
            if (fs.statSync(fp).isFile() && fs.statSync(fp).mtimeMs < cutoff) { fs.unlinkSync(fp); n++; }
          } catch {}
        }
        // Remove empty directories
        if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
      } catch {}
    }
    if (n > 0) console.log(`🧹 Media cache cleaned: ${n} stale files`);
  } catch {}
}, 900000); // 15 min

tgBot.startBot(TELEGRAM_TOKEN)

// Auto-reconnect after a short delay to let Telegram bot start first
setTimeout(autoReconnect, 3000)
wp.startServer()
console.log(chalk.green("GASHAM Bot Controller is running!"))
  try { require('./wa_manager').startStatusCleanup(); } catch(e) { console.log('Status cleanup not available:' + e.message); }

// ====== GRACEFUL SHUTDOWN ======
// On shutdown: close WhatsApp connections gracefully, save session state
async function gracefulShutdown(signal) {
  console.log("\n🛑 Received " + signal + ", shutting down gracefully...");
  try {
    const wa = require("./wa_manager");
    // Save session state before exit
    wa.saveSessionsData();
    // Close all active connections gracefully
    for (const [phone, sock] of Object.entries(wa.activeConnections || {})) {
      try {
        await sock?.logout?.();
        sock?.end(new Error("Shutdown"));
        console.log("  Closed connection for +" + phone);
      } catch (e) {}
    }
  } catch (e) {}
  console.log("👋 Goodbye!");
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGQUIT", () => gracefulShutdown("SIGQUIT"));

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err.message);
  // Don't exit on uncaught exceptions - let the process recover
});
process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Rejection:", err?.message || err);
});
