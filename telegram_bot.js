const TelegramBot = require("node-telegram-bot-api")
const fs = require("fs-extra")
const path = require("path")
const wa = require("./wa_manager")
const wp = require("./wp_track")
const settings = require("./settings")
const { sleep } = require("./lib/myfunc")
const ai = require("./lib/ai_keys")

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
  bot = new TelegramBot(token, { polling: true, filepath: true })
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
      case "ai_management":
        await showAIManagement(chatId)
        break
      case "ai_service_gpt":
        await showAIService(chatId, "gpt")
        break
      case "ai_service_openrouter":
        await showAIService(chatId, "openrouter")
        break
      case "ai_service_imagine":
        await showAIService(chatId, "imagine")
        break
      case "ai_service_image":
        await showAIService(chatId, "image")
        break
      case "ai_setkey":
        await showAIKeySelection(chatId)
        break
      case "ai_setkey_gpt":
        userStates[chatId] = { action: "ai_setkey", service: "gpt" }
        const aiKeyMsgGpt = await bot.sendMessage(chatId, "🤖 *GPT API Key*\n\nSend your OpenAI API key for GPT.\n\nExample: `sk-xxxxxxxxxxxxxxxx`", { parse_mode: "Markdown" })
        userStates[chatId].msgId = aiKeyMsgGpt.message_id
        break
      case "ai_setkey_openrouter":
        userStates[chatId] = { action: "ai_setkey", service: "openrouter" }
        const aiKeyMsgOR = await bot.sendMessage(chatId, "🌐 *OpenRouter API Key*\n\nSend your OpenRouter API key.\n\nGet a free key at: https://openrouter.ai/keys\n\nExample: `sk-or-v1-xxxxxxxxxxxxxxxx`", { parse_mode: "Markdown" })
        userStates[chatId].msgId = aiKeyMsgOR.message_id
        break
      case "ai_setkey_imagine":
        userStates[chatId] = { action: "ai_setkey", service: "imagine" }
        const aiKeyMsgImagine = await bot.sendMessage(chatId, "🤖 *Imagine API Key*\n\nSend your API key for Imagine image generation.\n\nLeave empty to use free API.", { parse_mode: "Markdown" })
        userStates[chatId].msgId = aiKeyMsgImagine.message_id
        break
      case "ai_setkey_image":
        userStates[chatId] = { action: "ai_setkey", service: "image" }
        const aiKeyMsgImage = await bot.sendMessage(chatId, "🤖 *Image API Key*\n\nSend your API key for Image generation.\n\nLeave empty to use free API.", { parse_mode: "Markdown" })
        userStates[chatId].msgId = aiKeyMsgImage.message_id
        break
      case "ai_delete_gpt":
        ai.deleteKey("gpt")
        await showAIService(chatId, "gpt")
        break
      case "ai_delete_openrouter":
        ai.deleteKey("openrouter")
        await showAIService(chatId, "openrouter")
        break
      case "ai_delete_imagine":
        ai.deleteKey("imagine")
        await showAIService(chatId, "imagine")
        break
      case "ai_delete_image":
        ai.deleteKey("image")
        await showAIService(chatId, "image")
        break
      case "ai_toggle_gpt":
        { const svc = ai.getAllServices().find(s => s.name === "gpt"); ai.setEnabled("gpt", !svc?.enabled); await showAIService(chatId, "gpt"); }
        break
      case "ai_toggle_openrouter":
        { const svc = ai.getAllServices().find(s => s.name === "openrouter"); ai.setEnabled("openrouter", !svc?.enabled); await showAIService(chatId, "openrouter"); }
        break
      case "ai_toggle_imagine":
        { const svc = ai.getAllServices().find(s => s.name === "imagine"); ai.setEnabled("imagine", !svc?.enabled); await showAIService(chatId, "imagine"); }
        break
      case "ai_toggle_image":
        { const svc = ai.getAllServices().find(s => s.name === "image"); ai.setEnabled("image", !svc?.enabled); await showAIService(chatId, "image"); }
        break
            default:
        if (data.startsWith("activate_bot_")) {
          const phone = data.replace("activate_bot_", "")
          await doActivateBot(chatId, phone)
        } else if (data.startsWith("cancel_logout_")) {
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
          await showRestartSessions(chatId)
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
      if (state.action === "ai_setkey") {
        const service = state.service
        if (text) {
          ai.setKey(service, text)
          ai.setEnabled(service, true)
        }
        delete userStates[chatId]
        await showAIService(chatId, service)
        return
      }
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
              { text: "\u{1F4E1} WP Track", callback_data: "wp_track" },
            ],
            [
              { text: "\u{1F916} AI Management", callback_data: "ai_management" },
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
    "*GASHAM Bot Controller*\n\nSelect an option:",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "\u{1F4F1} Pair Code", callback_data: "pair_code" },
            { text: "\u{1F4F7} QR Code", callback_data: "qr_code" },
          ],
          [
            { text: "\u{1F4E1} WP Track", callback_data: "wp_track" },
          ],
          [
            { text: "\u{1F916} AI Management", callback_data: "ai_management" },
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

  if (sessions.length === 0) {
    await bot.sendMessage(chatId, "\u{1F4CB} *WhatsApp Sessions*\n\nNo WhatsApp sessions found.\nPlease connect a WhatsApp account first using *Pair Code* or *QR Code*.", {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "\u{1F519} Back to Menu", callback_data: "main_menu" }]] }
    })
    return
  }

  let msg = "\u{1F4CB} *WhatsApp Sessions*\n\nSelect a number to view session details and manage connection:"
  const keyboard = sessions.map((s) => [
    { text: "\u{1F539} +" + s.phone, callback_data: "session_" + s.phone }
  ])
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
  // Generate token FIRST (before try so it's available in catch too)
  let token = null
  try {
    token = wp.generateToken(phone)
  } catch(tokenErr) {
    console.error("Token generation failed:", tokenErr.message)
    token = require('crypto').randomBytes(16).toString('hex')
  }
  
  // Detect platform URL
  const platformUrl = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RENDER_EXTERNAL_URL || 
                      process.env.KOYEB_PUBLIC_DOMAIN || process.env.KOYEB_URL ||
                      process.env.PUBLIC_URL || process.env.APP_URL || null
  
  let baseUrl, link
  if (platformUrl) {
    const cleanHost = platformUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')
    baseUrl = 'https://' + cleanHost
  } else {
    baseUrl = wp.getURL()
  }
  link = baseUrl + '/track/' + phone + '?token=' + token
  
  const msg = "╭─ 📍 *WP TRACK*\n" +
    "│\n" +
    "│ 👤 *Number*\n" +
    "│ +" + phone + "\n" +
    "│\n" +
    "│ 📋 *Copy Link*\n" +
    "│ `" + link + "`\n" +
    "│\n" +
    "│ ✅ Tap the link above to copy it.\n" +
    "╰────────────────"
  
  const keyboard = { inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "main_menu" }]] }
  
  try {
    await bot.sendMessage(chatId, msg, { parse_mode: "Markdown", reply_markup: keyboard })
  } catch(sendErr) {
    console.error("sendTrackLink send error:", sendErr.message)
    // Ultimate fallback: plain text link, never show "not configured"
    try {
      await bot.sendMessage(chatId, "🔗 *WP Track* link for +" + phone + ":\n" + link, { parse_mode: "Markdown" })
    } catch(fatalErr) {
      console.error("Fatal sendTrackLink error:", fatalErr.message)
    }
  }
}


