import { bytesToHex, concatBytes, hexToBytes, type Hex } from "viem";

/**
 * Optional gift message, encrypted with a key derived from the link secret before it is
 * stored on-chain. Chain data is public; this way only people holding the link can read it.
 *
 * Format: 12-byte IV || AES-256-GCM ciphertext (+16-byte tag).
 */
export const MAX_MESSAGE_CHARS = 200;
const INFO = new TextEncoder().encode("arcgift:message:v1");

async function deriveKey(linkKey: Hex): Promise<CryptoKey> {
  const material = new Uint8Array(concatBytes([INFO, hexToBytes(linkKey)]));
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptMessage(linkKey: Hex, text: string): Promise<Hex> {
  const trimmed = text.trim();
  if (!trimmed) return "0x";
  if ([...trimmed].length > MAX_MESSAGE_CHARS) throw new Error(`Message is longer than ${MAX_MESSAGE_CHARS} characters`);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await deriveKey(linkKey),
    new TextEncoder().encode(trimmed),
  );
  return bytesToHex(concatBytes([iv, new Uint8Array(cipher)]));
}

/** Returns null if there is no message or it can't be decrypted with this key. */
export async function decryptMessage(linkKey: Hex, payload: Hex): Promise<string | null> {
  const bytes = hexToBytes(payload);
  if (bytes.length <= 12) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12) },
      await deriveKey(linkKey),
      bytes.slice(12),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
