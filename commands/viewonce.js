const { downloadContentFromMessage } = require("@whiskeysockets/baileys");

async function downloadMedia(msg, type) {
    const stream = await downloadContentFromMessage(msg, type);
    const buffer = [];
    for await (const chunk of stream) {
        buffer.push(chunk);
        if (Buffer.concat(buffer).length > 100 * 1024 * 1024) {
            throw new Error('Media too large (max 100MB)');
        }
    }
    return Buffer.concat(buffer);
}

async function viewonceCommand(sock, chatId, message) {
    try {
        const contextInfo = message.message?.extendedTextMessage?.contextInfo;
        if (!contextInfo?.quotedMessage) {
            return await sock.sendMessage(chatId, { text: '❌ Please reply to a view-once image or video with .vv' }, { quoted: message });
        }
        
        const quoted = contextInfo.quotedMessage;
        
        // Find view-once media in all possible formats
        let foundMedia = null;
        let mediaType = null;
        
        const searchPaths = [
            { msg: quoted?.viewOnceMessageV2?.message, name: 'viewOnceMessageV2' },
            { msg: quoted?.viewOnceMessageV2Extension?.message, name: 'viewOnceMessageV2Extension' },
            { msg: quoted?.viewOnceMessage, name: 'viewOnceMessage' },
            { msg: quoted, name: 'direct' },
        ];
        
        for (const { msg, name } of searchPaths) {
            if (!msg) continue;
            
            if (msg.imageMessage) {
                foundMedia = msg.imageMessage;
                mediaType = 'image';
                console.log(`Found view-once image via ${name}`);
                break;
            }
            if (msg.videoMessage) {
                foundMedia = msg.videoMessage;
                mediaType = 'video';
                console.log(`Found view-once video via ${name}`);
                break;
            }
        }

        if (!foundMedia) {
            return await sock.sendMessage(chatId, { 
                text: '❌ No view-once media found. Reply to a view-once image or video with .vv' 
            }, { quoted: message });
        }

        // Send processing indicator
        await sock.sendMessage(chatId, { react: { text: '🔄', key: message.key } });

        try {
            // Download the media
            const buffer = await downloadMedia(foundMedia, mediaType);
            
            if (!buffer || buffer.length === 0) {
                throw new Error('Downloaded buffer is empty');
            }

            console.log(`ViewOnce ${mediaType} downloaded: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);

            if (mediaType === 'image') {
                // Send as view-once image
                await sock.sendMessage(chatId, {
                    image: buffer,
                    caption: foundMedia.caption || '',
                    viewOnce: true
                }, { quoted: message });
            } else if (mediaType === 'video') {
                // Send as view-once video
                // Try different approaches for sending video
                try {
                    await sock.sendMessage(chatId, {
                        video: buffer,
                        mimetype: 'video/mp4',
                        caption: foundMedia.caption || '',
                        viewOnce: true
                    }, { quoted: message });
                } catch (videoErr) {
                    console.log('ViewOnce video send failed:', videoErr.message);
                    // Fallback: send as document with mp4 mime type
                    try {
                        await sock.sendMessage(chatId, {
                            document: buffer,
                            mimetype: 'video/mp4',
                            fileName: 'viewonce_video.mp4',
                            caption: foundMedia.caption || '',
                            viewOnce: true
                        }, { quoted: message });
                    } catch (docErr) {
                        console.log('ViewOnce document fallback also failed:', docErr.message);
                        throw new Error('Could not send video: ' + videoErr.message);
                    }
                }
            }
            
            // Remove the reaction on success
            await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
            
        } catch (downloadErr) {
            console.error('ViewOnce download/send error:', downloadErr.message);
            
            // Try direct URL approach if download fails
            try {
                if (foundMedia.url) {
                    if (mediaType === 'video') {
                        await sock.sendMessage(chatId, {
                            video: { url: foundMedia.url },
                            mimetype: 'video/mp4',
                            caption: foundMedia.caption || '',
                            viewOnce: true
                        }, { quoted: message });
                        return;
                    } else if (mediaType === 'image') {
                        await sock.sendMessage(chatId, {
                            image: { url: foundMedia.url },
                            caption: foundMedia.caption || '',
                            viewOnce: true
                        }, { quoted: message });
                        return;
                    }
                }
            } catch (urlErr) {
                console.error('ViewOnce URL fallback failed:', urlErr.message);
            }
            
            await sock.sendMessage(chatId, { 
                text: '❌ Failed to process view-once ' + mediaType + '. The file may be too large or no longer available.' 
            }, { quoted: message });
        }
    } catch (err) {
        console.error('ViewOnce error:', err.message);
        await sock.sendMessage(chatId, { text: '❌ Error: ' + err.message }, { quoted: message });
    }
}

module.exports = viewonceCommand;
