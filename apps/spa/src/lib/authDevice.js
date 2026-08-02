import { authApi, ApiError } from './api.js';

const DB_NAME = 'misu-device-auth';
const STORE_NAME = 'credentials';
const KEY = 'current';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function storedCredential() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME);
    const r = tx.objectStore(STORE_NAME).get(KEY);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  }).finally(() => db.close());
}

async function saveCredential(cred) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(cred, KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

export async function clearCredential() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

function bytesToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function deviceName() {
  const ua = navigator.userAgent;
  const host = /MicroMessenger/i.test(ua)
    ? 'WeChat'
    : /Edg\//.test(ua)
      ? 'Edge'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : /Firefox\//.test(ua)
            ? 'Firefox'
            : 'Browser';
  const platform = navigator.userAgentData?.platform || navigator.platform || 'device';
  return `${host} on ${platform}`.slice(0, 191);
}

export function credentialSupportIssue(browser = window) {
  if (!browser.isSecureContext) {
    return 'Device sign-in requires HTTPS on iPhone and other phones. Open this site using a trusted HTTPS URL.';
  }
  if (!browser.crypto?.subtle) {
    return 'This browser does not provide the Web Crypto API required for device sign-in.';
  }
  if (!browser.indexedDB) {
    return 'This browser does not provide the secure local storage required for device sign-in.';
  }
  return null;
}

export function credentialSupported() {
  return credentialSupportIssue() === null;
}

export async function generateCredential() {
  const supportIssue = credentialSupportIssue();
  if (supportIssue) throw new Error(supportIssue);
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify']
  );
  const pubRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const cred = {
    credentialId: crypto.randomUUID(),
    privateKey: keyPair.privateKey,
    deviceName: deviceName()
  };
  await saveCredential(cred);
  return {
    local: cred,
    request: {
      credential_id: cred.credentialId,
      public_key: bytesToBase64(pubRaw),
      device_name: cred.deviceName
    }
  };
}

export async function signChallenge(cred, challengeText) {
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cred.privateKey,
    new TextEncoder().encode(challengeText)
  );
  return bytesToBase64(sig);
}

export async function trySilentLogin() {
  const cred = await storedCredential();
  if (!cred) return null;
  let deviceVerified = false;
  try {
    const challenge = await authApi.challenge(cred.credentialId);
    const signature = await signChallenge(cred, challenge.challenge);
    await authApi.verify(challenge.challenge_id, signature);
    deviceVerified = true;
    const current = await authApi.me();
    return current.user ?? current;
  } catch (err) {
    if (!deviceVerified && err instanceof ApiError && err.status === 401) {
      await clearCredential().catch(() => {});
    }
    return null;
  }
}
