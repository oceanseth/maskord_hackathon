import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Image, ActivityIndicator,
} from 'react-native';
import { useAuth } from '@maskord/shared';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMaskyAvatars, type MaskyAvatarGroup } from '../../hooks/useMaskyAvatars';

export default function ProfileScreen() {
  const { profile, firebaseUser, logOut } = useAuth();

  const { avatarGroups, loading: avatarsLoading, selectedId, setSelected } =
    useMaskyAvatars(firebaseUser?.uid ?? null);

  if (!profile) return null;

  const initials = profile.displayName.substring(0, 2).toUpperCase();
  const selectedAvatar = avatarGroups.find((g) => g.id === selectedId);
  const userAvatarUrl = profile.avatarUrl ?? '';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.avatarContainer}>
            {selectedAvatar?.thumbnailUrl || userAvatarUrl ? (
              <Image
                source={{ uri: selectedAvatar?.thumbnailUrl || userAvatarUrl }}
                style={styles.avatarImage}
              />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
            )}
            {selectedAvatar && (
              <View style={styles.maskBadge}>
                <Text style={styles.maskBadgeText}>🎭</Text>
              </View>
            )}
          </View>

          <Text style={styles.displayName}>{profile.displayName}</Text>
          {selectedAvatar && (
            <Text style={styles.activeMaskLabel}>
              Speaking as{' '}
              <Text style={styles.activeMaskName}>{selectedAvatar.displayName}</Text>
            </Text>
          )}
        </View>

        {/* My Masks */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>MY MASKS</Text>
            {avatarsLoading && avatarGroups.length > 0 && (
              <Text style={styles.updatingLabel}>Updating…</Text>
            )}
          </View>

          {avatarsLoading && avatarGroups.length === 0 ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color="#7c3aed" size="small" />
              <Text style={styles.loadingText}>Loading avatars…</Text>
            </View>
          ) : (
            <View style={styles.maskList}>
              {/* None option */}
              <AvatarOption
                thumbnailUrl={userAvatarUrl || undefined}
                label="None"
                sublabel="Use your real voice without any mask"
                selected={!selectedId}
                onPress={() => setSelected(null)}
              />

              {avatarGroups.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyText}>
                    No avatars found on your masky.ai account.
                  </Text>
                  <Text style={styles.emptyLink}>Create one at masky.ai →</Text>
                </View>
              ) : (
                avatarGroups.map((g) => (
                  <AvatarOption
                    key={g.id}
                    thumbnailUrl={g.thumbnailUrl}
                    label={g.displayName}
                    sublabel={
                      g.personalityPrompt
                        ? g.personalityPrompt.slice(0, 72) +
                          (g.personalityPrompt.length > 72 ? '…' : '')
                        : 'No personality prompt set'
                    }
                    hasVoice={!!g.humeVoiceId}
                    selected={selectedId === g.id}
                    onPress={() => setSelected(g.id)}
                  />
                ))
              )}
            </View>
          )}

          {selectedId && !avatarsLoading && (
            <Text style={styles.activeNote}>
              Mask active — your voice will be reinterpreted as{' '}
              <Text style={styles.activeNoteName}>
                {selectedAvatar?.displayName ?? 'this mask'}
              </Text>{' '}
              in voice channels.
            </Text>
          )}
        </View>

        {/* Sign out */}
        <TouchableOpacity style={styles.signOutButton} onPress={logOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Avatar option row ────────────────────────────────────────────────────────

interface AvatarOptionProps {
  thumbnailUrl?: string;
  label: string;
  sublabel?: string;
  hasVoice?: boolean;
  selected: boolean;
  onPress: () => void;
}

function AvatarOption({ thumbnailUrl, label, sublabel, hasVoice, selected, onPress }: AvatarOptionProps) {
  const initials = label.substring(0, 2).toUpperCase();

  return (
    <TouchableOpacity
      style={[styles.optionRow, selected && styles.optionRowSelected]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Thumbnail */}
      <View style={styles.optionThumb}>
        {thumbnailUrl ? (
          <Image source={{ uri: thumbnailUrl }} style={styles.optionThumbImage} />
        ) : (
          <Text style={styles.optionThumbInitials}>{initials}</Text>
        )}
      </View>

      {/* Info */}
      <View style={styles.optionInfo}>
        <View style={styles.optionLabelRow}>
          <Text
            style={[styles.optionLabel, selected && styles.optionLabelSelected]}
            numberOfLines={1}
          >
            {label}
          </Text>
          {hasVoice && (
            <View style={styles.voiceBadge}>
              <Text style={styles.voiceBadgeText}>Voice</Text>
            </View>
          )}
        </View>
        {sublabel ? (
          <Text style={styles.optionSublabel} numberOfLines={1}>{sublabel}</Text>
        ) : null}
      </View>

      {/* Radio indicator */}
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected && <View style={styles.radioDot} />}
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:           { flex: 1, backgroundColor: '#0a0a0f' },
  scroll:              { paddingBottom: 32 },

  // Header
  header:              { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: '#1e1e2e' },
  avatarContainer:     { position: 'relative', marginBottom: 12 },
  avatarFallback:      { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(124,58,237,0.3)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(124,58,237,0.5)' },
  avatarImage:         { width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: 'rgba(124,58,237,0.5)' },
  avatarText:          { color: '#a78bfa', fontWeight: '700', fontSize: 28 },
  maskBadge:           { position: 'absolute', bottom: 0, right: -4, width: 24, height: 24, borderRadius: 12, backgroundColor: '#0a0a0f', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#1e1e2e' },
  maskBadgeText:       { fontSize: 13 },
  displayName:         { color: '#ffffff', fontWeight: '700', fontSize: 22, marginBottom: 2 },
  activeMaskLabel:     { color: '#6b7280', fontSize: 12, marginBottom: 2 },
  activeMaskName:      { color: '#a78bfa', fontWeight: '600' },

  // Section
  section:             { padding: 16 },
  sectionHeader:       { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 },
  sectionTitle:        { color: '#6b7280', fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  updatingLabel:       { color: '#4b5563', fontSize: 10 },

  // Loading
  loadingBox:          { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, backgroundColor: '#0e0e16', borderRadius: 12, borderWidth: 1, borderColor: '#1e1e2e' },
  loadingText:         { color: '#6b7280', fontSize: 13 },

  // Mask list
  maskList:            { gap: 6 },
  emptyBox:            { backgroundColor: '#0e0e16', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#1e1e2e', gap: 6 },
  emptyText:           { color: '#6b7280', fontSize: 13 },
  emptyLink:           { color: '#a78bfa', fontSize: 13 },

  activeNote:          { marginTop: 10, fontSize: 12, color: '#4b5563', lineHeight: 18 },
  activeNoteName:      { color: '#a78bfa' },

  // Option row
  optionRow:           { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#1e1e2e', backgroundColor: '#0e0e16' },
  optionRowSelected:   { borderColor: 'rgba(124,58,237,0.5)', backgroundColor: 'rgba(124,58,237,0.08)' },
  optionThumb:         { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(124,58,237,0.2)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 },
  optionThumbImage:    { width: 44, height: 44, borderRadius: 22 },
  optionThumbInitials: { color: '#a78bfa', fontWeight: '700', fontSize: 14 },
  optionInfo:          { flex: 1, minWidth: 0 },
  optionLabelRow:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  optionLabel:         { color: '#94a3b8', fontWeight: '600', fontSize: 14, flexShrink: 1 },
  optionLabelSelected: { color: '#ffffff' },
  optionSublabel:      { color: '#4b5563', fontSize: 11 },
  voiceBadge:          { backgroundColor: 'rgba(124,58,237,0.2)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  voiceBadgeText:      { color: '#a78bfa', fontSize: 10, fontWeight: '600' },
  radio:               { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#2a2a3e', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  radioSelected:       { borderColor: '#7c3aed' },
  radioDot:            { width: 8, height: 8, borderRadius: 4, backgroundColor: '#7c3aed' },

  // Sign out
  signOutButton:       { marginHorizontal: 16, marginTop: 8, backgroundColor: 'rgba(220,38,38,0.1)', borderWidth: 1, borderColor: 'rgba(220,38,38,0.3)', borderRadius: 12, padding: 14, alignItems: 'center' },
  signOutText:         { color: '#f87171', fontWeight: '600', fontSize: 15 },
});
