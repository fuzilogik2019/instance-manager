import { promisify } from 'util';
import { generateKeyPair as generateKeyPairCrypto } from 'crypto';

const generateKeyPairAsync = promisify(generateKeyPairCrypto);

export async function generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  try {
    const { publicKey, privateKey } = await generateKeyPairAsync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });

    // Convert to OpenSSH format for the public key
    const publicKeyBase64 = publicKey
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/\s/g, '');

    const opensshPublicKey = `ssh-rsa ${publicKeyBase64}`;

    return {
      publicKey: opensshPublicKey,
      privateKey,
    };
  } catch (error) {
    console.error('Failed to generate key pair:', error);
    throw new Error('Failed to generate SSH key pair');
  }
}

export function validatePublicKey(publicKey: string): boolean {
  const sshKeyRegex = /^(ssh-rsa|ssh-dss|ssh-ed25519|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521) [A-Za-z0-9+\/]+=*( .*)?$/;
  return sshKeyRegex.test(publicKey.trim());
}