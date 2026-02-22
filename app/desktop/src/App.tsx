import { useEffect } from 'react';
import { useAuth, usePresence } from '@maskord/shared';
import { useAppStore } from './store/app';
import AuthScreen from './components/auth/AuthScreen';
import MainLayout from './components/MainLayout';
import LoadingScreen from './components/ui/LoadingScreen';

export default function App() {
  const { firebaseUser, profile, loading } = useAuth();
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);

  useEffect(() => {
    setCurrentUser(profile);
  }, [profile, setCurrentUser]);

  // Register presence
  usePresence(firebaseUser?.uid ?? null);

  if (loading) return <LoadingScreen />;
  if (!firebaseUser || !profile) return <AuthScreen />;

  return <MainLayout />;
}
