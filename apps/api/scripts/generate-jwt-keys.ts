/**
 * Prints an Ed25519 key pair in the single-line, `\n`-escaped PEM form that
 * `.env` files expect for JWT_PRIVATE_KEY / JWT_PUBLIC_KEY.
 *
 *   node --experimental-strip-types scripts/generate-jwt-keys.ts
 *
 * Never commit the output. Rotate by generating a new pair and restarting.
 */
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';

const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true });
const escape = (pem: string) => pem.trim().replaceAll('\n', '\\n');

process.stdout.write(`JWT_PRIVATE_KEY="${escape(await exportPKCS8(privateKey))}"\n`);
process.stdout.write(`JWT_PUBLIC_KEY="${escape(await exportSPKI(publicKey))}"\n`);
