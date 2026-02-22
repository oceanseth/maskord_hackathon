import { useState, useEffect } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { getFirebaseAuth, getFirebaseDb } from '../firebase/init';
import type { User } from '../types';

export interface AuthState {
  firebaseUser: FirebaseUser | null;
  profile: User | null;
  loading: boolean;
  error: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    firebaseUser: null,
    profile: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const auth = getFirebaseAuth();
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        const profile = await fetchOrCreateProfile(fbUser);
        setState({ firebaseUser: fbUser, profile, loading: false, error: null });
      } else {
        setState({ firebaseUser: null, profile: null, loading: false, error: null });
      }
    });
    return unsubscribe;
  }, []);

  async function signIn(email: string, password: string) {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Sign in failed';
      setState((s) => ({ ...s, loading: false, error: msg }));
    }
  }

  async function signInWithGoogle() {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(getFirebaseAuth(), provider);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Google sign in failed';
      setState((s) => ({ ...s, loading: false, error: msg }));
    }
  }

  async function register(email: string, password: string, displayName: string) {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { user } = await createUserWithEmailAndPassword(
        getFirebaseAuth(),
        email,
        password,
      );
      await updateProfile(user, { displayName });
      await createUserProfile(user, displayName);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Registration failed';
      setState((s) => ({ ...s, loading: false, error: msg }));
    }
  }

  async function logOut() {
    await signOut(getFirebaseAuth());
  }

  return { ...state, signIn, signInWithGoogle, register, logOut };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchOrCreateProfile(fbUser: FirebaseUser): Promise<User> {
  const db = getFirebaseDb();
  const ref = doc(db, 'users', fbUser.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    return { id: snap.id, ...snap.data() } as User;
  }

  return createUserProfile(fbUser, fbUser.displayName ?? 'User');
}

async function createUserProfile(fbUser: FirebaseUser, displayName: string): Promise<User> {
  const db = getFirebaseDb();
  const ref = doc(db, 'users', fbUser.uid);
  const profile: Omit<User, 'id'> = {
    displayName,
    email: fbUser.email ?? '',
    avatarUrl: fbUser.photoURL ?? '',
    bio: '',
    status: 'online',
    createdAt: serverTimestamp() as ReturnType<typeof serverTimestamp> as never,
    masks: [],
  };
  await setDoc(ref, profile, { merge: true });
  return { id: fbUser.uid, ...profile } as unknown as User;
}
