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
        console.error('[AI Command] Unhandled error:', error.message);
        console.error('[AI Command] Stack:', error.stack);
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
                await sock.sendMessage(chatId, {
                    text: content.trim()
                }, { quoted: message });
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
        console.log('[GPT] Free API returned unexpected format:', JSON.stringify(response.data).substring(0, 200));
    } catch (e) {
        console.log('[GPT] Free API failed:', e.message);
    }

    await sock.sendMessage(chatId, {
        text: "❌ Failed to get response. Please try again later.\n\nTip: Add your own OpenAI API key in AI Management (Menu → AI Management → GPT → Set API Key) for reliable access."
    }, { quoted: message });
}

async function handleGemini(sock, chatId, message, query) {
    const userKey = ai.getKey('gemini');
    console.log('[Gemini] User key present:', !!userKey);

    if (userKey) {
        try {
            console.log('[Gemini] Calling API with key:', userKey.substring(0, 8) + '...');
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${userKey}`,
                {
                    contents: [{ parts: [{ text: query }] }],
                    safetySettings: [
                        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                    ]
                },
                { timeout: 30000 }
            );

            console.log('[Gemini] API response received, status:', response.status);

            // Check for blocked content
            if (response.data?.promptFeedback?.blockReason) {
                await sock.sendMessage(chatId, {
                    text: "⚠️ *Content Blocked*\n\nYour prompt was blocked by Gemini safety filters. Reason: " + response.data.promptFeedback.blockReason + "\n\nPlease rephrase your question."
                }, { quoted: message });
                return;
            }

            // Check candidates
            const candidates = response.data?.candidates;
            if (!candidates || candidates.length === 0) {
                console.log('[Gemini] No candidates in response:', JSON.stringify(response.data).substring(0, 300));
                await sock.sendMessage(chatId, {
                    text: "❌ Gemini returned no response. The API key may have reached its limit. Try again later or add a new key in AI Management."
                }, { quoted: message });
                return;
            }

            // Check for finish reason (safety block, etc.)
            const candidate = candidates[0];
            if (candidate.finishReason && candidate.finishReason !== 'STOP') {
                console.log('[Gemini] Non-STOP finish reason:', candidate.finishReason);
                if (candidate.finishReason === 'SAFETY') {
                    await sock.sendMessage(chatId, {
                        text: "⚠️ *Content Blocked*\n\nThe response was blocked by Gemini safety filters. Please rephrase your question."
                    }, { quoted: message });
                    return;
                }
                if (candidate.finishReason === 'MAX_TOKENS') {
                    await sock.sendMessage(chatId, {
                        text: "⚠️ *Response Truncated*\n\nThe response was too long and got truncated. Try asking a more specific question."
                    }, { quoted: message });
                    return;
                }
                if (candidate.finishReason === 'RECITATION') {
                    await sock.sendMessage(chatId, {
                        text: "⚠️ *Content Blocked*\n\nThe response was blocked due to citation/recitation concerns. Please rephrase."
                    }, { quoted: message });
                    return;
                }
            }

            const answer = candidate?.content?.parts?.[0]?.text;
            if (answer) {
                await sock.sendMessage(chatId, {
                    text: answer.trim()
                }, { quoted: message });
                console.log('[Gemini] Response sent successfully');
                return;
            }

            console.log('[Gemini] Unexpected response format:', JSON.stringify(response.data).substring(0, 300));
            await sock.sendMessage(chatId, {
                text: "❌ Received unexpected response format from Gemini API. Please try again."
            }, { quoted: message });

        } catch (e) {
            const status = e.response?.status;
            const errData = e.response?.data?.error;
            const errMsg = errData?.message || e.message;
            console.log('[Gemini] API error - status:', status, 'message:', errMsg);

            // Handle specific error codes
            if (status === 400) {
                if (errMsg && errMsg.includes('API_KEY_INVALID')) {
                    await sock.sendMessage(chatId, {
                        text: "❌ *Invalid API Key*\n\nThe Gemini API key saved in AI Management is invalid.\n\nPlease update it via: Menu → AI Management → Gemini → Set API Key"
                    }, { quoted: message });
                    return;
                }
                if (errMsg && errMsg.includes('API key not found')) {
                    await sock.sendMessage(chatId, {
                        text: "❌ *API Key Not Found*\n\nThe Gemini API key doesn't exist. Get a key at https://aistudio.google.com/apikey and update in AI Management."
                    }, { quoted: message });
                    return;
                }
                if (errMsg && (errMsg.includes('not supported') || errMsg.includes('not found'))) {
                    await sock.sendMessage(chatId, {
                        text: "❌ *Model Unavailable*\n\nThe requested Gemini model is not available. The system will use an alternative model."
                    }, { quoted: message });
                    return;
                }
            }
            if (status === 401 || status === 403) {
                await sock.sendMessage(chatId, {
                    text: "❌ *Authentication Failed*\n\nThe Gemini API key is not authorized. Please check your key at https://aistudio.google.com/apikey."
                }, { quoted: message });
                return;
            }
            if (status === 429 || (errMsg && errMsg.toLowerCase().includes('quota'))) {
                await sock.sendMessage(chatId, {
                    text: "❌ *Rate Limit / Quota Exceeded*\n\nYour Gemini API key has reached its daily rate limit or quota.\n\nOptions:\n• Wait and try again later\n• Upgrade to a paid plan at https://ai.google.dev/pricing\n• Add a new API key in AI Management"
                }, { quoted: message });
                return;
            }
            if (status === 404) {
                await sock.sendMessage(chatId, {
                    text: "❌ *API Endpoint Error*\n\nThe Gemini API endpoint is temporarily unavailable. Please try again later."
                }, { quoted: message });
                return;
            }
            if (status >= 500) {
                await sock.sendMessage(chatId, {
                    text: "❌ *Gemini Server Error*\n\nGoogle Gemini servers are experiencing issues. Please try again later."
                }, { quoted: message });
                return;
            }

            console.log('[Gemini] Falling through to free APIs, reason:', errMsg);
        }
    }

    // Free API fallback
    console.log('[Gemini] Trying free APIs...');
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
            console.log('[Gemini] Trying free API:', api.substring(0, 50) + '...');
            const response = await fetch(api, { timeout: 10000 });
            const data = await response.json();
            const answer = data.message || data.data || data.answer || data.result;
            if (answer && typeof answer === 'string' && answer.length > 0) {
                await sock.sendMessage(chatId, { text: answer }, { quoted: message });
                console.log('[Gemini] Free API response sent');
                return;
            }
        } catch (e) {
            console.log('[Gemini] Free API failed:', e.message);
            continue;
        }
    }

    console.log('[Gemini] All APIs failed');
    await sock.sendMessage(chatId, {
        text: "❌ Failed to get response. Please try again later.\n\nTip: Add your own Gemini API key in AI Management (Menu → AI Management → Gemini → Set API Key) for reliable access."
    }, { quoted: message });
}

module.exports = aiCommand;
