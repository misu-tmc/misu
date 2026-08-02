import { describe, expect, it } from 'vitest';
import { credentialSupportIssue } from './authDevice.js';

describe('credentialSupportIssue', () => {
  it('explains that an insecure phone origin needs HTTPS', () => {
    expect(credentialSupportIssue({ isSecureContext: false })).toMatch(/requires HTTPS/);
  });

  it('accepts a secure browser with crypto and IndexedDB', () => {
    expect(credentialSupportIssue({
      isSecureContext: true,
      crypto: { subtle: {} },
      indexedDB: {}
    })).toBeNull();
  });
});