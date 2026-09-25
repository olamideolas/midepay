export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  
  const url = process.env.SUPABASE_URL || 'https://pxdzdehocjnmxbuvipxu.supabase.co';
  const anonKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_5adXF0UhSQJ1n4F_IqLXEw_0naxL0wT';

  res.status(200).send(`
window.MIDEPAY_SUPABASE_CONFIG = {
  url: ${JSON.stringify(url)},
  anonKey: ${JSON.stringify(anonKey)}
};
  `.trim());
}
