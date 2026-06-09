import os
import re
import json
import time
import logging
from datetime import datetime, timedelta
from collections import defaultdict
from dotenv import load_dotenv
from telegram import Update, ChatPermissions
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
from telegram.error import TelegramError

# ─── Load environment ──────────────────────────────────────────────────────────

load_dotenv()
TELEGRAM_TOKEN       = os.getenv("TELEGRAM_TOKEN")
ADMIN_CHAT_ID        = os.getenv("ADMIN_CHAT_ID")
COMMUNITY_GROUP_ID   = os.getenv("COMMUNITY_GROUP_ID")    # grupo de comunidad

# ─── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# ─── Helpers ───────────────────────────────────────────────────────────────────

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
    """Return list of admin user IDs for a given chat."""
    try:
        admins = context.bot.get_chat_administrators(chat_id)
        return [admin.user.id for admin in admins]
    except TelegramError:
        return []


# ═══════════════════════════════════════════════════════════════════════════════
#  BROADCAST — Canal de anuncios
# ═══════════════════════════════════════════════════════════════════════════════

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_chat.type != "private":
        return
    await update.message.reply_text(
        "👋 *Zenthis Bot*\n\n"
        "Send me any message and I will publish it to the group with formatting.\n\n"
        "You can also use `/announce <text>` for the same effect.",
        parse_mode="Markdown"
    )


async def id_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show user ID AND chat ID (admin only)."""
    uid = update.effective_user.id
    cid = update.effective_chat.id
    chat_type = update.effective_chat.type

    # Only admin can use /id in groups
    if chat_type in ("group", "supergroup") and not is_admin(uid):
        await update.message.delete()
        return

    lines = [f"🆔 Tu user ID: `{uid}`"]

    if chat_type in ("group", "supergroup"):
        lines.append(f"👥 Group ID: `{cid}`")
        lines.append("")
        if str(cid).startswith("-100"):
            lines.append("✅ Copy this ID to `COMMUNITY_GROUP_ID` in `.env`")
    elif chat_type == "channel":
        lines.append(f"📢 ID del canal: `{cid}`")

    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


async def anuncio_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_chat.type != "private":
        return
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("❌ You don't have permission to use this command.")
        return

    text = update.message.text.replace("/announce", "", 1).strip()
    if not text:
        await update.message.reply_text(
            "⚠️ Write your message after the command.\n"
            "Example: `/announce New updates!`",
            parse_mode="Markdown"
        )
        return

    await _send_to_group(update, context, text)


async def text_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Any plain text from admin in private chat → FAQ answer or forward to group."""
    if update.effective_chat.type != "private":
        return
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("❌ You don't have permission.")
        return

    text = update.message.text.strip()
    if not text:
        return

    # Check FAQ first
    answer = find_faq_answer(text)
    if answer:
        await update.message.reply_text(answer, parse_mode="Markdown", disable_web_page_preview=True)

    # Always forward to group
    await _send_to_group(update, context, text)


async def _send_to_group(update: Update, context: ContextTypes.DEFAULT_TYPE, text: str):
    if not COMMUNITY_GROUP_ID:
        await update.message.reply_text(
            "⚠️ `COMMUNITY_GROUP_ID` is not set in `.env`.",
            parse_mode="Markdown"
        )
        return

    formatted = (
        "🚀 *ZENTHIS UPDATE* 🚀\n\n"
        f"{escape_md(text)}\n\n"
        "🌐 [zenthisprotocol.xyz](https://zenthisprotocol.xyz)"
    )

    try:
        await context.bot.send_message(
            chat_id=COMMUNITY_GROUP_ID,
            text=formatted,
            parse_mode="Markdown",
            disable_web_page_preview=True
        )
        await update.message.reply_text("✅ Published to the group!")
    except Exception as e:
        logger.error(f"Error enviando al grupo: {e}")
        await update.message.reply_text(
            f"❌ Error publishing to group:\n`{e}`",
            parse_mode="Markdown"
        )


# ═══════════════════════════════════════════════════════════════════════════════
#  MODERATION — Grupo de comunidad
# ═══════════════════════════════════════════════════════════════════════════════

# ─── State files ───────────────────────────────────────────────────────────────

DATA_DIR = os.getenv("DATA_DIR", os.path.dirname(os.path.abspath(__file__)))
WARNS_FILE = os.path.join(DATA_DIR, "warns.json")
MUTES_FILE = os.path.join(DATA_DIR, "mutes.json")

# ─── Anti-flood ────────────────────────────────────────────────────────────────

flood_tracker = defaultdict(list)  # user_id → [timestamps]
MAX_FLOOD_MSGS  = 5      # max messages allowed in window
FLOOD_WINDOW    = 10     # seconds
FLOOD_MUTE_MIN  = 5      # minutes to mute on flood

