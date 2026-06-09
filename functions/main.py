"""ZenthisBot Firebase — minimal entrypoint for fast loading."""
import os, json, logging, sys, asyncio, traceback
from firebase_functions import https_fn, firestore_fn, params

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zenthisbot")

WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "zenthis_bot_secret")

# Firebase secrets — inject as env vars
TELEGRAM_TOKEN = params.SecretParam("TELEGRAM_TOKEN")
ADMIN_CHAT_ID = params.SecretParam("ADMIN_CHAT_ID")
COMMUNITY_GROUP_ID = params.SecretParam("COMMUNITY_GROUP_ID")

@https_fn.on_request(timeout_sec=60, memory=256, secrets=[TELEGRAM_TOKEN, ADMIN_CHAT_ID, COMMUNITY_GROUP_ID])
def webhook(req: https_fn.Request) -> https_fn.Response:
    return _handle(req)

_bot = None
_initialized = False

def _handle(req):
    global _bot, _initialized
    try:
        # Verify webhook secret
        if req.headers.get("X-Telegram-Bot-Api-Secret-Token") != WEBHOOK_SECRET:
            logger.warning("Invalid secret token")
            return https_fn.Response("Unauthorized", status=403)

        # Lazy imports
        sys.path.insert(0, os.path.dirname(__file__))
        import bot as bm
        bm.load_json = lambda path: {}
        bm.save_json = lambda path, data: None
        bm.WARNS_FILE = "warns"
        bm.MUTES_FILE = "mutes"

        from telegram import Update
        from telegram.ext import Application, CommandHandler, MessageHandler, filters
        from bot import (
            start_command, id_command, anuncio_command, warn_command, mute_command, unmute_command,
            ban_command, unban_command, report_command, rules_command, warns_command, faq_command,
            text_message, moderate_message, welcome_message
        )

        if not _initialized:
            _bot = Application.builder().token(os.environ.get("TELEGRAM_TOKEN", "")).build()
            _bot.add_handler(CommandHandler("start", start_command))
            _bot.add_handler(CommandHandler("id", id_command))
            _bot.add_handler(CommandHandler("anuncio", anuncio_command))
            _bot.add_handler(CommandHandler("faq", faq_command))
            _bot.add_handler(CommandHandler("warn", warn_command))
            _bot.add_handler(CommandHandler("mute", mute_command))
            _bot.add_handler(CommandHandler("unmute", unmute_command))
            _bot.add_handler(CommandHandler("ban", ban_command))
            _bot.add_handler(CommandHandler("unban", unban_command))
            _bot.add_handler(CommandHandler("report", report_command))
            _bot.add_handler(CommandHandler("rules", rules_command))
            _bot.add_handler(CommandHandler("warns", warns_command))
            _bot.add_handler(MessageHandler(filters.TEXT & filters.ChatType.PRIVATE & ~filters.COMMAND, text_message))
            _bot.add_handler(MessageHandler(filters.TEXT & (filters.ChatType.GROUP | filters.ChatType.SUPERGROUP) & ~filters.COMMAND, moderate_message))
            _bot.add_handler(MessageHandler(filters.StatusUpdate.NEW_CHAT_MEMBERS, welcome_message))
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(_bot.initialize())
            _initialized = True
            logger.info("ZenthisBot ready - v11")

        # Parse update
        body = req.get_data(as_text=True) or "{}"
        data = json.loads(body)
        update = Update.de_json(data, _bot.bot)
        
        # Process update
        loop = asyncio.get_event_loop()
        loop.run_until_complete(_bot.process_update(update))
        
        return https_fn.Response("OK")
    except Exception:
        msg = traceback.format_exc()
        logger.error(f"Webhook error: {msg}")
        return https_fn.Response(msg[:500], status=500, content_type="text/plain")


