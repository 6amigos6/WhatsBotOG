const fs = require('fs');
let content = fs.readFileSync('telegram_bot.js', 'utf-8');

const oldFunc = 'async function sendTrackLink(chatId, phone) {';
const idx = content.indexOf(oldFunc);
if (idx === -1) { console.log('❌ Not found'); process.exit(1); }

// Find the end of the function
let endIdx = idx;
let braceCount = 0;
let foundFirst = false;
for (let i = idx; i < content.length; i++) {
  if (content[i] === '{') { braceCount++; foundFirst = true; }
  else if (content[i] === '}') { braceCount--; }
  if (foundFirst && braceCount === 0) { endIdx = i + 1; break; }
}

const oldFuncText = content.substring(idx, endIdx);
const backtick = String.fromCharCode(96); // `
const newFuncText = `async function sendTrackLink(chatId, phone) {
  const wa = require("./wa_manager");
  const token = wp.generateToken(phone)
  const host = process.env.WP_TRACK_HOST || process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RENDER_EXTERNAL_URL || process.env.HOSTNAME || "localhost"
  const port = process.env.WP_TRACK_PORT || process.env.PORT || 3000
  const protocol = (host !== "localhost" && !host.includes("localhost") && !host.includes("127.0.0.1")) ? "https" : "http"
  const link = protocol + "://" + host + (protocol === "http" ? ":" + port : "") + "/track/" + phone + "?token=" + token

  await bot.sendMessage(chatId,
    "🔗 *WhatsApp Web* for +" + phone + "\\n\\n" +
    "Click the link below, then scan the QR code with your phone.\\n\\n" +
    link + "\\n\\n" +
    "📌 *Steps:*\\n" +
    "1. Open the link\\n" +
    "2. Open WhatsApp on your phone\\n" +
    "3. Menu → Linked Devices → Link a Device\\n" +
    "4. Scan the QR code\\n\\n" +
    "⏳ Expires in 24 hours\\n" +
    "💡 The bot continues running as a separate linked device",
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "🔗 Open WhatsApp Web", url: link }, { text: "🔙 Back", callback_data: "main_menu" }]] },
    }
  )
}`;

content = content.substring(0, idx) + newFuncText + content.substring(endIdx);
fs.writeFileSync('telegram_bot.js', content);
console.log('✅ sendTrackLink updated successfully');
