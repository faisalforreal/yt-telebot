import os
import sys
import time
import asyncio
from datetime import datetime
from dotenv import load_dotenv
import aiohttp
from telethon import TelegramClient, events, Button
from pymongo import MongoClient
from google.oauth2.credentials import Credentials
import google.auth.transport.requests

try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

load_dotenv()

def clean(val):
    return (val or '').strip().lstrip('\ufeff')

raw_api_id = clean(os.getenv("TELEGRAM_API_ID", ""))
API_ID = int(raw_api_id) if raw_api_id else 0
API_HASH = clean(os.getenv("TELEGRAM_API_HASH", ""))
BOT_TOKEN = clean(os.getenv("TELEGRAM_BOT_TOKEN", ""))
CLIENT_ID = clean(os.getenv("GOOGLE_CLIENT_ID", ""))
CLIENT_SECRET = clean(os.getenv("GOOGLE_CLIENT_SECRET", ""))
BASE_URL = clean(os.getenv("BASE_URL", "https://yt-telebot.vercel.app")).rstrip("/")
MONGO_URI = clean(os.getenv("MONGO_URI", ""))

if not BOT_TOKEN or not API_ID or not API_HASH or not MONGO_URI:
    print("Error: Missing required environment variables in .env (TELEGRAM_BOT_TOKEN, TELEGRAM_API_ID, TELEGRAM_API_HASH, MONGO_URI)")
    sys.exit(1)

# Persistent database storage
mongo_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
db = mongo_client["ytbot"]
users_col = db["users"]

def get_user(user_id):
    try:
        return users_col.find_one({"userId": str(user_id)})
    except Exception as e:
        print(f"Error fetching user {user_id}: {e}")
        return None

def save_user(user_id, data):
    try:
        data["userId"] = str(user_id)
        data["updatedAt"] = datetime.utcnow().isoformat()
        users_col.update_one({"userId": str(user_id)}, {"$set": data}, upsert=True)
    except Exception as e:
        print(f"Error saving user {user_id}: {e}")

def delete_user(user_id):
    try:
        res = users_col.delete_one({"userId": str(user_id)})
        return res.deleted_count > 0
    except Exception as e:
        print(f"Error deleting user {user_id}: {e}")
        return False

def get_user_access_token(user_id):
    user = get_user(user_id)
    if not user or "tokens" not in user:
        return None

    tokens = user["tokens"]
    creds = Credentials(
        token=tokens.get("access_token"),
        refresh_token=tokens.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        scopes=["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/userinfo.profile"]
    )

    if creds.expired or not creds.token:
        request = google.auth.transport.requests.Request()
        creds.refresh(request)
        tokens["access_token"] = creds.token
        save_user(user_id, {"tokens": tokens})

    return creds.token

def get_login_url(user_id):
    return f"{BASE_URL}/api/auth/login?user_id={user_id}"

bot = TelegramClient("yt_bot_session", API_ID, API_HASH)

def make_progress_bar(pct, length=14):
    filled = int(round(length * pct / 100))
    filled = max(0, min(length, filled))
    bar = "█" * filled + "░" * (length - filled)
    return f"[{bar}]"

def is_video_message(msg):
    if msg.video:
        return True
    if msg.document:
        if msg.document.mime_type and msg.document.mime_type.startswith("video/"):
            return True
        if msg.file and msg.file.name:
            ext = os.path.splitext(msg.file.name)[1].lower()
            if ext in ('.mp4', '.mov', '.mkv', '.webm', '.avi', '.flv', '.wmv', '.m4v', '.ts'):
                return True
    return False

def get_mime_type(msg):
    if msg.document and msg.document.mime_type and msg.document.mime_type.startswith("video/"):
        return msg.document.mime_type
    if msg.file and msg.file.name:
        ext = os.path.splitext(msg.file.name)[1].lower()
        if ext == ".mkv":
            return "video/x-matroska"
        elif ext == ".mov":
            return "video/quicktime"
        elif ext == ".webm":
            return "video/webm"
        elif ext == ".avi":
            return "video/x-msvideo"
    return "video/mp4"

