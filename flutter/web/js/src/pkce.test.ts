import { describe, expect, test } from 'vitest';
import { randomVerifier, s256Challenge } from './pkce';

describe('pkce', () => {
  test('S256 matches RFC 7636 appendix B', async () => {
    expect(await s256Challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  test('verifiers are 64 url-safe characters and differ', () => {
    const a = randomVerifier();
    expect(a).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(randomVerifier()).not.toBe(a);
  });
});
