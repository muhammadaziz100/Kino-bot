const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

// --- SOZLAMALAR ---
const TOKEN = '8308358853:AAEvTxl9ihnDoTPumryx_tkW9O8DJoJTHeo'; // Tokeningiz
const MAIN_ADMIN_USERNAME = 'muhammadaziz_zor'; // Sizning username'ingiz

const bot = new TelegramBot(TOKEN, { polling: true });
const userSession = new Map();

// --- MA'LUMOTLAR BAZASI ---
class DatabaseManager {
    constructor() {
        this.filePath = path.resolve(__dirname, 'database.json');
        this.data = this._initDB();
    }

    _initDB() {
        if (!fs.existsSync(this.filePath)) {
            const defaultData = { admins: [], movies: {}, users: [], sponsor_channels: [], db_channel: "" };
            fs.writeFileSync(this.filePath, JSON.stringify(defaultData, null, 2));
            return defaultData;
        }
        return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    }

    save() {
        fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    }
}
const db = new DatabaseManager();

// --- TUGMALAR ---
const adminMenu = {
    reply_markup: {
        keyboard: [
            [{ text: "🎬 Kino yuklash" }],
            [{ text: "📊 Statistika" }, { text: "📨 Xabar yuborish" }],
            [{ text: "📌 Kanal qo'shish" }, { text: "❌ Kanal o'chirish" }],
            [{ text: "➕ Admin qo'shish" }, { text: "➖ Admin o'chirish" }],
            [{ text: "🗂 Kino bazasi" }]
        ],
        resize_keyboard: true
    }
};

const userMenu = { reply_markup: { keyboard: [[{ text: "🔍 Kino izlash" }]], resize_keyboard: true } };
const backMenu = { reply_markup: { keyboard: [[{ text: "🔙 Ortga" }]], resize_keyboard: true } };

// --- MAJBURIY A'ZOLIK ---
async function isSubbed(chatId) {
    if (db.data.admins.includes(chatId) || db.data.sponsor_channels.length === 0) return true;

    let subbed = true;
    const keyboard = [];

    for (const ch of db.data.sponsor_channels) {
        try {
            const member = await bot.getChatMember(ch, chatId);
            if (member.status === 'left' || member.status === 'kicked') {
                subbed = false;
                keyboard.push([{ text: "Kanalga a'zo bo'lish", url: `https://t.me/${ch.replace('@', '')}` }]);
            }
        } catch (e) { } // Xatolik bo'lsa yashirish
    }

    if (!subbed) {
        keyboard.push([{ text: "✅ Tasdiqlash", callback_data: "check_sub" }]);
        await bot.sendMessage(chatId, "⚠️ Kino ko'rish uchun avval kanallarga a'zo bo'ling:", {
            reply_markup: { inline_keyboard: keyboard }
        });
        return false;
    }
    return true;
}

