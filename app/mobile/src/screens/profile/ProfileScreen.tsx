import { View, Text, TouchableOpacity, StyleSheet, Switch } from 'react-native';
import { useState } from 'react';
import { useAuth } from '@maskord/shared';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ProfileScreen() {
  const { profile, logOut } = useAuth();
  const [status, setStatus] = useState<'online' | 'idle' | 'dnd'>('online');

  if (!profile) return null;

  const initials = profile.displayName.substring(0, 2).toUpperCase();

  const STATUS_COLORS = { online: '#22c55e', idle: '#f59e0b', dnd: '#ef4444' };
  const STATUS_LABELS = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb' };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        {/* Avatar */}
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[status] }]} />
        </View>

        <Text style={styles.displayName}>{profile.displayName}</Text>
        <Text style={styles.email}>{profile.email}</Text>
      </View>

      {/* Status */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>STATUS</Text>
        {(['online', 'idle', 'dnd'] as const).map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.statusRow, status === s && styles.statusRowActive]}
            onPress={() => setStatus(s)}
          >
            <View style={[styles.statusBullet, { backgroundColor: STATUS_COLORS[s] }]} />
            <Text style={styles.statusLabel}>{STATUS_LABELS[s]}</Text>
            {status === s && <Text style={styles.check}>✓</Text>}
          </TouchableOpacity>
        ))}
      </View>

      {/* Masks section — future masky.ai */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>MY MASKS</Text>
        <View style={styles.masksPlaceholder}>
          <Text style={styles.masksEmoji}>🎭</Text>
          <Text style={styles.masksText}>
            Mask management with masky.ai is coming soon.
          </Text>
        </View>
      </View>

      {/* Sign out */}
      <TouchableOpacity style={styles.signOutButton} onPress={logOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#0a0a0f' },
  header:           { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: '#1e1e2e' },
  avatarContainer:  { position: 'relative', marginBottom: 12 },
  avatar:           { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(124,58,237,0.3)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(124,58,237,0.5)' },
  avatarText:       { color: '#a78bfa', fontWeight: '700', fontSize: 28 },
  statusDot:        { position: 'absolute', bottom: 2, right: 2, width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#0a0a0f' },
  displayName:      { color: '#ffffff', fontWeight: '700', fontSize: 22, marginBottom: 4 },
  email:            { color: '#6b7280', fontSize: 13 },
  section:          { padding: 16 },
  sectionTitle:     { color: '#6b7280', fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8 },
  statusRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10, marginBottom: 4 },
  statusRowActive:  { backgroundColor: '#1e1e2e' },
  statusBullet:     { width: 10, height: 10, borderRadius: 5 },
  statusLabel:      { color: '#e2e8f0', fontSize: 15, flex: 1 },
  check:            { color: '#7c3aed', fontWeight: '700' },
  masksPlaceholder: { backgroundColor: '#0e0e16', borderRadius: 12, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: '#1e1e2e', gap: 8 },
  masksEmoji:       { fontSize: 32 },
  masksText:        { color: '#6b7280', textAlign: 'center', fontSize: 13, lineHeight: 20 },
  signOutButton:    { margin: 24, backgroundColor: 'rgba(220,38,38,0.1)', borderWidth: 1, borderColor: 'rgba(220,38,38,0.3)', borderRadius: 12, padding: 14, alignItems: 'center' },
  signOutText:      { color: '#f87171', fontWeight: '600', fontSize: 15 },
});
