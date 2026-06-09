import os
import re as _re
import json
import time
import logging
from datetime import datetime, timedelta
from collections import defaultdict
from dotenv import load_dotenv
from telegram import Update, ChatPermissions
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
from telegram.error import TelegramError

load_dotenv()
TELEGRAM_TOKEN       = os.getenv("TELEGRAM_TOKEN")
ADMIN_CHAT_ID        = os.getenv("ADMIN_CHAT_ID")
COMMUNITY_GROUP_ID   = os.getenv("COMMUNITY_GROUP_ID")

logging.basicConfig(format='%(asctime)s - %(name)s - %(levelname)s - %(message)s', level=logging.INFO)
logger = logging.getLogger(__name__)

def is_admin(user_id: int) -> bool:
    return str(user_id) == str(ADMIN_CHAT_ID)

def is_community_group(chat_id: int) -> bool:
    return str(chat_id) == str(COMMUNITY_GROUP_ID)

def escape_md(text: str) -> str:
    for ch in ['*', '_', '`', '[']:
        text = text.replace(ch, f'\\{ch}')
    return text

def load_json(path: str) -> dict:
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def save_json(path: str, data: dict):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def get_chat_admins(context, chat_id: int) -> list:
    try:
        admins = context.bot.get_chat_administrators(chat_id)
        return [admin.user.id for admin in admins]
    except TelegramError:
        return []

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_chat.type != "private": return
    await update.message.reply_text("👋 *Zenthis Bot*\n\nSend me any message and I'll publish it to the group.", parse_mode="Markdown")

async def id_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    cid = update.effective_chat.id
    chat_type = update.effective_chat.type
    lines = [f"🆔 Your user ID: `{uid}`"]
    if chat_type in ("group", "supergroup"):
        lines.append(f"👥 Group ID: `{cid}`")
        if str(cid).startswith("-100"):
            lines.append("✅ Copy this ID to `COMMUNITY_GROUP_ID` in `.env`")
    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")

async def anuncio_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_chat.type != "private": return
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("❌ You don't have permission."); return
    text = update.message.text.replace("/anuncio", "", 1).strip()
    if not text:
        await update.message.reply_text("⚠️ `/anuncio <text>`", parse_mode="Markdown"); return
    await _send_to_group(update, context, text)

async def text_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_chat.type != "private": return
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("❌ You don't have permission."); return
    text = update.message.text.strip()
    if not text: return
    answer = find_faq_answer(text)
    if answer:
        await update.message.reply_text(answer, parse_mode="Markdown", disable_web_page_preview=True)
    await _send_to_group(update, context, text)

async def _send_to_group(update: Update, context: ContextTypes.DEFAULT_TYPE, text: str):
    if not COMMUNITY_GROUP_ID:
        await update.message.reply_text("⚠️ `COMMUNITY_GROUP_ID` not configured.", parse_mode="Markdown"); return
    formatted = f"🚀 *ZENTHIS UPDATE* 🚀\n\n{escape_md(text)}\n\n🌐 [zenthis-app.web.app](https://zenthis-app.web.app)"
    try:
        await context.bot.send_message(chat_id=COMMUNITY_GROUP_ID, text=formatted, parse_mode="Markdown", disable_web_page_preview=True)
        await update.message.reply_text("✅ Published to the group!")
    except Exception as e:
        logger.error(f"Error sending to group: {e}")
        await update.message.reply_text(f"❌ Error: `{e}`", parse_mode="Markdown")

DATA_DIR = os.getenv("DATA_DIR", os.path.dirname(os.path.abspath(__file__)))
WARNS_FILE = os.path.join(DATA_DIR, "warns.json")
MUTES_FILE = os.path.join(DATA_DIR, "mutes.json")
flood_tracker = defaultdict(list)
MAX_FLOOD_MSGS, FLOOD_WINDOW, FLOOD_MUTE_MIN = 5, 10, 5

