const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

// --- SOZLAMALAR ---
const TOKEN = '8308358853:AAEvTxl9ihnDoTPumryx_tkW9O8DJoJTHeo'; // Bot tokeni
const MAIN_ADMIN_USERNAME = 'muhammadaziz_zor'.toLowerCase(); // Asosiy admin

// INTERNETGA ULANISH XATOLIGI (IPv4 muammosi) YECHIMI:
const bot = new TelegramBot(TOKEN, { 
    polling: true,
    request: {
        agentOptions: {
            family: 4 
        }
    }
});

const userSession = new Map();
let BOT_USERNAME = ''; 

// Bot ishga tushganda o'z nomini aniqlab oladi
bot.getMe().then(me => {
    BOT_USERNAME = me.username;
    console.log(`✅ Bot @${BOT_USERNAME} nomi bilan muvaffaqiyatli ishga tushdi!`);
}).catch(err => {
    console.error("❌ Botni ishga tushirishda xatolik:", err.message);
});

// --- MA'LUMOTLAR BAZASI ---
class DatabaseManager {
    constructor() {
        this.filePath = path.resolve(__dirname, 'database.json');
        this.data = this._initDB();
    }

    _initDB() {
        if (!fs.existsSync(this.filePath)) {
            const defaultData = { admins: [], movies: {}, users: [], channels: [], db_channel: "" };
            fs.writeFileSync(this.filePath, JSON.stringify(defaultData, null, 2));
            return defaultData;
        }
        try {
            return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        } catch (e) {
            return { admins: [], movies: {}, users: [], channels: [], db_channel: "" };
        }
    }

    save() {
        fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    }
}
const db = new DatabaseManager();

// --- KLAVIATURALAR ---
const keyboards = {
    admin: {
        reply_markup: {
            keyboard: [
                [{ text: "🎬 Kino yuklash" }],
                [{ text: "📊 Statistika" }, { text: "📨 Xabar yuborish" }],
                [{ text: "📌 Kanal qo'shish" }, { text: "❌ Kanal o'chirish" }],
                [{ text: "➕ Admin qo'shish" }, { text: "➖ Admin o'chirish" }],
                [{ text: "🗂 Kino bazasi sozlash" }]
            ],
            resize_keyboard: true
        }
    },
    user: {
        reply_markup: {
            keyboard: [[{ text: "🔍 Kino izlash" }]],
            resize_keyboard: true
        }
    },
    back: {
        reply_markup: {
            keyboard: [[{ text: "🔙 Ortga" }]],
            resize_keyboard: true
        }
    }
};

// --- YORDAMCHI FUNKSIYALAR ---

// 1. Majburiy obunani tekshirish (Kanal nomlari yashirilgan)
async function isSubbed(chatId) {
    if (db.data.admins.includes(chatId) || db.data.channels.length === 0) return true;

    const inline_keyboard = [];
    let allSubbed = true;

    for (let i = 0; i < db.data.channels.length; i++) {
        const ch = db.data.channels[i];
        try {
            const res = await bot.getChatMember(ch, chatId);
            if (!['member', 'administrator', 'creator'].includes(res.status)) {
                allSubbed = false;
                inline_keyboard.push([{ text: `📢 ${i + 1}-kanalga obuna bo'lish`, url: `https://t.me/${ch.replace('@', '')}` }]);
            }
        } catch (e) {
            console.error(`Kanal xatosi (${ch}):`, e.message);
        }
    }

    if (!allSubbed) {
        inline_keyboard.push([{ text: "✅ Tasdiqlash", callback_data: "check_sub" }]);
        await bot.sendMessage(chatId, "⚠️ <b>Kino ko'rish uchun quyidagi homiy kanallarimizga obuna bo'lishingiz shart:</b>", {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: inline_keyboard }
        });
        return false;
    }
    return true;
}

// 2. Kinoni Ulashish tugmasi bilan yuborish
async function sendMovie(chatId, code) {
    const movieMsgId = db.data.movies[code];
    
    if (movieMsgId && db.data.db_channel) {
        const botUrl = `https://t.me/${BOT_USERNAME}?start=${code}`;
        const shareText = encodeURIComponent(`🔥 Men daxshatli kino topdim!\n\nKino kodi: ${code}\nShu ssilkani bosib ko'ring 👇`);
        const shareLink = `https://t.me/share/url?url=${botUrl}&text=${shareText}`;
        
        try {
            await bot.copyMessage(chatId, db.data.db_channel, movieMsgId, {
                reply_markup: {
                    inline_keyboard: [[{ text: "🚀 Do'stlarga ulashish", url: shareLink }]]
                }
            });
        } catch (e) {
            bot.sendMessage(chatId, "❌ Kechirasiz, kinoni yuborishda xatolik yuz berdi. Baza kanalini tekshiring.");
        }
    } else {
        bot.sendMessage(chatId, "😔 Afsuski, bunday kodli kino topilmadi. Kodni tekshirib qaytadan yuboring.");
    }
}

