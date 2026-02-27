import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, initializeFirestore, type Firestore } from 'firebase/firestore';
import { getDatabase, type Database } from 'firebase/database';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import { getFunctions, type Functions } from 'firebase/functions';
import { firebaseConfig } from './config';

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let rtdb: Database;
let storage: FirebaseStorage;
let functions: Functions;

export function initFirebase() {
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  auth = getAuth(app);
  // experimentalForceLongPolling bypasses QUIC (UDP) which causes ERR_QUIC_PROTOCOL_ERROR
  // noise in some network environments. Long-polling over TCP is slightly higher latency
  // but reliable everywhere.
  db = initializeFirestore(app, { experimentalForceLongPolling: true });
  rtdb = getDatabase(app);
  storage = getStorage(app);
  functions = getFunctions(app);
  return { app, auth, db, rtdb, storage, functions };
}

export function getFirebaseApp() {
  if (!app) initFirebase();
  return app;
}

export function getFirebaseAuth() {
  if (!auth) initFirebase();
  return auth;
}

export function getFirebaseDb() {
  if (!db) initFirebase();
  return db;
}

export function getFirebaseRtdb() {
  if (!rtdb) initFirebase();
  return rtdb;
}

export function getFirebaseStorage() {
  if (!storage) initFirebase();
  return storage;
}

export function getFirebaseFunctions() {
  if (!functions) initFirebase();
  return functions;
}