# ─── Bad words (ES + EN) ──────────────────────────────────────────────────────

BAD_WORDS = [
    r'\bput[ao]\b', r'\bputa\b', r'\bputo\b', r'\bputita\b', r'\bputona\b',
    r'\bmaric[oó]n\b', r'\bmarica\b', r'\btrolo\b', r'\btorta\b',
    r'\bchupa\w*\b', r'\bchupala\b', r'\bchúpamela\b', r'\bmam[aá]\w*\b',
    r'\bf[uú]ck\b', r'\bf[uú]cking\b', r'\bfacker\b', r'\bshit\b',
    r'\bcunt\b', r'\bbitch\b', r'\bbastard\b', r'\bdick\b',
    r'\basshole\b', r'\bdumbass\b', r'\bretard\b', r'\bn[ií]gg[ae]r?\b',
    r'\bpendej[oa]\b', r'\bverga\b', r'\bverg[aá]\b',
    r'\bcabr[oó]n\b', r'\bcabrona\b',
    r'\bhij[oa] de puta\b', r'\bhij[oa]puta\b',
    r'\bmierda\b', r'\bcul[oe]\b', r'\bculo\b',
    r'\bcoger\b', r'\bcogiendo\b',
    r'\bjoder\b', r'\bjodete\b', r'\bjódete\b',
    r'\bmaldit[oa]\b', r'\bidiot[ae]\b', r'\best[úu]pid[oa]\b',
    r'\bgilipollas\b', r'\bsubnormal\b', r'\btarado\b',
    r'\bscam\b', r'\bs[c4]ammer\b',
]

BAD_WORDS_PATTERN = re.compile('|'.join(BAD_WORDS), re.IGNORECASE)

# ─── Allowed domains (whitelist) ───────────────────────────────────────────────

ALLOWED_DOMAINS = [
    "zenthisprotocol.xyz",
    "zenthis.io",
    "t.me",
    "telegram.org",
    "telegram.me",
]

URL_PATTERN = re.compile(
    r'(?:https?://)?(?:www\.)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?:/\S*)?'
)

# ─── Group rules ───────────────────────────────────────────────────────────────

GROUP_RULES = (
    "📜 *ZENTHIS GROUP RULES* 📜\n\n"
    "1️⃣ *Mutual respect* — No insults, discrimination or harassment.\n"
    "2️⃣ *No spam* — No unauthorized external links.\n"
    "3️⃣ *No flood* — Do not send many messages in a row.\n"
    "4️⃣ *Relevant content* — Zenthis, DeFi and crypto related only.\n"
    "5️⃣ *No fake accounts* — One account per person.\n"
    "6️⃣ *Moderators* — Respect team decisions.\n"
    "7️⃣ *Languages* — English preferred.\n\n"
    "⚠️ *Penalties*: 3 warnings = mute • 5 warnings = ban\n"
    "Use `/report` to report problematic messages."
)


# ─── Warning helpers ───────────────────────────────────────────────────────────

def get_warns(user_id: int) -> dict:
    data = load_json(WARNS_FILE)
    uid = str(user_id)
    return data.get(uid, {"count": 0, "reasons": [], "last_warn": 0})


def set_warns(user_id: int, info: dict):
    data = load_json(WARNS_FILE)
    data[str(user_id)] = info
    save_json(WARNS_FILE, data)


def add_warn(user_id: int, reason: str) -> int:
    info = get_warns(user_id)
    info["count"] = info.get("count", 0) + 1
    info["reasons"].append({"reason": reason, "date": time.time()})
    info["last_warn"] = time.time()
    set_warns(user_id, info)
    return info["count"]


def reset_warns(user_id: int):
    data = load_json(WARNS_FILE)
    data.pop(str(user_id), None)
    save_json(WARNS_FILE, data)


# ─── Mute helpers ──────────────────────────────────────────────────────────────

def get_mute(user_id: int):
    data = load_json(MUTES_FILE)
    return data.get(str(user_id))


def set_mute(user_id: int, until: float):
    data = load_json(MUTES_FILE)
    data[str(user_id)] = until
    save_json(MUTES_FILE, data)


def del_mute(user_id: int):
    data = load_json(MUTES_FILE)
    data.pop(str(user_id), None)
    save_json(MUTES_FILE, data)


def is_muted(user_id: int) -> bool:
    until = get_mute(user_id)
    if not until:
        return False
    if time.time() > until:
        del_mute(user_id)
        return False
    return True


# ─── Message filters ───────────────────────────────────────────────────────────

