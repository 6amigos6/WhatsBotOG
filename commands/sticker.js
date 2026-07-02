const fs = require('fs-extra');
const path = require('path');
const { spawnSync } = require('child_process');
const webp = require('node-webpmux');
const Crypto = require('crypto');
const { tmpdir } = require('os');

const TMP = path.join(__dirname, '..', 'temp');
fs.ensureDirSync(TMP);

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

        const packname = global.packname || 'ORUJOV';
        const author = global.author || '@orujov';
        const isAnimated = mediaType === 'video';

        let stickerBuffer;
        if (mediaType === 'image' || mediaType === 'sticker') {
            stickerBuffer = await createImageSticker(buffer, packname, author);
        } else if (isAnimated) {
            stickerBuffer = await createVideoSticker(buffer, packname, author);
        }

        if (!stickerBuffer) {
            await sock.sendMessage(chatId, { react: { text: '\u{274C}', key: message.key } });
            await sock.sendMessage(chatId, { text: 'Failed to create sticker.' }, { quoted: message });
            return;
        }

        // Clean up temp files from /tmp
        try {
            const tmpFiles = fs.readdirSync(tmpdir()).filter(f => f.includes('sticker_') || f.includes('.webp'));
            for (const f of tmpFiles) {
                try { fs.unlinkSync(path.join(tmpdir(), f)); } catch {}
            }
        } catch {}

        // Send sticker with isAnimated flag for video stickers
        await sock.sendMessage(chatId, { react: { text: '\u{2705}', key: message.key } });
        
        const stickerMsg = { sticker: stickerBuffer };
        if (isAnimated) {
            // Extract dimensions from the WebP
            const img = new webp.Image();
            try {
                const tmpLoad = path.join(TMP, 'sticker_dim_' + Date.now() + '.webp');
                fs.writeFileSync(tmpLoad, stickerBuffer);
                await img.load(tmpLoad);
                stickerMsg.height = img.height;
                stickerMsg.width = img.width;
                fs.unlinkSync(tmpLoad);
            } catch {}
            // Mark as animated for WhatsApp
            stickerMsg.isAnimated = true;
        }
        
        await sock.sendMessage(chatId, stickerMsg);

    } catch (error) {
        console.error('[Sticker] Error:', error.message);
        try { await sock.sendMessage(chatId, { react: { text: '\u{274C}', key: message.key } }); } catch (e) {}
        try { await sock.sendMessage(chatId, { text: 'Sticker creation failed.' }, { quoted: message }); } catch (e) {}
    }
}

async function createImageSticker(buffer, packname, author) {
    const tmpIn = path.join(tmpdir(), Crypto.randomBytes(6).readUIntLE(0, 6).toString(36) + '.jpg');
    const tmpOut = path.join(tmpdir(), Crypto.randomBytes(6).readUIntLE(0, 6).toString(36) + '.webp');
    const tmpExif = path.join(tmpdir(), Crypto.randomBytes(6).readUIntLE(0, 6).toString(36) + '.webp');

    try {
        fs.writeFileSync(tmpIn, buffer);

        // Convert image to WebP using ffmpeg with optimal sticker dimensions
        const r = spawnSync('ffmpeg', [
            '-y', '-i', tmpIn,
            '-c:v', 'libwebp',
            '-vf', "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease",
            '-lossless', '0',
            '-quality', '60',
            tmpOut
        ], { timeout: 15000 });

        if (r.status !== 0) throw new Error('ffmpeg failed: ' + (r.stderr || '').toString().slice(0, 100));

        // Add EXIF metadata
        const result = await addWebpExif(tmpOut, tmpExif, packname, author);
        if (!result) throw new Error('EXIF add failed');

        const sticker = fs.readFileSync(tmpExif);
        return sticker;
    } catch (e) {
        console.error('[Sticker] Image conversion error:', e.message);
        return null;
    } finally {
        try { fs.unlinkSync(tmpIn); } catch {}
        try { fs.unlinkSync(tmpOut); } catch {}
        try { fs.unlinkSync(tmpExif); } catch {}
    }
}

