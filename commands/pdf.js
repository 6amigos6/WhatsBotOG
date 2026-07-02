const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const sharp = require('sharp');
const PDFDocument = require('pdfkit');
const mammoth = require('mammoth');
const { execSync } = require('child_process');

const TMP = path.join(__dirname, '..', 'temp');
fs.ensureDirSync(TMP);

async function pdfCommand(sock, chatId, message) {
    try {
        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quoted) {
            await sock.sendMessage(chatId, { text: '📄 Reply to a file (DOCX, image, text, etc.) with `.pdf` to convert it to PDF.' }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, { react: { text: '📄', key: message.key } });

        const msg = message.message?.extendedTextMessage?.contextInfo;
        const participant = msg?.participant || msg?.remoteJid;
        const quotedMsg = quoted;

        let buffer, ext;
        if (quotedMsg?.documentMessage) {
            buffer = await downloadMedia(sock, quotedMsg.documentMessage, participant);
            ext = (quotedMsg.documentMessage.fileName || '').split('.').pop().toLowerCase() || 'bin';
        } else if (quotedMsg?.imageMessage) {
            buffer = await downloadMedia(sock, quotedMsg.imageMessage, participant);
            ext = 'image';
        } else if (quotedMsg?.videoMessage) {
            buffer = await downloadMedia(sock, quotedMsg.videoMessage, participant);
            ext = 'image'; // treat first frame
        } else {
            await sock.sendMessage(chatId, { text: '❌ Unsupported file type. Reply to a document, image, or text file with `.pdf`.' }, { quoted: message });
            return;
        }

        if (!buffer) {
            await sock.sendMessage(chatId, { text: '❌ Could not download the file.' }, { quoted: message });
            return;
        }

        const pdfBuffer = await convertToPdf(buffer, ext);
        if (!pdfBuffer) {
            await sock.sendMessage(chatId, { text: '❌ Failed to convert to PDF. Unsupported format.' }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, { react: { text: '', key: message.key } });
        await sock.sendMessage(chatId, {
            document: pdfBuffer,
            mimetype: 'application/pdf',
            fileName: 'converted.pdf',
            caption: '📄 Converted to PDF'
        });
    } catch (error) {
        console.error('[PDF] Error:', error.message);
        await sock.sendMessage(chatId, { react: { text: '', key: message.key } });
        try { await sock.sendMessage(chatId, { text: '❌ PDF conversion failed: ' + error.message }, { quoted: message }); } catch {}
    }
}

async function convertToPdf(buffer, ext) {
    const inputPath = path.join(TMP, 'input_' + Date.now() + '.' + (ext === 'image' ? 'jpg' : ext));
    const outputPath = path.join(TMP, 'output_' + Date.now() + '.pdf');
    
    try {
        fs.writeFileSync(inputPath, buffer);

        if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'image'].includes(ext)) {
            // Image → PDF using sharp
            const imgBuffer = ext === 'gif' ? buffer : await sharp(buffer).jpeg().toBuffer();
            const doc = new PDFDocument({ margin: 0, autoFirstPage: false });
            const writeStream = fs.createWriteStream(outputPath);
            doc.pipe(writeStream);

            const img = sharp(imgBuffer);
            const meta = await img.metadata();
            const pageWidth = Math.min(meta.width || 595, 595);
            const pageHeight = Math.min(meta.height || 842, 842);
            const scale = Math.min(pageWidth / (meta.width || 1), pageHeight / (meta.height || 1));
            const w = Math.round((meta.width || 1) * scale);
            const h = Math.round((meta.height || 1) * scale);

            doc.addPage({ size: [pageWidth, pageHeight] });
            doc.image(imgBuffer, (pageWidth - w) / 2, (pageHeight - h) / 2, { width: w, height: h });
            doc.end();

            await new Promise((resolve, reject) => {
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
            });
        } else if (['txt', 'html', 'csv'].includes(ext)) {
            // Text → PDF
            const text = buffer.toString('utf-8');
            const doc = new PDFDocument({ margin: 50 });
            const writeStream = fs.createWriteStream(outputPath);
            doc.pipe(writeStream);
            doc.fontSize(11).text(text, 50, 50);
            doc.end();
            await new Promise((resolve, reject) => {
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
            });
        } else if (['docx', 'doc'].includes(ext)) {
            // DOCX → HTML → PDF
            const result = await mammoth.convertToHtml({ buffer });
            const html = result.value;
            const text = html.replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim();
            const doc = new PDFDocument({ margin: 50 });
            const writeStream = fs.createWriteStream(outputPath);
            doc.pipe(writeStream);
            doc.fontSize(11).text(text, 50, 50);
            doc.end();
            await new Promise((resolve, reject) => {
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
            });
        } else if (['xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf'].includes(ext)) {
            // Try libreoffice if available, otherwise return error
            try {
                execSync(`libreoffice --headless --convert-to pdf --outdir "${TMP}" "${inputPath}"`, { timeout: 30000 });
            } catch (e) {
                throw new Error('Conversion for ' + ext + ' requires LibreOffice. Please install it or use a different format.');
            }
        } else {
            throw new Error('Unsupported format: ' + ext);
        }

        return fs.readFileSync(outputPath);
    } finally {
        try { fs.unlinkSync(inputPath); } catch {}
        try { fs.unlinkSync(outputPath); } catch {}
    }
}

async function downloadMedia(sock, msg, participant) {
    try {
        const stream = await require('../wa_manager').downloadContentFromMessage(msg, 
            msg.mimetype?.startsWith('image') ? 'image' : 
            msg.mimetype?.startsWith('video') ? 'video' : 
            msg.mimetype?.startsWith('audio') ? 'audio' : 'document'
        );
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return Buffer.concat(chunks);
    } catch (e) {
        console.error('Download error:', e.message);
        return null;
    }
}

module.exports = pdfCommand;
