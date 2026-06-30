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
async function autoReconnect() {
  const wa = require('./wa_manager')
  const sessionsData = wa.sessionsData || {}
  const sessionsDir = path.join(__dirname, 'sessions')
  
  let reconnected = false
  
  // Check sessions.json for connected sessions
  for (const [phone, session] of Object.entries(sessionsData)) {
    if (session.status === 'connected' || session.status === 'reconnecting') {
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
  
  // Clean up stale sessions that couldn't be reconnected
  const wa2 = require('./wa_manager')
  const staleEntries = Object.entries(wa2.sessionsData || {}).filter(([p, s]) => 
    s.status === 'logged_out' || s.status === 'timeout' || s.status === 'failed' || s.status === 'disconnected'
  )
  for (const [phone] of staleEntries) {
    console.log('🧹 Cleaning stale session:', phone)
    delete wa2.sessionsData[phone]
  }
  wa2.saveSessionsData()
  
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

tgBot.startBot(TELEGRAM_TOKEN)

// Auto-reconnect after a short delay to let Telegram bot start first
setTimeout(autoReconnect, 3000)
wp.startServer()
console.log(chalk.green("ORUJOV Bot Telegram Controller is running!"))

process.on("uncaughtException", (err) => console.error("❌ Uncaught Exception:", err))
process.on("unhandledRejection", (err) => console.error("❌ Unhandled Rejection:", err))
