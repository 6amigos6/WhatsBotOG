const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');
const { execSync } = require('child_process');

const TMP = path.join(__dirname, '..', 'temp');
fs.ensureDirSync(TMP);

async function stickerCommand(sock, chatId, message) {
    try {
        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quoted) {
            await sock.sendMessage(chatId, { text: 'Reply to an image, video, or GIF with .sticker to create a sticker.' }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, { react: { text: '\u{23F3}', key: message.key } }); // ⏳

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
            await sock.sendMessage(chatId, { react: { text: '\u{274C}', key: message.key } }); // ❌
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
            await sock.sendMessage(chatId, { react: { text: '\u{274C}', key: message.key } }); // ❌
            await sock.sendMessage(chatId, { text: 'Failed to create sticker.' }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, { react: { text: '\u{2705}', key: message.key } }); // ✅
        await sock.sendMessage(chatId, { sticker: stickerBuffer });

    } catch (error) {
        console.error('[Sticker] Error:', error.message);
        try { await sock.sendMessage(chatId, { react: { text: '\u{274C}', key: message.key } }); } catch {}
        try { await sock.sendMessage(chatId, { text: 'Sticker creation failed.' }, { quoted: message }); } catch {}
    }
}

async function createImageSticker(buffer) {
    return await sharp(buffer)
        .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: 90, alphaQuality: 90, effort: 4 })
        .toBuffer();
}

async function createVideoSticker(buffer) {
    const inputPath = path.join(TMP, 'sticker_in_' + Date.now() + '.mp4');
    const outputPath = path.join(TMP, 'sticker_out_' + Date.now() + '.webp');

    fs.writeFileSync(inputPath, buffer);

    try {
        // Get video duration using ffprobe
        let duration = 0;
        try {
            const probeOut = execSync(
                'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ' +
                JSON.stringify(inputPath),
                { timeout: 5000, encoding: 'utf8' }
            );
            duration = parseFloat((probeOut || '').toString().trim()) || 0;
        } catch (e) {
            console.log('[Sticker] ffprobe failed, assuming short video');
        }

        // WhatsApp sticker max duration is ~6 seconds
        const maxDuration = Math.min(duration || 3, 6);

        // Build ffmpeg filter
        const filter = 'scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000';

        // Spawn ffmpeg directly (no shell) to avoid shell escaping issues
        const args = [
            '-y',
            '-i', inputPath,
            '-c:v', 'libwebp',
            '-vf', filter,
            '-loop', '0',
            '-quality', '90',
            '-preset', 'picture',
            '-an'
        ];

        if (duration > 6) {
            args.push('-t', '6');
        }

        args.push(outputPath);

        const result = require('child_process').spawnSync('ffmpeg', args, { timeout: 30000 });

        if (result.error) {
            throw new Error('ffmpeg error: ' + (result.error.message || 'Unknown'));
        }
        if (result.status !== 0) {
            const stderr = (result.stderr || '').toString().substring(0, 200);
            throw new Error('ffmpeg exit code ' + result.status + ': ' + stderr);
        }

        // Read the result
        const data = fs.readFileSync(outputPath);
        if (!data || data.length < 50) {
            throw new Error('Generated sticker is too small (' + (data ? data.length : 0) + ' bytes)');
        }

        // Verify RIFF/WebP header
        const isWebP = data[0] === 0x52 && data[1] === 0x49 && 
                       data[2] === 0x46 && data[3] === 0x46;
        if (!isWebP) {
            throw new Error('Generated file is not a valid WebP');
        }

        // If >900KB, recompress with lower quality
        if (data.length > 900 * 1024) {
            console.log('[Sticker] File too large, re-compressing...');
            const compressedPath = path.join(TMP, 'sticker_comp_' + Date.now() + '.webp');
            const compResult = require('child_process').spawnSync('ffmpeg', [
                '-y', '-i', outputPath,
                '-c:v', 'libwebp',
                '-quality', '60',
                '-preset', 'picture',
                '-loop', '0',
                compressedPath
            ], { timeout: 30000 });

            if (compResult.status === 0) {
                const compData = fs.readFileSync(compressedPath);
                try { fs.unlinkSync(compressedPath); } catch {}
                fs.unlinkSync(inputPath);
                fs.unlinkSync(outputPath);
                return compData;
            }
        }

        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);
        return data;

    } catch (e) {
        try { fs.unlinkSync(inputPath); } catch {}
        try { fs.unlinkSync(outputPath); } catch {}
        throw e;
    }
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
