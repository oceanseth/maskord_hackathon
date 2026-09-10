import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text } from 'react-native';
import GuildListScreen from '../screens/guild/GuildListScreen';
import ServerSettingsScreen from '../screens/guild/ServerSettingsScreen';
import ChannelListScreen from '../screens/channel/ChannelListScreen';
import ChannelSettingsScreen from '../screens/channel/ChannelSettingsScreen';
import ChatScreen from '../screens/channel/ChatScreen';
import VoiceScreen from '../screens/voice/VoiceScreen';
import LiveChannelScreen from '../screens/live/LiveChannelScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import FriendsScreen from '../screens/friends/FriendsScreen';
import DmChatScreen from '../screens/friends/DmChatScreen';

export type AppTabParamList = {
  Guilds:   undefined;
  Friends:  undefined;
  Profile:  undefined;
};

export type GuildStackParamList = {
  GuildList:       undefined;
  ChannelList:     { guildId: string; guildName: string };
  ServerSettings:  { guildId: string };
  ChannelSettings: { guildId: string; channelId: string };
  Chat:            { guildId: string; channelId: string; channelName: string };
  Voice:           { guildId: string; channelId: string; channelName: string };
  Live:            { guildId: string; channelId: string };
};

export type FriendsStackParamList = {
  FriendsList: undefined;
  DmChat:      { partnerUid: string; partnerName: string };
};

const Tab          = createBottomTabNavigator<AppTabParamList>();
const GuildStack   = createNativeStackNavigator<GuildStackParamList>();
const FriendsStack = createNativeStackNavigator<FriendsStackParamList>();

const stackScreenOptions = {
  headerStyle:       { backgroundColor: '#0e0e16' },
  headerTintColor:   '#e2e8f0',
  headerTitleStyle:  { fontWeight: '600' as const },
  headerShadowVisible: false,
};

function GuildNavigator() {
  return (
    <GuildStack.Navigator screenOptions={stackScreenOptions}>
      <GuildStack.Screen name="GuildList"   component={GuildListScreen}   options={{ title: 'Servers' }} />
      <GuildStack.Screen name="ChannelList"     component={ChannelListScreen}     options={({ route }) => ({ title: route.params.guildName })} />
      <GuildStack.Screen name="ServerSettings"  component={ServerSettingsScreen}  options={{ title: 'Server Settings' }} />
      <GuildStack.Screen name="ChannelSettings" component={ChannelSettingsScreen} options={{ title: 'Channel Settings' }} />
      <GuildStack.Screen name="Chat"            component={ChatScreen}            options={({ route }) => ({ title: `#${route.params.channelName}` })} />
      <GuildStack.Screen name="Voice"       component={VoiceScreen}       options={({ route }) => ({ title: `🔊 ${route.params.channelName}` })} />
      <GuildStack.Screen name="Live"        component={LiveChannelScreen} options={{ title: '📡 live' }} />
    </GuildStack.Navigator>
  );
}

function FriendsNavigator() {
  return (
    <FriendsStack.Navigator screenOptions={stackScreenOptions}>
      <FriendsStack.Screen name="FriendsList" component={FriendsScreen}  options={{ title: 'Friends' }} />
      <FriendsStack.Screen name="DmChat"      component={DmChatScreen}   options={({ route }) => ({ title: route.params.partnerName })} />
    </FriendsStack.Navigator>
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
        tabBarActiveTintColor:   '#7c3aed',
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
        name="Friends"
        component={FriendsNavigator}
        options={{
          tabBarLabel: 'Friends',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>👥</Text>,
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
