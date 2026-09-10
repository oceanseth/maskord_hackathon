import { useState, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import TwitchReconnectModal from '../../components/TwitchReconnectModal';
import { useRoute } from '@react-navigation/native';
import { WebView } from 'react-native-webview';
import {
  useAuth, useLiveMessages, useLiveStatus,
  LiveNetwork, type LiveMessage, type LiveNetworkValue,
} from '@maskord/shared';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFunctions } from '@maskord/shared';
import type { RouteProp } from '@react-navigation/native-stack';
import type { GuildStackParamList } from '../../navigation/AppNavigator';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMaskyAvatars } from '../../hooks/useMaskyAvatars';

type Route = RouteProp<GuildStackParamList, 'Live'>;

// ─── Platform colour coding ───────────────────────────────────────────────────

const NETWORK_COLORS: Record<number, { name: string; color: string; bg: string }> = {
  [LiveNetwork.Twitch]:  { name: 'Twitch',  color: '#bf94ff', bg: 'rgba(145,70,255,0.1)' },
  [LiveNetwork.YouTube]: { name: 'YouTube', color: '#ff6b6b', bg: 'rgba(255,0,0,0.1)'    },
  [LiveNetwork.Facebook]:{ name: 'Facebook',color: '#60a5fa', bg: 'rgba(59,130,246,0.1)' },
  [LiveNetwork.Maskord]: { name: 'Maskord', color: '#a78bfa', bg: 'rgba(124,58,237,0.1)' },
};

