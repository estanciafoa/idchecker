import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, ScrollView, RefreshControl, Platform, Image, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getLocalResidents, type Resident, clearAllData } from '../src/services/storage';

export default function AdminScreen() {
  const [residents, setResidents] = useState<Resident[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedResident, setSelectedResident] = useState<Resident | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => { loadResidents(); }, []);

  useFocusEffect(
    useCallback(() => {
      void loadResidents();
    }, [])
  );

  const loadResidents = async () => {
    const data = await getLocalResidents();
    setResidents(data);
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadResidents();
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleClearData = () => {
    setShowClearConfirm(true);
  };

  const confirmClearData = async () => {
    setClearing(true);
    try {
      await clearAllData();
      setShowClearConfirm(false);
      setResidents([]);
      Alert.alert('Success', 'All data cleared successfully');
    } catch (error) {
      Alert.alert('Error', 'Failed to clear data');
    } finally {
      setClearing(false);
    }
  };

  const renderResident = ({ item }: { item: Resident }) => (
    <TouchableOpacity testID={`admin-resident-${item.id}`} style={styles.residentItem} onPress={() => setSelectedResident(item)} activeOpacity={0.7}>
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
      <View style={[styles.statusBadge, item.status === 'active' ? styles.badgeActive : styles.badgeInactive]}>
        <Text style={styles.statusBadgeText}>{item.status === 'active' ? 'ACTIVE' : 'INACTIVE'}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView testID="admin-screen" style={styles.container}>
      <View style={styles.titleBar}>
        <Text style={styles.titleText}>ESTANCIA ID CHECK</Text>
        <TouchableOpacity onPress={handleClearData} disabled={clearing}>
          <Ionicons name="trash" size={24} color="#FF3B30" />
        </TouchableOpacity>
      </View>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerCount}>{residents.length}</Text>
          <Text style={styles.headerLabel}>TOTAL RESIDENTS</Text>
        </View>
      </View>

      <View style={styles.idFormatInfo}>
        <Ionicons name="information-circle" size={16} color="#64748B" />
        <Text style={styles.idFormatText}>View-only. Residents managed via Google Sheet sync.</Text>
      </View>

      {residents.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="people-outline" size={64} color="#CBD5E1" />
          <Text style={styles.emptyText}>NO RESIDENTS</Text>
          <Text style={styles.emptySubtext}>Go to SYNC tab to pull data from sheet</Text>
        </View>
      ) : (
        <FlatList testID="admin-resident-list" data={residents} keyExtractor={(item) => item.id} renderItem={renderResident} contentContainerStyle={styles.listContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} />
      )}

      {/* Resident Detail Modal */}
      {selectedResident && (
        <Modal visible={!!selectedResident} animationType="slide" transparent={false} onRequestClose={() => setSelectedResident(null)}>
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
              <View style={[styles.detailStatusBadge, selectedResident.status === 'active' ? styles.badgeActive : styles.badgeInactive]}>
                <Text style={styles.statusBadgeText}>{selectedResident.status === 'active' ? 'ACTIVE' : 'INACTIVE'}</Text>
              </View>
              <View style={styles.detailCard}>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>RESIDENT ID</Text><Text style={styles.detailValueMono}>{selectedResident.id}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>NAME</Text><Text style={styles.detailValue}>{selectedResident.name}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>FLAT</Text><Text style={styles.detailValue}>{selectedResident.unit}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>AADHAR</Text><Text style={styles.detailValue}>{selectedResident.aadhar_masked || 'N/A'}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>VEHICLE</Text><Text style={styles.detailValue}>{selectedResident.vehicle_plate || 'N/A'}</Text></View>
                {selectedResident.validity ? (
                  <View style={styles.detailRow}><Text style={styles.detailLabel}>VALIDITY</Text><Text style={styles.detailValue}>{selectedResident.validity}</Text></View>
                ) : null}
              </View>
            </ScrollView>
          </SafeAreaView>
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
  titleBar: { backgroundColor: '#0F172A', paddingVertical: 14, paddingHorizontal: 24, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  titleText: { fontSize: 20, fontWeight: '900', color: '#FFFFFF', letterSpacing: 2 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingHorizontal: 24, borderBottomWidth: 2, borderBottomColor: '#000000' },
  headerCount: { fontSize: 36, fontWeight: '900', color: '#000000' },
  headerLabel: { fontSize: 11, fontWeight: '700', color: '#64748B', letterSpacing: 2 },
  idFormatInfo: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 24, paddingVertical: 10, backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  idFormatText: { fontSize: 11, fontWeight: '600', color: '#64748B' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyText: { fontSize: 18, fontWeight: '900', color: '#475569', marginTop: 16 },
  emptySubtext: { fontSize: 14, color: '#94A3B8', marginTop: 8 },
  listContent: { padding: 12 },
  residentItem: { flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 8, borderWidth: 2, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF' },
  residentAvatar: { width: 48, height: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0055FF', marginRight: 12, overflow: 'hidden' },
  avatarImage: { width: 48, height: 48 },
  avatarText: { fontSize: 22, fontWeight: '900', color: '#FFFFFF' },
  residentInfo: { flex: 1 },
  residentName: { fontSize: 16, fontWeight: '800', color: '#000000' },
  residentId: { fontSize: 12, fontWeight: '700', color: '#0055FF', marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  residentUnit: { fontSize: 12, fontWeight: '600', color: '#64748B', marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4 },
  badgeActive: { backgroundColor: '#00C853' },
  badgeInactive: { backgroundColor: '#FF3B30' },
  statusBadgeText: { fontSize: 10, fontWeight: '900', color: '#FFFFFF', letterSpacing: 1 },
  // Detail
  detailContainer: { flex: 1, backgroundColor: '#FFFFFF' },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#0F172A', paddingVertical: 18, paddingHorizontal: 24, minHeight: 64 },
  backBtnText: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  detailContent: { padding: 24, alignItems: 'center' },
  detailPhoto: { width: 160, height: 160, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0055FF', borderWidth: 3, borderColor: '#000000', marginBottom: 16, overflow: 'hidden' },
  detailPhotoImg: { width: 160, height: 160 },
  detailPhotoText: { fontSize: 72, fontWeight: '900', color: '#FFFFFF' },
  detailStatusBadge: { paddingHorizontal: 16, paddingVertical: 6, marginBottom: 20 },
  detailCard: { width: '100%', borderWidth: 2, borderColor: '#000000', backgroundColor: '#F8FAFC', padding: 16 },
  detailRow: { marginBottom: 14, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', paddingBottom: 10 },
  detailLabel: { fontSize: 11, fontWeight: '700', color: '#64748B', letterSpacing: 2, marginBottom: 4 },
  detailValue: { fontSize: 18, fontWeight: '900', color: '#000000' },
  detailValueMono: { fontSize: 16, fontWeight: '800', color: '#0055FF', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24, width: '85%', alignItems: 'center', borderWidth: 2, borderColor: '#000000' },
  modalTitle: { fontSize: 18, fontWeight: '900', color: '#0F172A', marginBottom: 8, textAlign: 'center' },
  modalMessage: { fontSize: 14, color: '#475569', textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  modalButtonRow: { flexDirection: 'row', gap: 12, width: '100%' },
  modalButton: { flex: 1, height: 48, borderRadius: 10, justifyContent: 'center', alignItems: 'center', borderWidth: 2 },
  cancelButton: { borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  cancelButtonText: { fontSize: 13, fontWeight: '900', color: '#475569' },
  confirmButton: { borderColor: '#FF3B30', backgroundColor: '#FF3B30' },
  confirmButtonText: { fontSize: 13, fontWeight: '900', color: '#FFFFFF' },
});
