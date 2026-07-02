const fs = require('fs-extra');
const path = require('path');
const { writeExifImg, writeExifVid } = require('../lib/exif');

async function stickerCommand(sock, chatId, message) {
    try {
        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quoted) {
            await sock.sendMessage(chatId, { text: 'Reply to an image, video, or GIF with .sticker to create a sticker.' }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, { react: { text: '\u{23F3}', key: message.key } });

        const msg = message.message?.extendedTextMessage?.contextInfo;
        const participant = msg?.participant || msg?.remoteJid;
        const quotedMsg = quoted;

        let buffer, mediaType;
        if (quotedMsg?.imageMessage) {
            buffer = await downloadMedia(sock, quotedMsg.imageMessage);
            mediaType = 'image';
        } else if (quotedMsg?.videoMessage) {
            buffer = await downloadMedia(sock, quotedMsg.videoMessage);
            mediaType = 'video';
        } else if (quotedMsg?.stickerMessage) {
            buffer = await downloadMedia(sock, quotedMsg.stickerMessage);
            mediaType = 'sticker';
        } else {
            await sock.sendMessage(chatId, { text: 'Reply to an image, video, or GIF with .sticker.' }, { quoted: message });
            return;
        }

        if (!buffer || buffer.length === 0) {
            await sock.sendMessage(chatId, { react: { text: '\u{274C}', key: message.key } });
            await sock.sendMessage(chatId, { text: 'Could not download the media.' }, { quoted: message });
            return;
        }

        let stickerBuffer;
        const packname = global.packname || 'WhatsApp Bot';
        const author = global.author || '@orujov';

        if (mediaType === 'image' || mediaType === 'sticker') {
            stickerBuffer = await createImageSticker(buffer, { packname, author });
        } else if (mediaType === 'video') {
            stickerBuffer = await createVideoSticker(buffer, { packname, author });
        }

        if (!stickerBuffer) {
            await sock.sendMessage(chatId, { react: { text: '\u{274C}', key: message.key } });
            await sock.sendMessage(chatId, { text: 'Failed to create sticker.' }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, { react: { text: '\u{2705}', key: message.key } });
        await sock.sendMessage(chatId, { sticker: stickerBuffer });

    } catch (error) {
        console.error('[Sticker] Error:', error.message);
        try { await sock.sendMessage(chatId, { react: { text: '\u{274C}', key: message.key } }); } catch (e) {}
        try { await sock.sendMessage(chatId, { text: 'Sticker creation failed.' }, { quoted: message }); } catch (e) {}
    }
}

async function createImageSticker(buffer, metadata) {
    try {
        const resultPath = await writeExifImg(buffer, {
            packname: metadata.packname,
            author: metadata.author,
            categories: ['📦']
        });
        if (!resultPath) return null;
        const sticker = fs.readFileSync(resultPath);
        try { fs.unlinkSync(resultPath); } catch (e) {}
        return sticker;
    } catch (e) {
        console.error('[Sticker] Image conversion error:', e.message);
        return null;
    }
}

async function createVideoSticker(buffer, metadata) {
    try {
        const resultPath = await writeExifVid(buffer, {
            packname: metadata.packname,
            author: metadata.author,
            categories: ['📦']
        });
        if (!resultPath) return null;
        const sticker = fs.readFileSync(resultPath);
        try { fs.unlinkSync(resultPath); } catch (e) {}
        return sticker;
    } catch (e) {
        console.error('[Sticker] Video conversion error:', e.message);
        return null;
    }
}

async function downloadMedia(sock, msg, participant) {
    try {
        const wa = require('../wa_manager');
        const mimetype = msg.mimetype || '';
        const mediaType = mimetype.startsWith('video') ? 'video' : 
                         mimetype.startsWith('image') ? 'image' : 'document';
        const stream = await wa.downloadContentFromMessage(msg, mediaType);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return Buffer.concat(chunks);
    } catch (e) {
        console.error('[Sticker] Download error:', e.message);
        return null;
    }
}

module.exports = stickerCommand;
