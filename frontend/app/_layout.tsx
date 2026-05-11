import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  
  return (
    <Tabs
      screenOptions={{
        tabBarStyle: [
          styles.tabBar,
          {
            paddingBottom: insets.bottom || 12,
            marginBottom: insets.bottom ? 0 : 0,
            minHeight: 64 + (insets.bottom || 0),
          },
        ],
        contentStyle: {
          paddingBottom: insets.bottom,
        },
        sceneContainerStyle: {
          paddingBottom: insets.bottom,
        },
        tabBarActiveTintColor: '#D97706',
        tabBarInactiveTintColor: '#B6A69B',
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'SCAN',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="scan" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="logs"
        options={{
          title: 'LOG',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="sync"
        options={{
          title: 'SYNC',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cloud-download" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: 'ADMIN',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 2,
    borderTopColor: '#000000',
    height: 64,
    paddingTop: 8,
  },
});