async function createVideoSticker(buffer, packname, author) {
    const tmpIn = path.join(tmpdir(), Crypto.randomBytes(6).readUIntLE(0, 6).toString(36) + '.mp4');
    const tmpOut = path.join(tmpdir(), Crypto.randomBytes(6).readUIntLE(0, 6).toString(36) + '.webp');
    const tmpExif = path.join(tmpdir(), Crypto.randomBytes(6).readUIntLE(0, 6).toString(36) + '.webp');

    try {
        fs.writeFileSync(tmpIn, buffer);

        // Get video duration to decide encoding strategy
        let duration = 3;
        try {
            const probe = spawnSync('ffprobe', [
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                tmpIn
            ], { timeout: 5000, encoding: 'utf8' });
            if (probe.status === 0) {
                duration = parseFloat((probe.stdout || '').trim()) || 3;
            }
        } catch {}

        // Limit duration to max 3 seconds for sticker size control
        const capDuration = Math.min(duration, 3);
        
        // Use optimized settings for WhatsApp animated sticker compatibility:
        // - 320x320 (standard sticker size)
        // - 8 fps (smooth enough for stickers, low file size)
        // - Lossy compression with quality 40 (good balance)
        // - Loop 0 (infinite)
        // - Max 3 seconds (WhatsApp sticker friendly)
        const r = spawnSync('ffmpeg', [
            '-y',
            '-i', tmpIn,
            '-c:v', 'libwebp',
            '-vf', 'scale=320:320:force_original_aspect_ratio=decrease,fps=8',
            '-lossless', '0',
            '-quality', '40',
            '-loop', '0',
            '-t', String(capDuration),
            '-an',
            tmpOut
        ], { timeout: 30000 });

        if (r.status !== 0) {
            throw new Error('ffmpeg failed: ' + (r.stderr || '').toString().slice(0, 200));
        }

        // Check file size - if over 95KB, recompress with lower settings
        const stats = fs.statSync(tmpOut);
        if (stats.size > 95 * 1024) {
            console.log('[Sticker] File too large (' + (stats.size/1024).toFixed(1) + 'KB), recompressing...');
            const tmpRecompress = path.join(tmpdir(), Crypto.randomBytes(6).readUIntLE(0, 6).toString(36) + '.webp');
            const r2 = spawnSync('ffmpeg', [
                '-y', '-i', tmpOut,
                '-c:v', 'libwebp',
                '-lossless', '0',
                '-quality', '25',
                '-loop', '0',
                tmpRecompress
            ], { timeout: 15000 });
            
            if (r2.status === 0) {
                fs.unlinkSync(tmpOut);
                fs.renameSync(tmpRecompress, tmpOut);
            } else {
                try { fs.unlinkSync(tmpRecompress); } catch {}
            }
        }

        // Add EXIF metadata
        const result = await addWebpExif(tmpOut, tmpExif, packname, author);
        if (!result) throw new Error('EXIF add failed');

        const sticker = fs.readFileSync(tmpExif);
        return sticker;
    } catch (e) {
        console.error('[Sticker] Video conversion error:', e.message);
        return null;
    } finally {
        try { fs.unlinkSync(tmpIn); } catch {}
        try { fs.unlinkSync(tmpOut); } catch {}
        try { fs.unlinkSync(tmpExif); } catch {}
    }
}

async function addWebpExif(inputPath, outputPath, packname, author) {
    try {
        const img = new webp.Image();
        await img.load(inputPath);

        const json = {
            'sticker-pack-id': 'https://orujov.xyz',
            'sticker-pack-name': packname || 'WhatsApp Bot',
            'sticker-pack-publisher': author || '@orujov',
            'emojis': ['📦']
        };
        
        const exifAttr = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
        const jsonBuff = Buffer.from(JSON.stringify(json), 'utf-8');
        const exif = Buffer.concat([exifAttr, jsonBuff]);
        exif.writeUIntLE(jsonBuff.length, 14, 4);

        img.exif = exif;
        await img.save(outputPath);
        return true;
    } catch (e) {
        console.error('[Sticker] EXIF error:', e.message);
        // If EXIF fails, copy input to output as fallback
        try {
            fs.copyFileSync(inputPath, outputPath);
            return true;
        } catch {}
        return false;
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
