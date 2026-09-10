const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the entire workspace so Metro can resolve @maskord/shared
config.watchFolders = [workspaceRoot];

// Resolve node_modules from both the mobile app and the workspace root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Firebase 12's umbrella `firebase` package does NOT have a `react-native`
// export condition for its sub-entries (firebase/auth, firebase/app, etc.).
// Metro falls back to the `default`/`browser` ESM build which re-exports from
// @firebase/*, but the chained resolution of @firebase/* doesn't always pick
// up the `react-native` build correctly, causing:
//   "Component auth has not been registered yet"
//
// Fix: explicitly map each firebase/* sub-entry to its @firebase/* counterpart
// using the known react-native build path. Packages without a dedicated RN
// build (database, functions, storage) use their CJS browser build which
// works fine in React Native.
const mobileRoot = path.resolve(projectRoot, 'node_modules');
const firebaseRoot = path.resolve(workspaceRoot, 'node_modules');
const FIREBASE_RN_MAP = {
  'firebase/app':       path.join(firebaseRoot, '@firebase/app/dist/index.cjs.js'),
  'firebase/auth':      path.join(firebaseRoot, '@firebase/auth/dist/rn/index.js'),
  'firebase/firestore': path.join(firebaseRoot, '@firebase/firestore/dist/index.rn.js'),
  'firebase/database':  path.join(firebaseRoot, '@firebase/database/dist/index.cjs.js'),
  'firebase/functions': path.join(firebaseRoot, '@firebase/functions/dist/index.cjs.js'),
  'firebase/storage':   path.join(firebaseRoot, '@firebase/storage/dist/index.cjs.js'),
};

// The workspace root (../../node_modules) also has React 18 installed (for
// app/desktop). When Metro resolves imports from within @maskord/shared it
// walks up the directory tree and can find the workspace-root React 18 before
// the mobile-app React 19, producing a "duplicate React" hook error.
// Force react, react-native, and scheduler to always resolve to the single
// copy inside the mobile app's own node_modules.
const SINGLE_COPY_MODULES = ['react', 'react-dom', 'react-native', 'scheduler'];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Pin Firebase sub-packages to their React Native builds
  if (platform === 'ios' || platform === 'android') {
    const override = FIREBASE_RN_MAP[moduleName];
    if (override) {
      return { filePath: override, type: 'sourceFile' };
    }
  }
  // Ensure only one copy of React (and friends) is used across the whole bundle
  if (SINGLE_COPY_MODULES.includes(moduleName)) {
    return context.resolveRequest(
      { ...context, originModulePath: mobileRoot },
      moduleName,
      platform,
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
