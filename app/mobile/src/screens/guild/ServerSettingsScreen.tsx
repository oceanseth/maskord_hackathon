import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  Image, Switch, ActivityIndicator, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, RouteProp } from '@react-navigation/native-stack';
import {
  useAuth, useGuild, updateGuildSettings, DEFAULT_CLAUDE_AVATAR,
} from '@maskord/shared';
import type { GuildStackParamList } from '../../navigation/AppNavigator';
import { useMaskyAvatars, type MaskyAvatarGroup } from '../../hooks/useMaskyAvatars';

type Nav   = NativeStackNavigationProp<GuildStackParamList, 'ServerSettings'>;
type Route = RouteProp<GuildStackParamList, 'ServerSettings'>;

type Tab = 'overview' | 'ai';

export default function ServerSettingsScreen() {
  const nav   = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { guildId } = route.params;
  const [tab, setTab] = useState<Tab>('ai');

  useEffect(() => {
    nav.setOptions({ title: 'Server Settings' });
  }, [nav]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.tabBar}>
        <TabBtn label="Overview"      active={tab === 'overview'} onPress={() => setTab('overview')} />
        <TabBtn label="AI Assistance" active={tab === 'ai'}       onPress={() => setTab('ai')} />
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {tab === 'overview' && <OverviewTab />}
        {tab === 'ai'       && <AITab guildId={guildId} />}
      </ScrollView>
    </SafeAreaView>
  );
}

function TabBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.tabBtn, active && styles.tabBtnActive]}>
      <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function OverviewTab() {
  return (
    <Text style={styles.placeholder}>
      Name, icon, and invite link will live here. For now manage these on the web app.
    </Text>
  );
}

// ─── AI Assistance ────────────────────────────────────────────────────────────

