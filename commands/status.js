const fs = require('fs-extra');
const path = require('path');
const wa = require('../wa_manager');

const statusStates = {};

// Normalize JID: strip device suffix and ensure consistent format
function normalizeJid(jid) {
    if (!jid) return 'unknown';
    // Remove device suffix (e.g., ":1@s.whatsapp.net" → "@s.whatsapp.net")
    jid = jid.replace(/:\d+@/, '@');
    // Keep only the number part for comparison
    return jid.split('@')[0].replace(/[^0-9]/g, '');
}

function formatName(jid) {
    if (!jid) return 'Unknown';
    return jid.replace(/:\d+@.*$/, '').replace(/@.*$/, '').replace(/[^0-9]/g, '');
}

async function statusCommand(sock, chatId, message) {
    try {
        const phone = await getPhoneFromSock(sock);
        if (!phone) {
            await sock.sendMessage(chatId, { text: '❌ Could not identify WhatsApp session.' }, { quoted: message });
            return;
        }

        // Get stored statuses organized by contact (deduplicated)
        let contacts = getUniqueContacts(phone);

        if (!contacts || contacts.length === 0) {
            await sock.sendMessage(chatId, {
                text: '📭 No status updates available.\n\nStatuses are captured automatically when your contacts post new stories while the bot is running.'
            }, { quoted: message });
            return;
        }

        // Build clean numbered list
        const lines = contacts.map((c, i) => `${i + 1}. ${c.name}`);
        const msg = lines.join('\n');

        // Store state
        statusStates[chatId] = {
            contacts: contacts,
            active: true,
            phone: phone,
        };

        await sock.sendMessage(chatId, { text: msg }, { quoted: message });

    } catch (error) {
        console.error('[Status] Error:', error.message);
        delete statusStates[chatId];
        try {
            await sock.sendMessage(chatId, { text: '❌ Failed to fetch statuses.' }, { quoted: message });
        } catch {}
    }
}

async function handleStatusSelection(sock, chatId, message, text) {
    const state = statusStates[chatId];
    if (!state || !state.active) return false;

    const num = parseInt(text.trim());
    if (isNaN(num) || num < 1 || num > state.contacts.length) {
        await sock.sendMessage(chatId, { text: `❌ Send a number between 1-${state.contacts.length}.` }, { quoted: message });
        return true;
    }

    // Clean up state immediately
    delete statusStates[chatId];

    const contact = state.contacts[num - 1];
    const statuses = contact.statuses;

    // Send each status immediately without confirmation
    for (let i = 0; i < statuses.length; i++) {
        try {
            await sendStatusItem(sock, chatId, statuses[i], i + 1, statuses.length, state.phone);
            if (i < statuses.length - 1) await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
            console.error(`[Status] Send error ${i + 1}:`, e.message);
        }
    }

    return true;
}

async function sendStatusItem(sock, chatId, st, index, total, phone) {
    // Text status
    if (st.type === 'text') {
        await sock.sendMessage(chatId, { text: st.content || '(empty)' });
        return;
    }

    // Media status - download and forward
    if (st.msgObj && st.mediaType) {
        try {
            const socket = wa.getActiveConnection(phone) || sock;
            const stream = await wa.downloadContentFromMessage(st.msgObj, st.mediaType);
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
                if (Buffer.concat(chunks).length > 50 * 1024 * 1024) throw new Error('File too large');
            }
            const buffer = Buffer.concat(chunks);
            if (buffer.length === 0) throw new Error('Empty buffer');

            const caption = st.content || '';

            if (st.mediaType === 'image') {
                await sock.sendMessage(chatId, { image: buffer, caption });
            } else if (st.mediaType === 'video') {
                await sock.sendMessage(chatId, { video: buffer, caption });
            } else if (st.mediaType === 'audio') {
                await sock.sendMessage(chatId, { audio: buffer, mimetype: 'audio/mp4' });
            } else if (st.mediaType === 'sticker') {
                await sock.sendMessage(chatId, { sticker: buffer });
            } else {
                await sock.sendMessage(chatId, { document: buffer, mimetype: 'application/octet-stream', fileName: `status.${st.mediaType === 'video' ? 'mp4' : 'jpg'}` });
            }
            return;
        } catch (e) {
            console.log(`[Status] Download failed:`, e.message);
        }
    }

    // Fallback: send caption as text
    await sock.sendMessage(chatId, { text: st.content || `📸 Status (${st.type})` });
}

function getUniqueContacts(phone) {
    const contacts = {};

    // Source 1: status.json (has msgObj for media download)
    const stored = wa.getStoredStatuses(phone);
    for (const st of stored.statuses) {
        const key = normalizeJid(st.from);
        if (!contacts[key]) {
            contacts[key] = { 
                jid: key, 
                name: st.pushName || formatName(st.from), 
                statuses: [],
                seenIds: new Set()
            };
        }
        if (!contacts[key].seenIds.has(st.id)) {
            contacts[key].seenIds.add(st.id);
            contacts[key].statuses.push(st);
        }
    }

    // Source 2: messages.json (additional broadcast messages)
    try {
        const filePath = path.join(__dirname, '..', 'sessions', phone, 'messages.json');
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            const broadcastMsgs = data['status@broadcast'];
            if (broadcastMsgs && broadcastMsgs.messages) {
                for (const m of broadcastMsgs.messages) {
                    const from = m.from || m.jid || 'unknown';
                    const key = normalizeJid(from);
                    if (!contacts[key]) {
                        contacts[key] = { 
                            jid: key, 
                            name: m.pushName || formatName(from), 
                            statuses: [],
                            seenIds: new Set()
                        };
                    }
                    if (!contacts[key].seenIds.has(m.id)) {
                        contacts[key].seenIds.add(m.id);
                        contacts[key].statuses.push({
                            id: m.id,
                            from: from,
                            type: m.mediaType || 'text',
                            content: m.text || m.caption || '',
                            mediaUrl: m.mediaUrl || '',
                            msgObj: null,
                            time: m.time || Date.now(),
                            pushName: m.pushName || formatName(from),
                            mediaType: m.mediaType || 'text',
                        });
                    }
                }
            }
        }
    } catch (e) {
        console.log('[Status] Message store read error:', e.message);
    }

    // Sort statuses by time and clean up
    const result = Object.values(contacts);
    for (const c of result) {
        c.statuses.sort((a, b) => (a.time || 0) - (b.time || 0));
        delete c.seenIds;
    }

    return result;
}

async function getPhoneFromSock(sock) {
    try {
        if (sock && sock.user && sock.user.id) {
            return sock.user.id.split(':')[0].replace(/[^0-9]/g, '');
        }
    } catch (e) {}
    try {
        const sessions = wa.getAllSessions();
        const connected = sessions.find(s => s.status === 'connected');
        if (connected) return connected.phone;
    } catch (e) {}
    return null;
}

module.exports = { statusCommand, handleStatusSelection };
