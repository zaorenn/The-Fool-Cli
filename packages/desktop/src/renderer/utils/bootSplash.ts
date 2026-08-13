/**
 * Retires the boot splash declared in `index.html`.
 *
 * The splash is a plain element in the document so it paints on the first frame,
 * before the bundle is parsed. It sits at `z-index: 9999` over the whole
 * viewport, so until it is removed it *is* the app as far as anyone looking at
 * the window is concerned.
 */

/** How long to wait for the two-frame path before dismissing regardless. */
const RAF_FALLBACK_MS = 1000;

/** How long the leaving transition is given before the node is removed anyway. */
const TRANSITION_FALLBACK_MS = 600;

export const dismissBootSplash = (doc: Document = document): void => {
  const splash = doc.getElementById('boot-splash');
  if (!splash) return;

  let dismissed = false;

  const dismiss = (): void => {
    if (dismissed) return;
    dismissed = true;

    splash.classList.add('boot-splash--leaving');
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
    // The transition does not fire if the element is not being rendered.
    setTimeout(() => splash.remove(), TRANSITION_FALLBACK_MS);
  };

  // Wait two frames so React's first paint is already on screen — dismissing on
  // mount alone can expose a blank window for a frame.
  requestAnimationFrame(() => {
    requestAnimationFrame(dismiss);
  });

  // requestAnimationFrame does not fire while the window is not producing
  // frames: minimised, occluded, on another virtual desktop, started into the
  // tray, or a background browser tab in WebUI mode. The two-frame wait would
  // then never resolve and the splash would cover the mounted app until the
  // window happened to be shown — indistinguishable from a hang, and the app
  // underneath is fully loaded and interactive the whole time.
  setTimeout(dismiss, RAF_FALLBACK_MS);
};
