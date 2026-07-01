const axios = require('axios');
const ai = require('../lib/ai_keys');

async function aiCommand(sock, chatId, message) {
    try {
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        
        if (!text) {
            return await sock.sendMessage(chatId, { 
                text: "Please provide a question after .gpt\n\nExample: .gpt write a basic html code"
            }, { quoted: message });
        }

        const parts = text.split(' ');
        const command = parts[0].toLowerCase();
        const query = parts.slice(1).join(' ').trim();

        if (!query) {
            return await sock.sendMessage(chatId, { 
                text: "Please provide a question after .gpt"
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, {
            react: { text: '🤖', key: message.key }
        });

        if (command === '.gpt') {
            await handleGPT(sock, chatId, message, query);
        }

        await sock.sendMessage(chatId, { react: { text: '', key: message.key } });

    } catch (error) {
        console.error('[AI Command] Unhandled error:', error.message);
        await sock.sendMessage(chatId, { react: { text: '', key: message.key } });
        try {
            await sock.sendMessage(chatId, {
                text: "❌ An unexpected error occurred. Please try again later."
            }, { quoted: message });
        } catch {}
    }
}

async function handleGPT(sock, chatId, message, query) {
    const userKey = ai.getKey('gpt');
    console.log('[GPT] User key present:', !!userKey);

    if (userKey) {
        try {
            const response = await axios.post('https://api.openai.com/v1/chat/completions', {
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: query }],
                max_tokens: 2000,
            }, {
                headers: {
                    'Authorization': 'Bearer ' + userKey,
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
            });

            const content = response.data?.choices?.[0]?.message?.content;
            if (content) {
                await sock.sendMessage(chatId, { text: content.trim() }, { quoted: message });
                console.log('[GPT] Response sent successfully');
                return;
            }
        } catch (e) {
            const status = e.response?.status;
            const errData = e.response?.data?.error;
            const errMsg = errData?.message || e.message;
            console.log('[GPT] API key error - status:', status, 'message:', errMsg);

            if (status === 401) {
                await sock.sendMessage(chatId, {
                    text: "❌ *Invalid API Key*\n\nThe GPT API key saved in AI Management is invalid or expired.\n\nPlease update it via: Menu → AI Management → GPT → Set API Key"
                }, { quoted: message });
                return;
            }
            if (status === 429) {
                await sock.sendMessage(chatId, {
                    text: "❌ *Rate Limit Exceeded*\n\nYour OpenAI API key has reached its rate limit. Please wait and try again."
                }, { quoted: message });
                return;
            }
            if (status === 403 || status === 402) {
                await sock.sendMessage(chatId, {
                    text: "❌ *Billing Issue*\n\nYour OpenAI account has a billing issue or quota exceeded. Check your OpenAI account."
                }, { quoted: message });
                return;
            }
            if (status === 500 || status === 503) {
                await sock.sendMessage(chatId, {
                    text: "❌ *OpenAI Server Error*\n\nOpenAI servers are experiencing issues. Please try again later."
                }, { quoted: message });
                return;
            }
            console.log('[GPT] Falling through to free API, reason:', errMsg);
        }
    }

    // Free API fallback
    console.log('[GPT] Trying free API...');
    try {
        const response = await axios.get(
            `https://zellapi.autos/ai/chatbot?text=${encodeURIComponent(query)}`,
            { timeout: 15000 }
        );
        if (response.data?.status && response.data?.result) {
            await sock.sendMessage(chatId, { text: response.data.result }, { quoted: message });
            console.log('[GPT] Free API response sent');
            return;
        }
    } catch (e) {
        console.log('[GPT] Free API failed:', e.message);
    }

    await sock.sendMessage(chatId, {
        text: "❌ Failed to get response. Please try again later.\n\nTip: Add your own OpenAI API key in AI Management (Menu → AI Management → GPT → Set API Key) for reliable access."
    }, { quoted: message });
}

module.exports = aiCommand;