BAD_WORDS = [
    r'\bput[ao]\b', r'\bputa\b', r'\bputo\b', r'\bmaric[oó]n\b', r'\bmarica\b',
    r'\bf[uú]ck\b', r'\bf[uú]cking\b', r'\bshit\b', r'\bcunt\b', r'\bbitch\b',
    r'\bbastard\b', r'\bdick\b', r'\basshole\b', r'\bretard\b', r'\bn[ií]gg[ae]r?\b',
    r'\bpendej[oa]\b', r'\bverga\b', r'\bcabr[oó]n\b', r'\bmierda\b', r'\bcul[oe]\b',
    r'\bjoder\b', r'\bidiot[ae]\b', r'\best[úu]pid[oa]\b', r'\bgilipollas\b',
    r'\bscam\b', r'\bs[c4]ammer\b', r'\bhij[oa] de puta\b', r'\bhij[oa]puta\b',
]
BAD_WORDS_PATTERN = _re.compile('|'.join(BAD_WORDS), _re.IGNORECASE)

ALLOWED_DOMAINS = ["zenthis-app.web.app", "zenthis.io", "t.me", "telegram.org", "telegram.me"]
URL_PATTERN = _re.compile(r'(?:https?://)?(?:www\.)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?:/\S*)?')

GROUP_RULES = (
    "📜 *ZENTHIS GROUP RULES* 📜\n\n"
    "1️⃣ *Mutual respect*\n2️⃣ *No spam*\n3️⃣ *No flooding*\n"
    "4️⃣ *Relevant content*\n5️⃣ *No fake accounts*\n"
    "6️⃣ *Follow moderators*\n7️⃣ *English preferred*\n\n"
    "⚠️ 3 warnings = mute • 5 warnings = ban\nUse `/report` to report."
)

def get_warns(user_id): return load_json(WARNS_FILE).get(str(user_id), {"count":0,"reasons":[],"last_warn":0})
def set_warns(user_id, info): d=load_json(WARNS_FILE); d[str(user_id)]=info; save_json(WARNS_FILE, d)
def add_warn(user_id, reason):
    info=get_warns(user_id); info["count"]=info.get("count",0)+1
    info["reasons"].append({"reason":reason,"date":time.time()}); info["last_warn"]=time.time()
    set_warns(user_id, info); return info["count"]
def reset_warns(user_id): d=load_json(WARNS_FILE); d.pop(str(user_id),None); save_json(WARNS_FILE, d)

def get_mute(user_id): return load_json(MUTES_FILE).get(str(user_id))
def set_mute(user_id, until): d=load_json(MUTES_FILE); d[str(user_id)]=until; save_json(MUTES_FILE, d)
def del_mute(user_id): d=load_json(MUTES_FILE); d.pop(str(user_id),None); save_json(MUTES_FILE, d)

def extract_domains(text):
    return [m.group(1) for m in URL_PATTERN.finditer(text) if m.group(1) not in ("tg",)]

def message_has_bad_links(text):
    domains=extract_domains(text); bad=[d for d in domains if d not in ALLOWED_DOMAINS]; return bool(bad), bad

def message_has_bad_words(text): return bool(BAD_WORDS_PATTERN.search(text))

def check_flood(user_id):
    now=time.time(); stamps=flood_tracker[user_id]
    stamps=[s for s in stamps if now-s<FLOOD_WINDOW]; flood_tracker[user_id]=stamps; stamps.append(now)
    return len(stamps)>MAX_FLOOD_MSGS, len(stamps)

