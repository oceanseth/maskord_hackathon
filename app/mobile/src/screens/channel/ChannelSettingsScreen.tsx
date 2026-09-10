import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, RouteProp } from '@react-navigation/native-stack';
import {
  useGuild, useGuildChannels, updateChannel, DEFAULT_CLAUDE_AVATAR,
} from '@maskord/shared';
import type { GuildStackParamList } from '../../navigation/AppNavigator';
import { useMaskyAvatars } from '../../hooks/useMaskyAvatars';

type Nav   = NativeStackNavigationProp<GuildStackParamList, 'ChannelSettings'>;
type Route = RouteProp<GuildStackParamList, 'ChannelSettings'>;

export default function ChannelSettingsScreen() {
  const nav   = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { guildId, channelId } = route.params;
  const channels = useGuildChannels(guildId);
  const channel  = useMemo(() => channels.find((c) => c.id === channelId), [channels, channelId]);
  const { guild } = useGuild(guildId);

  useEffect(() => {
    nav.setOptions({ title: channel ? `# ${channel.name}` : 'Channel Settings' });
  }, [nav, channel?.name]);

  const ownerUid     = guild?.claudeAvatarOwnerUid ?? DEFAULT_CLAUDE_AVATAR.ownerUid;
  const guildAvatars = useMaskyAvatars(ownerUid);
  const avatarId     = guild?.claudeAvatarId ?? DEFAULT_CLAUDE_AVATAR.avatarId;
  const avatar       = guildAvatars.avatarGroups.find((a) => a.id === avatarId);
  const avatarName   = avatar?.displayName ?? DEFAULT_CLAUDE_AVATAR.fallbackDisplayName;

  const [mode,      setMode]      = useState<'off' | 'mention' | 'all'>('off');
  const [mediaMode, setMediaMode] = useState<'audio' | 'video'>('audio');
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!channel) return;
    setMode(channel.claudeMode ?? 'off');
    setMediaMode(channel.claudeMediaMode ?? 'audio');
  }, [channel?.id, channel?.claudeMode, channel?.claudeMediaMode]);

  if (!channel) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ActivityIndicator color="#7c3aed" style={{ marginTop: 32 }} />
      </SafeAreaView>
    );
  }

  const dirty = mode !== (channel.claudeMode ?? 'off')
    || mediaMode !== (channel.claudeMediaMode ?? 'audio');

  async function handleSave() {
    setSaving(true); setError(null);
    try {
      await updateChannel(guildId, channelId, { claudeMode: mode, claudeMediaMode: mediaMode });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save');
    } finally { setSaving(false); }
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {!guild?.claudeEnabled && (
          <Text style={styles.warning}>
            AI assistance is disabled for this server. Enable it in Server Settings → AI Assistance first.
          </Text>
        )}

        <View>
          <Text style={styles.title}>{avatarName} in this channel</Text>
          <Text style={styles.subtitle}>
            Decide when <Text style={styles.mono}>@{avatarName}</Text> responds here.
            Everyone in the channel sees the responses.
          </Text>
        </View>

        <ModeRow
          label="Off"
          desc="Members chat freely; the avatar ignores everything in this channel."
          active={mode === 'off'}
          onPress={() => setMode('off')}
        />
        <ModeRow
          label="Mention only"
          desc={`Replies only when a message contains @${avatarName} or, in voice channels, when someone says the avatar's wake word.`}
          active={mode === 'mention'}
          onPress={() => setMode('mention')}
        />
        <ModeRow
          label="Listen to everything"
          desc="Replies to every message. Burns the most tokens — leave off unless this is a chat-with-AI room."
          active={mode === 'all'}
          onPress={() => setMode('all')}
        />

        {channel.type === 'voice' && mode !== 'off' && (
          <>
            <View style={styles.divider} />
            <View>
              <Text style={styles.title}>Voice presence</Text>
              <Text style={styles.subtitle}>How the avatar appears in this voice channel when it speaks.</Text>
            </View>
            <View style={styles.mediaRow}>
              <MediaChoice
                label="Audio only"
                desc="Spoken response only — fast and cheap."
                active={mediaMode === 'audio'}
                onPress={() => setMediaMode('audio')}
              />
              <MediaChoice
                label="Talking head"
                desc="Audio + animated avatar video. Higher cost."
                active={mediaMode === 'video'}
                onPress={() => setMediaMode('video')}
              />
            </View>
          </>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          disabled={!dirty || saving}
          onPress={handleSave}
          style={[styles.saveBtn, (!dirty || saving) && styles.saveBtnDisabled, saved && styles.saveBtnSaved]}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.saveBtnText}>{saved ? 'Saved!' : 'Save changes'}</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function ModeRow({ label, desc, active, onPress }: {
  label: string; desc: string; active: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={[styles.modeRow, active && styles.modeRowActive]}>
      <View style={[styles.radio, active && styles.radioActive]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.modeLabel}>{label}</Text>
        <Text style={styles.modeDesc}>{desc}</Text>
      </View>
    </TouchableOpacity>
  );
}

function MediaChoice({ label, desc, active, onPress }: {
  label: string; desc: string; active: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={[styles.mediaChoice, active && styles.mediaChoiceActive]}>
      <Text style={styles.modeLabel}>{label}</Text>
      <Text style={styles.modeDesc}>{desc}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0e0e16' },
  scrollContent:{ padding: 20, gap: 16 },

  warning:      { color: '#fbbf24', fontSize: 12, padding: 12, borderRadius: 10, backgroundColor: 'rgba(120,53,15,0.15)', borderColor: 'rgba(180,83,9,0.3)', borderWidth: 1 },

  title:        { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  subtitle:     { color: '#6b7280', fontSize: 12, marginTop: 4, lineHeight: 16 },
  mono:         { fontFamily: 'Menlo', color: '#c8d0e0' },

  modeRow:      { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#1e1e2e', backgroundColor: '#0a0a0f' },
  modeRowActive:{ borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.12)' },
  radio:        { marginTop: 3, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#3a3a5e' },
  radioActive:  { backgroundColor: '#a78bfa', borderColor: '#c4b5fd' },
  modeLabel:    { color: '#ffffff', fontSize: 14, fontWeight: '500' },
  modeDesc:     { color: '#6b7280', fontSize: 12, marginTop: 2, lineHeight: 16 },

  divider:      { height: 1, backgroundColor: '#1e1e2e' },

  mediaRow:     { flexDirection: 'row', gap: 8 },
  mediaChoice:  { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#1e1e2e', backgroundColor: '#0a0a0f' },
  mediaChoiceActive: { borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.12)' },

  error:        { color: '#f87171', fontSize: 12, padding: 10, borderRadius: 8, backgroundColor: 'rgba(127,29,29,0.2)', borderColor: 'rgba(127,29,29,0.3)', borderWidth: 1 },

  saveBtn:      { backgroundColor: '#7c3aed', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnSaved: { backgroundColor: '#16a34a' },
  saveBtnText:  { color: '#ffffff', fontSize: 14, fontWeight: '600' },
});
