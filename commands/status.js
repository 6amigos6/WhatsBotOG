const fs = require('fs-extra');
const path = require('path');
const wa = require('../wa_manager');

// Track user status selection state per chatId
const statusStates = {};

async function statusCommand(sock, chatId, message) {
    try {
        // Get the sender's phone number from the sock
        const phone = getPhoneFromSock(sock);
        if (!phone) {
            await sock.sendMessage(chatId, {
                text: "❌ Could not identify WhatsApp session."
            }, { quoted: message });
            return;
        }

        // Get contacts with statuses
        const contacts = wa.getStoredStatusByContact(phone);
        
        if (!contacts || contacts.length === 0) {
            await sock.sendMessage(chatId, {
                text: "📭 *No Status Updates*\n\nNo contacts have shared statuses recently.\n\nStatuses are stored as they appear. Make sure your contacts have posted stories."
            }, { quoted: message });
            return;
        }

        // Build numbered contact list
        let msg = "📸 *WhatsApp Status*\n\nSelect a contact by sending its number:\n\n";
        const contactList = contacts.map((c, i) => {
            const name = c.name || c.jid.split('@')[0] || 'Unknown';
            const statusCount = c.statuses.length;
            return `${i + 1}. ${name} (${statusCount} ${statusCount === 1 ? 'status' : 'statuses'})`;
        });
        msg += contactList.join('\n');
        msg += "\n\n╰────────────────\n\nReply with a number (e.g., `1`) to view that contact's statuses.\nSend /cancel to cancel.";

        // Store state for this chat
        statusStates[chatId] = {
            contacts: contacts,
            active: true,
        };

        await sock.sendMessage(chatId, { text: msg }, { quoted: message });

    } catch (error) {
        console.error('[Status] Error:', error.message);
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

    // Parse the number
    const num = parseInt(text.trim());
    if (isNaN(num) || num < 1 || num > state.contacts.length) {
        await sock.sendMessage(chatId, {
            text: `❌ Invalid selection. Please send a number between 1 and ${state.contacts.length}.`
        }, { quoted: message });
        return true; // Still in selection mode
    }

    // Mark as no longer active (clean up state after processing)
    delete statusStates[chatId];

    const contact = state.contacts[num - 1];
    const statuses = contact.statuses;
    const name = contact.name || contact.jid.split('@')[0] || 'Unknown';

    await sock.sendMessage(chatId, {
        text: `📸 *${name}'s Statuses*\n\nSending ${statuses.length} status update(s)...`
    }, { quoted: message });

    for (let i = 0; i < statuses.length; i++) {
        const st = statuses[i];
        try {
            await sendStatusItem(sock, chatId, st, i + 1, statuses.length);
            // Small delay between sends
            await new Promise(r => setTimeout(r, 800));
        } catch (e) {
            console.error(`[Status] Failed to send status ${i + 1}:`, e.message);
        }
    }

    return true;
}

async function sendStatusItem(sock, chatId, st, index, total) {
    const caption = st.content 
        ? `╭─ 📸 *Status ${index}/${total}*\n│\n│ ${st.content}\n╰────────────────`
        : `╭─ 📸 *Status ${index}/${total}*\n╰────────────────`;

    if (st.type === 'text') {
        // Text status - just send as message
        await sock.sendMessage(chatId, {
            text: st.content || '(Empty status)'
        }, { quoted: null });
        return;
    }

    // Media status - try to download and forward
    if (st.msgObj && st.mediaType) {
        try {
            const socket = wa.getActiveConnection(getPhoneFromSock(sock));
            if (socket) {
                const stream = await wa.downloadContentFromMessage(st.msgObj, st.mediaType);
                const chunks = [];
                for await (const chunk of stream) {
                    chunks.push(chunk);
                }
                const buffer = Buffer.concat(chunks);

                if (st.mediaType === 'image') {
                    await sock.sendMessage(chatId, {
                        image: buffer,
                        caption: caption
                    });
                } else if (st.mediaType === 'video') {
                    await sock.sendMessage(chatId, {
                        video: buffer,
                        caption: caption
                    });
                } else if (st.mediaType === 'audio') {
                    await sock.sendMessage(chatId, {
                        audio: buffer,
                        mimetype: 'audio/mp4',
                        caption: caption
                    });
                } else if (st.mediaType === 'sticker') {
                    await sock.sendMessage(chatId, {
                        sticker: buffer
                    });
                } else {
                    await sock.sendMessage(chatId, {
                        document: buffer,
                        mimetype: 'application/octet-stream',
                        fileName: `status_${index}.${st.mediaType}`,
                        caption: caption
                    });
                }
                return;
            }
        } catch (e) {
            console.log(`[Status] Download failed for ${st.id}:`, e.message);
            // Fall through to text-only
        }
    }

    // Fallback: send caption with type info if media unavailable
    await sock.sendMessage(chatId, {
        text: `📸 *Status ${index}/${total}*\n\nType: ${st.type}\n${st.content ? 'Content: ' + st.content : ''}\n\n(Media content - could not download)`
    });
}

function getPhoneFromSock(sock) {
    // Get the phone number from the socket's user ID
    try {
        if (sock && sock.user && sock.user.id) {
            const jid = sock.user.id.split(':')[0] || sock.user.id;
            return jid.replace(/[^0-9]/g, '');
        }
    } catch (e) {}
    
    // Fallback: iterate through active connections
    try {
        const conns = wa.getAllActiveConnections();
        for (const [phone, s] of Object.entries(conns)) {
            if (s === sock) return phone;
        }
        // If not found by reference, try to match by user id
        for (const [phone, s] of Object.entries(conns)) {
            if (s && s.user && sock && sock.user && s.user.id === sock.user.id) return phone;
        }
    } catch (e) {}
    
    return null;
}

// Export both the command handler and the selection handler
module.exports = { statusCommand, handleStatusSelection };