function AITab({ guildId }: { guildId: string }) {
  const { firebaseUser } = useAuth();
  const { guild } = useGuild(guildId);

  const [enabled,    setEnabled]    = useState(false);
  const [apiKey,     setApiKey]     = useState('');
  const [keyDirty,   setKeyDirty]   = useState(false);
  const [selectedOwnerUid, setSelectedOwnerUid] = useState(DEFAULT_CLAUDE_AVATAR.ownerUid);
  const [selectedAvatarId, setSelectedAvatarId] = useState(DEFAULT_CLAUDE_AVATAR.avatarId);

  useEffect(() => {
    if (!guild) return;
    setEnabled(!!guild.claudeEnabled);
    setApiKey(guild.claudeApiKey ?? '');
    setKeyDirty(false);
    setSelectedOwnerUid(guild.claudeAvatarOwnerUid ?? DEFAULT_CLAUDE_AVATAR.ownerUid);
    setSelectedAvatarId(guild.claudeAvatarId ?? DEFAULT_CLAUDE_AVATAR.avatarId);
  }, [guild]);

  const myAvatars      = useMaskyAvatars(firebaseUser?.uid ?? null);
  const defaultAvatars = useMaskyAvatars(DEFAULT_CLAUDE_AVATAR.ownerUid);

  type Choice = MaskyAvatarGroup & { ownerUid: string; isDefault?: boolean };
  const choices: Choice[] = useMemo(() => {
    const ownerUid = firebaseUser?.uid ?? '';
    const own = myAvatars.avatarGroups.map((g): Choice => ({ ...g, ownerUid }));
    const def = defaultAvatars.avatarGroups
      .filter((g) => g.id === DEFAULT_CLAUDE_AVATAR.avatarId
                  || own.every((o) => o.id !== g.id))
      .map((g): Choice => ({ ...g, ownerUid: DEFAULT_CLAUDE_AVATAR.ownerUid, isDefault: true }));
    return [...def, ...own];
  }, [myAvatars.avatarGroups, defaultAvatars.avatarGroups, firebaseUser?.uid]);

  const selected = choices.find(
    (c) => c.id === selectedAvatarId && c.ownerUid === selectedOwnerUid,
  );
  const mentionName = selected?.displayName ?? DEFAULT_CLAUDE_AVATAR.fallbackDisplayName;

  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const dirty = !guild
    || enabled !== !!guild.claudeEnabled
    || keyDirty
    || selectedOwnerUid !== (guild.claudeAvatarOwnerUid ?? DEFAULT_CLAUDE_AVATAR.ownerUid)
    || selectedAvatarId !== (guild.claudeAvatarId      ?? DEFAULT_CLAUDE_AVATAR.avatarId);

  async function handleSave() {
    setSaving(true); setError(null);
    try {
      await updateGuildSettings(guildId, {
        claudeEnabled: enabled,
        ...(keyDirty ? { claudeApiKey: apiKey.trim() } : {}),
        claudeAvatarOwnerUid: selectedOwnerUid,
        claudeAvatarId: selectedAvatarId,
      });
      setSaved(true); setKeyDirty(false);
      setTimeout(() => setSaved(false), 1500);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save');
    } finally { setSaving(false); }
  }

  return (
    <View style={{ gap: 24 }}>
      {/* Enable */}
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Enable AI assistance</Text>
          <Text style={styles.rowDesc}>
            When on, the selected avatar acts as a bot member of this server. Reference it in chat
            as <Text style={styles.mono}>@{mentionName}</Text>.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={setEnabled}
          trackColor={{ false: '#1e1e2e', true: '#7c3aed' }}
          thumbColor="#ffffff"
        />
      </View>

      <View style={styles.divider} />

      {/* API key */}
      <View>
        <Text style={styles.label}>Anthropic API key</Text>
        <Text style={styles.hint}>Stored server-side. Not exposed to members.</Text>
        <TextInput
          value={apiKey}
          onChangeText={(v) => { setApiKey(v); setKeyDirty(true); }}
          placeholder="sk-ant-api03-…"
          placeholderTextColor="#4b5563"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
      </View>

      {/* Avatar picker */}
      <View>
        <Text style={styles.label}>Avatar</Text>
        <Text style={styles.hint}>
          Drives the bot's name, voice, and visual identity. Wake word is configured on the avatar in masky.
        </Text>
        {choices.length === 0 ? (
          <ActivityIndicator color="#7c3aed" style={{ marginTop: 12 }} />
        ) : (
          <View style={styles.choices}>
            {choices.map((c) => (
              <TouchableOpacity
                key={`${c.ownerUid}:${c.id}`}
                style={[
                  styles.choice,
                  c.id === selectedAvatarId && c.ownerUid === selectedOwnerUid && styles.choiceSelected,
                ]}
                onPress={() => { setSelectedOwnerUid(c.ownerUid); setSelectedAvatarId(c.id); }}
                activeOpacity={0.7}
              >
                <View style={styles.thumb}>
                  {c.thumbnailUrl
                    ? <Image source={{ uri: c.thumbnailUrl }} style={styles.thumbImg} />
                    : <Text style={styles.thumbFallback}>{c.displayName.slice(0, 2).toUpperCase()}</Text>
                  }
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.choiceName} numberOfLines={1}>{c.displayName}</Text>
                  {c.isDefault && <Text style={styles.choiceTag}>Default</Text>}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

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
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0e0e16' },
  tabBar:       { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1e1e2e' },
  tabBtn:       { paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: '#7c3aed' },
  tabBtnText:   { color: '#6b7280', fontSize: 14, fontWeight: '500' },
  tabBtnTextActive: { color: '#ffffff' },
  scrollContent:{ padding: 20 },
  placeholder:  { color: '#6b7280', fontSize: 13 },

  row:          { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  rowText:      { flex: 1 },
  rowTitle:     { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  rowDesc:      { color: '#6b7280', fontSize: 12, marginTop: 4, lineHeight: 16 },
  mono:         { fontFamily: 'Menlo', color: '#c8d0e0' },

  divider:      { height: 1, backgroundColor: '#1e1e2e' },

  label:        { color: '#94a3b8', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  hint:         { color: '#6b7280', fontSize: 12, marginBottom: 8 },
  input:        { backgroundColor: '#0a0a0f', borderColor: '#1e1e2e', borderWidth: 1, borderRadius: 10, color: '#ffffff', fontSize: 13, paddingHorizontal: 12, paddingVertical: 11, fontFamily: 'Menlo' },

  choices:      { marginTop: 4, gap: 8 },
  choice:       { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#1e1e2e', backgroundColor: '#0a0a0f' },
  choiceSelected: { borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.12)' },
  thumb:        { width: 36, height: 36, borderRadius: 18, overflow: 'hidden', backgroundColor: 'rgba(124,58,237,0.3)', alignItems: 'center', justifyContent: 'center' },
  thumbImg:     { width: '100%', height: '100%' },
  thumbFallback:{ color: '#c4b5fd', fontSize: 11, fontWeight: '700' },
  choiceName:   { color: '#ffffff', fontSize: 14, fontWeight: '500' },
  choiceTag:    { color: '#c4b5fd', fontSize: 10, marginTop: 2 },

  error:        { color: '#f87171', fontSize: 12, padding: 10, borderRadius: 8, backgroundColor: 'rgba(127,29,29,0.2)', borderColor: 'rgba(127,29,29,0.3)', borderWidth: 1 },

  saveBtn:      { backgroundColor: '#7c3aed', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnSaved: { backgroundColor: '#16a34a' },
  saveBtnText:  { color: '#ffffff', fontSize: 14, fontWeight: '600' },
});
