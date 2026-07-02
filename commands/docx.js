const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { Document, Packer, Paragraph, TextRun, ImageRun } = require('docx');
const mammoth = require('mammoth');

const TMP = path.join(__dirname, '..', 'temp');
fs.ensureDirSync(TMP);

async function docxCommand(sock, chatId, message) {
    try {
        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quoted) {
            await sock.sendMessage(chatId, { text: '📝 Reply to a PDF or text file with `.docx` to convert it to DOCX.' }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, { react: { text: '📝', key: message.key } });

        const msg = message.message?.extendedTextMessage?.contextInfo;
        const participant = msg?.participant || msg?.remoteJid;
        const quotedMsg = quoted;

        let buffer, ext;
        if (quotedMsg?.documentMessage) {
            buffer = await downloadMedia(sock, quotedMsg.documentMessage, participant);
            ext = (quotedMsg.documentMessage.fileName || '').split('.').pop().toLowerCase() || 'bin';
        } else if (quotedMsg?.conversation) {
            buffer = Buffer.from(quotedMsg.conversation, 'utf-8');
            ext = 'txt';
        } else if (quotedMsg?.extendedTextMessage?.text) {
            buffer = Buffer.from(quotedMsg.extendedTextMessage.text, 'utf-8');
            ext = 'txt';
        } else {
            await sock.sendMessage(chatId, { text: '❌ Reply to a PDF, text, or document file with `.docx`.' }, { quoted: message });
            return;
        }

        if (!buffer) {
            await sock.sendMessage(chatId, { text: '❌ Could not read the file.' }, { quoted: message });
            return;
        }

        const docxBuffer = await convertToDocx(buffer, ext);
        if (!docxBuffer) {
            await sock.sendMessage(chatId, { text: '❌ Failed to convert to DOCX.' }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, { react: { text: '', key: message.key } });
        await sock.sendMessage(chatId, {
            document: docxBuffer,
            mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            fileName: 'converted.docx',
            caption: '📝 Converted to DOCX'
        });
    } catch (error) {
        console.error('[DOCX] Error:', error.message);
        await sock.sendMessage(chatId, { react: { text: '', key: message.key } });
        try { await sock.sendMessage(chatId, { text: '❌ DOCX conversion failed. Please try again.' }, { quoted: message }); } catch {}
    }
}

async function convertToDocx(buffer, ext) {
    if (ext === 'txt' || ext === 'html' || ext === 'csv') {
        const text = buffer.toString('utf-8');
        const doc = new Document({
            sections: [{
                properties: {},
                children: text.split('\n').map(line => 
                    new Paragraph({
                        children: [new TextRun({ text: line, size: 22 })],
                        spacing: { after: 120 }
                    })
                )
            }]
        });
        return await Packer.toBuffer(doc);
    } else if (ext === 'pdf') {
        // Extract text from PDF using basic method
        const text = buffer.toString('utf-8')
            .replace(/\(([^)]*)\)/g, '$1 ')
            .replace(/[^\x20-\x7E\n\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        const words = text.split(' ').filter(w => w.length > 0);
        const extracted = words.slice(0, 1000).join(' '); // limit to 1000 words
        
        const doc = new Document({
            sections: [{
                properties: {},
                children: extracted.split('. ').map(sent => 
                    new Paragraph({
                        children: [new TextRun({ text: (sent || '').trim() + '.', size: 22 })],
                        spacing: { after: 200 }
                    })
                )
            }]
        });
        return await Packer.toBuffer(doc);
    } else if (ext === 'docx') {
        // Already DOCX - pass through
        return buffer;
    } else {
        throw new Error('Unsupported format: ' + ext);
    }
}

async function downloadMedia(sock, msg, participant) {
    try {
        const wa = require('../wa_manager');
        const mediaType = msg.mimetype?.startsWith('application/pdf') ? 'document' : 'document';
        const stream = await wa.downloadContentFromMessage(msg, 'document');
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return Buffer.concat(chunks);
    } catch (e) {
        console.error('Download error:', e.message);
        return null;
    }
}

module.exports = docxCommand;