const delay = (ms) => new Promise(res => setTimeout(res, ms));

// --- ASOSIY JARAYON ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || '';
    const username = msg.from.username ? msg.from.username.toLowerCase() : '';

    // Foydalanuvchini bazaga qo'shish
    if (!db.data.users.includes(chatId)) {
        db.data.users.push(chatId);
        db.save();
    }

    let isAdmin = db.data.admins.includes(chatId) || username === MAIN_ADMIN_USERNAME;
    let session = userSession.get(chatId) || {};

    // Asosiy adminni bazaga saqlash
    if (username === MAIN_ADMIN_USERNAME && !db.data.admins.includes(chatId)) {
        db.data.admins.push(chatId);
        db.save();
        isAdmin = true;
    }

    if (text === "🔙 Ortga") {
        userSession.delete(chatId);
        return bot.sendMessage(chatId, "Bosh menyudasiz.", isAdmin ? keyboards.admin : keyboards.user);
    }

    // ================= /START VA DEEP LINKING =================
    if (text.startsWith('/start')) {
        userSession.delete(chatId);
        
        const parts = text.split(' ');
        const requestedCode = parts.length > 1 ? parts[1] : null;

        if (isAdmin && !requestedCode) {
            return bot.sendMessage(chatId, "👋 <b>Admin panelga xush kelibsiz!</b>", { parse_mode: 'HTML', ...keyboards.admin });
        }
        
        const ok = await isSubbed(chatId);
        
        if (!ok) {
            // Agar obuna bo'lmagan va kino kodi bilan kelgan bo'lsa
            if (requestedCode) {
                userSession.set(chatId, { pendingCode: requestedCode });
            }
            return;
        }

        // Hamma narsa joyida bo'lsa va kod bilan kelgan bo'lsa
        if (requestedCode) {
            return sendMovie(chatId, requestedCode);
        }

        return bot.sendMessage(chatId, "🎬 <b>Assalomu alaykum! Kino kodini yuboring:</b>", { parse_mode: 'HTML', ...keyboards.user });
    }

    // ================= ADMIN PANEL =================
    if (isAdmin) {
        switch(text) {
            case "🎬 Kino yuklash":
                if (!db.data.db_channel) return bot.sendMessage(chatId, "❌ Avval 'Kino bazasi sozlash' orqali kanalni sozlang!");
                userSession.set(chatId, { state: 'WAIT_VIDEO' });
                return bot.sendMessage(chatId, "🎥 Kinoni yuboring (video yoki fayl):", keyboards.back);
            case "📊 Statistika":
                return bot.sendMessage(chatId, `📊 <b>Statistika:</b>\n\n👤 Foydalanuvchilar: ${db.data.users.length}\n🎬 Kinolar: ${Object.keys(db.data.movies).length}\n📢 Kanallar: ${db.data.channels.length}`, { parse_mode: 'HTML' });
            case "📌 Kanal qo'shish":
                userSession.set(chatId, { state: 'ADD_CH' });
                return bot.sendMessage(chatId, "Kanal @usernamesini yuboring:", keyboards.back);
            case "❌ Kanal o'chirish":
                if (db.data.channels.length === 0) return bot.sendMessage(chatId, "Kanal yo'q.", keyboards.admin);
                userSession.set(chatId, { state: 'DEL_CH' });
                return bot.sendMessage(chatId, `O'chirish uchun kanal nomini xuddi shunday yozing:\n\n${db.data.channels.join('\n')}`, keyboards.back);
            case "🗂 Kino bazasi sozlash":
                userSession.set(chatId, { state: 'SET_DB' });
                return bot.sendMessage(chatId, `Kino bazasi uchun kanal @usernamesini yuboring.\nHozirgi kanal: ${db.data.db_channel || "Yo'q"}`, keyboards.back);
            case "➕ Admin qo'shish":
                userSession.set(chatId, { state: 'ADD_ADM' });
                return bot.sendMessage(chatId, "Yangi admin ID sini yuboring (Raqam shaklida):", keyboards.back);
            case "➖ Admin o'chirish":
                userSession.set(chatId, { state: 'DEL_ADM' });
                return bot.sendMessage(chatId, `O'chirish uchun admin ID sini yozing:\n\n${db.data.admins.join('\n')}`, keyboards.back);
            case "📨 Xabar yuborish":
                userSession.set(chatId, { state: 'SEND_POST' });
                return bot.sendMessage(chatId, "Tarqatmoqchi bo'lgan xabaringizni yuboring (Rasm, video, matn):", keyboards.back);
        }

        // Admin holatlarini ushlash
        if (session.state === 'WAIT_VIDEO' && (msg.video || msg.document)) {
            const copy = await bot.copyMessage(db.data.db_channel, chatId, msg.message_id);
            userSession.set(chatId, { state: 'WAIT_CODE', msgId: copy.message_id });
            return bot.sendMessage(chatId, "✅ Video qabul qilindi. Endi unga raqamli yoki matnli kod bering:", keyboards.back);
        }

        if (session.state === 'WAIT_CODE' && text) {
            db.data.movies[text.trim()] = session.msgId;
            db.save();
            userSession.delete(chatId);
            return bot.sendMessage(chatId, `✅ Kino bazaga muvaffaqiyatli saqlandi!\n\nKodi: <b>${text.trim()}</b>`, { parse_mode: 'HTML', ...keyboards.admin });
        }

        if (session.state === 'ADD_CH' && text) {
            const ch = text.startsWith('@') ? text : '@' + text;
            if (!db.data.channels.includes(ch)) db.data.channels.push(ch);
            db.save();
            userSession.delete(chatId);
            return bot.sendMessage(chatId, "✅ Kanal muvaffaqiyatli qo'shildi!", keyboards.admin);
        }

        if (session.state === 'DEL_CH' && text) {
            db.data.channels = db.data.channels.filter(c => c !== text.trim());
            db.save();
            userSession.delete(chatId);
            return bot.sendMessage(chatId, "✅ Kanal o'chirildi!", keyboards.admin);
        }

        if (session.state === 'SET_DB' && text) {
            db.data.db_channel = text.trim();
            db.save();
            userSession.delete(chatId);
            return bot.sendMessage(chatId, "✅ Baza kanali o'rnatildi!", keyboards.admin);
        }

        if (session.state === 'ADD_ADM' && text) {
            const newAdminId = Number(text.trim());
            if (!isNaN(newAdminId) && !db.data.admins.includes(newAdminId)) {
                db.data.admins.push(newAdminId);
                db.save();
                bot.sendMessage(chatId, "✅ Admin qo'shildi!", keyboards.admin);
            } else {
                bot.sendMessage(chatId, "❌ Noto'g'ri ID yoki admin allaqachon bor.", keyboards.admin);
            }
            userSession.delete(chatId);
            return;
        }

        if (session.state === 'DEL_ADM' && text) {
            db.data.admins = db.data.admins.filter(a => a !== Number(text.trim()));
            db.save();
            userSession.delete(chatId);
            return bot.sendMessage(chatId, "✅ Admin o'chirildi!", keyboards.admin);
        }

        if (session.state === 'SEND_POST') {
            userSession.delete(chatId);
            bot.sendMessage(chatId, "🚀 Xabar yuborilmoqda... Bot biroz qotishi mumkin, kuting.");
            let count = 0;
            for (let u of db.data.users) {
                try { 
                    await bot.copyMessage(u, chatId, msg.message_id); 
                    count++; 
                    await delay(50); 
                } catch (e) {} // Bloklaganlarga xato bermay o'tkazib yuboradi
            }
            return bot.sendMessage(chatId, `✅ Xabar ${count} ta foydalanuvchiga muvaffaqiyatli yetkazildi!`, keyboards.admin);
        }
    }

    // ================= FOYDALANUVCHI QIDIRUVI =================
    if (!session.state && text && !text.startsWith('/')) {
        if (text === "🔍 Kino izlash") {
            const ok = await isSubbed(chatId);
            if (ok) return bot.sendMessage(chatId, "🎬 Qidirayotgan kinongiz kodini yuboring:");
            return;
        }

        const ok = await isSubbed(chatId);
        if (ok) {
            sendMovie(chatId, text.trim());
        }
    }
});

