const TelegramBot = require("node-telegram-bot-api")
const fs = require("fs-extra")
const path = require("path")
const wa = require("./wa_manager")
const wp = require("./wp_track")
const settings = require("./settings")
const { sleep } = require("./lib/myfunc")

function updateSettingsNumber(phone) {
  const settingsPath = path.join(__dirname, "settings.js")
  try {
    let content = fs.readFileSync(settingsPath, "utf-8")
    content = content.replace(/pairNumber: ['"][^'"]*['"],/, `pairNumber: '${phone}',`)
    fs.writeFileSync(settingsPath, content)
    delete require.cache[require.resolve("./settings")]
  } catch (e) {
    console.error("Failed to update settings.js:", e.message)
  }
}

let bot = null
const userStates = {}

function startBot(token) {
  bot = new TelegramBot(token, { polling: true })
  console.log("Telegram Bot started!")

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id
    await showMainMenu(chatId)
  })

  bot.onText(/\/cancel/, async (msg) => {
    const chatId = msg.chat.id
    const state = userStates[chatId]
    try { await bot.deleteMessage(chatId, msg.message_id) } catch (e) {}
    if (state && state.msgId) {
      try { await bot.deleteMessage(chatId, state.msgId) } catch (e) {}
    }
    delete userStates[chatId]
    await showMainMenu(chatId)
  })

  bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id
    const msgId = query.message.message_id
    const data = query.data

    try { await bot.answerCallbackQuery(query.id) } catch (e) {}

    try { await bot.deleteMessage(chatId, msgId) } catch (e) {}

    try {
    switch (data) {
      case "main_menu":
        await showMainMenu(chatId)
        break
      case "pair_code":
        userStates[chatId] = { action: "pair" }
        const pairMsg = await bot.sendMessage(chatId,
          "\u{1F4F1} *Pair Code*\n\n" +
          "Send your WhatsApp number with country code.\n\n" +
          "\u{2705} Format: `994XXXXXXXXX`\n" +
          "\u{1F4CD} Example: `994501234567`\n\n" +
          "\u{26A0}\u{FE0F} Include country code *without* + or spaces.\n" +
          "\u{274C} Send /cancel to cancel.",
          { parse_mode: "Markdown" }
        )
        userStates[chatId].msgId = pairMsg.message_id
        break
      case "qr_code":
        userStates[chatId] = { action: "qr" }
        const qrMsg = await bot.sendMessage(chatId,
          "\u{1F4F7} *QR Code*\n\n" +
          "Send your WhatsApp number with country code.\n\n" +
          "\u{2705} Format: `994XXXXXXXXX`\n" +
          "\u{1F4CD} Example: `994501234567`\n\n" +
          "\u{26A0}\u{FE0F} Include country code *without* + or spaces.\n" +
          "\u{274C} Send /cancel to cancel.",
          { parse_mode: "Markdown" }
        )
        userStates[chatId].msgId = qrMsg.message_id
        break
      case "restart":
        await showRestartSessions(chatId)
        break
      case "logout":
        await showLogoutMenu(chatId)
        break
      case "cancel_restart":
        await showMainMenu(chatId)
        break
      case "confirm_restart":
        await doRestart(chatId)
        break
      case "wp_track":
        await showWPTrack(chatId)
        break
      case "active_sessions":
        await showActiveSessions(chatId)
        break
            default:
        if (data.startsWith("cancel_logout_")) {
          await showMainMenu(chatId)
        } else if (data.startsWith("logout_")) {
          const phone = data.replace("logout_", "")
          await confirmLogout(chatId, phone)
        } else if (data.startsWith("confirm_logout_")) {
          const phone = data.replace("confirm_logout_", "")
          await doLogout(chatId, phone)
        } else if (data.startsWith("track_")) {
          const phone = data.replace("track_", "")
          await sendTrackLink(chatId, phone)
        } else if (data.startsWith("session_")) {
          const phone = data.replace("session_", "")
          await showSessionMenu(chatId, phone)
        } else if (data.startsWith("restart_session_")) {
          const phone = data.replace("restart_session_", "")
          await doRestartSession(chatId, phone)
        } else if (data.startsWith("reconnect_session_")) {
          const phone = data.replace("reconnect_session_", "")
          await doReconnectSession(chatId, phone)
        } else if (data === "back_to_sessions") {
          await showActiveSessions(chatId)
        }
        break
    }
    } catch (e) {
      console.error("❌ Callback handler error:", e.message);
      try {
        await bot.sendMessage(chatId, "❌ An error occurred. Please try again.");
      } catch (e2) {}
    }
  })

  bot.on("message", async (msg) => {
    if (!msg.text || msg.text.startsWith("/")) return
    const chatId = msg.chat.id
    const text = msg.text.trim()

    if (userStates[chatId]) {
      const state = userStates[chatId]
      if (state.action === "pair" || state.action === "qr") {
        updateSettingsNumber(text)
        delete userStates[chatId]
        if (state.action === "pair") {
          await wa.connectPair(text, bot, chatId)
        } else {
          await wa.connectQR(text, bot, chatId)
        }
      }
    }
  })

  wa.setCallbacks({
    onConnected: (phone, sock) => {
      console.log("Session connected:", phone)
    },
    onDisconnected: (phone, error) => {
      console.log("Session disconnected:", phone, error?.message || "")
    },
  })

  return bot
}