@https_fn.on_request(timeout_sec=15, memory=128, secrets=[TELEGRAM_TOKEN, COMMUNITY_GROUP_ID])
def verifytelegram(req: https_fn.Request) -> https_fn.Response:
    """Verify if a Telegram user is a member of the community group."""
    import requests as _req
    headers_out = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
    }
    if req.method == "OPTIONS":
        return https_fn.Response("", status=204, headers=headers_out)
    if req.method != "POST":
        return https_fn.Response("Method Not Allowed", status=405, headers=headers_out)

    try:
        body = req.get_json() or {}
        user_id = body.get("telegram_id")
        if not user_id:
            return https_fn.Response(
                json.dumps({"verified": False, "error": "Missing telegram_id"}),
                status=400, content_type="application/json", headers=headers_out
            )

        token = os.environ.get("TELEGRAM_TOKEN", "")
        chat_id = os.environ.get("COMMUNITY_GROUP_ID", "")
        url = f"https://api.telegram.org/bot{token}/getChatMember"
        resp = _req.post(url, json={"chat_id": chat_id, "user_id": user_id}, timeout=10)

        if resp.status_code != 200:
            return https_fn.Response(
                json.dumps({"verified": False, "error": "Telegram API error"}),
                status=502, content_type="application/json", headers=headers_out
            )

        data = resp.json()
        if not data.get("ok"):
            return https_fn.Response(
                json.dumps({"verified": False, "error": data.get("description", "Unknown")}),
                status=200, content_type="application/json", headers=headers_out
            )

        result = data.get("result", {})
        status_text = result.get("status", "")
        is_member = status_text in ("creator", "administrator", "member")

        return https_fn.Response(
            json.dumps({
                "verified": is_member,
                "status": status_text,
                "user": (result.get("user") or {}).get("username", "")
            }),
            status=200, content_type="application/json", headers=headers_out
        )

    except Exception as e:
        return https_fn.Response(
            json.dumps({"verified": False, "error": str(e)}),
            status=500, content_type="application/json", headers=headers_out
        )


@firestore_fn.on_document_created(document="waitlist/{docId}", timeout_sec=15, memory=128)
def on_waitlist_created(event: firestore_fn.Event) -> None:
    """Bridge: copy registration to 'mail' collection so the SendGrid extension sends the welcome email."""
    from firebase_admin import firestore as admin_fs
    try:
        data = event.data
        if not data:
            logger.warning("on_waitlist_created: no data in event")
            return

        to_email = data.get("to") or data.get("email")
        if not to_email:
            logger.warning("on_waitlist_created: no email field")
            return

        # Build email document for firestore-send-email extension
        welcome = {
            "to": to_email,
            "message": data.get("message", {}),
            "replyTo": data.get("replyTo", "zenthisio@proton.me"),
        }

        db = admin_fs.client()
        db.collection("mail").document(to_email).set(welcome)
        logger.info(f"Welcome email queued for {to_email}")

    except Exception as e:
        logger.error(f"on_waitlist_created error: {e}")


RESEND_API_KEY = params.SecretParam("RESEND_API_KEY")

@firestore_fn.on_document_created(document="mail/{docId}", timeout_sec=30, memory=256, secrets=[RESEND_API_KEY])
def send_email_resend(event: firestore_fn.Event) -> None:
    """Send confirmation email via Resend API when a doc is created in 'mail'."""
    import requests as _req
    try:
        data = event.data
        if not data:
            logger.warning("send_email_resend: no data")
            return

        to_email = data.get("to")
        if not to_email:
            logger.warning("send_email_resend: no 'to' field")
            return

        # Skip if already delivered/sent
        delivery = data.get("delivery") or {}
        if delivery.get("state") == "SUCCESS":
            return

        msg = data.get("message") or {}
        subject = msg.get("subject", "Welcome to Zenthis Protocol")
        html = msg.get("html", "<p>Welcome to Zenthis Protocol!</p>")

        api_key = os.environ.get("RESEND_API_KEY", "").strip()
        if not api_key or api_key == "PLACEHOLDER":
            logger.warning(f"RESEND_API_KEY not configured for {to_email}")
            return

        mail_from = data.get("from", "Zenthis <noreply@zenthisprotocol.xyz>")
        resp = _req.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "from": mail_from,
                "to": [to_email],
                "subject": subject,
                "html": html,
                "reply_to": data.get("replyTo", "noreply@zenthisprotocol.xyz"),
            },
            timeout=15,
        )

        # Update delivery status on the document
        from firebase_admin import firestore as admin_fs
        db = admin_fs.client()
        doc_ref = db.collection("mail").document(event.document_id or to_email)

        if resp.ok:
            info = resp.json()
            doc_ref.set({
                "delivery": {
                    "state": "SUCCESS",
                    "messageId": info.get("id", ""),
                    "ts": int(__import__("time").time()),
                }
            }, merge=True)
            logger.info(f"Email sent via Resend to {to_email}")
        else:
            error_text = resp.text[:500]
            logger.error(f"Resend API error for {to_email}: {resp.status_code} {error_text}")
            doc_ref.set({
                "delivery": {
                    "state": "ERROR",
                    "error": f"Resend {resp.status_code}: {error_text}",
                    "attempts": (delivery.get("attempts") or 0) + 1,
                }
            }, merge=True)

    except Exception as e:
        logger.error(f"send_email_resend error: {traceback.format_exc()}")


