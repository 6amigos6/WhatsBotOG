const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
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

        await sock.sendMessage(chatId, { react: { text: '\u{1F5BC}', key: message.key } });

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

        await sock.sendMessage(chatId, { react: { text: '\u{2699}\u{FE0F}', key: message.key } }); // ⚙️ processing

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
        
        // Clear reaction after a moment
        setTimeout(async () => {
            try { await sock.sendMessage(chatId, { react: { text: '', key: message.key } }); } catch {}
        }, 2000);

    } catch (error) {
        console.error('[Sticker] Error:', error.message);
        try { await sock.sendMessage(chatId, { react: { text: '\u{274C}', key: message.key } }); } catch {}
        try { await sock.sendMessage(chatId, { text: 'Sticker creation failed.' }, { quoted: message }); } catch {}
    }
}

async function createImageSticker(buffer) {
    return await sharp(buffer)
        .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ 
            quality: 90,
            alphaQuality: 90,
            effort: 4  // balance speed vs compression
        })
        .toBuffer();
}

async function createVideoSticker(buffer) {
    const inputPath = path.join(TMP, 'sticker_in_' + Date.now() + '.mp4');
    const outputPath = path.join(TMP, 'sticker_out_' + Date.now() + '.webp');
    
    fs.writeFileSync(inputPath, buffer);
    
    try {
        // Step 1: Get video duration and trim if needed (max 10 seconds)
        let duration = 0;
        try {
            const probeOut = execSync(
                'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ' +
                JSON.stringify(inputPath),
                { timeout: 5000, encoding: 'utf-8' }
            );
            duration = parseFloat(probeOut.trim()) || 0;
        } catch (e) {
            // ffprobe might fail on some files, continue with default
        }
        
        // Limit to max 6 seconds for sticker
        const maxDuration = Math.min(duration || 6, 6);
        
        // Step 2: Convert to WebP with WhatsApp-compatible settings
        await new Promise((resolve, reject) => {
            const cmd = ffmpeg(inputPath);
            
            // Trim if needed
            if (duration > 6) {
                cmd.duration(6);
            }
            
            cmd.outputOptions([
                '-c:v', 'libwebp',
                '-vf', "scale='min(512,iw)':'min(512,ih)':force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000@0.0",
                '-loop', '0',
                '-quality', '85',
                '-preset', 'picture',
                '-an',
                '-vsync', '0',
                '-t', '6'
            ])
            .outputOptions(['-strict', 'unofficial'])
            .output(outputPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        });
        
        // Read result
        const data = fs.readFileSync(outputPath);
        if (!data || data.length === 0) throw new Error('Empty output');
        if (data.length > 1024 * 1024) {
            // File too large (>1MB), try compressing more
            console.log('[Sticker] File too large (' + (data.length / 1024 / 1024).toFixed(1) + 'MB), re-compressing...');
            const compressedPath = path.join(TMP, 'sticker_comp_' + Date.now() + '.webp');
            await new Promise((resolve, reject) => {
                ffmpeg(outputPath)
                    .outputOptions([
                        '-c:v', 'libwebp',
                        '-quality', '60',
                        '-preset', 'picture',
                        '-loop', '0'
                    ])
                    .output(compressedPath)
                    .on('end', resolve)
                    .on('error', reject)
                    .run();
            });
            const compData = fs.readFileSync(compressedPath);
            try { fs.unlinkSync(compressedPath); } catch {}
            fs.unlinkSync(inputPath);
            fs.unlinkSync(outputPath);
            return compData;
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