async def upload_chunk_to_youtube(session, upload_url, chunk, start_byte, end_byte, total_bytes, mime_type, max_retries=5):
    headers = {
        "Content-Length": str(len(chunk)),
        "Content-Range": f"bytes {start_byte}-{end_byte}/{total_bytes}",
        "Content-Type": mime_type,
    }

    for attempt in range(max_retries):
        try:
            async with session.put(upload_url, headers=headers, data=chunk) as resp:
                if resp.status in (200, 201):
                    return await resp.json()
                elif resp.status == 308:
                    return None
                elif resp.status in (500, 502, 503, 504):
                    await asyncio.sleep(2 ** attempt)
                    continue
                else:
                    err_text = await resp.text()
                    raise Exception(f"Upload error ({resp.status}): {err_text}")
        except (aiohttp.ClientError, asyncio.TimeoutError):
            if attempt < max_retries - 1:
                await asyncio.sleep(2 ** attempt)
                continue
            raise

    raise Exception("Transfer timed out. Please try again.")

@bot.on(events.NewMessage(pattern="/start"))
@bot.on(events.NewMessage(pattern="/connect"))
async def start_handler(event):
    user_id = event.sender_id
    user = get_user(user_id)

    if user and user.get("tokens"):
        channel_name = user.get("channelTitle", "Your Channel")
        await event.respond(
            f"👋 Welcome back!\n\n"
            f"✅ Connected Channel: **{channel_name}**\n"
            f"🔒 Upload Visibility: **Private**\n"
            f"⚡ **Direct 2 GB Streaming**: Forward or drop any video up to 2 GB here!\n\n"
            f"💡 *Tip*: Add a caption to your video! The first line becomes the title, and the rest becomes the description."
        )
        return

    login_url = get_login_url(user_id)
    await event.respond(
        "👋 Welcome to YouTube Video Uploader!\n\n"
        "Forward or send any video here (up to 2 GB) and it will be transferred directly to your YouTube channel as a **Private** video so you have complete control.\n\n"
        "To get started, tap below to connect your YouTube channel:",
        buttons=[[Button.url("🔗 Connect YouTube Channel", login_url)]]
    )

@bot.on(events.NewMessage(pattern="/status"))
async def status_handler(event):
    user_id = event.sender_id
    user = get_user(user_id)

    if user and user.get("tokens"):
        channel_name = user.get("channelTitle", "Connected Channel")
        await event.respond(
            f"📊 **Channel Status**\n\n"
            f"✅ Connected: **{channel_name}**\n"
            f"🔒 Visibility: **Private**\n"
            f"⚡ **Direct Streaming**: Up to 2,000 MB (2 GB)\n\n"
            f"Ready for uploads! Simply forward or drop any video into this chat.\n\n"
            f"Send /disconnect to unlink your channel anytime."
        )
    else:
        login_url = get_login_url(user_id)
        await event.respond(
            "⚠️ No YouTube channel connected yet.\n\nTap below to connect your channel:",
            buttons=[[Button.url("🔗 Connect YouTube Channel", login_url)]]
        )

@bot.on(events.NewMessage(pattern="/disconnect"))
async def disconnect_handler(event):
    user_id = event.sender_id
    deleted = delete_user(user_id)
    if deleted:
        await event.respond("Your channel has been disconnected. Send /connect to connect anytime.")
    else:
        await event.respond("No channel was connected. Send /connect to connect one!")

@bot.on(events.NewMessage(pattern="/help"))
async def help_handler(event):
    await event.respond(
        "**YouTube Video Uploader Guide** 📹\n\n"
        "**1. How to Upload:**\n"
        "Forward or send any video file directly to this chat (supports up to **2 GB**).\n\n"
        "**2. Setting Title & Description:**\n"
        "Add a caption when sending or forwarding your video:\n"
        "• First line = Video Title\n"
        "• Next lines = Video Description\n\n"
        "**3. Privacy:**\n"
        "Every video is uploaded as **Private** so you can review it before making it public.\n\n"
        "**4. Commands:**\n"
        "/status - Check channel connection\n"
        "/connect - Connect your YouTube channel\n"
        "/disconnect - Disconnect your channel\n"
        "/help - View this guide"
    )

