const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');

const TMP = path.join(__dirname, '..', 'temp');
fs.ensureDirSync(TMP);

async function stickerCommand(sock, chatId, message) {
    try {
        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quoted) {
            await sock.sendMessage(chatId, { text: 'Reply to an image, video, or GIF with .sticker to create a sticker.' }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, { react: { text: "{1F5BC}", key: message.key } });

        const msg = message.message?.extendedTextMessage?.contextInfo;
        const participant = msg?.participant || msg?.remoteJid;
        const quotedMsg = quoted;

        let buffer, mediaType;
        if (quotedMsg?.imageMessage) {
            buffer = await downloadMedia(sock, quotedMsg.imageMessage, participant);
            mediaType = 'image';
        } else if (quotedMsg?.videoMessage) {
            buffer = await downloadMedia(sock, quotedMsg.videoMessage, participant);
            mediaType = 'video';
        } else if (quotedMsg?.stickerMessage) {
            buffer = await downloadMedia(sock, quotedMsg.stickerMessage, participant);
            mediaType = 'sticker';
        } else {
            await sock.sendMessage(chatId, { text: 'Reply to an image, video, or GIF with .sticker.' }, { quoted: message });
            return;
        }

        if (!buffer) {
            await sock.sendMessage(chatId, { text: 'Could not download the media.' }, { quoted: message });
            return;
        }

        let stickerBuffer;
        if (mediaType === 'image' || mediaType === 'sticker') {
            stickerBuffer = await createImageSticker(buffer);
        } else if (mediaType === 'video') {
            stickerBuffer = await createVideoSticker(buffer);
        }

        if (!stickerBuffer) {
            await sock.sendMessage(chatId, { text: 'Failed to create sticker.' }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, { react: { text: '', key: message.key } });
        await sock.sendMessage(chatId, { sticker: stickerBuffer });
    } catch (error) {
        console.error('[Sticker] Error:', error.message);
        await sock.sendMessage(chatId, { react: { text: '', key: message.key } });
        try { await sock.sendMessage(chatId, { text: 'Sticker creation failed.' }, { quoted: message }); } catch {}
    }
}

async function createImageSticker(buffer) {
    const img = sharp(buffer);
    const meta = await img.metadata();
    return await img
        .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: 90 })
        .toBuffer();
}

async function createVideoSticker(buffer) {
    return new Promise((resolve, reject) => {
        const inputPath = path.join(TMP, 'sticker_in_' + Date.now() + '.mp4');
        const outputPath = path.join(TMP, 'sticker_out_' + Date.now() + '.webp');
        
        fs.writeFileSync(inputPath, buffer);
        
        ffmpeg(inputPath)
            .outputOptions([
                '-c:v', 'libwebp',
                '-vf', "scale='min(512,iw)':min'(512,ih)':force_original_aspect_ratio=decrease,fps=15,pad=512:512:-1:-1:color=#00000000@0.0",
                '-loop', '0',
                '-preset', 'default',
                '-an',
                '-vsync', '0',
                '-s', '512:512'
            ])
            .output(outputPath)
            .on('end', () => {
                try {
                    const data = fs.readFileSync(outputPath);
                    fs.unlinkSync(inputPath);
                    fs.unlinkSync(outputPath);
                    resolve(data);
                } catch (e) { reject(e); }
            })
            .on('error', (err) => {
                try { fs.unlinkSync(inputPath); } catch {}
                try { fs.unlinkSync(outputPath); } catch {}
                reject(err);
            })
            .run();
    });
}

async function downloadMedia(sock, msg, participant) {
    try {
        const wa = require('../wa_manager');
        const mediaType = msg.mimetype?.startsWith('video') ? 'video' : 
                          msg.mimetype?.startsWith('image') ? 'image' : 'document';
        const stream = await wa.downloadContentFromMessage(msg, mediaType);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return Buffer.concat(chunks);
    } catch (e) {
        console.error('Download error:', e.message);
        return null;
    }
}

module.exports = stickerCommand;