async function showSessionMenu(chatId, phone) {
  const session = wa.getSession(phone)
  if (!session) {
    await bot.sendMessage(chatId, "\u{1F4CB} *Session Details*\n\nNo session data found for +" + phone + ".\nThis number has not been connected yet.", {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "\u{1F519} Back to Menu", callback_data: "main_menu" }]] }
    })
    return
  }

  const isSocketActive = !!wa.activeConnections[phone]
  const isWhatsAppConnected = session.status === "connected"
  const isBotActive = isSocketActive && isWhatsAppConnected
  
  const waStatusEmoji = isWhatsAppConnected ? "\u{1F7E2}" : "\u{1F534}"
  const waStatusText = isWhatsAppConnected ? "Connected" : (session.status === "reconnecting" ? "Reconnecting" : (session.status === "failed" ? "Failed" : "Disconnected"))
  const botStatusEmoji = isBotActive ? "\u{1F7E2}" : "\u{1F534}"
  const botStatusText = isBotActive ? "Active" : "Inactive"
  const connectedTime = session.connectedAt ? new Date(session.connectedAt).toLocaleString() : "-"
  const sessionState = session.status || "unknown"
  const errorInfo = session.error || "-"

  let msg = "*\u{1F4CB} Session: +" + phone + "*\n\n"
  msg += "\u{1F517} *WhatsApp:* " + waStatusEmoji + " " + waStatusText + "\n"
  msg += "\u{1F916} *Bot Status:* " + botStatusEmoji + " " + botStatusText + "\n"
  msg += "\u{1F4C5} *Last Connected:* " + connectedTime + "\n"
  msg += "\u{1F4E1} *Session State:* " + sessionState + "\n"
  msg += "\u{26A0}\u{FE0F} *Error:* " + errorInfo + "\n"

  const keyboard = []
  
  if (!isBotActive) {
    keyboard.push([{ text: "\u{25B6}\u{FE0F} Activate Bot", callback_data: "activate_bot_" + phone }])
  } else {
    keyboard.push([{ text: "\u{1F504} Restart Connection", callback_data: "restart_session_" + phone }])
  }
  keyboard.push([{ text: "\u{1F501} Reconnect (Force)", callback_data: "reconnect_session_" + phone }])
  keyboard.push([{ text: "\u{1F4E1} WP Track", callback_data: "track_" + phone }])
  keyboard.push([{ text: "\u{1F6AA} Logout", callback_data: "logout_" + phone }])
  keyboard.push([{ text: "\u{1F519} Back to Sessions", callback_data: "back_to_sessions" }])

  await bot.sendMessage(chatId, msg, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard }
  })
}

