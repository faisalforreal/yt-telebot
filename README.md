# 📤 SendToYT Telegram Bot (`@teletoytupload_bot`)

> Upload videos directly from Telegram to YouTube with one-click Google sign-in. Videos are kept private by default.

Inspired by [SendToYTBot](https://ytbot.pages.dev/).

---

## 🚀 Live Production Deployment

- **Landing Page & Webhook**: [https://yt-telebot.vercel.app](https://yt-telebot.vercel.app)
- **Telegram Bot**: [@teletoytupload_bot](https://t.me/teletoytupload_bot)
- **OAuth Callback URL**: `https://yt-telebot.vercel.app/api/auth/callback`

---

## 🌟 Key Features

1. **Forward & Upload**: Forward any video message from your Telegram chats or drop a video file directly into `@teletoytupload_bot`. The bot automatically uploads it to your YouTube channel.
2. **Private by Default**: Every uploaded video is set to **Private** visibility so only you can view it until you choose to publish it.
3. **Simple Google Sign-In**: Users tap **Connect YouTube Channel** once to authorize video uploading via standard Google OAuth 2.0. No passwords shared, and permissions can be revoked anytime with `/disconnect`.
4. **Smart Captions**: Add a text caption when sending a video:
   - **First line**: Becomes the YouTube video title.
   - **Remaining lines**: Become the video description.
5. **Dual Architecture**:
   - **Cloud Serverless**: Live on Vercel with webhooks and OAuth callback.
   - **Local / Polling Worker**: Ready for standalone background execution via `npm run bot`.

---

## ⚙️ Google Cloud Console Step

To complete user sign-ins on the live web portal:

1. Open [Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials).
2. Select the OAuth 2.0 Client (`242783595099-...`).
3. Under **Authorized redirect URIs**, add:
   ```text
   https://yt-telebot.vercel.app/api/auth/callback
   ```
4. Save changes.

---

## 🛠️ Bot Commands

- `/start` - Welcome message & quick connect link.
- `/connect` or `/login` - Generate your secure Google sign-in link.
- `/status` - Check connected channel name and upload privacy.
- `/disconnect` - Revoke authorization and unlink your channel.
- `/help` - Usage tips and formatting guide.

---

## 💻 Local Development

```bash
# Install dependencies
npm install

# Start local web portal (OAuth & landing page)
npm run start

# Start Telegram bot in polling mode
npm run bot
```
