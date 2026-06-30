const settings = require('../settings');
const fs = require('fs');
const path = require('path');

async function helpCommand(sock, chatId, message) {
    const menuMessage = `╭───────── ⚓ ─────────╮
          𝘽𝙤𝙩 𝘾𝙧𝙚𝙖𝙩𝙚𝙙 𝙗𝙮 𝙊𝙍𝙐𝙅𝙊𝙑        
            🤖 𝘽𝙊𝙏 𝙈𝙀𝙉𝙐 • 𝙫6.6           
╰─────────────────────╯

「 🌐 GENERAL 」
╭──────────────
│ ⌬ .menu
│ ⌬ .ping
│ ⌬ .tts
│ ⌬ .vv
│ ⌬ .ss
│ ⌬ .jid
│ ⌬ .url
╰──────────────

「 🔒 OWNER 」
╭──────────────
│ ⌬ .mode
│ ⌬ .settings
│ ⌬ .update
│ ⌬ .setpp
│ ⌬ .autoread
│ ⌬ .autostatus
│ ⌬ .anticall
│ ⌬ .pmblocker
│ ⌬ .antidelete
│ ⌬ .clearsession
│ ⌬ .cleartmp
╰──────────────

「 🤖 AI 」
╭──────────────
│ ✦ .gpt
│ ✦ .gemini
│ ✦ .imagine
│ ✦ .flux
│ ✦ .sora
╰──────────────

「 📥 DOWNLOAD 」
╭──────────────
│ 🎵 .play <song>
│ 📥 .reply [on/off]
│ 📺 YouTube → Send Link
│ 📸 Instagram → Send Link
│ 📱 TikTok → Send Link
│ 📘 .facebook <link>
╰──────────────

「 🎨 EFFECTS 」
╭──────────────
│ ✨ .heart
│ ✨ .glass
│ ✨ .circle
│ ✨ .triggered
│ ✨ .passed
│ ✨ .jail
│ ✨ .tweet
│ ✨ .ytcomment
│ ✨ .namecard
│ ✨ .oogway
╰──────────────

━━━━━━━━━━━━━━━━━━━━━━
⚓ ORUJOV • WhatsApp Bot
🤖 Version : 6.6
💎 Fast • Stable • Premium
━━━━━━━━━━━━━━━━━━━━━━`;

    try {
        const imagePath = path.join(__dirname, '../assets/bot_image.jpg');
        if (fs.existsSync(imagePath)) {
            const imageBuffer = fs.readFileSync(imagePath);
            await sock.sendMessage(chatId, {
                image: imageBuffer,
                caption: menuMessage,
            }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, { text: menuMessage }, { quoted: message });
        }
    } catch (error) {
        console.error('Error in help command:', error);
        await sock.sendMessage(chatId, { text: menuMessage }, { quoted: message });
    }
}

module.exports = helpCommand;