def extract_domains(text: str) -> list:
    """Extract domain names from URLs in text."""
    domains = []
    for match in URL_PATTERN.finditer(text):
        domain = match.group(1)
        if domain not in ("tg",):
            domains.append(domain)
    return domains


def message_has_bad_links(text: str) -> tuple[bool, list]:
    """Returns (has_bad, bad_domains)."""
    domains = extract_domains(text)
    bad = [d for d in domains if d not in ALLOWED_DOMAINS]
    return bool(bad), bad


def message_has_bad_words(text: str) -> bool:
    return bool(BAD_WORDS_PATTERN.search(text))


def check_flood(user_id: int) -> tuple[bool, int]:
    """Returns (is_flooding, msg_count_in_window)."""
    now = time.time()
    stamps = flood_tracker[user_id]
    # Remove old stamps
    stamps = [s for s in stamps if now - s < FLOOD_WINDOW]
    flood_tracker[user_id] = stamps
    stamps.append(now)
    return len(stamps) > MAX_FLOOD_MSGS, len(stamps)


# ─── Main moderation handler ───────────────────────────────────────────────────

async def moderate_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Check every group message for violations + FAQ auto-reply."""
    if not update.message or not update.message.text:
        return

    chat_id = update.effective_chat.id
    user_id = update.effective_user.id
    text   = update.message.text
    msg_id = update.message.message_id

    # Only moderate in community group
    if not is_community_group(chat_id):
        return

    # ── FAQ check (for questions or bot mentions) ──
    is_question = "?" in text or "¿" in text
    mentions_bot = "@zenthisbot" in text.lower()
    if is_question or mentions_bot:
        clean = text.lower().replace("@zenthisbot", "").strip()
        answer = find_faq_answer(clean)
        if answer:
            try:
                await update.message.reply_text(answer, parse_mode="Markdown", disable_web_page_preview=True)
            except TelegramError as e:
                logger.error(f"FAQ reply error: {e}")
            # Don't moderate FAQ questions (they're not violations)
            return

    # ── Moderation ──

    # Skip admins
    admins = get_chat_admins(context, chat_id)
    if user_id in admins:
        return

    username = update.effective_user.username or update.effective_user.first_name or "Usuario"
    actions = []  # Collect actions to report

    # ── 1. Flood check ──
    is_flood, flood_count = check_flood(user_id)
    if is_flood:
        try:
            await update.message.delete()
        except TelegramError:
            pass
        # Mute for flood
        until = time.time() + (FLOOD_MUTE_MIN * 60)
        set_mute(user_id, until)
        logger.info(f"Flood mute: user={user_id}, until={until}")
        try:
            await context.bot.restrict_chat_member(
                chat_id, user_id,
                permissions=ChatPermissions(can_send_messages=False),
                until_date=datetime.fromtimestamp(until)
            )
        except TelegramError:
            pass
        return  # Don't process further

    # ── 2. Bad links ──
    has_bad, bad_domains = message_has_bad_links(text)
    if has_bad:
        try:
            await update.message.delete()
        except TelegramError:
            pass
        actions.append(f"🔗 Enlace no permitido: `{', '.join(bad_domains)}`")
        add_warn(user_id, f"Enlace no permitido: {', '.join(bad_domains)}")

    # ── 3. Bad words ──
    if message_has_bad_words(text):
        try:
            await update.message.delete()
        except TelegramError:
            pass
        actions.append("🤬 Lenguaje inapropiado")
        add_warn(user_id, "Lenguaje inapropiado")

    # ── Notify if violations ──
    if actions:
        warn_count = get_warns(user_id)["count"]
        action_str = "\n".join(f"• {a}" for a in actions)

        alert = (
            f"⚠️ *@{username}* — tu mensaje fue eliminado:\n"
            f"{action_str}\n\n"
            f"📊 *Warnings: {warn_count}/5*\n"
            f"_(3 avisos = mute • 5 avisos = ban)_"
        )

        try:
            await context.bot.send_message(
                chat_id=chat_id,
                text=alert,
                parse_mode="Markdown"
            )
        except TelegramError:
            pass

        # Auto escalate
        if warn_count >= 5:
            # Ban
            try:
                await context.bot.ban_chat_member(chat_id, user_id)
                reset_warns(user_id)
                await context.bot.send_message(
                    chat_id=chat_id,
                    text=f"🚫 @{username} ha sido *banned* (5 avisos).",
                    parse_mode="Markdown"
                )
            except TelegramError as e:
                logger.error(f"Failed to ban {user_id}: {e}")
        elif warn_count >= 3:
            # Mute for 1 hour
            until = time.time() + 3600
            set_mute(user_id, until)
            try:
                await context.bot.restrict_chat_member(
                    chat_id, user_id,
                    permissions=ChatPermissions(can_send_messages=False),
                    until_date=datetime.fromtimestamp(until)
                )
                await context.bot.send_message(
                    chat_id=chat_id,
                    text=(
                        f"🔇 @{username} ha sido *muted 1 hora* "
                        f"por acumular 3 avisos."
                    ),
                    parse_mode="Markdown"
                )
            except TelegramError as e:
                logger.error(f"Failed to mute {user_id}: {e}")


# ─── /warn ─────────────────────────────────────────────────────────────────────

async def warn_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Admin: /warn @user [motivo]"""
    if not update.message.reply_to_message:
        await update.message.reply_text(
            "⚠️ Reply to a message with `/warn [motivo]` para advertir al usuario.",
            parse_mode="Markdown"
        )
        return

    chat_id = update.effective_chat.id
    admin_id = update.effective_user.id
    admins = get_chat_admins(context, chat_id)

    if admin_id not in admins:
        await update.message.reply_text("❌ Only admins can use this command.")
        return

    target = update.message.reply_to_message.from_user
    reason = update.message.text.replace("/warn", "", 1).strip() or "Sin motivo especificado"
    count = add_warn(target.id, reason)
    username = target.username or target.first_name

    if count >= 5:
        try:
            await context.bot.ban_chat_member(chat_id, target.id)
            reset_warns(target.id)
            await update.message.reply_text(
                f"🚫 @{username} ha sido *banned* (5 avisos).",
                parse_mode="Markdown"
            )
        except TelegramError as e:
            await update.message.reply_text(f"❌ Error banning: {e}")
    elif count >= 3:
        until = time.time() + 3600
        set_mute(target.id, until)
        try:
            await context.bot.restrict_chat_member(
                chat_id, target.id,
                permissions=ChatPermissions(can_send_messages=False),
                until_date=datetime.fromtimestamp(until)
            )
            await update.message.reply_text(
                f"🔇 @{username} muted 1h (3 avisos).\n📊 Total: {count}/5",
                parse_mode="Markdown"
            )
        except TelegramError as e:
            await update.message.reply_text(f"❌ Error muting: {e}")
    else:
        await update.message.reply_text(
            f"⚠️ @{username} advertido ({count}/5)\n"
            f"📝 Reason: {reason}",
            parse_mode="Markdown"
        )