async def moderate_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.text: return
    chat_id, user_id, text = update.effective_chat.id, update.effective_user.id, update.message.text
    if not is_community_group(chat_id): return

    is_question = "?" in text or "¿" in text
    mentions_bot = "@zenthisbot" in text.lower()
    if is_question or mentions_bot:
        clean = text.lower().replace("@zenthisbot", "").strip()
        answer = find_faq_answer(clean)
        if answer:
            try: await update.message.reply_text(answer, parse_mode="Markdown", disable_web_page_preview=True)
            except TelegramError as e: logger.error(f"FAQ error: {e}")
            return

    admins = get_chat_admins(context, chat_id)
    if user_id in admins: return
    username = update.effective_user.username or update.effective_user.first_name or "User"
    actions = []

    is_flood, fc = check_flood(user_id)
    if is_flood:
        try: await update.message.delete()
        except TelegramError: pass
        until=time.time()+(FLOOD_MUTE_MIN*60); set_mute(user_id,until)
        try: await context.bot.restrict_chat_member(chat_id,user_id,permissions=ChatPermissions(can_send_messages=False),until_date=datetime.fromtimestamp(until))
        except TelegramError: pass
        return

    has_bad, bad_domains = message_has_bad_links(text)
    if has_bad:
        try: await update.message.delete()
        except TelegramError: pass
        actions.append(f"🔗 Not allowed link: `{', '.join(bad_domains)}`")
        add_warn(user_id, f"Link: {', '.join(bad_domains)}")

    if message_has_bad_words(text):
        try: await update.message.delete()
        except TelegramError: pass
        actions.append("🤬 Inappropriate language")
        add_warn(user_id, "Inappropriate language")

    if actions:
        wc = get_warns(user_id)["count"]
        alert = f"⚠️ *@{username}* — message deleted:\n" + "\n".join(f"• {a}" for a in actions) + f"\n\n📊 Warnings: {wc}/5\n_(3=mute • 5=ban)_"
        try: await context.bot.send_message(chat_id=chat_id, text=alert, parse_mode="Markdown")
        except TelegramError: pass
        if wc>=5:
            try:
                await context.bot.ban_chat_member(chat_id, user_id); reset_warns(user_id)
                await context.bot.send_message(chat_id=chat_id, text=f"🚫 @{username} banned (5 warnings).", parse_mode="Markdown")
            except TelegramError as e: logger.error(f"Ban error: {e}")
        elif wc>=3:
            until=time.time()+3600; set_mute(user_id,until)
            try:
                await context.bot.restrict_chat_member(chat_id,user_id,permissions=ChatPermissions(can_send_messages=False),until_date=datetime.fromtimestamp(until))
                await context.bot.send_message(chat_id=chat_id, text=f"🔇 @{username} muted 1h (3 warnings).", parse_mode="Markdown")
            except TelegramError as e: logger.error(f"Mute error: {e}")

async def warn_command(update, context):
    if not update.message.reply_to_message: await update.message.reply_text("⚠️ Reply to a message with `/warn`"); return
    chat_id, admin_id = update.effective_chat.id, update.effective_user.id
    if admin_id not in get_chat_admins(context, chat_id): await update.message.reply_text("❌ Admins only."); return
    target = update.message.reply_to_message.from_user
    reason = update.message.text.replace("/warn","",1).strip() or "No reason"
    count = add_warn(target.id, reason)
    username = target.username or target.first_name
    if count>=5:
        try:
            await context.bot.ban_chat_member(chat_id,target.id); reset_warns(target.id)
            await update.message.reply_text(f"🚫 @{username} banned (5 warnings).", parse_mode="Markdown")
        except TelegramError as e: await update.message.reply_text(f"❌ {e}")
    elif count>=3:
        until=time.time()+3600; set_mute(target.id,until)
        try:
            await context.bot.restrict_chat_member(chat_id,target.id,permissions=ChatPermissions(can_send_messages=False),until_date=datetime.fromtimestamp(until))
            await update.message.reply_text(f"🔇 @{username} muted 1h ({count}/5).", parse_mode="Markdown")
        except TelegramError as e: await update.message.reply_text(f"❌ {e}")
    else: await update.message.reply_text(f"⚠️ @{username} warned ({count}/5)\n📝 {reason}", parse_mode="Markdown")

