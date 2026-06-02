import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View, LogBox } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { fs } from '../src/utils/scale';
import { getDeviceLocation } from '../src/services/storage';
import { startNetworkSync, pushAllUnpushed } from '../src/services/autoPush';

LogBox.ignoreLogs(['Looks like you have configured linking in multiple places']);

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const [location, setLocation] = useState('');

  useEffect(() => {
    getDeviceLocation().then(setLocation);
    // Re-check location every 2s (in case changed via hamburger menu)
    const interval = setInterval(() => {
      getDeviceLocation().then(setLocation);
    }, 2000);
    // Start network-recovery sync and push any cached logs
    startNetworkSync();
    pushAllUnpushed();
    return () => clearInterval(interval);
  }, []);

  const isGateLocation = location.toLowerCase().includes('gate');
  
  return (
    <Tabs
      screenOptions={{
        tabBarStyle: [
          styles.tabBar,
          {
            paddingBottom: insets.bottom || 12,
            marginBottom: insets.bottom ? 0 : 0,
            minHeight: 76 + (insets.bottom || 0),
          },
        ],
        contentStyle: {
          paddingBottom: insets.bottom,
        } as any,
        sceneContainerStyle: {
          paddingBottom: insets.bottom,
        } as any,
        tabBarActiveTintColor: '#D97706',
        tabBarInactiveTintColor: '#B6A69B',
        tabBarLabelStyle: { fontSize: fs(15), fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
        tabBarIconStyle: { marginBottom: -2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'STUDENTS',
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <Ionicons name="school" size={28} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="maidcook"
        options={{
          title: 'MAID/COOK',
          headerShown: false,
          href: isGateLocation ? null : undefined,
          tabBarIcon: ({ color }) => (
            <Ionicons name="restaurant" size={28} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="visitors"
        options={{
          title: 'VISITORS',
          headerShown: false,
          href: null, // temporarily hidden
          tabBarIcon: ({ color }) => (
            <Ionicons name="person-add" size={28} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="taxi"
        options={{
          title: 'TAXI/CAB',
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <Ionicons name="car" size={28} color={color} />
          ),
        }}
      />
      {/* Hidden from tab bar — accessible via hamburger menu */}
      <Tabs.Screen
        name="logs"
        options={{
          title: 'LOG',
          headerShown: false,
          href: null,
        }}
      />
      <Tabs.Screen
        name="sync"
        options={{
          title: 'SYNC',
          headerShown: false,
          href: null,
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: 'ADMIN',
          headerShown: false,
          href: null,
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
