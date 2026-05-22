import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { fs } from '../utils/scale';
import { getDeviceLocation, setDeviceLocation, LOCATION_OPTIONS } from '../services/storage';

interface MenuItem {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
}

const MENU_ITEMS: MenuItem[] = [
  { label: 'SYNC', icon: 'cloud-download', route: '/sync' },
  { label: 'LOGS', icon: 'list', route: '/logs' },
  { label: 'ADMIN', icon: 'people', route: '/admin' },
];

export default function HamburgerMenu() {
  const [visible, setVisible] = useState(false);
  const [locationModalVisible, setLocationModalVisible] = useState(false);
  const [currentLocation, setCurrentLocation] = useState('');
  const router = useRouter();

  useEffect(() => {
    getDeviceLocation().then(setCurrentLocation);
  }, []);

  const handleNavigate = (route: string) => {
    setVisible(false);
    router.push(route as any);
  };

  const handleOpenLocationPicker = () => {
    setVisible(false);
    setTimeout(() => setLocationModalVisible(true), 300);
  };

  const handleSelectLocation = async (loc: string) => {
    await setDeviceLocation(loc);
    setCurrentLocation(loc);
    setLocationModalVisible(false);
  };

  return (
    <>
      <TouchableOpacity
        style={styles.hamburgerBtn}
        onPress={() => setVisible(true)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="menu" size={28} color="#FFFBEB" />
      </TouchableOpacity>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setVisible(false)}>
          <View style={styles.menuPanel}>
            <View style={styles.menuHeader}>
              <Text style={styles.menuTitle}>MENU</Text>
              <TouchableOpacity onPress={() => setVisible(false)}>
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            {MENU_ITEMS.map((item) => (
              <TouchableOpacity
                key={item.route}
                style={styles.menuItem}
                onPress={() => handleNavigate(item.route)}
              >
                <Ionicons name={item.icon} size={22} color="#78350F" />
                <Text style={styles.menuItemText}>{item.label}</Text>
                <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleOpenLocationPicker}
            >
              <Ionicons name="location" size={22} color="#78350F" />
              <View style={{ flex: 1 }}>
                <Text style={styles.locationLabel}>LOCATION</Text>
                {currentLocation ? (
                  <Text style={styles.locationSubtext}>{currentLocation}</Text>
                ) : (
                  <Text style={[styles.locationSubtext, { color: '#EF4444' }]}>Not set</Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Location Picker Modal */}
      <Modal
        visible={locationModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLocationModalVisible(false)}
      >
        <Pressable style={styles.locationBackdrop} onPress={() => setLocationModalVisible(false)}>
          <View style={styles.locationPanel} onStartShouldSetResponder={() => true}>
            <View style={styles.locationHeader}>
              <Ionicons name="location" size={24} color="#78350F" />
              <Text style={styles.locationTitle}>SELECT DEVICE LOCATION</Text>
            </View>
            {LOCATION_OPTIONS.map((loc) => (
              <TouchableOpacity
                key={loc}
                style={[
                  styles.locationOption,
                  currentLocation === loc && styles.locationOptionSelected,
                ]}
                onPress={() => handleSelectLocation(loc)}
              >
                <Text style={[
                  styles.locationOptionText,
                  currentLocation === loc && styles.locationOptionTextSelected,
                ]}>{loc}</Text>
                {currentLocation === loc && (
                  <Ionicons name="checkmark-circle" size={22} color="#059669" />
                )}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.locationCancelBtn}
              onPress={() => setLocationModalVisible(false)}
            >
              <Text style={styles.locationCancelText}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  hamburgerBtn: {
    padding: 4,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  menuPanel: {
    width: 260,
    height: '100%',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 10,
  },
  menuHeader: {
    backgroundColor: '#78350F',
    paddingVertical: 18,
    paddingHorizontal: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  menuTitle: {
    fontSize: fs(18),
    fontWeight: '900',
    color: '#FFFBEB',
    letterSpacing: 2,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 14,
  },
  menuItemText: {
    flex: 1,
    fontSize: fs(15),
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 1,
  },
  locationLabel: {
    fontSize: fs(15),
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 1,
  },
  locationSubtext: {
    fontSize: fs(11),
    fontWeight: '600',
    color: '#059669',
    marginTop: 2,
    letterSpacing: 0.5,
  },
  locationBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  locationPanel: {
    width: 300,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 10,
  },
  locationHeader: {
    backgroundColor: '#78350F',
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  locationTitle: {
    fontSize: fs(14),
    fontWeight: '900',
    color: '#FFFBEB',
    letterSpacing: 1,
  },
  locationOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  locationOptionSelected: {
    backgroundColor: '#F0FDF4',
  },
  locationOptionText: {
    fontSize: fs(15),
    fontWeight: '700',
    color: '#0F172A',
  },
  locationOptionTextSelected: {
    color: '#059669',
  },
  locationCancelBtn: {
    paddingVertical: 14,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  locationCancelText: {
    fontSize: fs(14),
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 1,
  },
});