async def mute_command(update, context):
    if not update.message.reply_to_message: await update.message.reply_text("⚠️ Reply to a message with `/mute [minutes]`"); return
    chat_id, admin_id = update.effective_chat.id, update.effective_user.id
    if admin_id not in get_chat_admins(context, chat_id): await update.message.reply_text("❌ Admins only."); return
    target = update.message.reply_to_message.from_user; username = target.username or target.first_name
    args=update.message.text.split(); minutes=60
    if len(args)>1:
        try: minutes=max(1,min(int(args[1]),43200))
        except ValueError: pass
    until=time.time()+(minutes*60); set_mute(target.id,until)
    try:
        await context.bot.restrict_chat_member(chat_id,target.id,permissions=ChatPermissions(can_send_messages=False),until_date=datetime.fromtimestamp(until))
        await update.message.reply_text(f"🔇 @{username} muted {minutes} min.", parse_mode="Markdown")
    except TelegramError as e: await update.message.reply_text(f"❌ {e}")

async def unmute_command(update, context):
    if not update.message.reply_to_message: await update.message.reply_text("⚠️ Reply to a message with `/unmute`"); return
    chat_id, admin_id = update.effective_chat.id, update.effective_user.id
    if admin_id not in get_chat_admins(context, chat_id): await update.message.reply_text("❌ Admins only."); return
    target = update.message.reply_to_message.from_user; username = target.username or target.first_name
    del_mute(target.id)
    try:
        await context.bot.restrict_chat_member(chat_id,target.id,permissions=ChatPermissions(can_send_messages=True,can_send_media=True,can_send_other=True,can_add_web_page_previews=True))
        await update.message.reply_text(f"🔊 @{username} can now speak.", parse_mode="Markdown")
    except TelegramError as e: await update.message.reply_text(f"❌ {e}")

async def ban_command(update, context):
    if not update.message.reply_to_message: await update.message.reply_text("⚠️ Reply to a message with `/ban`"); return
    chat_id, admin_id = update.effective_chat.id, update.effective_user.id
    if admin_id not in get_chat_admins(context, chat_id): await update.message.reply_text("❌ Admins only."); return
    target = update.message.reply_to_message.from_user; username = target.username or target.first_name
    reason = update.message.text.replace("/ban","",1).strip() or "No reason"
    try:
        await context.bot.ban_chat_member(chat_id,target.id); reset_warns(target.id)
        await update.message.reply_text(f"🚫 @{username} banned.\n📝 {reason}", parse_mode="Markdown")
    except TelegramError as e: await update.message.reply_text(f"❌ {e}")

async def unban_command(update, context):
    chat_id, admin_id = update.effective_chat.id, update.effective_user.id
    if admin_id not in get_chat_admins(context, chat_id): await update.message.reply_text("❌ Admins only."); return
    args=update.message.text.split()
    if len(args)<2: await update.message.reply_text("⚠️ `/unban @username`"); return
    try:
        await context.bot.unban_chat_member(chat_id,args[1].replace("@",""))
        await update.message.reply_text(f"✅ @{args[1]} unbanned.", parse_mode="Markdown")
    except TelegramError as e: await update.message.reply_text(f"❌ {e}")

async def report_command(update, context):
    if not update.message.reply_to_message: await update.message.reply_text("⚠️ Reply to a message with `/report`"); return
    chat_id=update.effective_chat.id; reporter=update.effective_user
    reported_msg=update.message.reply_to_message; reported_user=reported_msg.from_user
    reason=update.message.text.replace("/report","",1).strip() or "No reason"
    rn=reporter.username or reporter.first_name; tun=reported_user.username or reported_user.first_name
    admins=get_chat_admins(context,chat_id)
    report=f"🚨 *REPORT*\n👤 @{tun} (`{reported_user.id}`)\n📝 @{rn}\n💬 {reason}\n📨 {escape_md(reported_msg.text or '...')[:200]}"
    for aid in admins:
        if aid==context.bot.id: continue
        try: await context.bot.send_message(chat_id=aid,text=report,parse_mode="Markdown")
        except TelegramError: pass
    await update.message.reply_text("✅ Report sent.", parse_mode="Markdown")

