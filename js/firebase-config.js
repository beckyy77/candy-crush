'use strict';

/* ============================================================
   Dolly Crush Saga — Versus mode configuration ⚔️
   ------------------------------------------------------------
   1. Create a free Firebase project (see FIREBASE-SETUP.md)
   2. Enable Realtime Database + Anonymous auth
   3. Paste your web app's config below (databaseURL included!)
   ============================================================ */

window.FIREBASE_CONFIG = {
  apiKey:            "PASTE_YOUR_API_KEY",
  authDomain:        "YOUR-PROJECT.firebaseapp.com",
  databaseURL:       "https://YOUR-PROJECT-default-rtdb.firebaseio.com",
  projectId:         "YOUR-PROJECT",
  appId:             "PASTE_YOUR_APP_ID",
};

// true when the config has been filled in with real values
window.FIREBASE_ENABLED = function () {
  const c = window.FIREBASE_CONFIG || {};
  return typeof c.apiKey === 'string' && !c.apiKey.includes('PASTE')
      && !String(c.databaseURL || '').includes('YOUR-PROJECT')
      && String(c.databaseURL || '').startsWith('https://')
      && !String(c.projectId || '').includes('YOUR-PROJECT');
};
