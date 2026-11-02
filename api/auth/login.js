import { generateAuthUrl } from '../../src/youtube.js';

export default async function handler(req, res) {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).send('Missing user_id parameter. Please start from Telegram with /connect.');
    }

    // Determine current host for redirect_uri
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const redirectUri = `${protocol}://${host}/api/auth/callback`;

    const authUrl = generateAuthUrl(user_id, redirectUri);
    return res.redirect(302, authUrl);
  } catch (err) {
    console.error('Error generating auth url:', err);
    return res.status(500).send('Failed to initiate login.');
  }
}