async def rules_command(update, context): await update.message.reply_text(GROUP_RULES, parse_mode="Markdown")

async def warns_command(update, context):
    chat_id, user_id = update.effective_chat.id, update.effective_user.id
    admins = get_chat_admins(context, chat_id)
    tid, tname = user_id, update.effective_user.username or update.effective_user.first_name
    if update.message.reply_to_message and user_id in admins:
        target=update.message.reply_to_message.from_user; tid=target.id; tname=target.username or target.first_name
    info=get_warns(tid)
    if info["count"]==0: await update.message.reply_text(f"✅ @{tname} has no warnings.", parse_mode="Markdown"); return
    reasons="\n".join(f"• {r['reason']}" for r in info.get("reasons",[])[-5:])
    await update.message.reply_text(f"📊 Warnings for @{tname}: *{info['count']}/5*\n\n{reasons}", parse_mode="Markdown")

async def welcome_message(update, context):
    for m in update.message.new_chat_members:
        if m.is_bot: continue
        try: await update.message.reply_text(f"👋 Welcome *{m.first_name}*! 📜 `/rules`\n🌐 [zenthis-app.web.app](https://zenthis-app.web.app)", parse_mode="Markdown", disable_web_page_preview=True)
        except TelegramError: pass

FAQ = {
    "que es zenthis|what is zenthis|definicion zenthis": "🌐 *Zenthis Protocol*\n\nDEX cross-chain con HTLC atomic swaps. Sin bridges, sin wrapped tokens, sin custodios.\n🔗 [zenthis-app.web.app](https://zenthis-app.web.app)",
    "htlc|hash time lock|atomic swap|que es htlc": "🔐 *HTLC*\n\nHashlock + Timelock. Fondos peer-to-peer garantizados criptográficamente.",
    "diferencia bridge|vs bridge|bridges vs": "🌉 *HTLC vs Bridges*\n\n$2.8B robados de bridges. HTLC = sin custodio, sin punto único de fallo.",
    "cuando ido|fecha ido|cuando sale|lanzamiento": "📅 *IDO*\n\nSin fecha fija. 500 cupos whitelist → PinkSale. Comunidad determina timeline.",
    "precio ido|cuanto cuesta|precio token": "💰 *$0.10 por $ZTS* en IDO. Sin VCs, sin pre-mine.",
    "airdrop|whitelist|registrarse": "🎁 *Whitelist*: 500 wallets → asignación IDO + 2,000 $ZTS airdrop.\n📝 [zenthis-app.web.app](https://zenthis-app.web.app)",
    "referidos|referral": "👥 *Referidos*: 3→500, 10→2,500, 25→6,000 $ZTS. Top 10→50,000 $ZTS.",
    "kyc|documento|identidad": "🔓 *Sin KYC*. Solo wallet + email.",
    "equipo|team|anonimo|fundadores": "👤 *Equipo anónimo*. El código open-source habla por sí mismo.",
    "auditoria|audit|seguridad": "🛡️ Interna completada (10 hallazgos). Externa en progreso. Contratos verificados Sepolia.",
    "cadenas|chains|ethereum|solana": "⛓️ Ethereum (Sepolia) + Solana próximamente. Solidity + Rust.",
    "whitepaper|white paper": "📄 [zenthisprotocol.xyz/whitepaper](https://zenthisprotocol.xyz/whitepaper)",
    "roadmap|fases|futuro": "🗺️ F1: Contratos+testnet • F2: IDO+TGE • F3: DEX UI+SDK • F4: Governance+OTC",
    "tokenomics|suministro|supply": "📊 $ZTS • $0.10 IDO • Sin VCs. Tokenomics completa pronto.",
    "sitio web|web|website|links": "🌐 zenthis-app.web.app | X: @zenthis_io | GitHub: github.com/zenthis",
    "contrato|contract|direccion": "📜 Verificados Sepolia. Open-source GitHub.",
    "scam|estafa|falso|phishing": "⚠️ Links oficiales SOLO. NUNCA pedimos fondos/keys por DM. NUNCA presión.",
}
FAQ_LIST = [("What is Zenthis?","what is"),("HTLC / Atomic Swap","htlc"),("Vs Bridges","bridge"),("When IDO?","ido"),("$ZTS Price","price"),("Airdrop / Whitelist","airdrop"),("Referrals","referidos"),("KYC?","kyc"),("Team","equipo"),("Audit","audit"),("Chains","chains"),("Whitepaper","whitepaper"),("Roadmap","roadmap"),("Tokenomics","tokenomics"),("Official Links","web"),("Contracts","contrato"),("Anti-Scam","scam")]

