// Inverse of base64url(). Throws on characters outside the base64url alphabet.
export function fromBase64url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/u.test(text)) {
    throw new TypeError("not base64url");
  }
  const padded = text.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (text.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