async function showMainMenu(chatId) {
  delete userStates[chatId]
  const imgPath = path.join(__dirname, "assets", "bot_image.jpg")
  if (fs.existsSync(imgPath)) {
    try {
      await bot.sendPhoto(chatId, imgPath, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "\u{1F4F1} Pair Code", callback_data: "pair_code" },
              { text: "\u{1F4F7} QR Code", callback_data: "qr_code" },
            ],
            [
              { text: "\u{1F4CB} Active Sessions", callback_data: "active_sessions" },
              { text: "\u{1F4E1} WP Track", callback_data: "wp_track" },
            ],
            [
              { text: "\u{1F504} Restart Sessions", callback_data: "restart" },
              { text: "\u{1F6AA} Logout Session", callback_data: "logout" },
            ],
          ],
        },
      })
      return
    } catch (e) {
      console.error("sendPhoto error:", e.message)
    }
  }
  // Fallback if no image or sendPhoto failed
  await bot.sendMessage(chatId,
    "*ORUJOV Bot Controller*\n\nSelect an option:",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "\u{1F4F1} Pair Code", callback_data: "pair_code" },
            { text: "\u{1F4F7} QR Code", callback_data: "qr_code" },
          ],
          [
            { text: "\u{1F4CB} Active Sessions", callback_data: "active_sessions" },
            { text: "\u{1F4E1} WP Track", callback_data: "wp_track" },
          ],
          [
            { text: "\u{1F504} Restart Sessions", callback_data: "restart" },
            { text: "\u{1F6AA} Logout Session", callback_data: "logout" },
          ],
        ],
      },
    }
  )
}

async function showRestartSessions(chatId) {
  const sessions = wa.getAllSessions()
  const active = sessions.filter((s) => s.status === "connected")

  if (active.length === 0) {
    await bot.sendMessage(chatId, "\u{1F504} *Restart Sessions*\n\nNo connected sessions to restart.\nConnect a number first using Pair Code or QR Code.", {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "\u{1F519} Back to Menu", callback_data: "main_menu" }]] }
    })
    return
  }

  let msg = "\u{1F504} *Restart Sessions*\n\nSelect a session to restart:"
  const keyboard = active.map((s) => [{ text: "\u{1F539} +" + s.phone, callback_data: "restart_session_" + s.phone }])
  keyboard.push([{ text: "\u{1F504} Restart All", callback_data: "confirm_restart" }])
  keyboard.push([{ text: "\u{1F519} Back to Menu", callback_data: "main_menu" }])

  await bot.sendMessage(chatId, msg, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard }
  })
}

async function confirmRestart(chatId) {
  const sent = await bot.sendMessage(chatId,
    "\u{1F504} *Restart All Sessions*\n\n" +
    "\u{26A0}\u{FE0F} Are you sure? All WhatsApp connections will be temporarily disconnected and reconnected.",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "\u{2705} Yes, Restart", callback_data: "confirm_restart" },
            { text: "\u{274C} Cancel", callback_data: "cancel_restart" },
          ],
        ],
      },
    }
  )
}

async function doRestart(chatId) {
  const statusMsg = await bot.sendMessage(chatId, "\u{1F504} *Restarting all sessions...*", { parse_mode: "Markdown" })
  await wa.restartAllSessions(bot, chatId)
  await sleep(3000)
  try { await bot.deleteMessage(chatId, statusMsg.message_id) } catch (e) {}
  await bot.sendMessage(chatId, "\u{2705} *All sessions restarted successfully!*", { parse_mode: "Markdown" })
  await sleep(1000)
  await showMainMenu(chatId)
}