// ================= INLINE TUGMALAR (CALLBACK) =================
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    
    if (query.data === 'check_sub') {
        const ok = await isSubbed(chatId);
        if (ok) {
            bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
            
            const session = userSession.get(chatId) || {};
            // Agar foydalanuvchi do'stini ssilkasi orqali kirgan bo'lsa va tasdiqlasa, kinoni avtomatik beramiz
            if (session.pendingCode) {
                bot.answerCallbackQuery(query.id, { text: "✅ Rahmat! Obuna tasdiqlandi. Kino tayyorlanmoqda...", show_alert: false });
                const codeToSend = session.pendingCode;
                userSession.delete(chatId); 
                return sendMovie(chatId, codeToSend);
            } else {
                bot.answerCallbackQuery(query.id, { text: "✅ Rahmat! Obuna tasdiqlandi.", show_alert: false });
                bot.sendMessage(chatId, "✅ Obuna tasdiqlandi! Endi istalgan kino kodini yuborishingiz mumkin.", keyboards.user);
            }
        } else {
            bot.answerCallbackQuery(query.id, { text: "❌ Siz hali barcha kanallarga a'zo bo'lmadingiz! Iltimos, barchasiga a'zo bo'ling.", show_alert: true });
        }
    }
});

// Xatoliklarni ushlash (Server o'chib qolmasligi uchun)
bot.on('polling_error', (e) => console.log("⏳ Ulanish kutilmoqda..."));
process.on('uncaughtException', (err) => console.log("Kutilmagan xatolik:", err.message));
