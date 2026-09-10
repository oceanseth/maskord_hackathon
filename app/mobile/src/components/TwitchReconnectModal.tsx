import { Modal, View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTwitchAuth } from '../hooks/useTwitchAuth';

interface Props {
  visible:  boolean;
  onClose:  () => void;
  /** Called after a successful reconnect so the caller can retry its action. */
  onSuccess?: () => void;
}

export default function TwitchReconnectModal({ visible, onClose, onSuccess }: Props) {
  const { reconnect, loading, error } = useTwitchAuth();

  async function handleReconnect() {
    const ok = await reconnect();
    if (ok) {
      onSuccess?.();
      onClose();
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <SafeAreaView style={styles.card}>
          <View style={styles.iconWrap}>
            <Text style={styles.icon}>🟣</Text>
          </View>

          <Text style={styles.title}>Twitch Disconnected</Text>
          <Text style={styles.body}>
            Your Twitch session has expired. Reconnect to send messages to Twitch chat.
          </Text>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.reconnectBtn, loading && styles.btnDisabled]}
            onPress={handleReconnect}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#bf94ff" size="small" />
            ) : (
              <Text style={styles.reconnectBtnText}>Reconnect Twitch</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={loading}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay:          { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card:             { width: '100%', maxWidth: 360, backgroundColor: '#0e0e16', borderRadius: 20, borderWidth: 1, borderColor: '#1e1e2e', padding: 24, alignItems: 'center', gap: 12 },
  iconWrap:         { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(145,70,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  icon:             { fontSize: 28 },
  title:            { color: '#ffffff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  body:             { color: '#94a3b8', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  errorBox:         { backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', borderRadius: 8, padding: 10, width: '100%' },
  errorText:        { color: '#f87171', fontSize: 12, textAlign: 'center' },
  reconnectBtn:     { width: '100%', backgroundColor: 'rgba(145,70,255,0.15)', borderWidth: 1, borderColor: 'rgba(145,70,255,0.4)', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 4 },
  btnDisabled:      { opacity: 0.5 },
  reconnectBtnText: { color: '#bf94ff', fontWeight: '600', fontSize: 15 },
  cancelBtn:        { padding: 10 },
  cancelBtnText:    { color: '#4b5563', fontSize: 14 },
});
