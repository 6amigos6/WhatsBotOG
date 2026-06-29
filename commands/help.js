const settings = require('../settings');
const fs = require('fs');
const path = require('path');

async function helpCommand(sock, chatId, message) {
    const menuMessage = `╭───────── ⚓ ─────────╮
          𝘽𝙤𝙩 𝘾𝙧𝙚𝙖𝙩𝙚𝙙 𝙗𝙮 𝙊𝙍𝙐𝙅𝙊𝙑        
            🤖 𝘽𝙊𝙏 𝙈𝙀𝙉𝙐 • 𝙫6.6           
╰─────────────────────╯
•𝐓𝐇𝐄 𝐋𝐈𝐅𝐄 𝐈𝐒 𝐍𝐎𝐓 𝐅𝐀𝐈𝐑 , 𝐘𝐎𝐔 𝐒𝐇𝐎𝐔𝐋𝐃 𝐍𝐎𝐓 𝐁𝐄 𝐀 𝐅𝐀𝐈𝐑•

╭─❍ 「 🌐 GENERAL 」
│➤ .help
│➤ .menu
│➤ .ping
│➤ .alive
│➤ .tts
│➤ .owner
│➤ .fact
│➤ .weather
│➤ .groupinfo
│➤ .admins
│➤ .vv
│➤ .ss
│➤ .jid
│➤ .url
╰───────────────

╭─❍ 「 🔒 OWNER 」
│➤ .mode
│➤ .clearsession
│➤ .antidelete
│➤ .cleartmp
│➤ .update
│➤ .settings
│➤ .setpp
│➤ .autoreact
│➤ .autostatus
│➤ .autoread
│➤ .anticall
│➤ .pmblocker
╰───────────────

╭─❍ 「 🤖 AI 」
│➤ .gpt
│➤ .gemini
│➤ .imagine
│➤ .flux
│➤ .sora
╰───────────────

╭─❍ 「 📥 DOWNLOAD 」
│➤ .play <song name>
│   📝 Example: .play shape of you
│➤ .song <song name or link>
│   📝 Example: .song shape of you
│➤ .spotify <song name>
│   📝 Example: .spotify blinding lights
│➤ .instagram <link>
│   📝 Example: Send Instagram link directly
│➤ .facebook <link>
│   📝 Example: .facebook <fb video url>
│➤ .tiktok <link>
│   📝 Example: Send TikTok link directly
│➤ .video <video name or link>
│   📝 Example: .video cat videos
│➤ .ytmp4 <youtube link>
│   📝 Example: .ytmp4 <youtube url>
╰───────────────

╭─❍ 「 🧩 MISC 」
│➤ .heart
│➤ .horny
│➤ .circle
│➤ .lgbt
│➤ .lolice
│➤ .namecard
│➤ .oogway
│➤ .tweet
│➤ .ytcomment
│➤ .gay
│➤ .glass
│➤ .jail
│➤ .passed
│➤ .triggered
╰───────────────

━━━━━━━━━━━━━━━━━━━━
⚓ ORUJOV ⚓
Premium WhatsApp Bot
Version 6.6
━━━━━━━━━━━━━━━━━━━━`;

    try {
        const imagePath = path.join(__dirname, '../assets/bot_image.jpg');

        if (fs.existsSync(imagePath)) {
            const imageBuffer = fs.readFileSync(imagePath);

            await sock.sendMessage(chatId, {
                image: imageBuffer,
                caption: menuMessage,
            }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, {
                text: menuMessage,
            }, { quoted: message });
        }
    } catch (error) {
        console.error('Error in help command:', error);
        await sock.sendMessage(chatId, { text: menuMessage });
    }
}

module.exports = helpCommand;
