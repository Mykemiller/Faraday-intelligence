// api/subscribe.js — Vercel Serverless Function
// Wires registration form to Beehiiv newsletter subscription API
// Required env vars: BEEHIIV_API_KEY, BEEHIIV_PUB_ID

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, ref } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const apiKey = process.env.BEEHIIV_API_KEY;
  const pubId  = process.env.BEEHIIV_PUB_ID;

  if (!apiKey || !pubId) {
    console.error('Missing BEEHIIV_API_KEY or BEEHIIV_PUB_ID env vars');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const beehiivRes = await fetch(
      `https://api.beehiiv.com/v2/publications/${pubId}/subscriptions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          email,
          reactivate_existing: false,
          send_welcome_email: true,
          utm_source: ref || 'faraday-website',
          utm_medium: 'organic',
          utm_campaign: 'mvp-beta',
        }),
      }
    );

    const data = await beehiivRes.json();

    if (!beehiivRes.ok) {
      console.error('Beehiiv error:', data);
      return res.status(beehiivRes.status).json({ error: data.message || 'Subscription failed' });
    }

    return res.status(200).json({ success: true, id: data.data?.id });
  } catch (err) {
    console.error('Subscribe error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
