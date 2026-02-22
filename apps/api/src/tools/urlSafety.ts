import { isIP } from 'node:net';
import dns from 'node:dns/promises';

const PRIVATE_IP_RANGES = [
  /^127\./, // loopback
  /^10\./, // class A private
  /^172\.(1[6-9]|2\d|3[01])\./, // class B private
  /^192\.168\./, // class C private
  /^169\.254\./, // link-local
  /^0\./, // current network
  /^::1$/, // IPv6 loopback
  /^fc00:/i, // IPv6 ULA
  /^fe80:/i, // IPv6 link-local
  /^fd/i, // IPv6 ULA
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((range) => range.test(ip));
}

async function checkSsrf(hostname: string): Promise<void> {
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`Blocked: "${hostname}" resolves to a private/internal IP address.`);
    }
    return;
  }

  try {
    const addresses = await dns.resolve4(hostname);
    for (const addr of addresses) {
      if (isPrivateIp(addr)) {
        throw new Error(`Blocked: "${hostname}" resolves to private IP ${addr}.`);
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOTFOUND') {
      throw new Error(`DNS lookup failed for "${hostname}".`);
    }
    // For other DNS errors, allow the request. The caller fetch/post will fail naturally.
  }
}

export async function assertPublicHttpUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported protocol: ${parsed.protocol}. Only http/https allowed.`);
  }
  await checkSsrf(parsed.hostname);
  return parsed;
}