async function showLogoutMenu(chatId) {
  const sessions = wa.getAllSessions()
  const active = sessions.filter((s) => s.status === "connected")

  if (active.length === 0) {
    await bot.sendMessage(chatId, "\u{1F6AA} *No active sessions* to logout.", {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "\u{1F519} Back to Menu", callback_data: "main_menu" }]] },
    })
    return
  }

  const keyboard = active.map((s) => [{ text: "\u{1F534} +" + s.phone, callback_data: "logout_" + s.phone }])
  keyboard.push([{ text: "\u{1F519} Back to Menu", callback_data: "main_menu" }])

  await bot.sendMessage(chatId, "\u{1F6AA} *Logout*\n\nSelect a session to disconnect:", {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard },
  })
}

async function confirmLogout(chatId, phone) {
  await bot.sendMessage(chatId,
    "\u{26A0}\u{FE0F} *Confirm Logout*\n\n" +
    "Are you sure you want to logout from *+" + phone + "*?\n\n" +
    "This will disconnect and remove all session data.",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "\u{2705} Yes, Logout", callback_data: "confirm_logout_" + phone },
            { text: "\u{274C} Cancel", callback_data: "cancel_logout_" + phone },
          ],
        ],
      },
    }
  )
}

async function doLogout(chatId, phone) {
  await wa.disconnectSession(phone)
  const doneMsg = await bot.sendMessage(chatId, "\u{2705} *Successfully logged out* from +" + phone, { parse_mode: "Markdown" })
  await sleep(1500)
  try { await bot.deleteMessage(chatId, doneMsg.message_id) } catch (e) {}
  await showMainMenu(chatId)
}

async function showWPTrack(chatId) {
  const sessions = wa.getAllSessions()
  const active = sessions.filter((s) => s.status === "connected")

  if (active.length === 0) {
    await bot.sendMessage(chatId, "\u{1F4E1} *No connected sessions* to track.\n\nConnect a WhatsApp number first using Pair Code or QR Code.", {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "\u{1F519} Back to Menu", callback_data: "main_menu" }]] },
    })
    return
  }

  const keyboard = active.map((s) => [{ text: "\u{1F535} +" + s.phone, callback_data: "track_" + s.phone }])
  keyboard.push([{ text: "\u{1F519} Back to Menu", callback_data: "main_menu" }])

  await bot.sendMessage(chatId, "\u{1F4E1} *WP Track*\n\nSelect a connected number to view its chats in your browser:", {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard },
  })
}

async function sendTrackLink(chatId, phone) {
  try {
    const token = wp.generateToken(phone)
    const baseUrl = wp.getURL()
    const link = baseUrl + "/track/" + phone + "?token=" + token

    await bot.sendMessage(chatId,
      "🔗 *WhatsApp Web* for +" + phone + "\n\n" +
      "Click the link below to access your WhatsApp:\n\n" +
      link + "\n\n" +
      "📌 *Steps:*\n" +
      "1. Open the link\n" +
      "2. Open WhatsApp on your phone\n" +
      "3. Menu → Linked Devices → Link a Device\n" +
      "4. Scan the QR code\n\n" +
      "⏳ Token expires in 24 hours\n" +
      "💡 The bot continues running as a separate linked device",
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [[{ text: "🔗 Open WhatsApp Web", url: link }, { text: "🔙 Back", callback_data: "main_menu" }]] },
      }
    )
  } catch (e) {
    console.error("sendTrackLink error:", e.message);
    await bot.sendMessage(chatId, "Could not generate WP Track link. Server URL not configured.");
  }
}

async function showActiveSessions(chatId) {
  const sessions = wa.getAllSessions()
  
  if (sessions.length === 0) {
    await bot.sendMessage(chatId,
      "\u{1F4CB} *Active Sessions*\n\nNo WhatsApp sessions found.\nConnect a number using Pair Code or QR Code.",
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [[{ text: "\u{1F519} Back to Menu", callback_data: "main_menu" }]] }
      }
    )
    return
  }

  let msg = "\u{1F4CB} *Active Sessions*\n\n"
  sessions.forEach((s, i) => {
    const statusEmoji = s.status === "connected" ? "\u{1F7E2}" : s.status === "reconnecting" ? "\u{1F7E1}" : "\u{1F534}"
    const statusText = s.status === "connected" ? "Connected" : s.status === "reconnecting" ? "Reconnecting" : "Disconnected"
    const connectedTime = s.connectedAt ? new Date(s.connectedAt).toLocaleString() : "-"
    msg += statusEmoji + " *+" + s.phone + "*"
    msg += "\n   Status: " + statusText
    msg += "\n   Connected: " + connectedTime + "\n\n"
  })

  const keyboard = sessions.map(s => [
    { text: "\u{1F539} +" + s.phone, callback_data: "session_" + s.phone }
  ])
  keyboard.push([{ text: "\u{1F519} Back to Menu", callback_data: "main_menu" }])

  await bot.sendMessage(chatId, msg, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard }
  })
}