function networkStyle(network: LiveNetworkValue) {
  return NETWORK_COLORS[network] ?? NETWORK_COLORS[LiveNetwork.Twitch];
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function LiveChannelScreen() {
  const route = useRoute<Route>();
  const { guildId } = route.params;
  const { firebaseUser } = useAuth();

  const { messages, loading, hasMore, loadMore } = useLiveMessages(guildId);
  const liveStatus = useLiveStatus(guildId);
  const isLive = liveStatus?.isLive === true;

  const { avatarGroups, selectedId } = useMaskyAvatars(firebaseUser?.uid ?? null);
  const selectedAvatar = avatarGroups.find((g) => g.id === selectedId) ?? null;

  const [input,            setInput]            = useState('');
  const [sending,          setSending]          = useState(false);
  const [videoOpen,        setVideoOpen]        = useState(false);
  const [twitchModalOpen,  setTwitchModalOpen]  = useState(false);
  const [pendingText,      setPendingText]      = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);

  // Actively poll Twitch on mount so the live status is current even if the
  // EventSub webhook hasn't fired yet (e.g. streamer hasn't re-authorised).
  useEffect(() => {
    if (!firebaseUser) return;
    httpsCallable(getFirebaseFunctions(), 'checkLiveStatus')({ guildId }).catch(() => {});
  }, [guildId, firebaseUser]);

  useEffect(() => {
    if (messages.length > 0) listRef.current?.scrollToEnd({ animated: false });
  }, [messages.length]);

  async function handleSend() {
    const text = input.trim();
    if (!text || !firebaseUser) return;
    setInput('');
    setSending(true);
    try {
      await httpsCallable(getFirebaseFunctions(), 'sendLiveChatMessage')({ guildId, text });
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (
        code === 'functions/failed-precondition' ||
        code === 'functions/unauthenticated'
      ) {
        // Save the message so we can resend after reconnecting
        setPendingText(text);
        setTwitchModalOpen(true);
      }
      // Non-Twitch errors are silently dropped — the message just won't send
    } finally {
      setSending(false);
    }
  }

  function renderMessage({ item }: { item: LiveMessage }) {
    const ns = networkStyle(item.network);
    const isMaskord = item.network === LiveNetwork.Maskord;
    const time = item.timestamp
      ? new Date((item.timestamp as { toMillis(): number }).toMillis())
          .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';

    return (
      <View style={[styles.msgRow, { backgroundColor: ns.bg }]}>
        <View style={styles.msgLeft}>
          <View style={styles.msgHeader}>
            <Text style={[styles.msgSender, { color: ns.color }]}>
              {item.senderName}
            </Text>
            {!isMaskord && (
              <View style={[styles.platformBadge, { borderColor: ns.color + '60' }]}>
                <Text style={[styles.platformBadgeText, { color: ns.color }]}>{ns.name}</Text>
              </View>
            )}
            <Text style={styles.msgTime}>{time}</Text>
          </View>
          <Text style={styles.msgText}>{item.text}</Text>
        </View>
      </View>
    );
  }

  return (
    <>
    <TwitchReconnectModal
      visible={twitchModalOpen}
      onClose={() => { setTwitchModalOpen(false); setPendingText(null); }}
      onSuccess={() => {
        // Retry the message that triggered the reconnect
        if (pendingText) {
          setPendingText(null);
          httpsCallable(getFirebaseFunctions(), 'sendLiveChatMessage')({ guildId, text: pendingText })
            .catch(() => {});
        }
      }}
    />
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Live video strip */}
      {isLive && liveStatus?.twitchLogin && (
        <TouchableOpacity
          style={styles.videoStrip}
          onPress={() => setVideoOpen((v) => !v)}
          activeOpacity={0.85}
        >
          <View style={styles.recordingDot} />
          <Text style={styles.videoStripTitle} numberOfLines={1}>
            {liveStatus.streamTitle || 'Live Stream'}
          </Text>
          <Text style={styles.videoStripAction}>{videoOpen ? 'Hide ▲' : 'Watch ▼'}</Text>
        </TouchableOpacity>
      )}

      {/* Twitch embed player */}
      {isLive && videoOpen && liveStatus?.twitchLogin && (
        <View style={styles.player}>
          <WebView
            source={{
              uri: `https://player.twitch.tv/?channel=${liveStatus.twitchLogin}&parent=maskord.com&muted=false`,
            }}
            style={styles.webview}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
          />
        </View>
      )}

      {/* Active mask indicator */}
      {selectedAvatar && (
        <View style={styles.maskBanner}>
          <Text style={styles.maskBannerText}>
            Sending as <Text style={styles.maskBannerName}>{selectedAvatar.displayName}</Text>
          </Text>
        </View>
      )}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={88}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          onStartReached={hasMore ? loadMore : undefined}
          onStartReachedThreshold={0.1}
          ListHeaderComponent={
            loading
              ? <Text style={styles.loadingText}>Loading messages…</Text>
              : messages.length === 0
              ? <Text style={styles.emptyText}>
                  {isLive ? 'Chat messages will appear here.' : 'No live stream right now.'}
                </Text>
              : null
          }
        />

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Send to Twitch chat…"
            placeholderTextColor="#6b7280"
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.sendButton, (!input.trim() || sending) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!input.trim() || sending}
          >
            <Text style={styles.sendIcon}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:         { flex: 1, backgroundColor: '#0a0a0f' },
  flex:              { flex: 1 },

  // Video strip
  videoStrip:        { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: 'rgba(239,68,68,0.12)', borderBottomWidth: 1, borderBottomColor: 'rgba(239,68,68,0.25)' },
  recordingDot:      { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' },
  videoStripTitle:   { flex: 1, color: '#fca5a5', fontSize: 13, fontWeight: '600' },
  videoStripAction:  { color: '#9ca3af', fontSize: 12 },
  player:            { height: 200 },
  webview:           { flex: 1, backgroundColor: '#000' },

  // Mask banner
  maskBanner:        { paddingHorizontal: 14, paddingVertical: 6, backgroundColor: 'rgba(124,58,237,0.1)', borderBottomWidth: 1, borderBottomColor: 'rgba(124,58,237,0.2)' },
  maskBannerText:    { color: '#6b7280', fontSize: 12 },
  maskBannerName:    { color: '#a78bfa', fontWeight: '600' },

  // Messages
  messageList:       { padding: 10, gap: 3 },
  loadingText:       { color: '#6b7280', textAlign: 'center', padding: 16, fontSize: 13 },
  emptyText:         { color: '#4b5563', textAlign: 'center', padding: 32, fontSize: 13 },

  msgRow:            { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginVertical: 1 },
  msgLeft:           { flex: 1 },
  msgHeader:         { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  msgSender:         { fontWeight: '700', fontSize: 13 },
  platformBadge:     { borderWidth: 1, borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 },
  platformBadgeText: { fontSize: 9, fontWeight: '700' },
  msgTime:           { color: '#4b5563', fontSize: 10, marginLeft: 'auto' },
  msgText:           { color: '#e2e8f0', fontSize: 14, lineHeight: 19 },

  // Input
  inputRow:          { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: '#1e1e2e', backgroundColor: '#0a0a12' },
  input:             { flex: 1, backgroundColor: '#1a1a28', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: '#e2e8f0', fontSize: 15, maxHeight: 100 },
  sendButton:        { width: 40, height: 40, borderRadius: 20, backgroundColor: '#7c3aed', alignItems: 'center', justifyContent: 'center' },
  sendButtonDisabled:{ opacity: 0.3 },
  sendIcon:          { color: 'white', fontSize: 18, fontWeight: '700' },
});
