const LOAD_TIMEOUT = 3000;
const FADE_MS = 150;
const PET_STATES_BASE_PATH = '../pet-states';
let currentObject: HTMLObjectElement | null = document.getElementById('pet') as HTMLObjectElement;

function getStateAssetPath(state: string): string {
  return `${PET_STATES_BASE_PATH}/${state}.svg`;
}

function setupTransitions(_target: HTMLObjectElement | null): void {
  // Intentionally empty: eye tracking now writes SVG `transform` attributes on
  // the .idle-pupil / .idle-track wrappers (see onEyeMove below), which are
  // not affected by CSS `transition` — that property only animates CSS
  // transforms. Smoothing comes from the tick rate, not from CSS transitions.
}

/**
 * Load a new SVG state and cross-fade it over the previous one. The old object
 * is removed only after the fade completes, so there's no white flash between
 * states. If the new SVG fails to load within LOAD_TIMEOUT we bail out silently
 * and keep showing the previous state.
 */
function loadSvg(svgPath: string): void {
  const newObj = document.createElement('object');
  newObj.type = 'image/svg+xml';
  newObj.id = 'pet';
  newObj.style.position = 'absolute';
  newObj.style.inset = '0';
  newObj.style.width = '100%';
  newObj.style.height = '100%';
  newObj.style.opacity = '0';
  newObj.style.transition = `opacity ${FADE_MS}ms ease-out`;
  newObj.data = svgPath;

  let loaded = false;
  const timeout = setTimeout(() => {
    if (!loaded) {
      newObj.remove();
    }
  }, LOAD_TIMEOUT);

  newObj.addEventListener('load', () => {
    loaded = true;
    clearTimeout(timeout);
    setupTransitions(newObj);

    const oldObj = currentObject;
    // Clear the old id immediately so duplicate #pet selectors (from CSS and
    // setupTransitions' query) never see two elements at once during the fade.
    if (oldObj) oldObj.removeAttribute('id');
    currentObject = newObj;

    // Trigger the fade on the next frame so the browser has painted the
    // initial opacity:0 state — otherwise the transition is skipped and the
    // swap is instant.
    requestAnimationFrame(() => {
      newObj.style.opacity = '1';
      if (oldObj) oldObj.style.opacity = '0';
    });

    // Remove the old object after the cross-fade completes. Keep a reference
    // via closure so we don't race with another state change in the meantime.
    if (oldObj) {
      setTimeout(() => {
        oldObj.remove();
      }, FADE_MS);
    }
  });

  document.body.appendChild(newObj);
}

// The initial SVG is hard-coded in pet.html without any transition setup or
// positioning — mirror the runtime swap target so subsequent cross-fades work
// and eye/body transforms animate from the start.
if (currentObject) {
  currentObject.style.position = 'absolute';
  currentObject.style.inset = '0';
  currentObject.style.transition = `opacity ${FADE_MS}ms ease-out`;
  currentObject.addEventListener('load', () => {
    setupTransitions(currentObject);
  });
}

window.petAPI.onStateChange((state: string) => {
  loadSvg(getStateAssetPath(state));
});

window.petAPI.onEyeMove(({ eyeDx, eyeDy, bodyDx, bodyRotate }) => {
  if (!currentObject) return;
  const doc = currentObject.contentDocument;
  if (!doc) return;

  // Target the dedicated wrapper groups (.pet-pupil and .pet-track) rather than
  // the animated .pet-eye / .pet-body. Those already have CSS keyframes running
  // — writing style.transform to them gets overwritten every frame, so tracking
  // becomes invisible. The wrappers have no animation of their own, so their SVG
  // transform attributes stick. Using setAttribute (not style) because SVG
  // transform attributes and CSS transforms are separate channels in SVG — the
  // attribute stacks on top of the descendant's CSS animation without
  // overwriting it.
  //
  // The names are shared by every state's artwork, so tracking works in each
  // pose rather than only in idle.
  const pupil = doc.querySelector('.pet-pupil') as SVGGElement | null;
  const track = doc.querySelector('.pet-track') as SVGGElement | null;

  if (pupil) pupil.setAttribute('transform', `translate(${eyeDx} ${eyeDy})`);
  // rotate(angle cx cy) — rotation center is pinned to (11,12) in SVG units,
  // which is the head center for the idle pose.
  if (track) track.setAttribute('transform', `translate(${bodyDx} 0) rotate(${bodyRotate} 11 12)`);
});

// ── the voice stage label ────────────────────────────────────────────────────
// The pose says what is happening; this says it in words. Both come from the
// same event, so they cannot disagree.
const stageLabel = document.getElementById('stage');

window.petAPI.onVoiceStage(({ stage, stageLabel: text, notice, accent }) => {
  if (!stageLabel) return;
  // A notice takes the bubble: it exists precisely because the stage word would
  // not explain the wait. It also shows with the loop off, which is how a
  // read-aloud press can say it is loading a model with no session running.
  const message = notice || text;
  const live = notice.length > 0 || (stage !== 'off' && text.length > 0);
  stageLabel.textContent = message;
  stageLabel.style.setProperty('--stage-accent', accent || '#c4123f');
  stageLabel.classList.toggle('shown', live);
});
