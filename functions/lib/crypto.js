// Password hashing and token generation using the Workers-native Web Crypto
// API only — no external dependencies required.

function bufToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes.buffer;
}

export function newId(prefix = "") {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bufToHex(bytes.buffer);
}

async function pbkdf2(password, saltBuf, iterations = 100000) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBuf, iterations, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return bufToHex(bits);
}

export async function hashPassword(password) {
  const saltBuf = crypto.getRandomValues(new Uint8Array(16)).buffer;
  const hash = await pbkdf2(password, saltBuf);
  return { hash, salt: bufToHex(saltBuf) };
}

export async function verifyPassword(password, hash, saltHex) {
  const saltBuf = hexToBuf(saltHex);
  const candidate = await pbkdf2(password, saltBuf);
  // constant-time-ish comparison
  if (candidate.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  return diff === 0;
}
