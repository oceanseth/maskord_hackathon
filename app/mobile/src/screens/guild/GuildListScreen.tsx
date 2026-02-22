import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, TextInput, Modal,
} from 'react-native';
import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useAuth, useUserGuilds, createGuild } from '@maskord/shared';
import type { Guild } from '@maskord/shared';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { GuildStackParamList } from '../../navigation/AppNavigator';
import { SafeAreaView } from 'react-native-safe-area-context';

type Nav = NativeStackNavigationProp<GuildStackParamList, 'GuildList'>;

export default function GuildListScreen() {
  const { firebaseUser } = useAuth();
  const { guilds, loading } = useUserGuilds(firebaseUser?.uid ?? null);
  const nav = useNavigation<Nav>();
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newGuildName, setNewGuildName] = useState('');

  async function handleCreateGuild() {
    if (!newGuildName.trim() || !firebaseUser) return;
    const guildId = await createGuild(firebaseUser.uid, newGuildName.trim());
    setCreateModalVisible(false);
    setNewGuildName('');
    const guild = guilds.find((g) => g.id === guildId);
    if (guild) nav.navigate('ChannelList', { guildId, guildName: guild.name });
  }

  function renderGuild({ item }: { item: Guild }) {
    return (
      <TouchableOpacity
        style={styles.guildRow}
        onPress={() => nav.navigate('ChannelList', { guildId: item.id, guildName: item.name })}
      >
        <View style={styles.guildIcon}>
          <Text style={styles.guildInitials}>{item.name.substring(0, 2).toUpperCase()}</Text>
        </View>
        <View style={styles.guildInfo}>
          <Text style={styles.guildName}>{item.name}</Text>
          {item.description ? (
            <Text style={styles.guildDesc} numberOfLines={1}>{item.description}</Text>
          ) : null}
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={guilds}
        keyExtractor={(g) => g.id}
        renderItem={renderGuild}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>🎭</Text>
              <Text style={styles.emptyTitle}>No servers yet</Text>
              <Text style={styles.emptySubtitle}>Create or join a server to get started</Text>
            </View>
          )
        }
        ListFooterComponent={
          <TouchableOpacity style={styles.createButton} onPress={() => setCreateModalVisible(true)}>
            <Text style={styles.createButtonText}>+ Create a Server</Text>
          </TouchableOpacity>
        }
      />

      {/* Create guild modal */}
      <Modal visible={createModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>New Server</Text>
            <TextInput
              style={styles.modalInput}
              value={newGuildName}
              onChangeText={setNewGuildName}
              placeholder="Server name"
              placeholderTextColor="#6b7280"
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setCreateModalVisible(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={handleCreateGuild}>
                <Text style={styles.modalConfirmText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0a0a0f' },
  list:         { padding: 16, gap: 8 },
  guildRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#0e0e16', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#1e1e2e' },
  guildIcon:    { width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(124,58,237,0.3)', alignItems: 'center', justifyContent: 'center' },
  guildInitials: { color: '#a78bfa', fontWeight: '700', fontSize: 16 },
  guildInfo:    { flex: 1 },
  guildName:    { color: '#e2e8f0', fontWeight: '600', fontSize: 15 },
  guildDesc:    { color: '#6b7280', fontSize: 12, marginTop: 2 },
  chevron:      { color: '#6b7280', fontSize: 20 },
  empty:        { alignItems: 'center', paddingVertical: 60 },
  emptyEmoji:   { fontSize: 48, marginBottom: 16 },
  emptyTitle:   { color: '#e2e8f0', fontWeight: '600', fontSize: 18, marginBottom: 8 },
  emptySubtitle: { color: '#6b7280', fontSize: 14, textAlign: 'center' },
  createButton: { marginTop: 16, backgroundColor: 'rgba(124,58,237,0.15)', borderWidth: 1, borderColor: 'rgba(124,58,237,0.4)', borderRadius: 12, padding: 14, alignItems: 'center', borderStyle: 'dashed' },
  createButtonText: { color: '#a78bfa', fontWeight: '600', fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modal:        { backgroundColor: '#12121a', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 16 },
  modalTitle:   { color: '#ffffff', fontWeight: '700', fontSize: 20, textAlign: 'center' },
  modalInput:   { backgroundColor: '#1e1e2e', borderRadius: 10, padding: 12, color: '#e2e8f0', fontSize: 15 },
  modalActions: { flexDirection: 'row', gap: 12 },
  modalCancel:  { flex: 1, backgroundColor: '#1e1e2e', borderRadius: 10, padding: 14, alignItems: 'center' },
  modalCancelText: { color: '#94a3b8', fontWeight: '600' },
  modalConfirm: { flex: 1, backgroundColor: '#7c3aed', borderRadius: 10, padding: 14, alignItems: 'center' },
  modalConfirmText: { color: 'white', fontWeight: '600' },
});