// --- ASOSIY DASTUR ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || '';
    const username = msg.from.username ? msg.from.username.toLowerCase() : '';

    if (!text && !msg.video && !msg.document) return;

    // Odamlarni bazaga qo'shish
    if (!db.data.users.includes(chatId)) {
        db.data.users.push(chatId);
        db.save();
    }

    // Sizni avtomatik admin qilish
    let isAdmin = db.data.admins.includes(chatId);
    if (username === MAIN_ADMIN_USERNAME && !isAdmin) {
        db.data.admins.push(chatId);
        db.save();
        isAdmin = true;
    }

    const session = userSession.get(chatId) || { state: null };

    // Ortga
    if (text === "🔙 Ortga") {
        userSession.delete(chatId);
        return bot.sendMessage(chatId, "Bosh menyu", isAdmin ? adminMenu : userMenu);
    }

    // /start
    if (text === '/start') {
        userSession.delete(chatId);
        if (isAdmin) return bot.sendMessage(chatId, "Salom Admin!", adminMenu);
        
        // Obunani tekshirish
        const ok = await isSubbed(chatId);
        if (ok) bot.sendMessage(chatId, "Assalomu alaykum! Kino kodini yuboring.", userMenu);
        return;
    }

    // --- ADMIN PANEL ---
    if (isAdmin) {
        if (text === "🗂 Kino bazasi") {
            userSession.set(chatId, { state: 'DB_CH' });
            return bot.sendMessage(chatId, `Baza kanalini (@kanal_nomi) yuboring.\nHozirgi: ${db.data.db_channel || 'Yoq'}`, backMenu);
        }
        if (session.state === 'DB_CH') {
            db.data.db_channel = text.trim();
            db.save();
            userSession.delete(chatId);
            return bot.sendMessage(chatId, "Baza saqlandi!", adminMenu);
        }

        if (text === "🎬 Kino yuklash") {
            userSession.set(chatId, { state: 'WAIT_VID' });
            return bot.sendMessage(chatId, "Videoni yuboring:", backMenu);
        }
        if (session.state === 'WAIT_VID' && (msg.video || msg.document)) {
            try {
                const copy = await bot.copyMessage(db.data.db_channel, chatId, msg.message_id);
                userSession.set(chatId, { state: 'WAIT_CODE', msgId: copy.message_id });
                return bot.sendMessage(chatId, "Video tushdi! Kino kodini yozing (masalan 101):", backMenu);
            } catch (e) {
                userSession.delete(chatId);
                return bot.sendMessage(chatId, "Xatolik! Bot baza kanalida admin emas yoki kanal xato.", adminMenu);
            }
        }
        if (session.state === 'WAIT_CODE') {
            db.data.movies[text.trim()] = session.msgId;
            db.save();
            userSession.delete(chatId);
            return bot.sendMessage(chatId, `Kino saqlandi! Kodi: ${text}`, adminMenu);
        }

        // Kanallar
        if (text === "📌 Kanal qo'shish") {
            userSession.set(chatId, { state: 'ADD_CH' });
            return bot.sendMessage(chatId, "Kanal qo'shish (@kanal_nomi):", backMenu);
        }
        if (session.state === 'ADD_CH') {
            db.data.sponsor_channels.push(text.trim());
            db.save();
            userSession.delete(chatId);
            return bot.sendMessage(chatId, "Kanal qo'shildi!", adminMenu);
        }
        if (text === "❌ Kanal o'chirish") {
            userSession.set(chatId, { state: 'DEL_CH' });
            return bot.sendMessage(chatId, `O'chirish uchun kanal nomini yozing:\n${db.data.sponsor_channels.join('\n')}`, backMenu);
        }
        if (session.state === 'DEL_CH') {
            db.data.sponsor_channels = db.data.sponsor_channels.filter(c => c !== text.trim());
            db.save();
            userSession.delete(chatId);
            return bot.sendMessage(chatId, "Kanal o'chirildi!", adminMenu);
        }

        // Adminlar
        if (text === "➕ Admin qo'shish") {
            userSession.set(chatId, { state: 'ADD_ADM' });
            return bot.sendMessage(chatId, "Yangi admin IDsi:", backMenu);
        }
        if (session.state === 'ADD_ADM') {
            db.data.admins.push(Number(text));
            db.save();
            userSession.delete(chatId);
            return bot.sendMessage(chatId, "Admin qo'shildi!", adminMenu);
        }
        if (text === "➖ Admin o'chirish") {
            userSession.set(chatId, { state: 'DEL_ADM' });
            return bot.sendMessage(chatId, `O'chirish uchun ID yozing:\n${db.data.admins.join('\n')}`, backMenu);
        }
        if (session.state === 'DEL_ADM') {
            db.data.admins = db.data.admins.filter(a => a !== Number(text));
            db.save();
            userSession.delete(chatId);
            return bot.sendMessage(chatId, "Admin o'chirildi!", adminMenu);
        }

        // Statistika va Xabar
        if (text === "📊 Statistika") {
            return bot.sendMessage(chatId, `Odamlar: ${db.data.users.length}\nKinolar: ${Object.keys(db.data.movies).length}`);
        }
        if (text === "📨 Xabar yuborish") {
            userSession.set(chatId, { state: 'BROAD' });
            return bot.sendMessage(chatId, "Xabarni yuboring:", backMenu);
        }
        if (session.state === 'BROAD') {
            userSession.delete(chatId);
            bot.sendMessage(chatId, "Tarqatilmoqda...", adminMenu);
            db.data.users.forEach(u => bot.copyMessage(u, chatId, msg.message_id).catch(()=>{}));
            return;
        }
    }

    // --- KINO QIDIRISH (FOYDALANUVCHI) ---
    if (text === "🔍 Kino izlash") {
        const ok = await isSubbed(chatId);
        if (ok) bot.sendMessage(chatId, "Kino kodini yozing:");
        return;
    }

    if (!session.state && text && !text.startsWith('/')) {
        const ok = await isSubbed(chatId);
        if (!ok) return;

        const msgId = db.data.movies[text.trim()];
        if (msgId && db.data.db_channel) {
            try {
                await bot.copyMessage(chatId, db.data.db_channel, msgId);
            } catch (e) {
                bot.sendMessage(chatId, "Kinoni yuklab bo'lmadi.");
            }
        } else {
            bot.sendMessage(chatId, "Bunday kodli kino topilmadi.");
        }
    }
});

// Inline tugma bosilganda
bot.on('callback_query', async (query) => {
    if (query.data === 'check_sub') {
        const ok = await isSubbed(query.message.chat.id);
        if (ok) {
            bot.deleteMessage(query.message.chat.id, query.message.message_id).catch(()=>{});
            bot.sendMessage(query.message.chat.id, "Rahmat! Kino kodini yozishingiz mumkin.", userMenu);
        } else {
            bot.answerCallbackQuery(query.id, { text: "Kanallarga a'zo bo'lmadingiz!", show_alert: true });
        }
    }
});

// Xatoliklarni ushlab qolish
process.on('uncaughtException', () => {});
bot.on('polling_error', () => {});