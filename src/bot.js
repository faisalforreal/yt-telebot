import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { getUser, deleteUser } from './storage.js';
import { generateAuthUrl, getUserAuthClient, uploadVideoToYouTube } from './youtube.js';

function clean(str) {
  return (str || '').replace(/^\uFEFF/, '').trim();
}

const token = clean(process.env.TELEGRAM_BOT_TOKEN);
if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is missing from environment variables.');
}

export const bot = new Telegraf(token);

function getLoginUrl(userId) {
  const baseUrl = clean(process.env.BASE_URL) || 'http://localhost:3000';
  return `${baseUrl}/api/auth/login?user_id=${userId}`;
}

// /start command
bot.command('start', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);

  if (user && user.tokens) {
    const channelName = user.channelTitle || 'Your Channel';
    return ctx.reply(
      `👋 Welcome back!\n\n` +
      `✅ Connected Channel: *${channelName}*\n` +
      `🔒 Upload Visibility: *Private*\n\n` +
      `Just forward or send any video here to upload it directly to your channel.\n\n` +
      `💡 *Tip*: Add a caption to your video! The first line becomes the title, and the rest becomes the description.`,
      { parse_mode: 'Markdown' }
    );
  }

  const loginUrl = getLoginUrl(userId);
  return ctx.reply(
    `👋 Welcome to YouTube Video Uploader!\n\n` +
    `Forward or send any video here and it will be uploaded directly to your YouTube channel as a *Private* video so you have complete control.\n\n` +
    `To get started, connect your YouTube channel below:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        Markup.button.url('🔗 Connect YouTube Channel', loginUrl)
      ])
    }
  );
});

// /connect or /login command
bot.command(['connect', 'login'], async (ctx) => {
  const userId = ctx.from.id;
  const loginUrl = getLoginUrl(userId);

  return ctx.reply(
    `Tap the button below to connect your YouTube channel. It takes just a few seconds!`,
    Markup.inlineKeyboard([
      Markup.button.url('🔗 Connect YouTube Channel', loginUrl)
    ])
  );
});

// /status command
bot.command('status', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);

  if (user && user.tokens) {
    const channelName = user.channelTitle || 'Connected Channel';
    return ctx.reply(
      `📊 *Channel Status*\n\n` +
      `✅ Connected: *${channelName}*\n` +
      `🔒 Visibility: *Private*\n` +
      `⚡ Ready for video uploads! Just forward or send any video.\n\n` +
      `Send /disconnect if you ever want to switch channels.`,
      { parse_mode: 'Markdown' }
    );
  }

  const loginUrl = getLoginUrl(userId);
  return ctx.reply(
    `⚠️ No YouTube channel connected yet.\n\nTap below to connect your channel:`,
    Markup.inlineKeyboard([
      Markup.button.url('🔗 Connect YouTube Channel', loginUrl)
    ])
  );
});

// /disconnect command
bot.command('disconnect', async (ctx) => {
  const userId = ctx.from.id;
  const deleted = await deleteUser(userId);

  if (deleted) {
    return ctx.reply(
      `Your channel has been disconnected. No new uploads will go to your channel until you reconnect anytime using /connect.`
    );
  }
  return ctx.reply(`You don't have a connected channel right now. Send /connect to connect one!`);
});

// /help command
bot.command('help', async (ctx) => {
  return ctx.reply(
    `*YouTube Video Uploader Guide* 📹\n\n` +
    `*1. How to Upload:*\n` +
    `Forward or send any video file directly to this chat.\n\n` +
    `*2. Setting Title & Description:*\n` +
    `Add a caption when sending or forwarding your video:\n` +
    `• First line = Video Title\n` +
    `• Next lines = Video Description\n\n` +
    `*3. Privacy:*\n` +
    `Every video is uploaded as *Private* so you can review it before making it public.\n\n` +
    `*4. Commands:*\n` +
    `/status - Check channel connection\n` +
    `/connect - Connect your YouTube channel\n` +
    `/disconnect - Disconnect your channel\n` +
    `/help - View this guide`,
    { parse_mode: 'Markdown' }
  );
});

// Helper: Stream download from URL
function streamUrl(fileUrl) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(fileUrl);
    const client = parsed.protocol === 'https:' ? https : http;
    client.get(fileUrl, (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve(res);
      } else {
        reject(new Error(`Failed to download file: status code ${res.statusCode}`));
      }
    }).on('error', reject);
  });
}

