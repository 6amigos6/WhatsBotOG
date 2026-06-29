const yts = require('yt-search');
const ytdl = require('ytdl-core');
const axios = require('axios');
const { toAudio } = require('../lib/converter');
const { ytmp3, ytmp4 } = require('ruhend-scraper');

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

        // Send thumbnail first with song info
        try {
            await sock.sendMessage(chatId, {
                image: { url: video.thumbnail },
                caption: `🎵 *${video.title}*\n👤 ${video.author.name}\n⏱ ${video.timestamp}`
            });
        } catch (thumbErr) {
            console.log('Thumbnail failed:', thumbErr.message);
        }

        // Download audio with multi-source fallback
        let audioBuffer = null;
        let audioUrl = null;

        // Source 1: ruhend-scraper ytmp3
        try {
            const result = await ytmp3(urlYt);
            if (result && result.audio) {
                const res = await axios.get(result.audio, { responseType: 'arraybuffer', timeout: 60000 });
                audioBuffer = Buffer.from(res.data);
            }
            if (result && result.download) {
                audioUrl = result.download;
            }
        } catch (e) { console.log('ruhend ytmp3 failed:', e.message); }

        // Source 2: ytdl-core (fallback)
        if (!audioBuffer && !audioUrl) {
            try {
                const stream = ytdl(urlYt, { filter: 'audioonly', quality: 'highestaudio' });
                const chunks = [];
                for await (const chunk of stream) chunks.push(chunk);
                const buf = Buffer.concat(chunks);
                audioBuffer = await toAudio(buf, 'mp4');
            } catch (e) { console.log('ytdl-core failed:', e.message); }
        }

        // Source 3: ruhend-scraper ytmp4 audio
        if (!audioBuffer && !audioUrl) {
            try {
                const result = await ytmp4(urlYt);
                if (result && result.audio) {
                    const res = await axios.get(result.audio, { responseType: 'arraybuffer', timeout: 60000 });
                    audioBuffer = Buffer.from(res.data);
                }
            } catch (e) { console.log('ruhend ytmp4 failed:', e.message); }
        }

        // Source 4: External API fallback
        if (!audioBuffer && !audioUrl) {
            const apis = [
                "https://eliteprotech-apis.zone.id/ytdown?url=" + encodeURIComponent(urlYt) + "&format=mp3",
                "https://api.yupra.my.id/api/downloader/ytmp3?url=" + encodeURIComponent(urlYt),
            ];
            for (const apiUrl of apis) {
                try {
                    const response = await axios.get(apiUrl, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
                    const data = response.data;
                    audioUrl = data?.downloadURL || data?.data?.download_url || data?.dl || data?.result?.mp3 || null;
                    if (audioUrl) break;
                } catch (apiErr) { console.log('API failed:', apiErr.message); }
            }
        }

        // Send the audio
        if (audioBuffer) {
            await sock.sendMessage(chatId, {
                audio: audioBuffer,
                mimetype: 'audio/mpeg',
                fileName: video.title.replace(/[^\w\s-]/g, '') + '.mp3'
            });
            return;
        }
        if (audioUrl) {
            await sock.sendMessage(chatId, {
                audio: { url: audioUrl },
                mimetype: 'audio/mpeg',
                fileName: video.title.replace(/[^\w\s-]/g, '') + '.mp3'
            });
            return;
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