# ─── /mute ─────────────────────────────────────────────────────────────────────

async def mute_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Admin: /mute [minutos] (reply to user)"""
    if not update.message.reply_to_message:
        await update.message.reply_text(
            "⚠️ Reply to a message with `/mute [minutos]`.",
            parse_mode="Markdown"
        )
        return

    chat_id = update.effective_chat.id
    admin_id = update.effective_user.id
    admins = get_chat_admins(context, chat_id)

    if admin_id not in admins:
        await update.message.reply_text("❌ Admins only.")
        return

    target = update.message.reply_to_message.from_user
    username = target.username or target.first_name

    # Parse minutes
    args = update.message.text.split()
    minutes = 60  # default 1 hour
    if len(args) > 1:
        try:
            minutes = max(1, min(int(args[1]), 43200))  # max 30 days
        except ValueError:
            pass

    until = time.time() + (minutes * 60)
    set_mute(target.id, until)

    try:
        await context.bot.restrict_chat_member(
            chat_id, target.id,
            permissions=ChatPermissions(can_send_messages=False),
            until_date=datetime.fromtimestamp(until)
        )
        await update.message.reply_text(
            f"🔇 @{username} muted por {minutes} min.",
            parse_mode="Markdown"
        )
    except TelegramError as e:
        await update.message.reply_text(f"❌ Error: {e}")


# ─── /unmute ───────────────────────────────────────────────────────────────────

async def unmute_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Admin: /unmute (reply to user)"""
    if not update.message.reply_to_message:
        await update.message.reply_text("⚠️ Reply to a message with `/unmute`.")
        return

    chat_id = update.effective_chat.id
    admin_id = update.effective_user.id
    admins = get_chat_admins(context, chat_id)

    if admin_id not in admins:
        await update.message.reply_text("❌ Admins only.")
        return

    target = update.message.reply_to_message.from_user
    username = target.username or target.first_name

    del_mute(target.id)

    try:
        await context.bot.restrict_chat_member(
            chat_id, target.id,
            permissions=ChatPermissions(
                can_send_messages=True,
                can_send_media=True,
                can_send_other=True,
                can_add_web_page_previews=True
            )
        )
        await update.message.reply_text(f"🔊 @{username} can speak now.", parse_mode="Markdown")
    except TelegramError as e:
        await update.message.reply_text(f"❌ Error: {e}")


