import { describe, expect, it } from 'vitest';
import { shouldUsePersistentCache } from '../lib/utils/browserSupport';

const IPAD_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1';
const MAC_SAFARI = IPAD_SAFARI;
const WIN_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0';

describe('shouldUsePersistentCache', () => {
  it('iPad (mengaku Macintosh, layar sentuh) dan iPhone memakai cache memori', () => {
    expect(shouldUsePersistentCache(IPAD_SAFARI, 'MacIntel', 5)).toBe(false);
    expect(shouldUsePersistentCache(IPHONE_SAFARI, 'iPhone', 5)).toBe(false);
  });
  it('Chrome di iOS (tetap WebKit) memakai cache memori', () => {
    expect(shouldUsePersistentCache(IOS_CHROME, 'iPhone', 5)).toBe(false);
  });
  it('Safari desktop memakai cache memori', () => {
    expect(shouldUsePersistentCache(MAC_SAFARI, 'MacIntel', 0)).toBe(false);
  });
  it('Chrome desktop/Android dan Firefox tetap cache persisten (offline penuh)', () => {
    expect(shouldUsePersistentCache(WIN_CHROME, 'Win32', 0)).toBe(true);
    expect(shouldUsePersistentCache(ANDROID_CHROME, 'Linux armv8l', 5)).toBe(true);
    expect(shouldUsePersistentCache(FIREFOX, 'Win32', 0)).toBe(true);
  });
  it('UA kosong (lingkungan tak dikenal) tetap persisten', () => {
    expect(shouldUsePersistentCache('')).toBe(true);
  });
});
