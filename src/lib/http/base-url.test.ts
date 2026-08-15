import { afterEach, describe, expect, it } from 'vitest';
import { getBaseUrl } from './base-url';

function req(
  headers: Record<string, string> = {},
  url = 'https://ignored.example/x'
) {
  return new Request(url, { headers });
}

const ENV_KEYS = ['NEXT_PUBLIC_SITE_URL', 'ALLOWED_INVITE_HOSTS'] as const;

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe('getBaseUrl', () => {
  it('prefers NEXT_PUBLIC_SITE_URL when set, trailing slash stripped', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://my-crm.example/';
    expect(getBaseUrl(req({ host: 'ignored.example' }))).toBe(
      'https://my-crm.example'
    );
  });

  it('falls back to X-Forwarded-Host/Proto when no explicit site URL is set', () => {
    expect(
      getBaseUrl(
        req({
          'x-forwarded-host': 'app.example.com',
          'x-forwarded-proto': 'https',
        })
      )
    ).toBe('https://app.example.com');
  });

  it('defaults X-Forwarded-Proto to https when absent', () => {
    expect(getBaseUrl(req({ 'x-forwarded-host': 'app.example.com' }))).toBe(
      'https://app.example.com'
    );
  });

  it('falls back to the bare Host header + request protocol', () => {
    expect(
      getBaseUrl(req({ host: 'bare.example.com' }, 'http://bare.example.com/x'))
    ).toBe('http://bare.example.com');
  });

  it('falls back to the marketing domain when no host information is present', () => {
    expect(getBaseUrl(req({}))).toBe('https://wacrm.tech');
  });

  it('rejects a forwarded host not on ALLOWED_INVITE_HOSTS and falls back', () => {
    process.env.ALLOWED_INVITE_HOSTS = 'app.example.com,other.example.com';
    expect(
      getBaseUrl(
        req({
          'x-forwarded-host': 'phishing.example',
          host: 'phishing.example',
        })
      )
    ).toBe('https://wacrm.tech');
  });

  it('accepts a forwarded host that is on ALLOWED_INVITE_HOSTS', () => {
    process.env.ALLOWED_INVITE_HOSTS = 'app.example.com';
    expect(getBaseUrl(req({ 'x-forwarded-host': 'app.example.com' }))).toBe(
      'https://app.example.com'
    );
  });

  it('ALLOWED_INVITE_HOSTS check is case-insensitive', () => {
    process.env.ALLOWED_INVITE_HOSTS = 'App.Example.com';
    expect(getBaseUrl(req({ 'x-forwarded-host': 'app.example.com' }))).toBe(
      'https://app.example.com'
    );
  });

  it('NEXT_PUBLIC_SITE_URL bypasses the allow-list entirely', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://explicit.example';
    process.env.ALLOWED_INVITE_HOSTS = 'somewhere-else.example';
    expect(getBaseUrl(req({ host: 'attacker.example' }))).toBe(
      'https://explicit.example'
    );
  });
});
