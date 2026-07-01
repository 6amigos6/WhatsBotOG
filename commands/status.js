const fs = require('fs-extra');
const path = require('path');
const wa = require('../wa_manager');

const statusStates = {};

async function statusCommand(sock, chatId, message) {
    try {
        const phone = await getPhoneFromSock(sock);
        if (!phone) {
            await sock.sendMessage(chatId, {
                text: "❌ Could not identify WhatsApp session."
            }, { quoted: message });
            return;
        }

        // Try to get stored statuses
        let contacts = wa.getStoredStatusByContact(phone);

        // ALSO try to get additional status messages from the general message store
        const extraStatuses = getStatusFromMessageStore(phone);
        if (extraStatuses.length > 0) {
            contacts = mergeStatusContacts(contacts, extraStatuses);
        }

        // If still no contacts found, try to trigger a fresh status fetch
        if (!contacts || contacts.length === 0) {
            // Try to load recent status@broadcast messages from the socket
            try {
                const loaded = await loadStatusFromSocket(sock, phone);
                if (loaded && loaded.length > 0) {
                    contacts = loaded;
                }
            } catch (e) {
                console.log('[Status] Socket load failed:', e.message);
            }
        }

        if (!contacts || contacts.length === 0) {
            await sock.sendMessage(chatId, {
                text: "📭 *No Status Updates*\n\nNo contacts have shared WhatsApp statuses (stories) recently.\n\n📌 Statuses are captured when your contacts post new updates while the bot is running.\n\n💡 Ask your contacts to post a status, then use `.status` again to view them."
            }, { quoted: message });
            return;
        }

        // Build contact list with proper names
        let msg = "📸 *WhatsApp Status Updates*\n\n";
        msg += "Select a contact by sending its number:\n\n";

        const contactList = contacts.map((c, i) => {
            const name = c.name || formatJid(c.jid);
            const statusCount = c.statuses.length;
            return `┃ ${i + 1}. ${name} (${statusCount})`;
        });
        msg += contactList.join('\n');
        msg += "\n\n╰────────────────\n";
        msg += "\nReply with a number (1-" + contacts.length + ") to view statuses.\n";
        msg += "Send /cancel to cancel.";

        // Store state
        statusStates[chatId] = {
            contacts: contacts,
            active: true,
            phone: phone,
        };

        await sock.sendMessage(chatId, { text: msg }, { quoted: message });

    } catch (error) {
        console.error('[Status] Error:', error.message);
        console.error('[Status] Stack:', error.stack);
        delete statusStates[chatId];
        try {
            await sock.sendMessage(chatId, {
                text: "❌ Failed to fetch statuses. Please try again."
            }, { quoted: message });
        } catch {}
    }
}

async function handleStatusSelection(sock, chatId, message, text) {
    const state = statusStates[chatId];
    if (!state || !state.active) return false;

    const num = parseInt(text.trim());
    if (isNaN(num) || num < 1 || num > state.contacts.length) {
        await sock.sendMessage(chatId, {
            text: `❌ Invalid selection. Please send a number between 1 and ${state.contacts.length}.`
        }, { quoted: message });
        return true;
    }

    delete statusStates[chatId];

    const contact = state.contacts[num - 1];
    const statuses = contact.statuses;
    const name = contact.name || formatJid(contact.jid);

    await sock.sendMessage(chatId, {
        text: `📸 *${name}'s Statuses*\n\nSending ${statuses.length} status update(s)...`
    }, { quoted: message });

    // Send each status
    for (let i = 0; i < statuses.length; i++) {
        const st = statuses[i];
        try {
            await sendStatusItem(sock, chatId, st, i + 1, statuses.length, state.phone);
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
            console.error(`[Status] Failed to send status ${i + 1}:`, e.message);
            try {
                await sock.sendMessage(chatId, {
                    text: `⚠️ Could not send status ${i + 1}/${statuses.length}.`
                });
            } catch {}
        }
    }

    return true;
}

