import { View, Text, FlatList, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth, useFriendships, useUserProfiles } from '@maskord/shared';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Friendship } from '@maskord/shared';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMemo } from 'react';
import type { FriendsStackParamList } from '../../navigation/AppNavigator';

type Nav = NativeStackNavigationProp<FriendsStackParamList, 'FriendsList'>;

export default function FriendsScreen() {
  const { firebaseUser } = useAuth();
  const nav = useNavigation<Nav>();

  const { friends, pendingIncoming, getFriendUid, acceptRequest, rejectRequest } =
    useFriendships(firebaseUser?.uid ?? null);

  const allUids = useMemo(() => [
    ...friends.map(getFriendUid),
    ...pendingIncoming.map(getFriendUid),
  ], [friends, pendingIncoming]);

  const profiles = useUserProfiles(allUids);

  function renderFriend({ item }: { item: Friendship }) {
    const partnerUid = getFriendUid(item);
    const p = profiles[partnerUid];
    const name = p?.displayName ?? p?.twitchUsername ?? 'Unknown';
    const avatarUrl = p?.avatarUrl ?? '';
    const initials = name.substring(0, 2).toUpperCase();

    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => nav.navigate('DmChat', { partnerUid, partnerName: name })}
        activeOpacity={0.7}
      >
        <View style={styles.avatarWrap}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
          ) : (
            <Text style={styles.avatarInitials}>{initials}</Text>
          )}
        </View>
        <View style={styles.info}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.sub}>Tap to message</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    );
  }

  function renderPending({ item }: { item: Friendship }) {
    const partnerUid = getFriendUid(item);
    const p = profiles[partnerUid];
    const name = p?.displayName ?? p?.twitchUsername ?? 'Unknown';
    const avatarUrl = p?.avatarUrl ?? '';
    const initials = name.substring(0, 2).toUpperCase();

    return (
      <View style={styles.row}>
        <View style={styles.avatarWrap}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
          ) : (
            <Text style={styles.avatarInitials}>{initials}</Text>
          )}
        </View>
        <View style={styles.info}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.sub}>Wants to be friends</Text>
        </View>
        <View style={styles.pendingActions}>
          <TouchableOpacity style={styles.acceptBtn} onPress={() => acceptRequest(item.id)}>
            <Text style={styles.acceptText}>✓</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.rejectBtn} onPress={() => rejectRequest(item.id)}>
            <Text style={styles.rejectText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const isEmpty = friends.length === 0 && pendingIncoming.length === 0;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={[]}
        keyExtractor={() => ''}
        renderItem={null}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            {pendingIncoming.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>PENDING</Text>
                {pendingIncoming.map((item) => (
                  <View key={item.id}>{renderPending({ item })}</View>
                ))}
                <View style={styles.divider} />
              </>
            )}
            {friends.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>FRIENDS — {friends.length}</Text>
                {friends.map((item) => (
                  <View key={item.id}>{renderFriend({ item })}</View>
                ))}
              </>
            )}
            {isEmpty && (
              <View style={styles.empty}>
                <Text style={styles.emptyEmoji}>👥</Text>
                <Text style={styles.emptyTitle}>No friends yet</Text>
                <Text style={styles.emptySub}>
                  Friends will appear here once you connect with people on Maskord.
                </Text>
              </View>
            )}
          </>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0a0a0f' },
  list:           { padding: 16, gap: 6 },
  sectionTitle:   { color: '#6b7280', fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8, marginTop: 4 },
  divider:        { height: 1, backgroundColor: '#1e1e2e', marginVertical: 12 },

  row:            { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#0e0e16', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#1e1e2e', marginBottom: 6 },
  avatarWrap:     { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(124,58,237,0.2)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 },
  avatarImg:      { width: 44, height: 44, borderRadius: 22 },
  avatarInitials: { color: '#a78bfa', fontWeight: '700', fontSize: 14 },
  info:           { flex: 1 },
  name:           { color: '#e2e8f0', fontWeight: '600', fontSize: 15 },
  sub:            { color: '#6b7280', fontSize: 12, marginTop: 1 },
  chevron:        { color: '#6b7280', fontSize: 20 },

  pendingActions: { flexDirection: 'row', gap: 8 },
  acceptBtn:      { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(34,197,94,0.15)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.4)', alignItems: 'center', justifyContent: 'center' },
  acceptText:     { color: '#22c55e', fontWeight: '700', fontSize: 14 },
  rejectBtn:      { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(220,38,38,0.1)', borderWidth: 1, borderColor: 'rgba(220,38,38,0.3)', alignItems: 'center', justifyContent: 'center' },
  rejectText:     { color: '#f87171', fontWeight: '700', fontSize: 12 },

  empty:          { alignItems: 'center', paddingVertical: 60 },
  emptyEmoji:     { fontSize: 48, marginBottom: 16 },
  emptyTitle:     { color: '#e2e8f0', fontWeight: '600', fontSize: 18, marginBottom: 8 },
  emptySub:       { color: '#6b7280', fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
