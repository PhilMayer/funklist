// Prints each band's invite link. Use this to get into a band that has no accounts linked yet
// (for example, bands created before login existed): open the link, sign in, and claim your profile.
//   npm run invite              # all bands
//   npm run invite -- 3         # just band 3
const db = require('../db');

const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3001}`;
const bandId = Number(process.argv[2]) || null;
const bands = db.prepare(`
  SELECT b.id, b.name, b.invite_code,
         (SELECT COUNT(*) FROM band_members m WHERE m.band_id = b.id AND m.user_id IS NOT NULL) AS accounts
  FROM bands b ${bandId ? 'WHERE b.id = ?' : ''} ORDER BY b.id
`).all(...(bandId ? [bandId] : []));

if (!bands.length) console.log('No bands found.');
for (const b of bands) {
  console.log(`${b.id}  ${b.name}  (${b.accounts} linked account${b.accounts === 1 ? '' : 's'})`);
  console.log(`   ${base}/?join=${b.invite_code}\n`);
}