@bot.on(events.NewMessage)
async def video_handler(event):
    # Ignore text command messages
    if event.message.message and event.message.message.startswith("/"):
        return

    msg = event.message
    if not is_video_message(msg):
        return

    user_id = event.sender_id
    user = get_user(user_id)

    if not user or not user.get("tokens"):
        login_url = get_login_url(user_id)
        await event.respond(
            "⚠️ Please connect your YouTube channel first before sending videos.",
            buttons=[[Button.url("🔗 Connect YouTube Channel", login_url)]]
        )
        return

    # Extract title and description
    caption = msg.message or ""
    title = ""
    description = ""

    if caption.strip():
        lines = caption.strip().split("\n")
        title = lines[0].strip()
        description = "\n".join(lines[1:]).strip()

    if not title:
        if msg.file and msg.file.name:
            title = os.path.splitext(msg.file.name)[0]
        else:
            now_str = datetime.now().strftime("%b %d, %H:%M")
            title = f"Video - {now_str}"

    if not description:
        description = "Uploaded directly from Telegram."

    total_bytes = msg.file.size if msg.file else 0
    if not total_bytes or total_bytes <= 0:
        await event.respond("⚠️ Unable to determine video size. Please try sending the video again.")
        return

    size_mb = total_bytes / (1024 * 1024)
    if total_bytes > 2000 * 1024 * 1024:
        await event.respond(f"⚠️ Video is {size_mb:.1f} MB. Maximum supported size is 2,000 MB (2 GB).")
        return

    mime_type = get_mime_type(msg)
    status_msg = await event.respond(f"⚡ Starting direct transfer to YouTube ({size_mb:.1f} MB)...")

    # Refresh credentials & obtain active access token
    try:
        access_token = get_user_access_token(user_id)
        if not access_token:
            raise Exception("Session expired. Please reconnect using /connect.")
    except Exception as e:
        login_url = get_login_url(user_id)
        await status_msg.edit(
            "⚠️ Your YouTube session has expired. Please reconnect your channel:",
            buttons=[[Button.url("🔗 Connect YouTube Channel", login_url)]]
        )
        return

    timeout = aiohttp.ClientTimeout(total=7200, sock_read=180, sock_connect=60)
    start_time = time.time()
    last_update = [0.0]

    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            # 1. Initialize Resumable Upload Session
            init_headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json; charset=UTF-8",
                "X-Upload-Content-Length": str(total_bytes),
                "X-Upload-Content-Type": mime_type,
            }
            init_body = {
                "snippet": {
                    "title": title,
                    "description": description,
                    "categoryId": "22",
                },
                "status": {
                    "privacyStatus": "private",
                },
            }

            async with session.post(
                "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
                headers=init_headers,
                json=init_body,
            ) as init_resp:
                if init_resp.status != 200:
                    err_body = await init_resp.text()
                    raise Exception(f"Init failed ({init_resp.status}): {err_body}")
                upload_url = init_resp.headers.get("Location")
                if not upload_url:
                    raise Exception("Did not receive an upload URL from YouTube.")

            # 2. Direct In-Memory Chunk Streaming (Zero Disk Writes)
            # Chunk size: 8 MB (exactly 32 multiples of 256 KB)
            CHUNK_SIZE = 8 * 1024 * 1024
            buffer = bytearray()
            uploaded_bytes = 0
            video_result = None

            async for block in bot.iter_download(msg.media, chunk_size=512 * 1024):
                buffer.extend(block)
                while len(buffer) >= CHUNK_SIZE:
                    part = bytes(buffer[:CHUNK_SIZE])
                    del buffer[:CHUNK_SIZE]

                    start_byte = uploaded_bytes
                    end_byte = start_byte + len(part) - 1

                    res = await upload_chunk_to_youtube(
                        session, upload_url, part, start_byte, end_byte, total_bytes, mime_type
                    )
                    uploaded_bytes += len(part)

                    # Update Telegram live progress
                    now = time.time()
                    if (now - last_update[0] >= 3.5) or (uploaded_bytes >= total_bytes):
                        last_update[0] = now
                        pct = (uploaded_bytes / total_bytes) * 100
                        mb_done = uploaded_bytes / (1024 * 1024)
                        mb_tot = total_bytes / (1024 * 1024)
                        elapsed = now - start_time
                        speed = (mb_done / elapsed) if elapsed > 0.5 else 0.0
                        bar = make_progress_bar(pct)
                        try:
                            await status_msg.edit(
                                f"⚡ **Transferring directly to YouTube...**\n\n"
                                f"📊 **Progress**: {pct:.0f}% ({mb_done:.1f} MB / {mb_tot:.1f} MB)\n"
                                f"🚀 **Speed**: {speed:.1f} MB/s\n"
                                f"🔒 **Visibility**: Private\n\n"
                                f"{bar}"
                            )
                        except Exception:
                            pass

                    if res:
                        video_result = res
                        break

            # Send remaining final chunk
            if len(buffer) > 0 and not video_result:
                part = bytes(buffer)
                buffer.clear()

                start_byte = uploaded_bytes
                end_byte = start_byte + len(part) - 1

                res = await upload_chunk_to_youtube(
                    session, upload_url, part, start_byte, end_byte, total_bytes, mime_type
                )
                uploaded_bytes += len(part)
                if res:
                    video_result = res

            video_id = video_result.get("id") if video_result else None
            if not video_id:
                raise Exception("Upload completed but no video ID was returned.")

            watch_url = f"https://youtu.be/{video_id}"
            await status_msg.edit(
                f"🎉 **Video Uploaded Successfully!**\n\n"
                f"🎬 **Title:** {title}\n"
                f"🔒 **Visibility:** Private (Only you can watch)\n"
                f"🔗 **Watch Link:** {watch_url}\n\n"
                f"You can review and publish it whenever you're ready!"
            )

    except Exception as err:
        print(f"Direct stream upload error: {err}")
        err_text = str(err)
        if "YouTube Data API v3 has not been used" in err_text or "disabled" in err_text:
            msg_text = (
                "⚠️ The YouTube service is not enabled in your Google project yet.\n\n"
                "Please enable YouTube Data API v3 in your Google Cloud Console, then try uploading again!"
            )
        elif "quotaExceeded" in err_text:
            msg_text = "⚠️ Daily upload limit reached on your channel. Please try again tomorrow!"
        elif "invalid_grant" in err_text or "expired" in err_text.lower():
            login_url = get_login_url(user_id)
            await status_msg.edit(
                "⚠️ Your YouTube session has expired. Please reconnect your channel:",
                buttons=[[Button.url("🔗 Connect YouTube Channel", login_url)]]
            )
            return
        else:
            msg_text = "❌ Could not complete the upload. Please check /status or reconnect using /connect."

        try:
            await status_msg.edit(msg_text)
        except Exception:
            pass

async def main():
    print("=" * 60)
    print("🚀 SendToYT 2 GB Direct Stream Uploader Bot")
    print(f"Bot Token: {BOT_TOKEN[:10]}...")
    print(f"API ID: {API_ID}")
    print("=" * 60)

    # Clear webhook to allow direct polling
    import urllib.request
    try:
        urllib.request.urlopen(f"https://api.telegram.org/bot{BOT_TOKEN}/deleteWebhook")
        print("✓ Telegram webhook cleared for direct 2 GB stream transfers.")
    except Exception as e:
        print("Note on webhook clear:", e)

    await bot.start(bot_token=BOT_TOKEN)
    me = await bot.get_me()
    print(f"🤖 Bot running as @{me.username} ({me.first_name})")
    print("⚡ Ready for direct in-memory 2 GB stream transfers!")
    await bot.run_until_disconnected()

if __name__ == "__main__":
    asyncio.run(main())
