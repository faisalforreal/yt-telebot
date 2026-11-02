import { bot } from '../src/bot.js';

export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Telegram Webhook Endpoint');
  }

  try {
    const update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    await bot.handleUpdate(update);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(200).json({ ok: false, error: err.message });
  }
}
