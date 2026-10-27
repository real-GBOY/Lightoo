import { hashPassword } from '../src/lib/crypto';

const pw = process.argv[2];
if (!pw) {
  console.error('Usage: npx tsx scripts/hash-password.ts "your password"');
  process.exit(1);
}
// Prints a value for OWNER_PASSWORD_HASH. In .env files escape $ as \$ if your loader expands variables.
console.log(await hashPassword(pw));
