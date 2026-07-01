const axios = require('axios');
const fetch = require('node-fetch');
const ai = require('../lib/ai_keys');

async function aiCommand(sock, chatId, message) {
    try {
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        
        if (!text) {
            return await sock.sendMessage(chatId, { 
                text: "Please provide a question after .gpt or .gemini\n\nExample: .gpt write a basic html code"
            }, { quoted: message });
        }

        const parts = text.split(' ');
        const command = parts[0].toLowerCase();
        const query = parts.slice(1).join(' ').trim();

        if (!query) {
            return await sock.sendMessage(chatId, { 
                text: "Please provide a question after .gpt or .gemini"
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, {
            react: { text: '🤖', key: message.key }
        });

        if (command === '.gpt') {
            await handleGPT(sock, chatId, message, query);
        } else if (command === '.gemini') {
            await handleGemini(sock, chatId, message, query);
        }

        await sock.sendMessage(chatId, { react: { text: '', key: message.key } });

    } catch (error) {
        console.error('AI Command Error:', error);
        await sock.sendMessage(chatId, { react: { text: '', key: message.key } });
        try {
            await sock.sendMessage(chatId, {
                text: "❌ An error occurred. Please try again later."
            }, { quoted: message });
        } catch {}
    }
}

async function handleGPT(sock, chatId, message, query) {
    // Try user's own API key first
    const userKey = ai.getKey('gpt');
    if (userKey) {
        try {
            const response = await axios.post('https://api.openai.com/v1/chat/completions', {
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: query }],
                max_tokens: 1000,
            }, {
                headers: {
                    'Authorization': 'Bearer ' + userKey,
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
            });

            if (response.data?.choices?.[0]?.message?.content) {
                await sock.sendMessage(chatId, {
                    text: response.data.choices[0].message.content.trim()
                }, { quoted: message });
                return;
            }
        } catch (e) {
            const status = e.response?.status;
            const msg = e.response?.data?.error?.message || e.message;
            if (status === 401) {
                await sock.sendMessage(chatId, {
                    text: "❌ *Invalid API Key*\n\nThe GPT API key saved in AI Management is invalid or expired.\n\nPlease update it via the Telegram bot: Menu → AI Management → GPT → Set API Key"
                }, { quoted: message });
                return;
            }
            if (status === 429) {
                await sock.sendMessage(chatId, {
                    text: "❌ *Rate Limit Exceeded*\n\nYour OpenAI API key has reached its rate limit. Please wait and try again, or use a different API key."
                }, { quoted: message });
                return;
            }
            if (status === 403 || status === 402) {
                await sock.sendMessage(chatId, {
                    text: "❌ *Billing Issue*\n\nYour OpenAI account has a billing issue or insufficient quota. Please check your OpenAI account."
                }, { quoted: message });
                return;
            }
            console.log('GPT API key failed:', msg);
            // Fall through to free API
        }
    }

    // Free API fallback
    try {
        const response = await axios.get(`https://zellapi.autos/ai/chatbot?text=${encodeURIComponent(query)}`, { timeout: 15000 });
        if (response.data && response.data.status && response.data.result) {
            await sock.sendMessage(chatId, { text: response.data.result }, { quoted: message });
            return;
        }
        throw new Error('Invalid response');
    } catch (e) {
        console.log('Free GPT API failed:', e.message);
    }

    await sock.sendMessage(chatId, {
        text: "❌ Failed to get response. Please try again later.\n\nTip: Add your own OpenAI API key in AI Management (Menu → AI Management → GPT → Set API Key) for better reliability."
    }, { quoted: message });
}

async function handleGemini(sock, chatId, message, query) {
    // Try user's own API key first
    const userKey = ai.getKey('gemini');
    if (userKey) {
        try {
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${userKey}`,
                {
                    contents: [{ parts: [{ text: query }] }]
                },
                { timeout: 30000 }
            );

            if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
                await sock.sendMessage(chatId, {
                    text: response.data.candidates[0].content.parts[0].text.trim()
                }, { quoted: message });
                return;
            }
        } catch (e) {
            const status = e.response?.status;
            const errMsg = e.response?.data?.error?.message || e.message;
            if (status === 400 && errMsg.includes('API_KEY_INVALID')) {
                await sock.sendMessage(chatId, {
                    text: "❌ *Invalid API Key*\n\nThe Gemini API key saved in AI Management is invalid.\n\nPlease update it via the Telegram bot: Menu → AI Management → Gemini → Set API Key"
                }, { quoted: message });
                return;
            }
            if (status === 403 || (errMsg && errMsg.includes('API key not found'))) {
                await sock.sendMessage(chatId, {
                    text: "❌ *Invalid API Key*\n\nThe Gemini API key is not found or not authorized.\n\nPlease check your key at https://aistudio.google.com/apikey and update it in AI Management."
                }, { quoted: message });
                return;
            }
            if (status === 429 || (errMsg && errMsg.includes('quota'))) {
                await sock.sendMessage(chatId, {
                    text: "❌ *Rate Limit / Quota Exceeded*\n\nYour Gemini API key has reached its rate limit or quota. Please wait and try again, or upgrade your plan."
                }, { quoted: message });
                return;
            }
            console.log('Gemini API key failed:', status, errMsg);
            // Fall through to free API
        }
    }

    // Free API fallback — try multiple endpoints
    const freeApis = [
        `https://vapis.my.id/api/gemini?q=${encodeURIComponent(query)}`,
        `https://api.siputzx.my.id/api/ai/gemini-pro?content=${encodeURIComponent(query)}`,
        `https://api.ryzendesu.vip/api/ai/gemini?text=${encodeURIComponent(query)}`,
        `https://zellapi.autos/ai/chatbot?text=${encodeURIComponent(query)}`,
        `https://api.giftedtech.my.id/api/ai/geminiai?apikey=gifted&q=${encodeURIComponent(query)}`,
        `https://api.giftedtech.my.id/api/ai/geminiaipro?apikey=gifted&q=${encodeURIComponent(query)}`
    ];

    for (const api of freeApis) {
        try {
            const response = await fetch(api, { timeout: 10000 });
            const data = await response.json();
            const answer = data.message || data.data || data.answer || data.result;
            if (answer) {
                await sock.sendMessage(chatId, { text: answer }, { quoted: message });
                return;
            }
        } catch (e) {
            continue;
        }
    }

    await sock.sendMessage(chatId, {
        text: "❌ Failed to get response. Please try again later.\n\nTip: Add your own Gemini API key in AI Management (Menu → AI Management → Gemini → Set API Key) for better reliability."
    }, { quoted: message });
}

module.exports = aiCommand;