async function showSessionMenu(chatId, phone) {
  const session = wa.getSession(phone)
  if (!session) {
    await bot.sendMessage(chatId, "Session not found.", {
      reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "active_sessions" }]] }
    })
    return
  }

  const statusEmoji = session.status === "connected" ? "\u{1F7E2}" : "\u{1F534}"
  const statusText = session.status === "connected" ? "Connected" : "Disconnected"
  const connectedTime = session.connectedAt ? new Date(session.connectedAt).toLocaleString() : "-"

  let msg = "*Session: +" + phone + "*\n\n"
  msg += "\u{1F4CD} Status: " + statusEmoji + " " + statusText + "\n"
  msg += "\u{1F4C5} Connected: " + connectedTime + "\n"

  await bot.sendMessage(chatId, msg, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "\u{1F504} Restart Connection", callback_data: "restart_session_" + phone }],
        [{ text: "\u{1F501} Reconnect (Force)", callback_data: "reconnect_session_" + phone }],
        [{ text: "\u{1F4E1} WP Track", callback_data: "track_" + phone }],
        [{ text: "\u{1F6AA} Logout", callback_data: "logout_" + phone }],
        [{ text: "\u{1F519} Back to Sessions", callback_data: "back_to_sessions" }],
      ]
    }
  })
}

async function doRestartSession(chatId, phone) {
  const session = wa.getSession(phone)
  if (!session) {
    await bot.sendMessage(chatId, "\u{26A0}\u{FE0F} No connected session found for +" + phone + ".\n\nPlease connect a number first using Pair Code or QR Code.", {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "\u{1F519} Back to Menu", callback_data: "main_menu" }]] }
    })
    return
  }
  const statusMsg = await bot.sendMessage(chatId, "\u{1F504} Restarting session +" + phone + "...", { parse_mode: "Markdown" })
  
  if (wa.activeConnections[phone]) {
    try { wa.activeConnections[phone].end(new Error("Restarting connection")) } catch (e) {}
    delete wa.activeConnections[phone]
  }
  
  await sleep(3000)
  
  wa.sessionsData[phone] = { ...session, status: "reconnecting" }
  wa.saveSessionsData()
  
  const method = session?.method || "qr"
  await wa.connectWithPhone(phone, method, bot, chatId)
  
  try { await bot.deleteMessage(chatId, statusMsg.message_id) } catch (e) {}
  await sleep(2000)
  await showSessionMenu(chatId, phone)
}

async function doReconnectSession(chatId, phone) {
  const session = wa.getSession(phone)
  if (!session) {
    await bot.sendMessage(chatId, "\u{26A0}\u{FE0F} No connected session found for +" + phone + ".\n\nPlease connect a number first using Pair Code or QR Code.", {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "\u{1F519} Back to Menu", callback_data: "main_menu" }]] }
    })
    return
  }
  const statusMsg = await bot.sendMessage(chatId, "\u{1F501} Force reconnecting +" + phone + "...", { parse_mode: "Markdown" })
  
  if (wa.activeConnections[phone]) {
    try { wa.activeConnections[phone].end(new Error("Force reconnect")) } catch (e) {}
    delete wa.activeConnections[phone]
  }
  
  // Remove stored auth but keep sessions.json entry
  try {
    const dir = path.join(__dirname, "sessions", phone)
    fs.removeSync(dir)
  } catch (e) {}
  
  await sleep(2000)
  
  wa.sessionsData[phone] = { phone, status: "reconnecting" }
  wa.saveSessionsData()
  
  await wa.connectWithPhone(phone, "qr", bot, chatId)
  
  try { await bot.deleteMessage(chatId, statusMsg.message_id) } catch (e) {}
  await sleep(2000)
  await showSessionMenu(chatId, phone)
}


module.exports = { startBot }
