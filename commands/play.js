const yts = require('yt-search');
const ytdl = require('ytdl-core');
const axios = require('axios');
const { toAudio } = require('../lib/converter');

async function playCommand(sock, chatId, message) {
    try {
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const searchQuery = text.replace(/^\.play\s+/i, '').trim();
        
        if (!searchQuery) {
            return await sock.sendMessage(chatId, { 
                text: "What song do you want to download?\nUsage: .play <song name>"
            });
        }

        // Send loading reaction
        await sock.sendMessage(chatId, { react: { text: '🔄', key: message.key } });

        // Search YouTube
        const search = await yts(searchQuery);
        const videos = search.videos;
        if (!videos || videos.length === 0) {
            return await sock.sendMessage(chatId, { text: "No songs found!" });
        }

        const video = videos[0];
        const urlYt = video.url;

        // Send thumbnail first
        try {
            await sock.sendMessage(chatId, {
                image: { url: video.thumbnail },
                caption: `🎵 *${video.title}*\n👤 ${video.author.name}\n⏱ ${video.timestamp}`
            }, { quoted: message });
        } catch (thumbErr) {
            console.log('Thumbnail failed:', thumbErr.message);
        }

        // Download audio via ytdl-core
        try {
            const stream = ytdl(urlYt, { filter: 'audioonly', quality: 'lowestaudio' });
            const audioBuffer = await new Promise((resolve, reject) => {
                const chunks = [];
                stream.on('data', chunk => chunks.push(chunk));
                stream.on('end', () => resolve(Buffer.concat(chunks)));
                stream.on('error', reject);
            });
            
            if (audioBuffer && audioBuffer.length > 0) {
                await sock.sendMessage(chatId, {
                    audio: audioBuffer,
                    mimetype: "audio/mpeg",
                    fileName: `${video.title}.mp3`
                }, { quoted: message });
                return;
            }
        } catch (ytdlError) {
            console.log('ytdl-core failed:', ytdlError.message);
        }

        // Fallback APIs
        const apis = [
            `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(urlYt)}&format=mp3`,
            `https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(urlYt)}`,
        ];

        for (const apiUrl of apis) {
            try {
                const response = await axios.get(apiUrl, { timeout: 15000,
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                });
                const data = response.data;
                let audioUrl = data?.downloadURL || data?.data?.download_url || data?.dl || null;

                if (audioUrl) {
                    await sock.sendMessage(chatId, {
                        audio: { url: audioUrl },
                        mimetype: "audio/mpeg",
                        fileName: `${video.title}.mp3`
                    }, { quoted: message });
                    return;
                }
            } catch (apiErr) {
                console.log(`API failed:`, apiErr.message);
            }
        }

        throw new Error('All download methods failed');
    } catch (error) {
        console.error('Error in play command:', error);
        await sock.sendMessage(chatId, { 
            text: "Download failed. Please try again later."
        });
    }
}

module.exports = playCommand;