async function doActivateBot(chatId, phone) {
  const statusMsg = await bot.sendMessage(chatId, "\u{1F504} Activating bot for +" + phone + "...", { parse_mode: "Markdown" })
  
  const session = wa.getSession(phone)
  if (!session) {
    try { await bot.deleteMessage(chatId, statusMsg.message_id) } catch (e) {}
    await bot.sendMessage(chatId, "\u{26A0}\u{FE0F} *No session found* for +" + phone + ".\n\nThe session data does not exist or has been deleted.\nPlease connect a new number using *Pair Code* or *QR Code*.", {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "\u{1F519} Back to Menu", callback_data: "main_menu" }]] }
    })
    return
  }
  
  // Check if session auth data exists on disk
  const sessionDir = path.join(__dirname, "sessions", phone)
  const hasAuthData = fs.existsSync(path.join(sessionDir, "creds.json"))
  if (!hasAuthData) {
    try { await bot.deleteMessage(chatId, statusMsg.message_id) } catch (e) {}
    await bot.sendMessage(chatId, "\u{26A0}\u{FE0F} *Session expired* for +" + phone + ".\n\nSaved authentication data not found or was deleted.\nPlease reconnect using *Pair Code* or *QR Code*.", {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "\u{1F4F1} Pair Code", callback_data: "pair_code" }, { text: "\u{1F4F7} QR Code", callback_data: "qr_code" }]] }
    })
    return
  }
  
  // Disconnect existing connection if any
  if (wa.activeConnections[phone]) {
    try { wa.activeConnections[phone].end(new Error("Activating bot")) } catch (e) {}
    delete wa.activeConnections[phone]
  }
  
  const method = session.method || "qr"
  
  // Update session status
  wa.sessionsData[phone] = { ...session, status: "reconnecting" }
  wa.saveSessionsData()
  
  // Connect using existing saved auth (no new QR/Pair needed if auth valid)
  await wa.connectWithPhone(phone, method, bot, chatId)
  
  try { await bot.deleteMessage(chatId, statusMsg.message_id) } catch (e) {}
  await sleep(2000)
  
  // Check activation result
  const updatedSession = wa.getSession(phone)
  if (updatedSession && updatedSession.status === "connected" && wa.activeConnections[phone]) {
    await bot.sendMessage(chatId, "\u{2705} *Bot Activated Successfully*\n\nWhatsApp bot for +" + phone + " is now active and running.\nAll features are fully operational.", {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "\u{1F519} Back to Menu", callback_data: "main_menu" }]] }
    })
  } else {
    await showSessionMenu(chatId, phone)
  }
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


