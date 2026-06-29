const yts = require('yt-search');
const axios = require('axios');
const ytdl = require('ytdl-core');
const { toAudio } = require('../lib/converter');

const AXIOS_DEFAULTS = {
    timeout: 30000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*'
    }
};

async function playCommand(sock, chatId, message) {
    try {
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const searchQuery = text.replace(/^\.play\s+/i, '').trim();
        
        if (!searchQuery) {
            return await sock.sendMessage(chatId, { 
                text: "What song do you want to download?\nUsage: .play <song name>"
            });
        }

        // Search for the song
        const search = await yts(searchQuery);
        const videos = search.videos;
        if (!videos || videos.length === 0) {
            return await sock.sendMessage(chatId, { 
                text: "No songs found!"
            });
        }

        // Send loading reaction
        await sock.sendMessage(chatId, {
            react: { text: '🔄', key: message.key }
        });

        // Get the first video result
        const video = videos[0];
        const urlYt = video.url;

        try {
            // Try ytdl-core first (most reliable)
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
                    fileName: `${video.title}.mp3`,
                    caption: "DOWNLOADED BY ORUJOV"
                }, { quoted: message });
                return;
            }
        } catch (ytdlError) {
            console.log('ytdl-core failed, trying API fallback:', ytdlError.message);
        }

        // API fallback
        const apis = [
            `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(urlYt)}&format=mp3`,
            `https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(urlYt)}`,
            `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(urlYt)}`
        ];

        for (const apiUrl of apis) {
            try {
                const response = await axios.get(apiUrl, { ...AXIOS_DEFAULTS, timeout: 15000 });
                const data = response.data;
                let audioUrl = null;
                let title = video.title;

                if (data?.success && data?.downloadURL) {
                    audioUrl = data.downloadURL; title = data.title || title;
                } else if (data?.data?.download_url) {
                    audioUrl = data.data.download_url; title = data.data.title || title;
                } else if (data?.dl) {
                    audioUrl = data.dl; title = data.title || title;
                }

                if (audioUrl) {
                    await sock.sendMessage(chatId, {
                        audio: { url: audioUrl },
                        mimetype: "audio/mpeg",
                        fileName: `${title}.mp3`
                    }, { quoted: message });
                    return;
                }
            } catch (apiErr) {
                console.log(`API ${apiUrl.split('/')[2]} failed:`, apiErr.message);
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
