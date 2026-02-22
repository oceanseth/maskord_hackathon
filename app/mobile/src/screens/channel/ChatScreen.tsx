import { useState, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useAuth, useMessages, sendMessage } from '@maskord/shared';
import type { Message } from '@maskord/shared';
import type { RouteProp } from '@react-navigation/native-stack';
import type { GuildStackParamList } from '../../navigation/AppNavigator';
import { SafeAreaView } from 'react-native-safe-area-context';

type Route = RouteProp<GuildStackParamList, 'Chat'>;

export default function ChatScreen() {
  const route = useRoute<Route>();
  const { guildId, channelId } = route.params;
  const { firebaseUser } = useAuth();
  const { messages, loading, hasMore, loadMore } = useMessages(guildId, channelId);
  const [input, setInput] = useState('');
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (messages.length > 0) {
      listRef.current?.scrollToEnd({ animated: false });
    }
  }, [messages.length]);

  async function handleSend() {
    const content = input.trim();
    if (!content || !firebaseUser) return;
    setInput('');
    await sendMessage(guildId, channelId, firebaseUser.uid, content);
  }

  function renderMessage({ item }: { item: Message }) {
    const isOwn = item.authorId === firebaseUser?.uid;
    const time = item.createdAt
      ? new Date(item.createdAt.toMillis()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';

    if (item.type === 'system_join') {
      return (
        <View style={styles.systemMessage}>
          <Text style={styles.systemText}>👋 Someone joined the server</Text>
        </View>
      );
    }

    return (
      <View style={[styles.messageRow, isOwn && styles.messageRowOwn]}>
        <View style={[styles.bubble, isOwn && styles.bubbleOwn]}>
          <Text style={styles.bubbleText}>{item.content}</Text>
        </View>
        <Text style={styles.messageTime}>{time}</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
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
            loading ? <Text style={styles.loadingText}>Loading...</Text> : null
          }
        />

        {/* Input */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Message..."
            placeholderTextColor="#6b7280"
            multiline
            maxLength={2000}
          />
          <TouchableOpacity
            style={[styles.sendButton, !input.trim() && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!input.trim()}
          >
            <Text style={styles.sendIcon}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#0e0e16' },
  flex:               { flex: 1 },
  messageList:        { padding: 12, gap: 4 },
  loadingText:        { color: '#6b7280', textAlign: 'center', padding: 12, fontSize: 13 },
  systemMessage:      { alignItems: 'center', paddingVertical: 4 },
  systemText:         { color: '#6b7280', fontSize: 12 },
  messageRow:         { alignItems: 'flex-start', marginVertical: 2 },
  messageRowOwn:      { alignItems: 'flex-end' },
  bubble:             { backgroundColor: '#1e1e2e', borderRadius: 14, borderBottomLeftRadius: 4, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '80%' },
  bubbleOwn:          { backgroundColor: '#5b21b6', borderBottomLeftRadius: 14, borderBottomRightRadius: 4 },
  bubbleText:         { color: '#e2e8f0', fontSize: 15, lineHeight: 21 },
  messageTime:        { color: '#4b5563', fontSize: 10, marginTop: 2, marginHorizontal: 4 },
  inputRow:           { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: '#1e1e2e', backgroundColor: '#0a0a12' },
  input:              { flex: 1, backgroundColor: '#1a1a28', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: '#e2e8f0', fontSize: 15, maxHeight: 100 },
  sendButton:         { width: 40, height: 40, borderRadius: 20, backgroundColor: '#7c3aed', alignItems: 'center', justifyContent: 'center' },
  sendButtonDisabled: { opacity: 0.3 },
  sendIcon:           { color: 'white', fontSize: 18, fontWeight: '700' },
});
