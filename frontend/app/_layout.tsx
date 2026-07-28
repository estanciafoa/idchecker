import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View, Text, LogBox, Alert, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect, useRef } from 'react';
import { fs } from '../src/utils/scale';
import { getDeviceLocation, getOverstayVisitors, isAppDisplayRotation90, isScannerOnlyMode } from '../src/services/storage';
import { startNetworkSync, pushAllUnpushed } from '../src/services/autoPush';
import { startPhotoBackfill, stopPhotoBackfill, backfillMissingPhotos, runPhotoRepairOnce } from '../src/services/photoBackfill';
import { runAutoSync } from '../src/services/dataSync';
import { useNetworkStatus } from '../src/utils/useNetworkStatus';
import ErrorBoundary from '../src/components/ErrorBoundary';

import AsyncStorage from '@react-native-async-storage/async-storage';

LogBox.ignoreLogs(['Looks like you have configured linking in multiple places']);

const LAST_DAILY_PUSH_KEY = '@gate_check_last_daily_push';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const windowSize = useWindowDimensions();
  const [location, setLocation] = useState('');
  const [kioskMode, setKioskMode] = useState(false);
  const [rotateDisplay90, setRotateDisplay90] = useState(false);
  const isConnected = useNetworkStatus();
  const overstayAlertShown = useRef(false);

  const getTowerFromFlat = (flat: string): number | null => {
    const raw = (flat || '').trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    const towerWord = lower.match(/tower\s*([1-5])/);
    if (towerWord) return Number(towerWord[1]);
    const leadingDigit = raw.match(/^([1-5])\d{2,4}$/);
    if (leadingDigit) return Number(leadingDigit[1]);
    const prefixedDigit = raw.match(/^([1-5])[\s\-\/]/);
    if (prefixedDigit) return Number(prefixedDigit[1]);
    return null;
  };

  const getTowerFromLocation = (loc: string): number | null => {
    const m = (loc || '').match(/tower\s*([1-5])/i);
    return m ? Number(m[1]) : null;
  };

  useEffect(() => {
    getDeviceLocation().then(setLocation);
    isScannerOnlyMode().then(setKioskMode);
    isAppDisplayRotation90().then(setRotateDisplay90);
    // Re-check location every 2s (in case changed via hamburger menu)
    const interval = setInterval(() => {
      getDeviceLocation().then(setLocation);
      isAppDisplayRotation90().then(setRotateDisplay90);
    }, 2000);
    // Start network-recovery sync and push any cached logs
    startNetworkSync();
    pushAllUnpushed();

    // Backfill any missing faces from the Drive "faces" folder when online,
    // both now and whenever connectivity returns. Also run the one-time repair
    // of poisoned (HTML-saved-as-jpg) face files.
    startPhotoBackfill();
    backfillMissingPhotos();
    runPhotoRepairOnce();

    // Daily auto-backup: push all unpushed once per day
    const checkDailyPush = async () => {
      const last = await AsyncStorage.getItem(LAST_DAILY_PUSH_KEY);
      const todayStr = new Date().toISOString().slice(0, 10);
      if (last !== todayStr) {
        await pushAllUnpushed();
        await AsyncStorage.setItem(LAST_DAILY_PUSH_KEY, todayStr);
      }
    };
    checkDailyPush();
    const dailyInterval = setInterval(checkDailyPush, 60 * 60 * 1000); // check every hour

    // Visitor overstay check every hour
    const checkOverstay = async () => {
      try {
        const overstay = await getOverstayVisitors();
        if (overstay.length > 0) {
          const currentLocation = await getDeviceLocation();
          const normalized = currentLocation.trim().toLowerCase();
          const locationTower = getTowerFromLocation(currentLocation);

          // Notify only on Front Gate, EM Office, or the corresponding Tower device.
          let relevant = overstay;
          if (normalized === 'front gate' || normalized === 'em office') {
            relevant = overstay;
          } else if (locationTower) {
            relevant = overstay.filter(v => getTowerFromFlat(v.flat) === locationTower);
          } else {
            relevant = [];
          }

          if (relevant.length === 0) return;

          const lines = relevant.map(v =>
            `• ${v.name} (Flat ${v.flat}) — Card #${v.card_number}, expected out: ${v.check_out}`
          ).join('\n');
          Alert.alert(
            `⚠️ ${relevant.length} VISITOR${relevant.length > 1 ? 'S' : ''} OVERSTAYING`,
            `The following visitor${relevant.length > 1 ? 's have' : ' has'} not returned the ID card and exceeded check-out time:\n\n${lines}`,
            [{ text: 'OK' }],
          );
        }
      } catch (_) {}
    };
    // Run first check after 1 minute (let app load), then every hour
    const overstayTimeout = setTimeout(checkOverstay, 60 * 1000);
    const overstayInterval = setInterval(checkOverstay, 60 * 60 * 1000);

    // Auto-download student & visitor data from the sheet: shortly after launch,
    // then every hour. runAutoSync() no-ops when offline or no token is stored.
    const autoSyncTimeout = setTimeout(runAutoSync, 15 * 1000);
    const autoSyncInterval = setInterval(runAutoSync, 60 * 60 * 1000);

    return () => {
      clearInterval(interval);
      clearInterval(dailyInterval);
      clearTimeout(overstayTimeout);
      clearInterval(overstayInterval);
      clearTimeout(autoSyncTimeout);
      clearInterval(autoSyncInterval);
      stopPhotoBackfill();
    };
  }, []);

  const normalizedLocation = location.trim().toLowerCase();
  const isGateLocation = normalizedLocation.includes('gate');
  const isEmOffice = normalizedLocation === 'em office';

  const appContent = (
    <View style={{ flex: 1 }}>
    {!isConnected && (
      <View style={styles.offlineBanner}>
        <Ionicons name="cloud-offline" size={14} color="#FFFFFF" />
        <Text style={styles.offlineBannerText}>OFFLINE — logs queued for push</Text>
      </View>
    )}
    <Tabs
      screenOptions={{
        tabBarStyle: kioskMode ? { display: 'none' } : [
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
      } as any}
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
          href: location === 'Front Gate' ? undefined : null,
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
      <Tabs.Screen
        name="zoho"
        options={{
          title: 'ZOHO',
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <Ionicons name="business" size={28} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="logs"
        options={{
          title: 'LOG',
          headerShown: false,
          href: isEmOffice ? undefined : null,
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
    </View>
  );

  if (rotateDisplay90) {
    const { width, height } = windowSize;
    return (
      <ErrorBoundary>
        <View style={styles.rotatedViewport}>
          <View
            style={[
              styles.rotatedContent,
              {
                width: height,
                height: width,
                left: (width - height) / 2,
                top: (height - width) / 2,
              },
            ]}
          >
            {appContent}
          </View>
        </View>
      </ErrorBoundary>
    );
  }
  
  return (
    <ErrorBoundary>
    {appContent}
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  rotatedViewport: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  rotatedContent: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    transform: [{ rotate: '-90deg' }],
  },
  offlineBanner: {
    backgroundColor: '#DC2626',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  offlineBannerText: {
    color: '#FFFFFF',
    fontSize: fs(11),
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  tabBar: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 2,
    borderTopColor: '#000000',
    height: 64,
    paddingTop: 8,
  },
});
