import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Image,
} from 'react-native';
import { useMemo } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useAuth, useUserGuilds, useUserProfiles } from '@maskord/shared';
import type { Guild } from '@maskord/shared';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { GuildStackParamList } from '../../navigation/AppNavigator';
import { SafeAreaView } from 'react-native-safe-area-context';

type Nav = NativeStackNavigationProp<GuildStackParamList, 'GuildList'>;

export default function GuildListScreen() {
  const { firebaseUser } = useAuth();
  const { guilds, loading } = useUserGuilds(firebaseUser?.uid ?? null);
  const nav = useNavigation<Nav>();
  // Fetch owner profiles for guilds that have no custom iconUrl,
  // so we can fall back to the owner's avatar (e.g. their Twitch/Google photo).
  const ownerIds = useMemo(
    () => guilds.filter((g) => !g.iconUrl).map((g) => g.ownerId),
    [guilds],
  );
  const ownerProfiles = useUserProfiles(ownerIds);

  function renderGuild({ item }: { item: Guild }) {
    const iconUrl = item.iconUrl || ownerProfiles[item.ownerId]?.avatarUrl || '';
    return (
      <TouchableOpacity
        style={styles.guildRow}
        onPress={() => nav.navigate('ChannelList', { guildId: item.id, guildName: item.name })}
      >
        <View style={styles.guildIcon}>
          {iconUrl ? (
            <Image source={{ uri: iconUrl }} style={styles.guildIconImage} />
          ) : (
            <Text style={styles.guildInitials}>{item.name.substring(0, 2).toUpperCase()}</Text>
          )}
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
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0a0a0f' },
  list:         { padding: 16, gap: 8 },
  guildRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#0e0e16', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#1e1e2e' },
  guildIcon:     { width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(124,58,237,0.3)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  guildIconImage: { width: 48, height: 48, borderRadius: 14 },
  guildInitials: { color: '#a78bfa', fontWeight: '700', fontSize: 16 },
  guildInfo:    { flex: 1 },
  guildName:    { color: '#e2e8f0', fontWeight: '600', fontSize: 15 },
  guildDesc:    { color: '#6b7280', fontSize: 12, marginTop: 2 },
  chevron:      { color: '#6b7280', fontSize: 20 },
  empty:        { alignItems: 'center', paddingVertical: 60 },
  emptyEmoji:   { fontSize: 48, marginBottom: 16 },
  emptyTitle:   { color: '#e2e8f0', fontWeight: '600', fontSize: 18, marginBottom: 8 },
  emptySubtitle: { color: '#6b7280', fontSize: 14, textAlign: 'center' },
});
