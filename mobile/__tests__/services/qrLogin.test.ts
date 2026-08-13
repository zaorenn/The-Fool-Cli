import { parseQrLoginUrl, qrLoginBody, qrLoginEndpoint } from '../../src/services/qrLogin';

describe('parseQrLoginUrl', () => {
  it('takes apart a code the desktop built', () => {
    expect(parseQrLoginUrl('http://192.168.1.40:25809/qr-login?token=abc123')).toEqual({
      host: '192.168.1.40',
      port: '25809',
      qrToken: 'abc123',
    });
  });

  it('assumes the packaged port when the address carries none', () => {
    expect(parseQrLoginUrl('http://192.168.1.40/qr-login?token=abc123')?.port).toBe('25808');
  });

  it('refuses a URL that is not a login code', () => {
    expect(parseQrLoginUrl('http://192.168.1.40:25809/settings?token=abc123')).toBeNull();
  });

  it('refuses a login code carrying no token', () => {
    expect(parseQrLoginUrl('http://192.168.1.40:25809/qr-login')).toBeNull();
  });

  it('refuses text that is not a URL at all', () => {
    expect(parseQrLoginUrl('not a url')).toBeNull();
  });
});

describe('qrLoginBody', () => {
  /**
   * The backend's `QrLoginRequest` derives Deserialize with no rename rule, and
   * its own test asserts that `{"qrToken": ...}` fails to deserialise. This
   * test is that contract restated on the side that has to honour it.
   */
  it('spells the token the way the server reads it', () => {
    expect(qrLoginBody('abc123')).toEqual({ qr_token: 'abc123' });
  });

  it('does not send the camelCase key the server rejects', () => {
    expect(qrLoginBody('abc123')).not.toHaveProperty('qrToken');
  });
});

describe('qrLoginEndpoint', () => {
  it('addresses the route the static server proxies', () => {
    expect(qrLoginEndpoint('192.168.1.40', '25809')).toBe('http://192.168.1.40:25809/api/auth/qr-login');
  });
});