# ─── /ban ──────────────────────────────────────────────────────────────────────

async def ban_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Admin: /ban [motivo] (reply to user)"""
    if not update.message.reply_to_message:
        await update.message.reply_text("⚠️ Reply to a message with `/ban [motivo]`.")
        return

    chat_id = update.effective_chat.id
    admin_id = update.effective_user.id
    admins = get_chat_admins(context, chat_id)

    if admin_id not in admins:
        await update.message.reply_text("❌ Admins only.")
        return

    target = update.message.reply_to_message.from_user
    username = target.username or target.first_name
    reason = update.message.text.replace("/ban", "", 1).strip() or "Sin motivo"

    try:
        await context.bot.ban_chat_member(chat_id, target.id)
        reset_warns(target.id)
        await update.message.reply_text(
            f"🚫 @{username} *banned*.\n📝 {reason}",
            parse_mode="Markdown"
        )
    except TelegramError as e:
        await update.message.reply_text(f"❌ Error: {e}")


# ─── /unban ────────────────────────────────────────────────────────────────────

async def unban_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Admin: /unban [username or ID]"""
    chat_id = update.effective_chat.id
    admin_id = update.effective_user.id
    admins = get_chat_admins(context, chat_id)

    if admin_id not in admins:
        await update.message.reply_text("❌ Admins only.")
        return

    args = update.message.text.split()
    if len(args) < 2:
        await update.message.reply_text("⚠️ Uso: `/unban @username` o `/unban 12345678`")
        return

    target_id = args[1].replace("@", "")

    try:
        await context.bot.unban_chat_member(chat_id, target_id)
        await update.message.reply_text(f"✅ @{target_id} desbanned.", parse_mode="Markdown")
    except TelegramError as e:
        await update.message.reply_text(f"❌ Error: {e}")


# ─── /report ───────────────────────────────────────────────────────────────────

async def report_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """User: /report [motivo] (reply to a problematic message)"""
    if not update.message.reply_to_message:
        await update.message.reply_text(
            "⚠️ Reply to the problematic message with `/report [motivo]`.",
            parse_mode="Markdown"
        )
        return

    chat_id = update.effective_chat.id
    reporter = update.effective_user
    reported_msg = update.message.reply_to_message
    reported_user = reported_msg.from_user
    reason = update.message.text.replace("/report", "", 1).strip() or "Sin motivo"

    reporter_name = reporter.username or reporter.first_name
    reported_name = reported_user.username or reported_user.first_name

    # Notify admins
    admins = get_chat_admins(context, chat_id)
    report_text = (
        f"🚨 *REPORTE*\n\n"
        f"👤 Reportado: @{reported_name} (`{reported_user.id}`)\n"
        f"📝 Por: @{reporter_name}\n"
        f"💬 Reason: {reason}\n\n"
        f"📨 Mensaje: _{escape_md(reported_msg.text or '(media/sin texto)')[:200]}_"
    )

    for admin_id in admins:
        if admin_id == context.bot.id:
            continue
        try:
            await context.bot.send_message(
                chat_id=admin_id,
                text=report_text,
                parse_mode="Markdown"
            )
        except TelegramError:
            pass

    # Confirm to reporter privately
    await update.message.reply_text(
        "✅ Reporte enviado. Los administradores lo revisarán.",
        parse_mode="Markdown"
    )


# ─── /rules ────────────────────────────────────────────────────────────────────

async def rules_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(GROUP_RULES, parse_mode="Markdown")


# ─── /warns ────────────────────────────────────────────────────────────────────

