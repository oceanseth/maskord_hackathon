import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  Image, Modal, ScrollView, Alert, Linking,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useAuth, useVoiceChannel, useUserProfiles } from '@maskord/shared';
import type { RouteProp } from '@react-navigation/native-stack';
import type { GuildStackParamList } from '../../navigation/AppNavigator';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { VoiceParticipant } from '@maskord/shared';
import { useMaskyAvatars, type MaskyAvatarGroup } from '../../hooks/useMaskyAvatars';

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
    connectingPeers,
    join,
    leave,
    toggleMute,
    toggleDeafen,
  } = useVoiceChannel(guildId, channelId, firebaseUser?.uid ?? null);

  const { avatarGroups, selectedId, setSelected } =
    useMaskyAvatars(firebaseUser?.uid ?? null);

  const [avatarSettingsOpen, setAvatarSettingsOpen] = useState(false);

  // Collect all user IDs (self + participants)
  const allIds = [
    ...(firebaseUser?.uid ? [firebaseUser.uid] : []),
    ...participants.filter((p) => p.userId !== firebaseUser?.uid).map((p) => p.userId),
  ];
  const profiles = useUserProfiles(allIds);

  useEffect(() => {
    join();
    return () => { leave(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId, channelId]);

  async function handleDisconnect() {
    await leave();
    nav.goBack();
  }

  function getDisplayInfo(userId: string) {
    const p = profiles[userId];
    return {
      name:      p?.displayName ?? p?.twitchUsername ?? 'Unknown',
      avatarUrl: p?.avatarUrl ?? '',
    };
  }

  const selectedAvatar = avatarGroups.find((g) => g.id === selectedId) ?? null;

  // Build tile list: self first, then remote participants
  const selfTile = firebaseUser ? { userId: firebaseUser.uid, isSelf: true } : null;
  const remoteTiles = participants
    .filter((p) => p.userId !== firebaseUser?.uid)
    .map((p) => ({ userId: p.userId, isSelf: false, participant: p }));

  type TileItem =
    | { userId: string; isSelf: true }
    | { userId: string; isSelf: false; participant: VoiceParticipant };

  const tileData: TileItem[] = [
    ...(selfTile ? [selfTile as TileItem] : []),
    ...remoteTiles,
  ];

  function renderTile({ item }: { item: TileItem }) {
    const { name, avatarUrl } = getDisplayInfo(item.userId);

    // For self: prefer selected mask thumbnail over profile photo
    const displayAvatarUrl = item.isSelf
      ? (selectedAvatar?.thumbnailUrl || avatarUrl)
      : avatarUrl;

    const displayName = item.isSelf
      ? `${name} (you)`
      : name;

    const isMutedTile = item.isSelf
      ? isMuted
      : (item as { participant: VoiceParticipant }).participant.state.muted;

    const isPeerConnecting = !item.isSelf && connectingPeers.has(item.userId);

    return (
      <View style={[styles.tile, item.isSelf && styles.tileSelf]}>
        <View style={styles.tileAvatarWrap}>
          {displayAvatarUrl ? (
            <Image source={{ uri: displayAvatarUrl }} style={[styles.tileAvatarImg, isPeerConnecting && styles.tileAvatarConnecting]} />
          ) : (
            <Text style={[styles.tileInitials, isPeerConnecting && styles.tileInitialsConnecting]}>
              {name.substring(0, 2).toUpperCase()}
            </Text>
          )}
          {isMutedTile && !isPeerConnecting && (
            <View style={styles.mutedBadge}>
              <Text style={{ fontSize: 10 }}>🔇</Text>
            </View>
          )}
          {item.isSelf && (
            <TouchableOpacity
              style={styles.gearBtn}
              onPress={() => setAvatarSettingsOpen(true)}
            >
              <GearIcon />
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.tileName} numberOfLines={1}>{displayName}</Text>
        {isPeerConnecting ? (
          <Text style={styles.tileConnectingLabel}>Connecting…</Text>
        ) : item.isSelf && selectedAvatar ? (
          <Text style={styles.tileMaskLabel} numberOfLines={1}>
            {selectedAvatar.displayName}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Status bar */}
      <View style={styles.statusBar}>
        <View style={[styles.statusDot, styles.statusDotConnected]} />
        <Text style={styles.statusText}>Connected to {channelName}</Text>
      </View>

      {/* Participant grid */}
      <FlatList
        data={tileData}
        keyExtractor={(p) => p.userId}
        numColumns={2}
        contentContainerStyle={styles.grid}
        renderItem={renderTile}
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

      {/* Avatar settings modal */}
      <AvatarSettingsModal
        visible={avatarSettingsOpen}
        onClose={() => setAvatarSettingsOpen(false)}
        avatarGroups={avatarGroups}
        selectedId={selectedId}
        onSelect={setSelected}
      />
    </SafeAreaView>
  );
}

// ─── Avatar Settings Modal ────────────────────────────────────────────────────

interface AvatarSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  avatarGroups: MaskyAvatarGroup[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function AvatarSettingsModal({
  visible, onClose, avatarGroups, selectedId, onSelect,
}: AvatarSettingsModalProps) {
  const [useAvatarVoice, setUseAvatarVoice]         = useState(false);
  const [usePersonality,  setUsePersonality]         = useState(false);
  const [talkingAvatar,   setTalkingAvatar]           = useState(false);

  const selectedAvatar = avatarGroups.find((g) => g.id === selectedId) ?? null;

  function handleUseAvatarVoice() {
    if (!useAvatarVoice && selectedAvatar && !selectedAvatar.humeVoiceId) {
      Alert.alert(
        'No Voice Configured',
        'This avatar doesn\'t have a voice set up yet. Add one at masky.ai first.',
        [
          { text: 'Open masky.ai', onPress: () => Linking.openURL('https://masky.ai') },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
      return;
    }
    if (!useAvatarVoice && !selectedAvatar) {
      Alert.alert('No Mask Selected', 'Select a mask first to use its voice.');
      return;
    }
    setUseAvatarVoice((v) => !v);
  }

  function handleTalkingAvatar() {
    if (!talkingAvatar) {
      Alert.alert(
        'Maskord Pro Required',
        'Talking Avatar requires an active masky.ai membership.',
        [
          { text: 'Upgrade at masky.ai', onPress: () => Linking.openURL('https://masky.ai') },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
      return;
    }
    setTalkingAvatar((v) => !v);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={modal.container}>
        {/* Header */}
        <View style={modal.header}>
          <Text style={modal.title}>Avatar Settings</Text>
          <TouchableOpacity onPress={onClose} style={modal.closeBtn}>
            <Text style={modal.closeText}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={modal.scroll}>
          {/* Mask selector */}
          <View style={modal.section}>
            <Text style={modal.sectionTitle}>ACTIVE MASK</Text>
            <View style={modal.maskList}>
              {/* None */}
              <AvatarRow
                label="None"
                sublabel="Use your real identity"
                selected={!selectedId}
                onPress={() => onSelect(null)}
              />
              {avatarGroups.length === 0 ? (
                <View style={modal.emptyBox}>
                  <Text style={modal.emptyText}>No avatars found.</Text>
                  <TouchableOpacity onPress={() => Linking.openURL('https://masky.ai')}>
                    <Text style={modal.emptyLink}>Create one at masky.ai →</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                avatarGroups.map((g) => (
                  <AvatarRow
                    key={g.id}
                    thumbnailUrl={g.thumbnailUrl}
                    label={g.displayName}
                    sublabel={g.personalityPrompt?.slice(0, 60) ?? 'No personality set'}
                    hasVoice={!!g.humeVoiceId}
                    selected={selectedId === g.id}
                    onPress={() => onSelect(g.id)}
                  />
                ))
              )}
            </View>
          </View>

          {/* Feature toggles */}
          <View style={modal.section}>
            <Text style={modal.sectionTitle}>MASK FEATURES</Text>
            <View style={modal.toggleList}>
              <ToggleRow
                label="Use Avatar Voice"
                sublabel="Reinterpret your voice as this mask"
                value={useAvatarVoice}
                onPress={handleUseAvatarVoice}
              />
              <ToggleRow
                label="Use Personality Prompt"
                sublabel="Apply the mask's AI personality to messages"
                value={usePersonality}
                onPress={() => setUsePersonality((v) => !v)}
              />
              <ToggleRow
                label="Talking Avatar"
                sublabel="Animate your mask in video (Pro)"
                value={talkingAvatar}
                onPress={handleTalkingAvatar}
                proFeature
              />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Avatar row (for mask selector) ──────────────────────────────────────────

interface AvatarRowProps {
  thumbnailUrl?: string;
  label: string;
  sublabel?: string;
  hasVoice?: boolean;
  selected: boolean;
  onPress: () => void;
}

function AvatarRow({ thumbnailUrl, label, sublabel, hasVoice, selected, onPress }: AvatarRowProps) {
  const initials = label.substring(0, 2).toUpperCase();
  return (
    <TouchableOpacity
      style={[modal.avatarRow, selected && modal.avatarRowSelected]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={modal.rowThumb}>
        {thumbnailUrl ? (
          <Image source={{ uri: thumbnailUrl }} style={modal.rowThumbImg} />
        ) : (
          <Text style={modal.rowThumbInitials}>{initials}</Text>
        )}
      </View>
      <View style={modal.rowInfo}>
        <View style={modal.rowLabelRow}>
          <Text style={[modal.rowLabel, selected && modal.rowLabelSelected]} numberOfLines={1}>
            {label}
          </Text>
          {hasVoice && (
            <View style={modal.voiceBadge}>
              <Text style={modal.voiceBadgeText}>Voice</Text>
            </View>
          )}
        </View>
        {sublabel ? (
          <Text style={modal.rowSublabel} numberOfLines={1}>{sublabel}</Text>
        ) : null}
      </View>
      <View style={[modal.radio, selected && modal.radioSelected]}>
        {selected && <View style={modal.radioDot} />}
      </View>
    </TouchableOpacity>
  );
}

// ─── Toggle row (for feature checkboxes) ─────────────────────────────────────

interface ToggleRowProps {
  label: string;
  sublabel?: string;
  value: boolean;
  onPress: () => void;
  proFeature?: boolean;
}

function ToggleRow({ label, sublabel, value, onPress, proFeature }: ToggleRowProps) {
  return (
    <TouchableOpacity style={modal.toggleRow} onPress={onPress} activeOpacity={0.7}>
      <View style={modal.toggleInfo}>
        <View style={modal.toggleLabelRow}>
          <Text style={modal.toggleLabel}>{label}</Text>
          {proFeature && (
            <View style={modal.proBadge}>
              <Text style={modal.proBadgeText}>PRO</Text>
            </View>
          )}
        </View>
        {sublabel ? (
          <Text style={modal.toggleSublabel}>{sublabel}</Text>
        ) : null}
      </View>
      <View style={[modal.checkbox, value && modal.checkboxChecked]}>
        {value && <Text style={modal.checkmark}>✓</Text>}
      </View>
    </TouchableOpacity>
  );
}

// ─── Gear icon (SVG-free, text-based) ────────────────────────────────────────

function GearIcon() {
  return <Text style={{ fontSize: 14, color: '#ffffff' }}>⚙️</Text>;
}

// ─── Voice control button ─────────────────────────────────────────────────────

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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:              { flex: 1, backgroundColor: '#0a0a0f' },
  statusBar:              { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, borderBottomWidth: 1, borderBottomColor: '#1e1e2e' },
  statusDot:              { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4b5563' },
  statusDotConnected:     { backgroundColor: '#22c55e' },
  statusText:             { color: '#94a3b8', fontSize: 14 },
  grid:                   { padding: 16, gap: 12 },

  // Participant tile
  tile:                   { flex: 1, alignItems: 'center', margin: 6, backgroundColor: '#0e0e16', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#1e1e2e' },
  tileSelf:               { borderColor: 'rgba(124,58,237,0.5)' },
  tileAvatarWrap:         { position: 'relative', marginBottom: 8 },
  tileAvatarImg:          { width: 60, height: 60, borderRadius: 30 },
  tileInitials:           { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(124,58,237,0.2)', textAlign: 'center', textAlignVertical: 'center', color: '#a78bfa', fontWeight: '700', fontSize: 20, lineHeight: 60 },
  tileName:               { color: '#94a3b8', fontSize: 13, fontWeight: '500', maxWidth: '90%' },
  tileMaskLabel:          { color: '#7c3aed', fontSize: 11, marginTop: 2, maxWidth: '90%' },
  tileConnectingLabel:    { color: '#4b5563', fontSize: 11, marginTop: 2, fontStyle: 'italic' },
  tileAvatarConnecting:   { opacity: 0.4 },
  tileInitialsConnecting: { opacity: 0.4 },
  mutedBadge:             { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#dc2626', width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  gearBtn:                { position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: '#0a0a0f', borderWidth: 1, borderColor: '#2a2a3e', alignItems: 'center', justifyContent: 'center' },

  controls:               { flexDirection: 'row', justifyContent: 'center', gap: 20, padding: 24, borderTopWidth: 1, borderTopColor: '#1e1e2e' },
  control:                { alignItems: 'center', gap: 4, backgroundColor: '#1e1e2e', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16 },
  controlActive:          { backgroundColor: 'rgba(124,58,237,0.2)' },
  controlDanger:          { backgroundColor: 'rgba(220,38,38,0.2)' },
  controlEmoji:           { fontSize: 24 },
  controlLabel:           { color: '#94a3b8', fontSize: 11, fontWeight: '500' },
});

const modal = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#0a0a0f' },
  header:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#1e1e2e' },
  title:              { color: '#ffffff', fontWeight: '700', fontSize: 18 },
  closeBtn:           { paddingHorizontal: 4, paddingVertical: 2 },
  closeText:          { color: '#a78bfa', fontSize: 16, fontWeight: '600' },
  scroll:             { paddingBottom: 40 },

  section:            { padding: 16 },
  sectionTitle:       { color: '#6b7280', fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 10 },

  maskList:           { gap: 6 },
  emptyBox:           { backgroundColor: '#0e0e16', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#1e1e2e', gap: 6 },
  emptyText:          { color: '#6b7280', fontSize: 13 },
  emptyLink:          { color: '#a78bfa', fontSize: 13 },

  // Avatar row
  avatarRow:          { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#1e1e2e', backgroundColor: '#0e0e16' },
  avatarRowSelected:  { borderColor: 'rgba(124,58,237,0.5)', backgroundColor: 'rgba(124,58,237,0.08)' },
  rowThumb:           { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(124,58,237,0.2)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 },
  rowThumbImg:        { width: 44, height: 44, borderRadius: 22 },
  rowThumbInitials:   { color: '#a78bfa', fontWeight: '700', fontSize: 14 },
  rowInfo:            { flex: 1, minWidth: 0 },
  rowLabelRow:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  rowLabel:           { color: '#94a3b8', fontWeight: '600', fontSize: 14, flexShrink: 1 },
  rowLabelSelected:   { color: '#ffffff' },
  rowSublabel:        { color: '#4b5563', fontSize: 11 },
  voiceBadge:         { backgroundColor: 'rgba(124,58,237,0.2)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  voiceBadgeText:     { color: '#a78bfa', fontSize: 10, fontWeight: '600' },
  radio:              { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#2a2a3e', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  radioSelected:      { borderColor: '#7c3aed' },
  radioDot:           { width: 8, height: 8, borderRadius: 4, backgroundColor: '#7c3aed' },

  // Toggle rows
  toggleList:         { gap: 4 },
  toggleRow:          { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#1e1e2e', backgroundColor: '#0e0e16' },
  toggleInfo:         { flex: 1 },
  toggleLabelRow:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  toggleLabel:        { color: '#e2e8f0', fontWeight: '600', fontSize: 14 },
  toggleSublabel:     { color: '#4b5563', fontSize: 11 },
  checkbox:           { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#2a2a3e', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  checkboxChecked:    { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  checkmark:          { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  proBadge:           { backgroundColor: 'rgba(245,158,11,0.15)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  proBadgeText:       { color: '#f59e0b', fontSize: 10, fontWeight: '700' },
});
