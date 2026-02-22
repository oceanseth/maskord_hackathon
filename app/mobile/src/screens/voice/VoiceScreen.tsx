import { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useAuth, useVoiceChannel } from '@maskord/shared';
import type { RouteProp } from '@react-navigation/native-stack';
import type { GuildStackParamList } from '../../navigation/AppNavigator';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { VoiceParticipant } from '@maskord/shared';

type Route = RouteProp<GuildStackParamList, 'Voice'>;

export default function VoiceScreen() {
  const route = useRoute<Route>();
  const nav = useNavigation();
  const { guildId, channelId, channelName } = route.params;
  const { firebaseUser } = useAuth();

  const {
    participants,
    isMuted,
    isDeafened,
    isConnected,
    join,
    leave,
    toggleMute,
    toggleDeafen,
  } = useVoiceChannel(guildId, channelId, firebaseUser?.uid ?? null);

  useEffect(() => {
    join();
    return () => { leave(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId, channelId]);

  async function handleDisconnect() {
    await leave();
    nav.goBack();
  }

  function renderParticipant({ item }: { item: VoiceParticipant }) {
    const isSelf = item.userId === firebaseUser?.uid;
    return (
      <View style={styles.participantTile}>
        <View style={[styles.participantAvatar, isSelf && styles.participantAvatarSelf]}>
          <Text style={styles.participantInitials}>
            {item.userId.substring(0, 2).toUpperCase()}
          </Text>
          {item.state.muted && (
            <View style={styles.mutedBadge}>
              <Text style={{ fontSize: 10 }}>🔇</Text>
            </View>
          )}
        </View>
        <Text style={styles.participantName} numberOfLines={1}>
          {isSelf ? 'You' : item.userId.substring(0, 8)}
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Status bar */}
      <View style={styles.statusBar}>
        <View style={[styles.statusDot, isConnected && styles.statusDotConnected]} />
        <Text style={styles.statusText}>
          {isConnected ? `Connected to ${channelName}` : 'Connecting...'}
        </Text>
      </View>

      {/* Participant grid */}
      <FlatList
        data={participants}
        keyExtractor={(p) => p.userId}
        numColumns={2}
        contentContainerStyle={styles.grid}
        renderItem={renderParticipant}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No one else is here yet</Text>
          </View>
        }
      />

      {/* Controls */}
      <View style={styles.controls}>
        <VoiceControl
          label={isMuted ? 'Unmute' : 'Mute'}
          emoji={isMuted ? '🔇' : '🎙️'}
          active={!isMuted}
          onPress={toggleMute}
        />
        <VoiceControl
          label={isDeafened ? 'Undeafen' : 'Deafen'}
          emoji={isDeafened ? '🔕' : '🎧'}
          active={!isDeafened}
          onPress={toggleDeafen}
        />
        <VoiceControl
          label="Disconnect"
          emoji="📵"
          active={false}
          danger
          onPress={handleDisconnect}
        />
      </View>
    </SafeAreaView>
  );
}

function VoiceControl({
  label, emoji, active, danger, onPress,
}: { label: string; emoji: string; active: boolean; danger?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.control, active && styles.controlActive, danger && styles.controlDanger]}
      onPress={onPress}
    >
      <Text style={styles.controlEmoji}>{emoji}</Text>
      <Text style={styles.controlLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container:              { flex: 1, backgroundColor: '#0a0a0f' },
  statusBar:              { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, borderBottomWidth: 1, borderBottomColor: '#1e1e2e' },
  statusDot:              { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4b5563' },
  statusDotConnected:     { backgroundColor: '#22c55e' },
  statusText:             { color: '#94a3b8', fontSize: 14 },
  grid:                   { padding: 16, gap: 12 },
  participantTile:        { flex: 1, alignItems: 'center', margin: 6, backgroundColor: '#0e0e16', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#1e1e2e' },
  participantAvatar:      { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(124,58,237,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 8, position: 'relative' },
  participantAvatarSelf:  { borderWidth: 2, borderColor: '#7c3aed' },
  participantInitials:    { color: '#a78bfa', fontWeight: '700', fontSize: 20 },
  participantName:        { color: '#94a3b8', fontSize: 13, fontWeight: '500', maxWidth: '90%' },
  mutedBadge:             { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#dc2626', width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  empty:                  { alignItems: 'center', paddingVertical: 40 },
  emptyText:              { color: '#4b5563', fontSize: 14 },
  controls:               { flexDirection: 'row', justifyContent: 'center', gap: 20, padding: 24, borderTopWidth: 1, borderTopColor: '#1e1e2e' },
  control:                { alignItems: 'center', gap: 4, backgroundColor: '#1e1e2e', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16 },
  controlActive:          { backgroundColor: 'rgba(124,58,237,0.2)' },
  controlDanger:          { backgroundColor: 'rgba(220,38,38,0.2)' },
  controlEmoji:           { fontSize: 24 },
  controlLabel:           { color: '#94a3b8', fontSize: 11, fontWeight: '500' },
});
