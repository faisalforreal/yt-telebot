import { handleAuthCallback } from '../../src/youtube.js';
import { saveUser } from '../../src/storage.js';
import { bot } from '../../src/bot.js';

export default async function handler(req, res) {
  try {
    const { code, state: userId, error } = req.query;

    if (error) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Connection Cancelled</title>
          <link rel="stylesheet" href="/style.css">
        </head>
        <body class="center-layout">
          <div class="card fade-in">
            <div class="icon">⚠️</div>
            <h2>Connection Cancelled</h2>
            <p>You cancelled the YouTube connection. No problem! You can reconnect anytime in Telegram using <code>/connect</code>.</p>
            <a href="https://t.me/teletoytupload_bot" class="cta-btn">Return to Telegram</a>
          </div>
        </body>
        </html>
      `);
    }

    if (!code || !userId) {
      return res.status(400).send('Missing authorization code or user identification.');
    }

    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const redirectUri = `${protocol}://${host}/api/auth/callback`;

    const { tokens, channelTitle } = await handleAuthCallback(code, redirectUri);

    await saveUser(userId, {
      tokens,
      channelTitle
    });

    // Notify user in Telegram
    try {
      await bot.telegram.sendMessage(
        userId,
        `🎉 *Channel Connected Successfully!*\n\n` +
        `Your channel *${channelTitle}* is ready. Any video you send or forward here will be uploaded straight to your channel as a *Private* video.\n\n` +
        `Try it now: forward or drop any video into this chat!`,
        { parse_mode: 'Markdown' }
      );
    } catch (teleErr) {
      console.warn('Could not send confirmation message to Telegram user:', teleErr.message);
    }

    return res.status(200).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Connected to YouTube!</title>
        <link rel="stylesheet" href="/style.css">
      </head>
      <body class="center-layout">
        <div class="card fade-in">
          <div class="icon">🎉</div>
          <h2>Connected Successfully!</h2>
          <p>Your channel <strong>${channelTitle}</strong> is now linked.</p>
          <p>You can close this tab and return to Telegram. Simply forward or send any video to start uploading!</p>
          <a href="https://t.me/teletoytupload_bot" class="cta-btn">Open in Telegram</a>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Callback error:', err);
    return res.status(500).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Connection Error</title>
        <link rel="stylesheet" href="/style.css">
      </head>
      <body class="center-layout">
        <div class="card fade-in">
          <div class="icon">❌</div>
          <h2>Connection Issue</h2>
          <p>Something went wrong while connecting your channel. Please return to Telegram and try <code>/connect</code> again.</p>
          <a href="https://t.me/teletoytupload_bot" class="cta-btn">Return to Telegram</a>
        </div>
      </body>
      </html>
    `);
  }
}
