// Prints VITE_OPERATOR_HASH for a new operator account: npm run operator-hash -- <username> <password>
// The dashboard keeps only this hash; share the username and password inside the team only.
import { createHash } from 'node:crypto';

const [user, pw] = process.argv.slice(2);
if (!user || !pw) {
  console.error('usage: npm run operator-hash -- <username> <password>');
  process.exit(1);
}
if (pw.length < 12) console.error('warning: use at least 12 characters; the hash is public in the code and on Vercel builds');
console.log(`VITE_OPERATOR_HASH=${createHash('sha256').update(`${user.trim().toLowerCase()}:${pw}`).digest('hex')}`);
