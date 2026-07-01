const axios = require('axios');
const ai = require('../lib/ai_keys');

async function openCommand(sock, chatId, message) {
    try {
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        if (!text) {
            return await sock.sendMessage(chatId, {
                text: "🌐 *OpenRouter AI*\n\nUsage: `.open <your question>`\nExample: `.open what is the capital of France?`"
            }, { quoted: message });
        }

        const query = text.replace(/^\.open\s+/i, '').trim();
        if (!query) {
            return await sock.sendMessage(chatId, {
                text: "🌐 *OpenRouter AI*\n\nPlease provide a question.\n\nExample: `.open explain quantum computing`"
            }, { quoted: message });
        }

        // Check if API key is configured
        const apiKey = ai.getKey('openrouter');
        if (!apiKey) {
            await sock.sendMessage(chatId, {
                text: "❌ *OpenRouter API Key Not Configured*\n\nPlease add your OpenRouter API key first via:\n\nMenu → AI Management → OpenRouter → Set API Key\n\nGet a free key at: https://openrouter.ai/keys"
            }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, { react: { text: '🌐', key: message.key } });

        // Call OpenRouter API
        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: 'openai/gpt-3.5-turbo',
            messages: [{ role: 'user', content: query }],
            max_tokens: 2000,
        }, {
            headers: {
                'Authorization': 'Bearer ' + apiKey,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/Anony1010/WhatsBotOG',
                'X-Title': 'WhatsBotOG',
            },
            timeout: 45000,
        });

        const content = response.data?.choices?.[0]?.message?.content;
        if (content) {
            await sock.sendMessage(chatId, { react: { text: '', key: message.key } });
            await sock.sendMessage(chatId, {
                text: content.trim()
            }, { quoted: message });
            console.log('[OpenRouter] Response sent successfully');
            return;
        }

        console.log('[OpenRouter] Unexpected response:', JSON.stringify(response.data).substring(0, 200));
        await sock.sendMessage(chatId, { react: { text: '', key: message.key } });
        await sock.sendMessage(chatId, {
            text: "❌ Unexpected response format from OpenRouter. Please try again."
        }, { quoted: message });

    } catch (e) {
        console.log('[OpenRouter] Error:', e.message);
        const status = e.response?.status;
        const errData = e.response?.data?.error;
        const errMsg = errData?.message || e.message;

        await sock.sendMessage(chatId, { react: { text: '', key: message.key } });

        if (status === 401) {
            await sock.sendMessage(chatId, {
                text: "❌ *Invalid API Key*\n\nThe OpenRouter API key saved in AI Management is invalid.\n\nPlease update it via: Menu → AI Management → OpenRouter → Set API Key"
            }, { quoted: message });
            return;
        }
        if (status === 402) {
            await sock.sendMessage(chatId, {
                text: "❌ *Insufficient Credits*\n\nYour OpenRouter account has insufficient credits.\n\nPlease add credits at: https://openrouter.ai/credits"
            }, { quoted: message });
            return;
        }
        if (status === 429) {
            await sock.sendMessage(chatId, {
                text: "❌ *Rate Limit Exceeded*\n\nYour OpenRouter API key has reached its rate limit. Please wait and try again."
            }, { quoted: message });
            return;
        }
        if (status === 403) {
            const msg = (errMsg || '').toLowerCase();
            if (msg.includes('term') || msg.includes('policy')) {
                await sock.sendMessage(chatId, {
                    text: "❌ *Access Restricted*\n\nYour OpenRouter access has been restricted due to content policy. Please contact OpenRouter support."
                }, { quoted: message });
                return;
            }
            await sock.sendMessage(chatId, {
                text: "❌ *Access Denied*\n\nThe API key does not have permission for this model. Check your OpenRouter account."
            }, { quoted: message });
            return;
        }
        if (status === 400) {
            await sock.sendMessage(chatId, {
                text: "❌ *Bad Request*\n\nThere was an issue with your request. The model may be unavailable or the query too long.\n\nError: " + (errMsg || 'Unknown error')
            }, { quoted: message });
            return;
        }
        if (status && status >= 500) {
            await sock.sendMessage(chatId, {
                text: "❌ *OpenRouter Server Error*\n\nOpenRouter servers are experiencing issues. Please try again later."
            }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, {
            text: "❌ Failed to get response from OpenRouter.\n\nError: " + (errMsg || 'Unknown error') + "\n\nPlease try again or check your API key in AI Management."
        }, { quoted: message });
    }
}

module.exports = openCommand;
