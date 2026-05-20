import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import HamburgerMenu from '../src/components/HamburgerMenu';
import { fs } from '../src/utils/scale';

export default function VisitorsScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.titleBar}>
        <HamburgerMenu />
        <Text style={styles.titleText}>VISITORS</Text>
        <View style={{ width: 36 }} />
      </View>
      <View style={styles.content}>
        <Ionicons name="construct-outline" size={64} color="#D97706" />
        <Text style={styles.heading}>COMING SOON</Text>
        <Text style={styles.subText}>
          Visitor management will be available in the next update.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  titleBar: {
    backgroundColor: '#78350F',
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleText: { fontSize: fs(20), fontWeight: '900', color: '#FFFBEB', letterSpacing: 2 },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  heading: {
    fontSize: fs(24),
    fontWeight: '900',
    color: '#0F172A',
    marginTop: 20,
    letterSpacing: 2,
  },
  subText: {
    fontSize: fs(15),
    color: '#64748B',
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 22,
  },
});