async function sendStatusItem(sock, chatId, st, index, total, phone) {
    const prefix = `╭─ 📸 *Status ${index}/${total}*`;

    // Text status
    if (st.type === 'text') {
        const text = st.content || '(Empty status)';
        await sock.sendMessage(chatId, { text: `╭─ 📝 *Status ${index}/${total}*\n│\n│ ${text}\n╰────────────────` });
        return;
    }

    // Media status - try to download and forward
    if (st.msgObj && st.mediaType) {
        try {
            let socket = sock;
            // If the sock passed is the WA socket, use it directly
            // Otherwise try to get the active connection
            if (!socket || !socket.ev) {
                socket = wa.getActiveConnection(phone);
            }
            if (!socket) {
                socket = sock;
            }

            const stream = await wa.downloadContentFromMessage(st.msgObj, st.mediaType);
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
                if (Buffer.concat(chunks).length > 50 * 1024 * 1024) {
                    // File too large - stop downloading
                    throw new Error('File too large (>50MB)');
                }
            }
            const buffer = Buffer.concat(chunks);

            if (buffer.length === 0) {
                throw new Error('Empty buffer');
            }

            const caption = `╭─ 📸 *Status ${index}/${total}*\n│\n│ ${st.content || ''}\n╰────────────────`;

            const sendOpts = { caption: caption };

            if (st.mediaType === 'image') {
                await sock.sendMessage(chatId, { image: buffer, ...sendOpts });
            } else if (st.mediaType === 'video') {
                await sock.sendMessage(chatId, { video: buffer, ...sendOpts });
            } else if (st.mediaType === 'audio') {
                await sock.sendMessage(chatId, { audio: buffer, mimetype: 'audio/mp4' });
            } else if (st.mediaType === 'sticker') {
                await sock.sendMessage(chatId, { sticker: buffer });
            } else {
                await sock.sendMessage(chatId, {
                    document: buffer,
                    mimetype: 'application/octet-stream',
                    fileName: `status_${index}.${st.mediaType === 'video' ? 'mp4' : st.mediaType === 'image' ? 'jpg' : 'bin'}`,
                    ...sendOpts
                });
            }
            return;

        } catch (e) {
            console.log(`[Status] Download failed for ${st.id}:`, e.message);
            // Fall through to text fallback
        }
    }

    // If media download failed, try alternate approach using mediaUrl
    if (st.mediaUrl) {
        try {
            const axios = require('axios');
            const resp = await axios.get(st.mediaUrl, { responseType: 'arraybuffer', timeout: 15000 });
            const buffer = Buffer.from(resp.data);
            const caption = `╭─ 📸 *Status ${index}/${total}*\n│\n│ ${st.content || ''}\n╰────────────────`;

            if (st.type === 'image') {
                await sock.sendMessage(chatId, { image: buffer, caption });
            } else if (st.type === 'video') {
                await sock.sendMessage(chatId, { video: buffer, caption });
            } else if (st.type === 'audio') {
                await sock.sendMessage(chatId, { audio: buffer, mimetype: 'audio/mp4' });
            }
            return;
        } catch (e) {
            console.log(`[Status] URL download failed:`, e.message);
        }
    }

    // Ultimate fallback: send as text
    const fallbackText = `📸 *Status ${index}/${total}*\n\n` +
        (st.content ? `📝 ${st.content}\n\n` : '') +
        `🗂 Type: ${st.type}\n` +
        `👤 From: ${st.pushName || formatJid(st.from)}\n` +
        `🕐 ${new Date(st.time).toLocaleString()}`;

    await sock.sendMessage(chatId, { text: fallbackText });
}

function getStatusFromMessageStore(phone) {
    try {
        const filePath = path.join(__dirname, '..', 'sessions', phone, 'messages.json');
        if (!fs.existsSync(filePath)) return [];
        
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const broadcastMsgs = data['status@broadcast'];
        if (!broadcastMsgs || !broadcastMsgs.messages) return [];

        // Group by sender
        const contacts = {};
        for (const m of broadcastMsgs.messages) {
            const from = m.from || m.jid || 'unknown';
            if (!contacts[from]) {
                contacts[from] = { jid: from, name: m.pushName || formatJid(from), statuses: [] };
            }
            contacts[from].statuses.push({
                id: m.id,
                from: from,
                type: m.mediaType || 'text',
                content: m.text || m.caption || '',
                mediaUrl: m.mediaUrl || '',
                msgObj: null, // messages.json doesn't store full msgObj
                time: m.time || Date.now(),
                pushName: m.pushName || formatJid(from),
            });
        }

        return Object.values(contacts);
    } catch (e) {
        console.log('[Status] Message store read error:', e.message);
        return [];
    }
}

function mergeStatusContacts(stored, extra) {
    const merged = {};
    
    // Add stored contacts (with msgObj) first
    for (const c of (stored || [])) {
        merged[c.jid] = c;
    }
    
    // Add extra contacts, merging statuses if contact already exists
    for (const c of extra) {
        if (merged[c.jid]) {
            // Merge statuses, avoid duplicates
            const existingIds = new Set(merged[c.jid].statuses.map(s => s.id));
            for (const s of c.statuses) {
                if (!existingIds.has(s.id)) {
                    merged[c.jid].statuses.push(s);
                }
            }
        } else {
            merged[c.jid] = c;
        }
    }
    
    return Object.values(merged);
}

async function loadStatusFromSocket(sock, phone) {
    // Baileys v7 doesn't have a direct method to fetch status updates.
    // This function is a placeholder for future implementation.
    // Statuses are currently captured passively via messages.upsert events.
    return [];
}

async function getPhoneFromSock(sock) {
    try {
        if (sock && sock.user && sock.user.id) {
            const jid = sock.user.id.split(':')[0] || sock.user.id;
            return jid.replace(/[^0-9]/g, '');
        }
    } catch (e) {}
    
    // Check all active connections
    try {
        const conns = wa.getAllActiveConnections();
        for (const [phone, s] of Object.entries(conns)) {
            if (s === sock) return phone;
            if (s && s.user && sock && sock.user && 
                s.user.id && sock.user.id && 
                s.user.id.split(':')[0] === sock.user.id.split(':')[0]) return phone;
        }
    } catch (e) {}
    
    // Fallback: get first connected session
    try {
        const sessions = wa.getAllSessions();
        const connected = sessions.find(s => s.status === 'connected');
        if (connected) return connected.phone;
    } catch (e) {}
    
    return null;
}

function formatJid(jid) {
    if (!jid) return 'Unknown';
    return jid.replace(/@.*$/, '').replace(/[^0-9]/g, '');
}

module.exports = { statusCommand, handleStatusSelection };
