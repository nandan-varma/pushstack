/**
 * The pre-paint theme script.
 *
 * It is inlined into the document rather than served as a file because a fetch
 * would land after first paint and flash the wrong theme, and it is a
 * build-time constant so the Content-Security-Policy can allow this exact
 * script by hash (see src/server/csp.ts) instead of allowing every inline
 * script in the document.
 *
 * Kept in its own module — with no imports — so both the root document
 * (`src/routes/__root.tsx`) and the policy builder read the same string, and
 * the hash can't drift from what is rendered.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;