@https_fn.on_request(timeout_sec=540, memory=512, secrets=[RESEND_API_KEY])
def retry_emails(req: https_fn.Request) -> https_fn.Response:
    """Process backlog of failed emails. Trigger manually via HTTP."""
    import firebase_admin
    import requests as _req
    from firebase_admin import firestore as admin_fs
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    try:
        db = admin_fs.client()
        api_key = os.environ.get("RESEND_API_KEY", "").strip()
        if not api_key or api_key == "PLACEHOLDER":
            return https_fn.Response("RESEND_API_KEY not configured", status=500)

        # Get all mail docs that need delivery
        mail_docs = db.collection("mail").stream()
        sent = 0
        skipped = 0
        failed = 0
        errors = []

        for doc_snap in mail_docs:
            data = doc_snap.to_dict()
            to_email = data.get("to", "")
            if not to_email:
                skipped += 1
                continue

            delivery = data.get("delivery") or {}
            if delivery.get("state") == "SUCCESS":
                skipped += 1
                continue

            msg = data.get("message") or {}
            subject = msg.get("subject", "Welcome to Zenthis Protocol")
            html = msg.get("html", "<p>Welcome to Zenthis Protocol!</p>")

            try:
                mail_from = data.get("from", "Zenthis <noreply@zenthisprotocol.xyz>")
                resp = _req.post(
                    "https://api.resend.com/emails",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "from": mail_from,
                        "to": [to_email],
                        "subject": subject,
                        "html": html,
                        "reply_to": data.get("replyTo", "noreply@zenthisprotocol.xyz"),
                    },
                    timeout=15,
                )

                if resp.ok:
                    info = resp.json()
                    doc_snap.reference.set({
                        "delivery": {
                            "state": "SUCCESS",
                            "messageId": info.get("id", ""),
                            "ts": int(__import__("time").time()),
                        }
                    }, merge=True)
                    sent += 1
                    logger.info(f"Retry: sent to {to_email}")
                else:
                    err_text = resp.text[:200]
                    doc_snap.reference.set({
                        "delivery": {
                            "state": "ERROR",
                            "error": f"Resend {resp.status_code}: {err_text}",
                            "attempts": (delivery.get("attempts") or 0) + 1,
                        }
                    }, merge=True)
                    failed += 1
                    errors.append(f"{to_email}: {resp.status_code}")
                    logger.warning(f"Retry failed for {to_email}: {err_text}")

                # Rate limit: Resend allows ~5 req/s
                __import__("time").sleep(0.25)
            except Exception as e:
                failed += 1
                errors.append(f"{to_email}: {str(e)[:80]}")

        return https_fn.Response(
            json.dumps({"sent": sent, "skipped": skipped, "failed": failed, "errors": errors[:20]}),
            status=200, content_type="application/json",
        )

    except Exception as e:
        logger.error(f"retry_emails error: {traceback.format_exc()}")
        return https_fn.Response(json.dumps({"error": str(e)}), status=500, content_type="application/json")


@https_fn.on_request(timeout_sec=60, memory=256, secrets=[RESEND_API_KEY])
def debug_send(req: https_fn.Request) -> https_fn.Response:
    """Debug: send a test email from within Cloud Functions and return full response."""
    import requests as _req
    import firebase_admin
    from firebase_admin import firestore as admin_fs
    try:
        api_key = os.environ.get("RESEND_API_KEY", "").strip()
        if not firebase_admin._apps:
            firebase_admin.initialize_app()
        db = admin_fs.client()
        # Get first mail doc
        docs = list(db.collection("mail").limit(1).stream())
        if not docs:
            return https_fn.Response(json.dumps({"error": "no docs"}), status=404)
        data = docs[0].to_dict()
        to_email = data.get("to", "")
        msg = data.get("message") or {}
        mail_from = data.get("from", "Zenthis <noreply@zenthisprotocol.xyz>")
        payload = {
            "from": mail_from,
            "to": [to_email],
            "subject": msg.get("subject", "Test"),
            "html": msg.get("html", "<p>Test</p>"),
            "reply_to": data.get("replyTo", "noreply@zenthisprotocol.xyz"),
        }
        # Log exact payload for debugging
        logger.info(f"Debug payload: {json.dumps(payload)[:500]}")
        resp = _req.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
            timeout=15,
        )
        return https_fn.Response(
            json.dumps({"status": resp.status_code, "body": resp.text, "headers": dict(resp.headers), "to": to_email, "from_used": mail_from}),
            status=200, content_type="application/json",
        )
    except Exception as e:
        return https_fn.Response(json.dumps({"error": str(e), "trace": traceback.format_exc()}), status=500, content_type="application/json")
