// Fill this in from the Firebase console, then redeploy. See SETUP-FIREBASE.md.
//
// Until projectId is set, the album runs in LOCAL mode: uploads persist in this
// browser only and are not shared with anyone. The app works either way — nothing
// here is required for the trip plan itself.
window.CHI_PHOTO_CONFIG = {
  // Firebase console -> Project settings -> General -> "Your apps" -> Web app -> Config
  firebase: {
    apiKey: 'AIzaSyD5E2q7TvkiBzNU8-McUe-M9fa6nhcPK04',
    authDomain: 'gen-lang-client-0060007004.firebaseapp.com',
    // The bare project slug — no domain suffix. (Pasting the authDomain here is the
    // easy slip; it makes every Firestore URL malformed and all reads/writes fail.)
    projectId: 'gen-lang-client-0060007004',
    storageBucket: 'gen-lang-client-0060007004.firebasestorage.app',
    messagingSenderId: '1068738075454',
    appId: '1:1068738075454:web:cb33ffee7883a026c7ea6f',
    measurementId: 'G-5G74K25N40'   // Analytics only; nothing here uses it
  },

  // Which Firestore database inside the project. Firebase defaults to the one
  // literally named '(default)'; this project's is a named database instead, so it
  // has to be passed explicitly. Getting this wrong fails in a nasty way — the SDK
  // serves reads from an empty local cache and parks writes in its offline queue,
  // so nothing errors, photos just silently never persist.
  databaseId: 'chicagophotos',

  // The code the four of you type once per device to unlock uploading.
  // This gates the UI. It is visible to anyone who reads the page source, so treat
  // it as a "keep honest people out" latch, not a security boundary.
  passcode: 'stem26',

  // Safety rails, mirrored in firestore.rules / storage.rules where they can be
  // enforced for real.
  maxPerDay: 40,

  // Cap on the STORED file, checked after the photo is downscaled to 1400px WebP and
  // mirrored in storage.rules where it is enforced for real. A 12MP phone photo
  // lands at roughly 20-650KB, so this is a backstop rather than a limit you'll meet.
  maxUploadBytes: 4 * 1024 * 1024,

  // Cap on the file the picker hands over, before decoding. Deliberately generous:
  // it exists to refuse a video or a giant scan, not to refuse a phone photo.
  maxInputBytes: 40 * 1024 * 1024
};
