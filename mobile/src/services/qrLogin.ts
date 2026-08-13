/**
 * What a scanned QR code means, and what to send back for it.
 *
 * Kept out of the screen that runs the camera so the contract can be stated
 * once and tested without React or a device. Its counterpart on the desktop
 * (`common/config/qrLoginUrl.ts`) builds the URL this reads; the two are the
 * two halves of one agreement, and the halves drifted apart unnoticed because
 * nothing on this side ever asserted the server's spelling.
 *
 * The drift was `qrToken`. The backend deserialises the login body with serde
 * and declares no rename rule, so the only key it accepts is `qr_token`; a
 * camelCase key is a missing field. That is not an edge case — it is every
 * scan, and it fails before the token is ever looked at, so the error says
 * nothing about QR codes.
 */

/** A scanned code that named a reachable server, taken apart. */
export type ScannedQrLogin = {
  host: string;
  port: string;
  /** The one-time token the desktop minted for this code. */
  qrToken: string;
};

/**
 * The port to assume when the code carries none.
 *
 * Matches the packaged desktop's production port. A QR built by the desktop
 * always carries an explicit port, so this only covers a hand-typed address.
 */
const DEFAULT_PORT = '25808';

/**
 * The parts of a QR login URL, or null when it is not one.
 *
 * Refuses rather than guessing: a code from some other application should send
 * the person back to the scanner, not produce a request to a random host.
 */
export const parseQrLoginUrl = (data: string): ScannedQrLogin | null => {
  try {
    const url = new URL(data);
    if (url.pathname !== '/qr-login') return null;
    const qrToken = url.searchParams.get('token');
    if (!qrToken) return null;
    return { host: url.hostname, port: url.port || DEFAULT_PORT, qrToken };
  } catch {
    return null;
  }
};

/** Where to POST the scanned token. */
export const qrLoginEndpoint = (host: string, port: string): string =>
  `http://${host}:${port}/api/auth/qr-login`;

/**
 * The request body, spelled the way the server reads it.
 *
 * The snake_case key is the whole point of this function existing.
 */
export const qrLoginBody = (qrToken: string): { qr_token: string } => ({ qr_token: qrToken });