// Video handler (covers directly sent and forwarded videos)
async function handleVideoUpload(ctx, fileId, caption, fileSize) {
  const userId = ctx.from.id;
  const user = await getUser(userId);

  if (!user || !user.tokens) {
    const loginUrl = getLoginUrl(userId);
    return ctx.reply(
      `⚠️ Please connect your YouTube channel first before sending videos.`,
      Markup.inlineKeyboard([
        Markup.button.url('🔗 Connect YouTube Channel', loginUrl)
      ])
    );
  }

  // Parse title and description from caption
  let title = '';
  let description = '';

  if (caption && caption.trim()) {
    const lines = caption.trim().split('\n');
    title = lines[0].trim();
    description = lines.slice(1).join('\n').trim();
  }

  if (!title) {
    const dateStr = new Date().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    title = `Video - ${dateStr}`;
  }

  if (!description) {
    description = 'Uploaded directly from Telegram.';
  }

  // Check file size (Telegram limits standard bot downloads to 20MB)
  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
  if (fileSize && fileSize > MAX_FILE_SIZE) {
    const sizeInMb = (fileSize / (1024 * 1024)).toFixed(1);
    return ctx.reply(
      `⚠️ This video is ${sizeInMb} MB.\n\n` +
      `Telegram limits standard bot transfers to videos up to *20 MB*.\n\n` +
      `💡 *Tip*: Try sending a shorter clip or compress the video slightly under 20 MB to upload!`,
      { parse_mode: 'Markdown' }
    );
  }

  const statusMsg = await ctx.reply(`📥 Getting your video ready...`);

  try {
    const authClient = await getUserAuthClient(userId);
    if (!authClient) {
      throw new Error('Authentication expired. Please reconnect using /connect.');
    }

    // Update status to user
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      `⏳ Uploading "${title}" to your YouTube channel as Private...`
    ).catch(() => {});

    // Get file download link from Telegram
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const videoStream = await streamUrl(fileLink.href);

    // Upload to YouTube
    const uploaded = await uploadVideoToYouTube({
      authClient,
      stream: videoStream,
      title,
      description,
      privacyStatus: 'private'
    });

    const videoId = uploaded.id;
    const watchUrl = `https://youtu.be/${videoId}`;

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      `🎉 *Video Uploaded Successfully!*\n\n` +
      `🎬 *Title:* ${title}\n` +
      `🔒 *Visibility:* Private (Only you can watch)\n` +
      `🔗 *Watch Link:* ${watchUrl}\n\n` +
      `You can review and publish it whenever you're ready!`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Upload error:', err);
    let errorMessage = `❌ Could not complete upload. Please check /status or reconnect using /connect.`;
    
    if (err.message && err.message.includes('file is too big')) {
      errorMessage = `⚠️ This video exceeds Telegram's 20 MB limit for bots. Please send a video under 20 MB.`;
    } else if (err.message && (err.message.includes('YouTube Data API v3 has not been used') || err.message.includes('it is disabled'))) {
      errorMessage = `⚠️ The YouTube service is not enabled in your Google project yet.\n\nPlease enable it once here:\nhttps://console.developers.google.com/apis/api/youtube.googleapis.com/overview?project=242783595099\n\nThen try uploading again!`;
    }

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      errorMessage
    ).catch(() => {});
  }
}

// Handle video messages
bot.on('video', async (ctx) => {
  const video = ctx.message.video;
  await handleVideoUpload(ctx, video.file_id, ctx.message.caption, video.file_size);
});

// Handle documents that are videos
bot.on('document', async (ctx) => {
  const doc = ctx.message.document;
  const isVideoMime = doc.mime_type && doc.mime_type.startsWith('video/');
  const isVideoExt = doc.file_name && /\.(mp4|mov|mkv|webm|avi|flv|wmv)$/i.test(doc.file_name);

  if (isVideoMime || isVideoExt) {
    await handleVideoUpload(ctx, doc.file_id, ctx.message.caption, doc.file_size);
  }
});

// If started directly with `node src/bot.js`
if (process.env.RUN_STANDALONE === 'true' || process.argv[1]?.endsWith('bot.js')) {
  console.log('Starting Telegram bot in polling mode...');
  bot.launch()
    .then(() => console.log('🤖 Telegram bot is running and listening for messages!'))
    .catch((err) => console.error('Failed to launch bot:', err));

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
