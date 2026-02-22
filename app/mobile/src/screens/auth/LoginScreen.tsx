import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '@maskord/shared';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../navigation/AuthNavigator';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Login'>;

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { signIn, signInWithGoogle, loading, error } = useAuth();
  const nav = useNavigation<Nav>();

  async function handleLogin() {
    await signIn(email, password);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Logo */}
        <View style={styles.logoArea}>
          <View style={styles.logoBox}>
            <Text style={styles.logoEmoji}>🎭</Text>
          </View>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to Maskord</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={styles.label}>EMAIL</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              placeholder="you@example.com"
              placeholderTextColor="#6b7280"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>PASSWORD</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••••••"
              placeholderTextColor="#6b7280"
            />
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="white" size="small" />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => signInWithGoogle()}
            disabled={loading}
          >
            <Text style={styles.secondaryButtonText}>Continue with Google</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={() => nav.navigate('Register')}>
          <Text style={styles.switchText}>
            Don't have an account? <Text style={styles.switchLink}>Register</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0a0a0f' },
  scroll:       { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logoArea:     { alignItems: 'center', marginBottom: 40 },
  logoBox:      { width: 64, height: 64, borderRadius: 16, backgroundColor: 'rgba(124,58,237,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  logoEmoji:    { fontSize: 30 },
  title:        { fontSize: 24, fontWeight: '700', color: '#ffffff', marginBottom: 4 },
  subtitle:     { fontSize: 14, color: '#6b7280' },
  form:         { gap: 12 },
  field:        { gap: 6 },
  label:        { fontSize: 10, fontWeight: '600', color: '#94a3b8', letterSpacing: 1 },
  input:        { backgroundColor: '#12121a', borderWidth: 1, borderColor: '#1e1e2e', borderRadius: 10, padding: 12, color: '#e2e8f0', fontSize: 14 },
  errorBox:     { backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', borderRadius: 8, padding: 10 },
  errorText:    { color: '#f87171', fontSize: 12 },
  button:       { backgroundColor: '#7c3aed', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 4 },
  buttonDisabled: { opacity: 0.5 },
  buttonText:   { color: 'white', fontWeight: '600', fontSize: 15 },
  divider:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dividerLine:  { flex: 1, height: 1, backgroundColor: '#1e1e2e' },
  dividerText:  { color: '#6b7280', fontSize: 12 },
  secondaryButton: { backgroundColor: '#12121a', borderWidth: 1, borderColor: '#1e1e2e', borderRadius: 10, padding: 14, alignItems: 'center' },
  secondaryButtonText: { color: '#e2e8f0', fontWeight: '500', fontSize: 15 },
  switchText:   { textAlign: 'center', color: '#6b7280', fontSize: 14, marginTop: 24 },
  switchLink:   { color: '#a78bfa', fontWeight: '500' },
});
