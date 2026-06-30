const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const { UploadFileUgu, TelegraPh } = require('../lib/uploader');

async function downloadMedia(msg, mediaType) {
  try {
    const stream = await downloadContentFromMessage(msg, mediaType);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  } catch (e) {
    console.error('downloadMedia error:', e.message);
    return null;
  }
}

function extractMedia(message) {
  const m = message.message || {};
  if (m.imageMessage) return { msg: m.imageMessage, type: 'image', ext: '.jpg' };
  if (m.videoMessage) return { msg: m.videoMessage, type: 'video', ext: '.mp4' };
  if (m.audioMessage) return { msg: m.audioMessage, type: 'audio', ext: '.mp3' };
  if (m.stickerMessage) return { msg: m.stickerMessage, type: 'sticker', ext: '.webp' };
  if (m.documentMessage) {
    const fName = m.documentMessage.fileName || 'file.bin';
    return { msg: m.documentMessage, type: 'document', ext: path.extname(fName) || '.bin' };
  }
  const quoted = m.extendedTextMessage?.contextInfo?.quotedMessage;
  if (quoted) {
    if (quoted.imageMessage) return { msg: quoted.imageMessage, type: 'image', ext: '.jpg' };
    if (quoted.videoMessage) return { msg: quoted.videoMessage, type: 'video', ext: '.mp4' };
    if (quoted.audioMessage) return { msg: quoted.audioMessage, type: 'audio', ext: '.mp3' };
    if (quoted.stickerMessage) return { msg: quoted.stickerMessage, type: 'sticker', ext: '.webp' };
    if (quoted.documentMessage) {
      return { msg: quoted.documentMessage, type: 'document', ext: path.extname(quoted.documentMessage.fileName || 'file.bin') || '.bin' };
    }
  }
  const vv = m.viewOnceMessageV2?.message || m.viewOnceMessage?.message;
  if (vv) {
    if (vv.imageMessage) return { msg: vv.imageMessage, type: 'image', ext: '.jpg' };
    if (vv.videoMessage) return { msg: vv.videoMessage, type: 'video', ext: '.mp4' };
    if (vv.audioMessage) return { msg: vv.audioMessage, type: 'audio', ext: '.mp3' };
    if (vv.documentMessage) {
      return { msg: vv.documentMessage, type: 'document', ext: path.extname(vv.documentMessage.fileName || 'file.bin') || '.bin' };
    }
  }
  return null;
}

// Sequential upload: try fastest provider first, fallback immediately on failure
async function uploadFile(filePath, ext) {
  const isImage = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);

  if (isImage) {
    // TelegraPh is fastest for images - try it first
    try {
      const url = await TelegraPh(filePath);
      if (url) return { url, provider: 'telegraph' };
    } catch {}
    // Fallback to Uguu
    try {
      const res = await UploadFileUgu(filePath);
      const url = typeof res === 'string' ? res : (res.url || res.url_full || '');
      if (url) return { url, provider: 'uguu' };
    } catch {}
  } else {
    // Uguu works for all non-image types
    try {
      const res = await UploadFileUgu(filePath);
      const url = typeof res === 'string' ? res : (res.url || res.url_full || '');
      if (url) return { url, provider: 'uguu' };
    } catch {}
  }
  return null;
}

async function urlCommand(sock, chatId, message) {
  try {
    const media = extractMedia(message);
    if (!media) {
      await sock.sendMessage(chatId, {
        text: 'Reply to any media (image, video, audio, sticker, document, GIF, ZIP, APK, PDF, etc.) with .url to get a shareable link.'
      }, { quoted: message });
      return;
    }

    // Show processing
    await sock.sendMessage(chatId, { react: { text: '⏳', key: message.key } });

    const buffer = await downloadMedia(media.msg, media.type);
    if (!buffer || buffer.length === 0) {
      await sock.sendMessage(chatId, { text: 'Failed to download media.' }, { quoted: message });
      return;
    }

    // Write temp and upload
    const tempDir = path.join(__dirname, '../temp');
    fs.mkdirSync(tempDir, { recursive: true });
    const tmpName = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}${media.ext}`;
    const tempPath = path.join(tempDir, tmpName);
    fs.writeFileSync(tempPath, buffer);

    const result = await uploadFile(tempPath, media.ext);

    // Cleanup temp immediately
    try { fs.unlinkSync(tempPath); } catch {}

    if (!result) {
      await sock.sendMessage(chatId, { text: 'Upload failed. Try again.' }, { quoted: message });
      return;
    }

    await sock.sendMessage(chatId, { react: { text: '', key: message.key } });

    const msg = `╭─ 🌐 *FILE URL*\n\n🔗 ${result.url}`;
    await sock.sendMessage(chatId, { text: msg, parse_mode: 'Markdown' }, { quoted: message });

  } catch (error) {
    console.error('[URL] error:', error?.message || error);
    try {
      await sock.sendMessage(chatId, { text: 'Error processing media.' }, { quoted: message });
    } catch {}
  }
}

module.exports = urlCommand;
