export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const env = process.env.APP_ENV || process.env.MIDEPAY_ENV || 'production';
  const url = process.env.SUPABASE_URL || 'https://pxdzdehocjnmxbuvipxu.supabase.co';
  const anonKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_5adXF0UhSQJ1n4F_IqLXEw_0naxL0wT';
  // Dynamic config must enforce the same public-key boundary as the build.
  let isPublicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(anonKey);
  if (!isPublicKey && anonKey.startsWith('eyJ')) {
    try { isPublicKey = JSON.parse(Buffer.from(anonKey.split('.')[1], 'base64url').toString('utf8')).role === 'anon'; } catch (_) {}
  }
  if (!isPublicKey) {
    res.status(503).send('/* Public configuration unavailable. */');
    return;
  }

  const financialRpcsLive = String(process.env.FINANCIAL_RPCS_LIVE || '').toLowerCase() === 'true';

  res.status(200).send(`
window.MIDEPAY_SUPABASE_CONFIG = {
  ENV: ${JSON.stringify(env)},
  FINANCIAL_RPCS_LIVE: ${JSON.stringify(financialRpcsLive)},
  url: ${JSON.stringify(url)},
  anonKey: ${JSON.stringify(anonKey)}
};
  `.trim());
}