def find_faq_answer(text: str):
    tl=text.lower().strip(); tl=_re.sub(r'[¿?¡!.,]','',tl); tl=_re.sub(r'\s+',' ',tl)
    best,best_score=None,0
    for pattern,answer in FAQ.items():
        for part in pattern.split("|"):
            if part in tl:
                score=len(part)
                if score>best_score: best_score, best=score, answer
            else:
                pw=set(part.split()); tw=set(tl.split()); overlap=pw&tw
                if len(overlap)>=2 and len(overlap)/len(pw)>=0.6:
                    score=len(overlap)*10
                    if score>best_score: best_score, best=score, answer
    return best

async def faq_command(update, context):
    lines=["📚 *FAQ Zenthis*\n"]+[f"• {t}" for t,_ in FAQ_LIST]+["\n_Type your question._"]
    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")

def main():
    app=_get_app()
    logger.info("ZenthisBot started (polling).")
    app.run_polling(allowed_updates=Update.ALL_TYPES)

def _get_app():
    if not TELEGRAM_TOKEN: logger.error("Missing TELEGRAM_TOKEN"); return None
    app=Application.builder().token(TELEGRAM_TOKEN).build()
    app.add_handler(CommandHandler("start",start_command))
    app.add_handler(CommandHandler("id",id_command))
    app.add_handler(CommandHandler("anuncio",anuncio_command))
    app.add_handler(CommandHandler("warn",warn_command))
    app.add_handler(CommandHandler("mute",mute_command))
    app.add_handler(CommandHandler("unmute",unmute_command))
    app.add_handler(CommandHandler("ban",ban_command))
    app.add_handler(CommandHandler("unban",unban_command))
    app.add_handler(CommandHandler("report",report_command))
    app.add_handler(CommandHandler("rules",rules_command))
    app.add_handler(CommandHandler("warns",warns_command))
    app.add_handler(CommandHandler("faq",faq_command))
    app.add_handler(MessageHandler(filters.TEXT & filters.ChatType.PRIVATE & ~filters.COMMAND, text_message))
    app.add_handler(MessageHandler(filters.TEXT & (filters.ChatType.GROUP | filters.ChatType.SUPERGROUP) & ~filters.COMMAND, moderate_message))
    app.add_handler(MessageHandler(filters.StatusUpdate.NEW_CHAT_MEMBERS, welcome_message))
    return app

# Lazy-initialized app for webhook
_webhook_app = None

def run_webhook(req):
    """Process Telegram webhook update. Called from Firebase function."""
    import json as _json
    global _webhook_app
    try:
        if _webhook_app is None: _webhook_app = _get_app()
        if _webhook_app is None: return ("Bot not initialized", 500)
        body = req.get_data(as_text=True) if hasattr(req, 'get_data') else req.get_data()
        if isinstance(body, bytes): body = body.decode()
        update = _json.loads(body)
        import asyncio
        async def _process():
            tg_update = Update.de_json(update, _webhook_app.bot)
            await _webhook_app.process_update(tg_update)
        asyncio.run(_process())
        return ("OK", 200)
    except Exception as e:
        logger.error(f"run_webhook error: {e}", exc_info=True)
        return (f"Error: {e}", 500)

if __name__=="__main__":
    main()