async def warns_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show warning count for a user."""
    # If admin and replying, show for that user. Otherwise show own.
    chat_id = update.effective_chat.id
    user_id = update.effective_user.id
    admins = get_chat_admins(context, chat_id)

    target_id = user_id
    target_name = update.effective_user.username or update.effective_user.first_name

    if update.message.reply_to_message and user_id in admins:
        target = update.message.reply_to_message.from_user
        target_id = target.id
        target_name = target.username or target.first_name

    info = get_warns(target_id)
    if info["count"] == 0:
        await update.message.reply_text(
            f"✅ @{target_name} no tiene avisos.",
            parse_mode="Markdown"
        )
        return

    reasons = "\n".join(
        f"• {r['reason']}" for r in info.get("reasons", [])[-5:]
    )
    await update.message.reply_text(
        f"📊 Warnings de @{target_name}: *{info['count']}/5*\n\n{reasons}",
        parse_mode="Markdown"
    )


# ─── Welcome ───────────────────────────────────────────────────────────────────

async def welcome_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    for new_member in update.message.new_chat_members:
        if new_member.is_bot:
            continue
        welcome_text = (
            f"👋 Welcome *{new_member.first_name}* to the Zenthis community!\n\n"
            "📜 Check the rules with `/rules`\n"
            "🚀 Join the waitlist: [zenthisprotocol.xyz](https://zenthisprotocol.xyz)\n\n"
            "Respect others and enjoy. 💙"
        )
        try:
            await update.message.reply_text(welcome_text, parse_mode="Markdown", disable_web_page_preview=True)
        except TelegramError as e:
            logger.error(f"Error en bienvenida: {e}")



# ═══════════════════════════════════════════════════════════════════════════════
#  FAQ — Respuestas automáticas sobre Zenthis
# ═══════════════════════════════════════════════════════════════════════════════

FAQ = {
    "que es zenthis|what is zenthis|zenthis que es|definicion zenthis": (
        "🌐 *¿Qué es Zenthis Protocol?*\n\n"
        "Zenthis es un **DEX cross-chain** que usa **HTLC atomic swaps** en vez de bridges. "
        "Sin tokens wrapped, sin custodios, sin punto único de fallo.\n\n"
        "Cada swap está garantizado criptográficamente: ambas partes completan, "
        "o ambas partes reciben reembolso. No hay tercer resultado.\n\n"
        "🔗 [zenthisprotocol.xyz](https://zenthisprotocol.xyz)"
    ),
    "htlc|hash time lock|atomic swap|que es htlc": (
        "🔐 *¿Qué es un HTLC?*\n\n"
        "**Hash Time-Locked Contract** = contrato criptográfico con dos candados:\n\n"
        "🔒 *Hashlock* — Solo quien tenga el secreto puede reclamar los fondos\n"
        "⏰ *Timelock* — Si nadie reclama antes del plazo, los fondos se reembolsan\n\n"
        "Dos personas bloquean fondos en blockchains distintas con el mismo hash. "
        "Cuando Alice revela el secreto → ambos lados completan. "
        "Si no revela → ambos reembolsan. Sin intermediarios."
    ),
    "diferencia bridge|vs bridge|bridges vs|mejor que bridge|problema bridge": (
        "🌉 *¿En qué se diferencia de un bridge?*\n\n"
        "Los bridges bloquean fondos en un contrato central → ese contrato es el punto único de fallo. "
        "**Más de $2.8 mil millones robados** de bridges.\n\n"
        "Los HTLC eliminan al custodio. Fondos peer-to-peer. "
        "Si el swap falla → reembolso automático.\n\n"
        "_Trust the code, not the custodian._"
    ),
    "cuando ido|fecha ido|ido cuando|salida ido|cuando sale|lanzamiento|cuando lanza": (
        "📅 *¿Cuándo es el IDO?*\n\n"
        "**No hay fecha fija.** El IDO en PinkSale se lanza cuando se completen "
        "los **500 cupos de la whitelist**. La comunidad determina el timeline.\n\n"
        "Actualmente estamos en fase pre-IDO."
    ),
    "precio ido|precio zts|cuanto cuesta|cuesta zts|valor zts|precio token|token price": (
        "💰 *Precio del IDO*\n\n"
        "El $ZTS tiene un precio de **$0.10 por token** en el IDO.\n\n"
        "Sin VCs. Sin pre-mine. Sin rondas internas."
    ),
    "airdrop|whitelist|lista blanca|como participar|registrarse|registro": (
        "🎁 *Airdrop & Whitelist*\n\n"
        "Los **primeros 500 wallets** registrados reciben:\n"
        "✅ Asignación garantizada en el IDO a $0.10 por $ZTS\n"
        "✅ 2,000 $ZTS de airdrop al TGE\n"
        "✅ Acceso prioritario en PinkSale\n\n"
        "📝 Regístrate: [zenthisprotocol.xyz](https://zenthisprotocol.xyz)\n"
        "🔓 Sin KYC. Solo wallet + email."
    ),
    "referidos|referral|referir|invitar|programa referidos": (
        "👥 *Programa de Referidos*\n\n"
        "Comparte tu link y gana $ZTS:\n"
        "• 3 referidos → 500 ZENTHIS al TGE\n"
        "• 10 referidos → 2,500 ZENTHIS\n"
        "• 25 referidos → 6,000 ZENTHIS\n"
        "• Top 10 del leaderboard → 50,000 ZENTHIS cada uno\n\n"
        "Obtén tu link en [zenthisprotocol.xyz](https://zenthisprotocol.xyz) tras registrarte."
    ),
    "kyc|documento|identidad|verificacion|pasaporte": (
        "🔓 *¿Se necesita KYC?*\n\n"
        "**No.** Solo necesitas wallet address y email para registrarte en la whitelist.\n"
        "Sin verificación de identidad."
    ),
    "equipo|team|anonimo|quien esta detras|fundadores|creadores": (
        "👤 *¿El equipo es anónimo?*\n\n"
        "**Sí.** Como Bitcoin y muchos protocolos DeFi, creemos que el código debe hablar "
        "por sí mismo. Todos los contratos son open-source y están verificados en la testnet Sepolia."
    ),
    "auditoria|audit|seguridad|security|hack": (
        "🛡️ *Auditoría y Seguridad*\n\n"
        "✅ Auditoría interna completada (10 hallazgos resueltos)\n"
        "🔄 Auditoría externa en progreso — se completará antes del mainnet launch\n"
        "📂 Contratos verificados en Sepolia testnet\n"
        "🔓 Código open-source en [GitHub](https://github.com/zenthis)"
    ),
    "cadenas|chains|blockchains|redes|ethereum|solana|que redes": (
        "⛓️ *Cadenas Soportadas*\n\n"
        "Actualmente: **Ethereum** (Sepolia testnet)\n"
        "Próximamente: **Solana** y cadenas adicionales\n\n"
        "Stack técnico: Solidity (EVM) + Rust (Solana)"
    ),
    "whitepaper|white paper|documento|paper|leer whitepaper": (
        "📄 *Whitepaper*\n\n"
        "Whitepaper v2.3 disponible en:\n"
        "🔗 [zenthisprotocol.xyz/whitepaper](https://zenthisprotocol.xyz/whitepaper)"
    ),
    "roadmap|fases|etapas|planeado|futuro|proximo": (
        "🗺️ *Roadmap*\n\n"
        "🔹 *Fase 1 — Fundación (Actual)*: Contratos, testnet Sepolia, whitelist, auditoría externa\n"
        "🔹 *Fase 2 — Lanzamiento*: IDO en PinkSale, TGE del $ZTS, airdrop, mainnet\n"
        "🔹 *Fase 3 — Producto*: Interfaz cross-chain swap, dashboard HTLC, SDK dev\n"
        "🔹 *Fase 4 — Expansión*: Más cadenas, governance, OTC institucional\n\n"
        "Sin fechas fijas — _we ship when it's ready._"
    ),
    "tokenomics|suministro|supply|total token|cuantos token": (
        "📊 *Tokenomics*\n\n"
        "Token: **$ZTS**\n"
        "IDO price: **$0.10**\n"
        "Sin VCs. Sin pre-mine. Sin rondas internas.\n"
        "La tokenomics completa estará disponible pronto en la web."
    ),
    "sitio web|web|website|pagina|link|url oficial": (
        "🌐 *Enlaces Oficiales*\n\n"
        "Web: [zenthisprotocol.xyz](https://zenthisprotocol.xyz)\n"
        "Whitepaper: [zenthisprotocol.xyz/whitepaper](https://zenthisprotocol.xyz/whitepaper)\n"
        "X/Twitter: [@zenthis_io](https://x.com/zenthis_io)\n"
        "GitHub: [github.com/zenthis](https://github.com/zenthis)"
    ),
    "contrato|contract|direccion|address|verified": (
        "📜 *Contratos Inteligentes*\n\n"
        "✅ Verificados en Sepolia testnet\n"
        "🔓 Open-source en [GitHub](https://github.com/zenthis)\n"
        "La verificación confirma que el bytecode desplegado coincide con el código fuente.\n\n"
        "_Verifícalo tú mismo en Etherscan Sepolia._"
    ),
    "scam|estafa|falso|fake|cuidado|phishing": (
        "⚠️ *Anti-Scam*\n\n"
        "🔗 Links oficiales SOLO:\n"
        "• Web: zenthisprotocol.xyz\n"
        "• X: @zenthis_io\n"
        "• GitHub: github.com/zenthis\n\n"
        "❌ NUNCA te pediremos por DM: fondos, private keys, seed phrases\n"
        "❌ NUNCA te enviaremos una dirección de contrato por DM\n"
        "❌ NUNCA te presionaremos con \"reclama tu allocation ya\"\n\n"
        "Si ves algo sospechoso → repórtalo con `/report`."
    ),
}

FAQ_LIST = [
    ("¿Qué es Zenthis?", "que es"),
    ("¿Qué es un HTLC / Atomic Swap?", "htlc"),
    ("¿Diferencia vs Bridges?", "bridge"),
    ("¿Cuándo es el IDO?", "ido"),
    ("Precio del token $ZTS", "precio"),
    ("Airdrop / Whitelist", "airdrop"),
    ("Programa de Referidos", "referidos"),
    ("¿KYC?", "kyc"),
    ("Equipo anónimo", "equipo"),
    ("Auditoría y Seguridad", "audit"),
    ("Cadenas soportadas", "chains"),
    ("Whitepaper", "whitepaper"),
    ("Roadmap / Fases", "roadmap"),
    ("Tokenomics", "tokenomics"),
    ("Links oficiales", "web"),
    ("Contratos verificados", "contrato"),
    ("Anti-Scam", "scam"),
]

import re as _re

def find_faq_answer(text: str) -> str | None:
    """Match user question to FAQ and return answer. Returns None if no match."""
    text_lower = text.lower().strip()
    # Remove question marks, extra spaces
    text_lower = _re.sub(r'[¿?¡!.,]', '', text_lower)
    text_lower = _re.sub(r'\s+', ' ', text_lower)

    best_match = None
    best_score = 0

    for pattern, answer in FAQ.items():
        parts = pattern.split("|")
        for part in parts:
            # Full pattern match
            if part in text_lower:
                score = len(part)
                if score > best_score:
                    best_score = score
                    best_match = answer
            # Word-by-word overlap
            else:
                pat_words = set(part.split())
                txt_words = set(text_lower.split())
                overlap = pat_words & txt_words
                if len(overlap) >= 2 and len(overlap) / len(pat_words) >= 0.6:
                    score = len(overlap) * 10
                    if score > best_score:
                        best_score = score
                        best_match = answer

    return best_match


async def faq_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show FAQ topics."""
    lines = ["📚 *Preguntas Frecuentes — Zenthis*\n"]
    for title, _ in FAQ_LIST:
        lines.append(f"• {title}")
    lines.append("\n_Escribe tu pregunta en el grupo y te responderé._")
    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


