import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, ScrollView, RefreshControl, Platform, Image, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import HamburgerMenu from '../src/components/HamburgerMenu';
import { fs } from '../src/utils/scale';
import { getLocalResidents, getLocalMaidsCooks, type Resident, type MaidCook, clearAllData } from '../src/services/storage';
import PasswordLock from '../src/components/PasswordLock';

export default function AdminScreen() {
  const [unlocked, setUnlocked] = useState(false);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [maidsCooks, setMaidsCooks] = useState<MaidCook[]>([]);
  const [activeTab, setActiveTab] = useState<'students' | 'maidcook'>('students');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedResident, setSelectedResident] = useState<Resident | null>(null);
  const [selectedMaidCook, setSelectedMaidCook] = useState<MaidCook | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);

  const loadData = async () => {
    const data = await getLocalResidents();
    setResidents(data);
    const mc = await getLocalMaidsCooks();
    setMaidsCooks(mc);
  };

  useEffect(() => { if (unlocked) loadData(); }, [unlocked]);

  useFocusEffect(
    useCallback(() => {
      if (unlocked) void loadData();
    }, [unlocked])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  }, []);

  if (!unlocked) {
    return <PasswordLock onUnlock={() => setUnlocked(true)} title="ADMIN ACCESS" />;
  }

  const handleClearData = () => {
    setShowClearConfirm(true);
  };

  const confirmClearData = async () => {
    setClearing(true);
    try {
      await clearAllData();
      setShowClearConfirm(false);
      setResidents([]);
      setMaidsCooks([]);
      Alert.alert('Success', 'All data cleared successfully');
    } catch (error) {
      Alert.alert('Error', 'Failed to clear data');
    } finally {
      setClearing(false);
    }
  };

  const parseValidityDate = (validity: string): Date | null => {
    const text = validity.trim();

    let match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (match) {
      const [, day, month, year] = match;
      const parsed = new Date(Number(year), Number(month) - 1, Number(day));
      return isNaN(parsed.getTime()) ? null : parsed;
    }

    const monthMap: Record<string, number> = {
      january: 0,
      february: 1,
      march: 2,
      april: 3,
      may: 4,
      june: 5,
      july: 6,
      august: 7,
      september: 8,
      october: 9,
      november: 10,
      december: 11,
    };

    match = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})$/i);
    if (match) {
      const [, day, monthName, year] = match;
      const month = monthMap[monthName.toLowerCase()];
      if (month === undefined) return null;
      const parsed = new Date(Number(year), month, Number(day));
      return isNaN(parsed.getTime()) ? null : parsed;
    }

    return null;
  };

  const isBlackMarked = (resident: Resident): boolean => {
    const text = String(resident.validity || '').toUpperCase();
    return text.includes('BLACK LISTED') || text.includes('BLACK MARKED') || text.includes('BLACKLISTED');
  };

  const isExpired = (resident: Resident): boolean => {
    if (!resident.validity || isBlackMarked(resident)) return false;
    const validityDate = parseValidityDate(resident.validity);
    if (!validityDate) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return validityDate < today;
  };

  const getStatusMeta = (resident: Resident): { label: string; style: any } => {
    if (isBlackMarked(resident)) return { label: 'BLACK MARKED', style: styles.badgeBlackMarked };
    if (isExpired(resident)) return { label: 'EXPIRED', style: styles.badgeExpired };
    if (resident.status === 'active') return { label: 'ACTIVE', style: styles.badgeActive };
    return { label: 'INACTIVE', style: styles.badgeInactive };
  };

  const renderResident = ({ item }: { item: Resident }) => {
    const statusMeta = getStatusMeta(item);
    const blackMarked = isBlackMarked(item);

    return (
    <TouchableOpacity
      testID={`admin-resident-${item.id}`}
      style={[styles.residentItem, blackMarked && styles.residentItemBlackMarked]}
      onPress={() => setSelectedResident(item)}
      activeOpacity={0.7}
    >
      <View style={styles.residentAvatar}>
        {(item.local_photo || item.photo_url) ? (
          <Image source={{ uri: item.local_photo || item.photo_url }} style={styles.avatarImage} />
        ) : (
          <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
        )}
      </View>
      <View style={styles.residentInfo}>
        <Text style={styles.residentName}>{item.name}</Text>
        <Text style={styles.residentId}>ID: {item.id}</Text>
        <Text style={styles.residentUnit}>{item.unit}{item.vehicle_plate ? ` • ${item.vehicle_plate}` : ''}</Text>
      </View>
      <View style={[styles.statusBadge, statusMeta.style]}>
        <Text style={styles.statusBadgeText}>{statusMeta.label}</Text>
      </View>
    </TouchableOpacity>
    );
  };

  const renderMaidCook = ({ item }: { item: MaidCook }) => {
    const statusMeta = getStatusMeta(item as any);
    const blackMarked = isBlackMarked(item as any);

    return (
    <TouchableOpacity
      style={[styles.residentItem, blackMarked && styles.residentItemBlackMarked]}
      onPress={() => setSelectedMaidCook(item)}
      activeOpacity={0.7}
    >
      <View style={[styles.residentAvatar, { backgroundColor: '#78350F' }]}>
        {(item.local_photo || item.photo_url) ? (
          <Image source={{ uri: item.local_photo || item.photo_url }} style={styles.avatarImage} />
        ) : (
          <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
        )}
      </View>
      <View style={styles.residentInfo}>
        <Text style={styles.residentName}>{item.name}</Text>
        <Text style={styles.residentId}>ID: {item.id}</Text>
        <Text style={styles.residentUnit}>Flats: {item.flats}{item.vehicle_plate ? ` • ${item.vehicle_plate}` : ''}</Text>
      </View>
      <View style={[styles.statusBadge, statusMeta.style]}>
        <Text style={styles.statusBadgeText}>{statusMeta.label}</Text>
      </View>
    </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView testID="admin-screen" style={styles.container}>
      <View style={styles.titleBar}>
        <HamburgerMenu />
        <Text style={styles.titleText}>ADMIN</Text>
        <TouchableOpacity onPress={handleClearData} disabled={clearing}>
          <Ionicons name="trash" size={24} color="#FF3B30" />
        </TouchableOpacity>
      </View>
      {/* Tab Switcher */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'students' && styles.tabBtnActive]}
          onPress={() => setActiveTab('students')}
        >
          <Ionicons name="school" size={16} color={activeTab === 'students' ? '#FFFFFF' : '#78350F'} />
          <Text style={[styles.tabBtnText, activeTab === 'students' && styles.tabBtnTextActive]}>STUDENTS ({residents.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'maidcook' && styles.tabBtnActive]}
          onPress={() => setActiveTab('maidcook')}
        >
          <Ionicons name="restaurant" size={16} color={activeTab === 'maidcook' ? '#FFFFFF' : '#78350F'} />
          <Text style={[styles.tabBtnText, activeTab === 'maidcook' && styles.tabBtnTextActive]}>MAIDS & COOKS ({maidsCooks.length})</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.idFormatInfo}>
        <Ionicons name="information-circle" size={16} color="#64748B" />
        <Text style={styles.idFormatText}>View-only. Data managed via Google Sheet sync.</Text>
      </View>

      {activeTab === 'students' ? (
        residents.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="people-outline" size={64} color="#CBD5E1" />
            <Text style={styles.emptyText}>NO RESIDENTS</Text>
            <Text style={styles.emptySubtext}>Go to SYNC to pull data from sheet</Text>
          </View>
        ) : (
          <FlatList testID="admin-resident-list" data={residents} keyExtractor={(item) => item.id} renderItem={renderResident} contentContainerStyle={styles.listContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} />
        )
      ) : (
        maidsCooks.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="restaurant-outline" size={64} color="#CBD5E1" />
            <Text style={styles.emptyText}>NO MAIDS & COOKS</Text>
            <Text style={styles.emptySubtext}>Go to SYNC to pull data from sheet</Text>
          </View>
        ) : (
          <FlatList testID="admin-maidcook-list" data={maidsCooks} keyExtractor={(item) => item.id} renderItem={renderMaidCook} contentContainerStyle={styles.listContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} />
        )
      )}

      {/* Resident Detail Modal */}
      {selectedResident && (
        <Modal visible={!!selectedResident} animationType="slide" transparent={false} onRequestClose={() => setSelectedResident(null)}>
          {(() => {
            const statusMeta = getStatusMeta(selectedResident);
            return (
          <SafeAreaView style={styles.detailContainer}>
            <TouchableOpacity testID="close-detail-modal" onPress={() => setSelectedResident(null)} style={styles.backBtn} activeOpacity={0.6}>
              <Ionicons name="arrow-back" size={28} color="#FFFFFF" />
              <Text style={styles.backBtnText}>BACK</Text>
            </TouchableOpacity>
            <ScrollView contentContainerStyle={styles.detailContent}>
              <View style={styles.detailPhoto}>
                {(selectedResident.local_photo || selectedResident.photo_url) ? (
                  <Image source={{ uri: selectedResident.local_photo || selectedResident.photo_url }} style={styles.detailPhotoImg} />
                ) : (
                  <Text style={styles.detailPhotoText}>{selectedResident.name.charAt(0).toUpperCase()}</Text>
                )}
              </View>
              <View style={[styles.detailStatusBadge, statusMeta.style]}>
                <Text style={styles.statusBadgeText}>{statusMeta.label}</Text>
              </View>
              <View style={styles.detailCard}>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>RESIDENT ID</Text><Text style={styles.detailValueMono}>{selectedResident.id}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>NAME</Text><Text style={styles.detailValue}>{selectedResident.name}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>FLAT</Text><Text style={styles.detailValue}>{selectedResident.unit}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>PHONE</Text><Text style={styles.detailValue}>{selectedResident.phone_last4 ? `••••${selectedResident.phone_last4}` : 'N/A'}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>VEHICLE</Text><Text style={styles.detailValue}>{selectedResident.vehicle_plate || 'N/A'}</Text></View>
                {selectedResident.validity ? (
                  <View style={styles.detailRow}><Text style={styles.detailLabel}>VALIDITY</Text><Text style={styles.detailValue}>{selectedResident.validity}</Text></View>
                ) : null}
              </View>
            </ScrollView>
          </SafeAreaView>
            );
          })()}
        </Modal>
      )}

      {/* MaidCook Detail Modal */}
      {selectedMaidCook && (
        <Modal visible={!!selectedMaidCook} animationType="slide" transparent={false} onRequestClose={() => setSelectedMaidCook(null)}>
          {(() => {
            const statusMeta = getStatusMeta(selectedMaidCook as any);
            return (
          <SafeAreaView style={styles.detailContainer}>
            <TouchableOpacity onPress={() => setSelectedMaidCook(null)} style={styles.backBtn} activeOpacity={0.6}>
              <Ionicons name="arrow-back" size={28} color="#FFFFFF" />
              <Text style={styles.backBtnText}>BACK</Text>
            </TouchableOpacity>
            <ScrollView contentContainerStyle={styles.detailContent}>
              <View style={[styles.detailPhoto, { backgroundColor: '#78350F' }]}>
                {(selectedMaidCook.local_photo || selectedMaidCook.photo_url) ? (
                  <Image source={{ uri: selectedMaidCook.local_photo || selectedMaidCook.photo_url }} style={styles.detailPhotoImg} />
                ) : (
                  <Text style={styles.detailPhotoText}>{selectedMaidCook.name.charAt(0).toUpperCase()}</Text>
                )}
              </View>
              <View style={[styles.detailStatusBadge, statusMeta.style]}>
                <Text style={styles.statusBadgeText}>{statusMeta.label}</Text>
              </View>
              <View style={styles.detailCard}>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>ID</Text><Text style={styles.detailValueMono}>{selectedMaidCook.id}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>NAME</Text><Text style={styles.detailValue}>{selectedMaidCook.name}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>FLATS</Text><Text style={styles.detailValue}>{selectedMaidCook.flats}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>PHONE</Text><Text style={styles.detailValue}>{selectedMaidCook.phone_last4 ? `••••${selectedMaidCook.phone_last4}` : 'N/A'}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>VEHICLE</Text><Text style={styles.detailValue}>{selectedMaidCook.vehicle_plate || 'N/A'}</Text></View>
                {selectedMaidCook.validity ? (
                  <View style={styles.detailRow}><Text style={styles.detailLabel}>VALIDITY</Text><Text style={styles.detailValue}>{selectedMaidCook.validity}</Text></View>
                ) : null}
              </View>
            </ScrollView>
          </SafeAreaView>
            );
          })()}
        </Modal>
      )}

      {/* Clear Data Confirmation Modal */}
      <Modal visible={showClearConfirm} transparent={true} animationType="fade" onRequestClose={() => setShowClearConfirm(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Ionicons name="warning" size={48} color="#FF3B30" style={{ marginBottom: 16 }} />
            <Text style={styles.modalTitle}>DELETE ALL DATA?</Text>
            <Text style={styles.modalMessage}>
              This will permanently delete all residents, photos, and access logs from your device. This action cannot be undone.
            </Text>
            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setShowClearConfirm(false)}
                disabled={clearing}
              >
                <Text style={styles.cancelButtonText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton]}
                onPress={confirmClearData}
                disabled={clearing}
              >
                <Text style={styles.confirmButtonText}>{clearing ? 'CLEARING...' : 'DELETE'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  titleBar: { backgroundColor: '#78350F', paddingVertical: 14, paddingHorizontal: 24, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  titleText: { fontSize: fs(20), fontWeight: '900', color: '#FFFBEB', letterSpacing: 2 },
  tabRow: { flexDirection: 'row', borderBottomWidth: 2, borderBottomColor: '#000000' },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, backgroundColor: '#F8FAFC' },
  tabBtnActive: { backgroundColor: '#78350F' },
  tabBtnText: { fontSize: fs(12), fontWeight: '900', color: '#78350F', letterSpacing: 1 },
  tabBtnTextActive: { color: '#FFFFFF' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingHorizontal: 24, borderBottomWidth: 2, borderBottomColor: '#000000' },
  headerCount: { fontSize: fs(36), fontWeight: '900', color: '#000000' },
  headerLabel: { fontSize: fs(11), fontWeight: '700', color: '#64748B', letterSpacing: 2 },
  idFormatInfo: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 24, paddingVertical: 10, backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  idFormatText: { fontSize: fs(11), fontWeight: '600', color: '#64748B' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyText: { fontSize: fs(18), fontWeight: '900', color: '#475569', marginTop: 16 },
  emptySubtext: { fontSize: fs(14), color: '#94A3B8', marginTop: 8 },
  listContent: { padding: 12 },
  residentItem: { flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 8, borderWidth: 2, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF' },
  residentItemBlackMarked: { borderColor: '#7F1D1D', backgroundColor: '#FEF2F2' },
  residentAvatar: { width: 48, height: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0055FF', marginRight: 12, overflow: 'hidden' },
  avatarImage: { width: 48, height: 48 },
  avatarText: { fontSize: fs(22), fontWeight: '900', color: '#FFFFFF' },
  residentInfo: { flex: 1 },
  residentName: { fontSize: fs(16), fontWeight: '800', color: '#000000' },
  residentId: { fontSize: fs(12), fontWeight: '700', color: '#0055FF', marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  residentUnit: { fontSize: fs(12), fontWeight: '600', color: '#64748B', marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4 },
  badgeActive: { backgroundColor: '#00C853' },
  badgeExpired: { backgroundColor: '#B45309' },
  badgeBlackMarked: { backgroundColor: '#7F1D1D' },
  badgeInactive: { backgroundColor: '#FF3B30' },
  statusBadgeText: { fontSize: fs(10), fontWeight: '900', color: '#FFFFFF', letterSpacing: 1 },
  // Detail
  detailContainer: { flex: 1, backgroundColor: '#FFFFFF' },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#0F172A', paddingVertical: 18, paddingHorizontal: 24, minHeight: 64 },
  backBtnText: { color: '#FFFFFF', fontSize: fs(18), fontWeight: '900', letterSpacing: 1 },
  detailContent: { padding: 24, alignItems: 'center' },
  detailPhoto: { width: 160, height: 160, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0055FF', borderWidth: 3, borderColor: '#000000', marginBottom: 16, overflow: 'hidden' },
  detailPhotoImg: { width: 160, height: 160 },
  detailPhotoText: { fontSize: fs(72), fontWeight: '900', color: '#FFFFFF' },
  detailStatusBadge: { paddingHorizontal: 16, paddingVertical: 6, marginBottom: 20 },
  detailCard: { width: '100%', borderWidth: 2, borderColor: '#000000', backgroundColor: '#F8FAFC', padding: 16 },
  detailRow: { marginBottom: 14, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', paddingBottom: 10 },
  detailLabel: { fontSize: fs(11), fontWeight: '700', color: '#64748B', letterSpacing: 2, marginBottom: 4 },
  detailValue: { fontSize: fs(18), fontWeight: '900', color: '#000000' },
  detailValueMono: { fontSize: fs(16), fontWeight: '800', color: '#0055FF', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24, width: '85%', alignItems: 'center', borderWidth: 2, borderColor: '#000000' },
  modalTitle: { fontSize: fs(18), fontWeight: '900', color: '#0F172A', marginBottom: 8, textAlign: 'center' },
  modalMessage: { fontSize: fs(14), color: '#475569', textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  modalButtonRow: { flexDirection: 'row', gap: 12, width: '100%' },
  modalButton: { flex: 1, height: 48, borderRadius: 10, justifyContent: 'center', alignItems: 'center', borderWidth: 2 },
  cancelButton: { borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  cancelButtonText: { fontSize: fs(13), fontWeight: '900', color: '#475569' },
  confirmButton: { borderColor: '#FF3B30', backgroundColor: '#FF3B30' },
  confirmButtonText: { fontSize: fs(13), fontWeight: '900', color: '#FFFFFF' },
});
