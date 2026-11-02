import { google } from 'googleapis';
import { getUser, saveUser } from './storage.js';

function clean(str) {
  return (str || '').replace(/^\uFEFF/, '').trim();
}

export function getOAuth2Client(redirectUri) {
  const clientId = clean(process.env.GOOGLE_CLIENT_ID);
  const clientSecret = clean(process.env.GOOGLE_CLIENT_SECRET);
  const redirect = clean(redirectUri) || `${clean(process.env.BASE_URL) || 'http://localhost:3000'}/api/auth/callback`;

  return new google.auth.OAuth2(clientId, clientSecret, redirect);
}

export function generateAuthUrl(userId, redirectUri) {
  const oauth2Client = getOAuth2Client(redirectUri);

  const scopes = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/userinfo.profile'
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
    state: String(userId)
  });
}

export async function handleAuthCallback(code, redirectUri) {
  const oauth2Client = getOAuth2Client(redirectUri);
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  let channelTitle = 'Your YouTube Channel';
  try {
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const response = await youtube.channels.list({
      part: ['snippet'],
      mine: true
    });
    if (response.data.items && response.data.items.length > 0) {
      channelTitle = response.data.items[0].snippet.title;
    }
  } catch (err) {
    console.warn('Could not fetch channel title during callback:', err.message);
  }

  return {
    tokens,
    channelTitle
  };
}

export async function getUserAuthClient(userId, redirectUri) {
  const user = await getUser(userId);
  if (!user || !user.tokens) {
    return null;
  }

  const oauth2Client = getOAuth2Client(redirectUri);
  oauth2Client.setCredentials(user.tokens);

  // Automatically persist updated tokens when refreshed
  oauth2Client.on('tokens', (newTokens) => {
    saveUser(userId, {
      tokens: {
        ...user.tokens,
        ...newTokens
      }
    });
  });

  return oauth2Client;
}

export async function uploadVideoToYouTube({ authClient, stream, title, description, privacyStatus = 'private' }) {
  const youtube = google.youtube({ version: 'v3', auth: authClient });

  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: title || `Video - ${new Date().toLocaleDateString()}`,
        description: description || 'Uploaded via Telegram Video Bot.',
        categoryId: '22'
      },
      status: {
        privacyStatus: privacyStatus || 'private'
      }
    },
    media: {
      body: stream
    }
  });

  return response.data;
}