async def faq_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Check messages for FAQ questions and auto-reply."""
    if not update.message or not update.message.text:
        return

    text = update.message.text
    chat_id = update.effective_chat.id

    # In groups, only respond if:
    # - It's the community group
    # - Message contains a question mark OR is directed at the bot
    is_question = "?" in text or "¿" in text
    mentions_bot = "@zenthisbot" in text.lower()

    if update.effective_chat.type in ("group", "supergroup"):
        if not is_community_group(chat_id):
            return
        # Only respond to questions or bot mentions (avoid noise)
        if not is_question and not mentions_bot:
            return
        # Remove @zenthisbot from text for matching
        text_clean = text.lower().replace("@zenthisbot", "").strip()
    else:
        text_clean = text

    answer = find_faq_answer(text_clean)
    if answer:
        try:
            await update.message.reply_text(answer, parse_mode="Markdown", disable_web_page_preview=True)
        except TelegramError as e:
            logger.error(f"FAQ reply error: {e}")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    if not TELEGRAM_TOKEN:
        logger.error("No se encontró TELEGRAM_TOKEN en .env")
        return
    if not ADMIN_CHAT_ID:
        logger.warning("ADMIN_CHAT_ID no configurado")
    if not COMMUNITY_GROUP_ID:
        logger.warning("COMMUNITY_GROUP_ID no configurado — la moderación y anuncios estarán desactivados")

    application = Application.builder().token(TELEGRAM_TOKEN).build()

    # ── Broadcast commands ──
    application.add_handler(CommandHandler("start",   start_command))
    application.add_handler(CommandHandler("id",      id_command))
    application.add_handler(CommandHandler("anuncio", anuncio_command))

    # ── Moderation commands ──
    application.add_handler(CommandHandler("warn",   warn_command))
    application.add_handler(CommandHandler("mute",   mute_command))
    application.add_handler(CommandHandler("unmute", unmute_command))
    application.add_handler(CommandHandler("ban",    ban_command))
    application.add_handler(CommandHandler("unban",  unban_command))
    application.add_handler(CommandHandler("report", report_command))
    application.add_handler(CommandHandler("rules",  rules_command))
    application.add_handler(CommandHandler("warns",  warns_command))

    # ── Private text → group broadcast ──
    application.add_handler(MessageHandler(
        filters.TEXT & filters.ChatType.PRIVATE & ~filters.COMMAND,
        text_message
    ))

    # ── FAQ command ──
    application.add_handler(CommandHandler("faq", faq_command))

    # ── Group moderation (runs on every group text message) ──
    application.add_handler(MessageHandler(
        filters.TEXT & (filters.ChatType.GROUP | filters.ChatType.SUPERGROUP) & ~filters.COMMAND,
        moderate_message
    ))

    # ── Welcome new members ──
    application.add_handler(MessageHandler(
        filters.StatusUpdate.NEW_CHAT_MEMBERS,
        welcome_message
    ))

    logger.info("ZenthisBot iniciado con moderación.")
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
