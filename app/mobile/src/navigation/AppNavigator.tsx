import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text } from 'react-native';
import GuildListScreen from '../screens/guild/GuildListScreen';
import ChannelListScreen from '../screens/channel/ChannelListScreen';
import ChatScreen from '../screens/channel/ChatScreen';
import VoiceScreen from '../screens/voice/VoiceScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';

export type AppTabParamList = {
  Guilds: undefined;
  Profile: undefined;
};

export type GuildStackParamList = {
  GuildList: undefined;
  ChannelList: { guildId: string; guildName: string };
  Chat: { guildId: string; channelId: string; channelName: string };
  Voice: { guildId: string; channelId: string; channelName: string };
};

const Tab = createBottomTabNavigator<AppTabParamList>();
const GuildStack = createNativeStackNavigator<GuildStackParamList>();

function GuildNavigator() {
  return (
    <GuildStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#0e0e16' },
        headerTintColor: '#e2e8f0',
        headerTitleStyle: { fontWeight: '600' },
        headerShadowVisible: false,
      }}
    >
      <GuildStack.Screen name="GuildList" component={GuildListScreen} options={{ title: 'Servers' }} />
      <GuildStack.Screen name="ChannelList" component={ChannelListScreen} options={({ route }) => ({ title: route.params.guildName })} />
      <GuildStack.Screen name="Chat" component={ChatScreen} options={({ route }) => ({ title: `#${route.params.channelName}` })} />
      <GuildStack.Screen name="Voice" component={VoiceScreen} options={({ route }) => ({ title: `🔊 ${route.params.channelName}` })} />
    </GuildStack.Navigator>
  );
}

export default function AppNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#06060a',
          borderTopColor: '#1e1e2e',
        },
        tabBarActiveTintColor: '#7c3aed',
        tabBarInactiveTintColor: '#6b7280',
      }}
    >
      <Tab.Screen
        name="Guilds"
        component={GuildNavigator}
        options={{
          tabBarLabel: 'Servers',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>🎭</Text>,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>👤</Text>,
        }}
      />
    </Tab.Navigator>
  );
}
