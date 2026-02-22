import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useGuildChannels } from '@maskord/shared';
import type { Channel } from '@maskord/shared';
import type { NativeStackNavigationProp, RouteProp } from '@react-navigation/native-stack';
import type { GuildStackParamList } from '../../navigation/AppNavigator';
import { SafeAreaView } from 'react-native-safe-area-context';

type Nav = NativeStackNavigationProp<GuildStackParamList, 'ChannelList'>;
type Route = RouteProp<GuildStackParamList, 'ChannelList'>;

export default function ChannelListScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { guildId } = route.params;
  const channels = useGuildChannels(guildId);

  const categories = channels.filter((c) => c.type === 'category');
  const uncategorized = channels.filter((c) => c.type !== 'category' && !c.parentId);

  function handleChannelPress(channel: Channel) {
    if (channel.type === 'voice') {
      nav.navigate('Voice', { guildId, channelId: channel.id, channelName: channel.name });
    } else {
      nav.navigate('Chat', { guildId, channelId: channel.id, channelName: channel.name });
    }
  }

  const allItems: Array<Channel | { type: 'category_header'; name: string; id: string }> = [
    ...uncategorized,
    ...categories.flatMap((cat) => [
      { type: 'category_header' as const, name: cat.name, id: cat.id },
      ...channels.filter((c) => c.parentId === cat.id),
    ]),
  ];

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={allItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          if (item.type === 'category_header') {
            return (
              <Text style={styles.categoryHeader}>{item.name.toUpperCase()}</Text>
            );
          }
          const channel = item as Channel;
          const isVoice = channel.type === 'voice';
          return (
            <TouchableOpacity
              style={styles.channelRow}
              onPress={() => handleChannelPress(channel)}
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

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#0a0a0f' },
  list:            { padding: 12 },
  categoryHeader:  { color: '#6b7280', fontSize: 11, fontWeight: '700', letterSpacing: 0.8, paddingHorizontal: 4, paddingTop: 20, paddingBottom: 6 },
  channelRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 10, borderRadius: 8 },
  channelPrefix:   { color: '#6b7280', fontSize: 16, width: 22, textAlign: 'center' },
  channelName:     { color: '#94a3b8', fontSize: 15, fontWeight: '500', flex: 1 },
  channelTopic:    { color: '#4b5563', fontSize: 12, flex: 1 },
});
