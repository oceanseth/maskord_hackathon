import { useEffect, useLayoutEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useGuildChannels, useLiveStatus, useAuth } from '@maskord/shared';
import type { Channel } from '@maskord/shared';
import type { NativeStackNavigationProp, RouteProp } from '@react-navigation/native-stack';
import type { GuildStackParamList } from '../../navigation/AppNavigator';
import { SafeAreaView } from 'react-native-safe-area-context';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFunctions } from '@maskord/shared';

type Nav   = NativeStackNavigationProp<GuildStackParamList, 'ChannelList'>;
type Route = RouteProp<GuildStackParamList, 'ChannelList'>;

export default function ChannelListScreen() {
  const nav   = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { guildId } = route.params;
  const channels   = useGuildChannels(guildId);
  const liveStatus = useLiveStatus(guildId);
  const isLive     = liveStatus?.isLive === true;
  const { firebaseUser } = useAuth();

  // Refresh live status from Twitch on mount so the badge is accurate
  // without waiting for a webhook event.
  useEffect(() => {
    if (!firebaseUser) return;
    httpsCallable(getFirebaseFunctions(), 'checkLiveStatus')({ guildId }).catch(() => {});
  }, [guildId, firebaseUser]);

  // Gear icon → Server Settings
  useLayoutEffect(() => {
    nav.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => nav.navigate('ServerSettings', { guildId })}
          hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
        >
          <Text style={{ fontSize: 18, color: '#94a3b8', paddingHorizontal: 8 }}>⚙︎</Text>
        </TouchableOpacity>
      ),
    });
  }, [nav, guildId]);

  // #live always floats first (position: -1), then everything else
  const sorted = [...channels].sort((a, b) => a.position - b.position);
  const liveChannel   = sorted.find((c) => c.type === 'live');
  const otherChannels = sorted.filter((c) => c.type !== 'live');

  function handleChannelPress(channel: Channel) {
    if (channel.type === 'live') {
      nav.navigate('Live', { guildId, channelId: channel.id });
    } else if (channel.type === 'voice') {
      nav.navigate('Voice', { guildId, channelId: channel.id, channelName: channel.name });
    } else {
      nav.navigate('Chat', { guildId, channelId: channel.id, channelName: channel.name });
    }
  }

  const categories    = otherChannels.filter((c) => c.type === 'category');
  const uncategorized = otherChannels.filter((c) => c.type !== 'category' && !c.parentId);

  const listItems: Array<Channel | { type: 'category_header'; name: string; id: string }> = [
    ...uncategorized,
    ...categories.flatMap((cat) => [
      { type: 'category_header' as const, name: cat.name, id: cat.id },
      ...otherChannels.filter((c) => c.parentId === cat.id),
    ]),
  ];

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* #live — always pinned at top */}
      {liveChannel && (
        <TouchableOpacity
          style={[styles.liveRow, isLive && styles.liveRowActive]}
          onPress={() => handleChannelPress(liveChannel)}
          activeOpacity={0.75}
        >
          <View style={styles.livePrefixWrap}>
            {isLive ? (
              <View style={styles.liveRecordingDot} />
            ) : (
              <Text style={styles.livePrefixInactive}>📡</Text>
            )}
          </View>
          <Text style={[styles.liveName, isLive && styles.liveNameActive]}>live</Text>
          {isLive && (
            <View style={styles.liveBadge}>
              <Text style={styles.liveBadgeText}>LIVE</Text>
            </View>
          )}
          {isLive && liveStatus?.viewerCount != null && (
            <Text style={styles.liveViewers}>{formatViewers(liveStatus.viewerCount)}</Text>
          )}
        </TouchableOpacity>
      )}

      <FlatList
        data={listItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          if (item.type === 'category_header') {
            return <Text style={styles.categoryHeader}>{item.name.toUpperCase()}</Text>;
          }
          const channel = item as Channel;
          const isVoice = channel.type === 'voice';
          return (
            <TouchableOpacity
              style={styles.channelRow}
              onPress={() => handleChannelPress(channel)}
              onLongPress={() => nav.navigate('ChannelSettings', { guildId, channelId: channel.id })}
              delayLongPress={400}
            >
              <Text style={styles.channelPrefix}>{isVoice ? '🔊' : '#'}</Text>
              <Text style={styles.channelName}>{channel.name}</Text>
              {channel.topic ? (
                <Text style={styles.channelTopic} numberOfLines={1}>{channel.topic}</Text>
              ) : null}
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}

function formatViewers(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

const styles = StyleSheet.create({
  container:         { flex: 1, backgroundColor: '#0a0a0f' },
  list:              { padding: 12 },
  categoryHeader:    { color: '#6b7280', fontSize: 11, fontWeight: '700', letterSpacing: 0.8, paddingHorizontal: 4, paddingTop: 20, paddingBottom: 6 },
  channelRow:        { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 10, borderRadius: 8 },
  channelPrefix:     { color: '#6b7280', fontSize: 16, width: 22, textAlign: 'center' },
  channelName:       { color: '#94a3b8', fontSize: 15, fontWeight: '500', flex: 1 },
  channelTopic:      { color: '#4b5563', fontSize: 12, flex: 1 },

  // #live row
  liveRow:           { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginTop: 12, marginBottom: 4, paddingHorizontal: 10, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: '#1e1e2e', backgroundColor: '#0e0e16' },
  liveRowActive:     { borderColor: 'rgba(239,68,68,0.5)', backgroundColor: 'rgba(239,68,68,0.06)' },
  livePrefixWrap:    { width: 22, alignItems: 'center' },
  liveRecordingDot:  { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ef4444' },
  livePrefixInactive:{ fontSize: 15 },
  liveName:          { color: '#6b7280', fontSize: 15, fontWeight: '600', flex: 1 },
  liveNameActive:    { color: '#fca5a5' },
  liveBadge:         { backgroundColor: '#ef4444', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  liveBadgeText:     { color: '#ffffff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  liveViewers:       { color: '#9ca3af', fontSize: 11, marginLeft: 4 },
});