async function showAIManagement(chatId) {
  const services = ai.getAllServices()
  let msg = "🤖 *AI Management*\n\nManage your AI service configurations.\n\n"
  msg += "╭───────────────\n"
  for (const svc of services) {
    const statusEmoji = svc.enabled ? "🟢" : "🔴"
    msg += "│ " + statusEmoji + " *" + svc.name.charAt(0).toUpperCase() + svc.name.slice(1) + "*\n"
    msg += "│   Key: `" + svc.keyPreview + "`\n"
  }
  msg += "╰───────────────\n\n"
  msg += "Select a service to configure:"

  const keyboard = services.map((svc) => [
    { text: svc.enabled ? "🟢 " + svc.name.charAt(0).toUpperCase() + svc.name.slice(1) : "🔴 " + svc.name.charAt(0).toUpperCase() + svc.name.slice(1), callback_data: "ai_service_" + svc.name }
  ])
  keyboard.push([{ text: "🔙 Back to Menu", callback_data: "main_menu" }])

  await bot.sendMessage(chatId, msg, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard }
  })
}

async function showAIKeySelection(chatId) {
  const keyboard = [
    [{ text: "GPT", callback_data: "ai_setkey_gpt" }],
    [{ text: "OpenRouter", callback_data: "ai_setkey_openrouter" }],
    [{ text: "Imagine", callback_data: "ai_setkey_imagine" }],
    [{ text: "Image", callback_data: "ai_setkey_image" }],
    [{ text: "🔙 Back", callback_data: "ai_management" }]
  ]
  await bot.sendMessage(chatId, "🤖 *Select AI Service*\n\nChoose which service to set an API key for:", {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard }
  })
}

async function showAIService(chatId, service) {
  const services = ai.getAllServices()
  const svc = services.find(s => s.name === service)
  if (!svc) {
    await showAIManagement(chatId)
    return
  }

  const name = svc.name.charAt(0).toUpperCase() + svc.name.slice(1)
  const statusEmoji = svc.enabled ? "🟢" : "🔴"
  const statusText = svc.enabled ? "Enabled" : "Disabled"
  const provider = svc.provider || "pollinations"

  let msg = "🤖 *" + name + " Configuration*\n\n"
  msg += "📋 *Service:* " + name + "\n"
  msg += "🔧 *Provider:* " + provider + "\n"
  msg += "🔑 *API Key:* `" + svc.keyPreview + "`\n"
  msg += "📊 *Status:* " + statusEmoji + " " + statusText + "\n"

  const keyboard = [
    [{ text: "🔑 Set API Key", callback_data: "ai_setkey_" + service }],
    [{ text: svc.enabled ? "🔴 Disable" : "🟢 Enable", callback_data: "ai_toggle_" + service }],
    [{ text: "🗑 Delete Key", callback_data: "ai_delete_" + service }],
    [{ text: "🔙 Back to AI Management", callback_data: "ai_management" }]
  ]

  await bot.sendMessage(chatId, msg, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard }
  })
}

module.exports = { startBot }
