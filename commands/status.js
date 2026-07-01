const wa = require('../wa_manager');

const statusStates = {};

// Robust JID normalization: strip device/domain, keep only digits
function normalizeJid(jid) {
    if (!jid || typeof jid !== 'string') return '';
    // Remove device suffix (e.g., ":1@s.whatsapp.net" → "@s.whatsapp.net")
    jid = jid.replace(/:\d+@/g, '@');
    // Extract digits only for comparison
    const digits = jid.replace(/[^0-9]/g, '');
    // Return empty if no digits (e.g., "status@broadcast" → "")
    return digits;
}

async function statusCommand(sock, chatId, message) {
    try {
        const phone = await getPhoneFromSock(sock);
        if (!phone) {
            await sock.sendMessage(chatId, { text: '❌ Could not identify WhatsApp session.' }, { quoted: message });
            return;
        }

        // Build deduplicated contact list from status.json only (has proper sender JIDs + media objects)
        const contacts = getUniqueContacts(phone);

        if (!contacts.length) {
            await sock.sendMessage(chatId, {
                text: '📭 No status updates available.\n\nStatuses are captured automatically when your contacts post new stories while the bot is running.'
            }, { quoted: message });
            return;
        }

        // Clean UI: header + numbered list + footer
        const lines = contacts.map((c, i) => `${i + 1}. ${c.name}`);
        const msg = '✨ Status Paylaşanlar\n\n' +
                    lines.join('\n') +
                    '\n\n────────────────\n\n💬 Baxmaq istədiyin statusun nömrəsini göndər.';

        statusStates[chatId] = { contacts, active: true, phone };
        await sock.sendMessage(chatId, { text: msg }, { quoted: message });

    } catch (error) {
        console.error('[Status] Error:', error.message);
        delete statusStates[chatId];
        try { await sock.sendMessage(chatId, { text: '❌ Failed to fetch statuses.' }, { quoted: message }); } catch {}
    }
}

async function handleStatusSelection(sock, chatId, message, text) {
    const state = statusStates[chatId];
    if (!state || !state.active) return false;

    const num = parseInt(text.trim());
    if (isNaN(num) || num < 1 || num > state.contacts.length) {
        await sock.sendMessage(chatId, { text: `❌ 1-${state.contacts.length} arası bir nömrə göndərin.` }, { quoted: message });
        return true;
    }

    delete statusStates[chatId];
    const contact = state.contacts[num - 1];

    // Send each status immediately, no confirmation messages
    for (let i = 0; i < contact.statuses.length; i++) {
        try {
            await sendStatusItem(sock, chatId, contact.statuses[i], state.phone);
            if (i < contact.statuses.length - 1) await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
            console.error(`[Status] Send error ${i + 1}:`, e.message);
        }
    }

    return true;
}

async function sendStatusItem(sock, chatId, st, phone) {
    if (st.type === 'text') {
        await sock.sendMessage(chatId, { text: st.content || '(empty)' });
        return;
    }

    // Download and forward media
    if (st.msgObj && st.mediaType && ['image', 'video', 'audio', 'sticker'].includes(st.mediaType)) {
        try {
            const socket = wa.getActiveConnection(phone) || sock;
            const stream = await wa.downloadContentFromMessage(st.msgObj, st.mediaType);
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
                if (Buffer.concat(chunks).length > 50 * 1024 * 1024) throw new Error('File too large');
            }
            const buffer = Buffer.concat(chunks);
            if (!buffer.length) throw new Error('Empty buffer');

            const caption = st.content || '';

            if (st.mediaType === 'image') await sock.sendMessage(chatId, { image: buffer, caption });
            else if (st.mediaType === 'video') await sock.sendMessage(chatId, { video: buffer, caption });
            else if (st.mediaType === 'audio') await sock.sendMessage(chatId, { audio: buffer, mimetype: 'audio/mp4' });
            else if (st.mediaType === 'sticker') await sock.sendMessage(chatId, { sticker: buffer });
            return;
        } catch (e) {
            console.log('[Status] Download failed:', e.message);
        }
    }

    // Fallback: send content as text
    await sock.sendMessage(chatId, { text: st.content || `📸 (${st.type})` });
}

function getUniqueContacts(phone) {
    const groups = {};

    // Get fresh (non-expired) statuses directly from storage with auto-cleanup
    const storedStatuses = wa.getFreshStatuses(phone);

    // storedStatuses is already filtered by expiry, just need to group by contact
        for (const st of storedStatuses) {
        const key = normalizeJid(st.from);
        if (!key) continue;

        if (!groups[key]) {
            groups[key] = {
                jid: key,
                name: st.pushName || key,
                statuses: [],
                seenIds: new Set()
            };
        }
        if (!groups[key].seenIds.has(st.id)) {
            groups[key].seenIds.add(st.id);
            groups[key].statuses.push(st);
        }
    }

    // Sort each contact's statuses by time
    const result = Object.values(groups);
    for (const c of result) {
        c.statuses.sort((a, b) => (a.time || 0) - (b.time || 0));
        delete c.seenIds;
    }

    return result;
}

async function getPhoneFromSock(sock) {
    try {
        if (sock?.user?.id) return sock.user.id.split(':')[0].replace(/[^0-9]/g, '');
    } catch (e) {}
    try {
        const sessions = wa.getAllSessions();
        const connected = sessions.find(s => s.status === 'connected');
        if (connected) return connected.phone;
    } catch (e) {}
    return null;
}

module.exports = { statusCommand, handleStatusSelection };
