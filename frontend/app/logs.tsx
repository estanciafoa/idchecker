import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
  ActivityIndicator,
  Modal,
  ScrollView,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import HamburgerMenu from '../src/components/HamburgerMenu';
import { AutoRickshawIcon, TruckIcon } from '../src/components/VehicleIcons';
import { fs } from '../src/utils/scale';
import { getLocalAccessLogs, getUnpushedAccessLogs, markAccessLogsPushed, getPendingVisitorCheckins, removePendingVisitorCheckin, getUnpushedAttendance, markAttendancePushed, getUnpushedTaxiLogs, markTaxiLogsPushed, getMaidCookAttendance, getTaxiLogs, getCurrentlyInMaidsCooks, loadLogPhoto, type AccessLogEntry, type MaidCookAttendanceEntry, type TaxiLogEntry, type PendingVisitorCheckin } from '../src/services/storage';
import { pushLogsToGoogleDrive, uploadVisitorCheckin, pushMaidCookAttendance, pushTaxiLogs } from '../src/services/api';

type UnifiedLogEntry = {
  id: string;
  type: 'access' | 'visitor' | 'maidcook' | 'taxi';
  title: string;
  subtitle: string;
  timestamp: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  vehicleType?: string;
  isDenied?: boolean;
  rawData?: any;
};

export default function LogsScreen() {
  const [allLogs, setAllLogs] = useState<UnifiedLogEntry[]>([]);
  const [activeFilter, setActiveFilter] = useState<'all' | 'access' | 'visitor' | 'maidcook' | 'taxi'>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [selectedLog, setSelectedLog] = useState<UnifiedLogEntry | null>(null);
  const [shiftStats, setShiftStats] = useState({ scans: 0, verified: 0, denied: 0, maidIn: 0, maidOut: 0, visitors: 0, vehicles: 0 });

  const handleShiftSummary = async () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const accessLogs = await getLocalAccessLogs();
    const todayAccess = accessLogs.filter(l => l.timestamp.slice(0, 10) === todayStr);
    const verified = todayAccess.filter(l => l.status === 'verified').length;
    const denied = todayAccess.filter(l => l.status !== 'verified').length;

    const maidLogs = await getMaidCookAttendance();
    const todayMaid = maidLogs.filter(l => l.timestamp.slice(0, 10) === todayStr);
    const maidIn = todayMaid.filter(l => l.direction === 'IN').length;
    const maidOut = todayMaid.filter(l => l.direction === 'OUT').length;

    const taxiLogs = await getTaxiLogs();
    const todayTaxi = taxiLogs.filter(l => l.timestamp.slice(0, 10) === todayStr);

    const checkins = await getPendingVisitorCheckins();
    const todayVisitors = checkins.filter(c => c.timestamp.slice(0, 10) === todayStr);

    const stillIn = await getCurrentlyInMaidsCooks();
    const stillInNames = stillIn.map(m => `${m.name} (Flat ${m.flat})`).join(', ') || 'None';

    const unpushedAccess = await getUnpushedAccessLogs();
    const unpushedAtt = await getUnpushedAttendance();
    const unpushedTaxi = await getUnpushedTaxiLogs();
    const pendingCount = unpushedAccess.length + checkins.length + unpushedAtt.length + unpushedTaxi.length;

    Alert.alert(
      'SHIFT SUMMARY',
      `Today (${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}):\n\n` +
      `ID Scans: ${todayAccess.length} (${verified} verified, ${denied} denied)\n` +
      `Visitors: ${todayVisitors.length}\n` +
      `Maid/Cook: ${maidIn} IN, ${maidOut} OUT\n` +
      `Vehicles: ${todayTaxi.length}\n\n` +
      `Still Inside: ${stillInNames}\n\n` +
      `Pending Upload: ${pendingCount} entries`,
    );
  };

  useEffect(() => {
    loadLogs();
  }, []);

  // Reload logs every time the tab is focused
  useFocusEffect(
    useCallback(() => {
      loadLogs();
    }, [])
  );

  const loadLogs = async () => {
    const [accessLogs, pendingCheckins, maidCookLogs, taxiLogs] = await Promise.all([
      getLocalAccessLogs(),
      getPendingVisitorCheckins(),
      getMaidCookAttendance(),
      getTaxiLogs(),
    ]);

    const unified: UnifiedLogEntry[] = [];

    for (const l of accessLogs) {
      unified.push({
        id: 'a_' + l.id,
        type: 'access',
        title: l.resident_name,
        subtitle: `ID: ${l.resident_id} • Flat: ${l.unit}`,
        timestamp: l.timestamp,
        icon: 'person',
        color: l.status === 'verified' ? '#00C853' : '#FF3B30',
        isDenied: l.status !== 'verified',
        rawData: l,
      });
    }

    for (const c of pendingCheckins) {
      unified.push({
        id: 'v_' + c.id,
        type: 'visitor',
        title: c.visitor.name,
        subtitle: `Visitor • Flat: ${c.visitor.flat}`,
        timestamp: c.timestamp,
        icon: 'people',
        color: '#F59E0B',
        rawData: c,

      });
    }

    for (const m of maidCookLogs) {
      unified.push({
        id: 'm_' + m.id,
        type: 'maidcook',
        title: m.name,
        subtitle: `${m.direction} • Flat: ${m.flat}`,
        timestamp: m.timestamp,
        icon: m.direction === 'IN' ? 'log-in' : 'log-out',
        color: m.direction === 'IN' ? '#7C3AED' : '#6366F1',
        rawData: m,
      });
    }

    for (const t of taxiLogs) {
      const vtype = (t as any).vehicle_type ? (t as any).vehicle_type.toUpperCase() : 'TAXI';
      unified.push({
        id: 't_' + t.id,
        type: 'taxi',
        title: t.vehicle_number || 'Vehicle',
        subtitle: `${vtype} • Tower: ${t.flat}`,
        timestamp: t.timestamp,
        icon: 'car',
        color: '#0EA5E9',
        vehicleType: (t as any).vehicle_type || 'auto',
        rawData: t,

      });
    }

    // Sort by timestamp descending (newest first)
    unified.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    setAllLogs(unified);

    // Count pending uploads
    const [ua, uc, uatt, ut] = await Promise.all([
      getUnpushedAccessLogs(), getPendingVisitorCheckins(),
      getUnpushedAttendance(), getUnpushedTaxiLogs(),
    ]);
    setPendingCount(ua.length + uc.length + uatt.length + ut.length);

    // Compute today's shift stats
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayAccess = accessLogs.filter(l => l.timestamp.slice(0, 10) === todayStr);
    const todayMaid = maidCookLogs.filter(l => l.timestamp.slice(0, 10) === todayStr);
    const todayTaxi = taxiLogs.filter(l => l.timestamp.slice(0, 10) === todayStr);
    const todayVisitors = pendingCheckins.filter(c => c.timestamp.slice(0, 10) === todayStr);
    setShiftStats({
      scans: todayAccess.length,
      verified: todayAccess.filter(l => l.status === 'verified').length,
      denied: todayAccess.filter(l => l.status !== 'verified').length,
      maidIn: todayMaid.filter(l => l.direction === 'IN').length,
      maidOut: todayMaid.filter(l => l.direction === 'OUT').length,
      visitors: todayVisitors.length,
      vehicles: todayTaxi.length,
    });
  };

  const filteredLogs = useMemo(() => activeFilter === 'all' ? allLogs : allLogs.filter(l => l.type === activeFilter), [allLogs, activeFilter]);

  const FILTERS: { key: typeof activeFilter; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'all', label: 'ALL', icon: 'list' },
    { key: 'access', label: 'ID CHECK', icon: 'person' },
    { key: 'visitor', label: 'VISITOR', icon: 'people' },
    { key: 'maidcook', label: 'MAID', icon: 'log-in' },
    { key: 'taxi', label: 'VEHICLE', icon: 'car' },
  ];

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadLogs();
    setRefreshing(false);
  }, []);

  const handlePushLogs = async () => {
    const unpushedAccess = await getUnpushedAccessLogs();
    const pendingCheckins = await getPendingVisitorCheckins();
    const unpushedAttendance = await getUnpushedAttendance();
    const unpushedTaxi = await getUnpushedTaxiLogs();
    if (unpushedAccess.length === 0 && pendingCheckins.length === 0 && unpushedAttendance.length === 0 && unpushedTaxi.length === 0) {
      Alert.alert('Nothing to Push', 'There are no logs to push.');
      return;
    }
    setPushing(true);
    const results: string[] = [];
    try {
      // Push access logs
      if (unpushedAccess.length > 0) {
        try {
          const result = await pushLogsToGoogleDrive(unpushedAccess);
          await markAccessLogsPushed(unpushedAccess.map(e => e.id));
          results.push(`${result.rowCount} access logs uploaded`);
        } catch (accErr: any) {
          results.push(`Access log upload failed: ${accErr.message || 'unknown error'}`);
        }
      }

      // Push pending visitor check-ins
      let checkinOk = 0, checkinFail = 0;
      for (const checkin of pendingCheckins) {
        try {
          const photoBase64 = await loadLogPhoto(checkin.compositeBase64);
          await uploadVisitorCheckin({
            visitor: checkin.visitor,
            photoBase64,
            timestamp: checkin.timestamp,
            location: checkin.location,
          });
          await removePendingVisitorCheckin(checkin.id);
          checkinOk++;
        } catch {
          checkinFail++;
        }
      }
      if (checkinOk > 0) results.push(`${checkinOk} visitor check-in(s) uploaded`);
      if (checkinFail > 0) results.push(`${checkinFail} check-in(s) failed`);

      // Push maid/cook attendance logs
      if (unpushedAttendance.length > 0) {
        try {
          const attResult = await pushMaidCookAttendance(unpushedAttendance);
          await markAttendancePushed(unpushedAttendance.map(e => e.id));
          results.push(`${attResult.rowsAppended} maid/cook attendance(s) uploaded`);
        } catch (attErr: any) {
          results.push(`Maid/cook upload failed: ${attErr.message || 'unknown error'}`);
        }
      }

      // Push taxi/cab logs
      if (unpushedTaxi.length > 0) {
        try {
          const withPhotos = await Promise.all(unpushedTaxi.map(async e => ({
            ...e,
            compositeBase64: await loadLogPhoto(e.compositeBase64),
          })));
          const taxiResult = await pushTaxiLogs(withPhotos);
          await markTaxiLogsPushed(unpushedTaxi.map(e => e.id));
          results.push(`${taxiResult.rowsAppended} taxi/cab log(s) uploaded`);
        } catch (taxiErr: any) {
          results.push(`Taxi/cab log upload failed: ${taxiErr.message || 'unknown error'}`);
        }
      }

      Alert.alert('Done', results.join('\n'));
    } catch (error: any) {
      Alert.alert('Upload Failed', error.message || 'Something went wrong');
    } finally {
      setPushing(false);
      await loadLogs();
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const hours = d.getHours().toString().padStart(2, '0');
    const mins = d.getMinutes().toString().padStart(2, '0');
    return `${hours}:${mins}`;
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const handleSelectLog = async (item: UnifiedLogEntry) => {
    if (item.rawData?.compositeBase64 && (item.type === 'taxi' || item.type === 'visitor')) {
      const photo = await loadLogPhoto(item.rawData.compositeBase64);
      setSelectedLog({ ...item, rawData: { ...item.rawData, compositeBase64: photo } });
    } else {
      setSelectedLog(item);
    }
  };

  const renderLogItem = ({ item }: { item: UnifiedLogEntry }) => (
    <TouchableOpacity testID={`log-item-${item.id}`} style={[styles.logItem, item.isDenied && { backgroundColor: '#FEE2E2', borderColor: '#FECACA' }]} onPress={() => handleSelectLog(item)} activeOpacity={0.7}>
      <View style={styles.logLeft}>
        <View style={[styles.iconCircle, { backgroundColor: item.color + '20' }]}>
          {item.vehicleType === 'auto' ? (
            <AutoRickshawIcon size={18} color={item.color} />
          ) : item.vehicleType === 'tempo' ? (
            <TruckIcon size={18} color={item.color} />
          ) : (
            <Ionicons name={item.icon} size={18} color={item.color} />
          )}
        </View>
      </View>
      <View style={styles.logCenter}>
        <Text style={styles.logName}>{item.title}</Text>
        <Text style={styles.logUnit}>{item.subtitle}</Text>
      </View>
      <View style={styles.logRight}>
        <Text style={styles.logTime}>{formatTime(item.timestamp)}</Text>
        <Text style={styles.logDate}>{formatDate(item.timestamp)}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView testID="access-log-screen" style={styles.container}>
      <View style={styles.titleBar}>
        <HamburgerMenu />
        <Text style={styles.titleText}>LOGS</Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity onPress={handlePushLogs} disabled={pushing} style={styles.pushButton}>
          {pushing ? (
            <ActivityIndicator size="small" color="#FFFBEB" />
          ) : (
            <View>
              <Ionicons name="cloud-upload-outline" size={28} color="#FFFBEB" />
              {pendingCount > 0 && (
                <View style={styles.pushBadge}>
                  <Text style={styles.pushBadgeText}>{pendingCount > 99 ? '99+' : pendingCount}</Text>
                </View>
              )}
            </View>
          )}
        </TouchableOpacity>
        </View>
      </View>
      {/* Push status banner */}
      <View style={[styles.pushStatusBanner, { backgroundColor: pendingCount === 0 ? '#F0FFF4' : '#FFFBEB' }]}>
        <Ionicons
          name={pendingCount === 0 ? 'checkmark-circle' : 'cloud-upload'}
          size={16}
          color={pendingCount === 0 ? '#00C853' : '#D97706'}
        />
        <Text style={[styles.pushStatusText, { color: pendingCount === 0 ? '#00C853' : '#D97706' }]}>
          {pendingCount === 0 ? 'ALL LOGS PUSHED' : `${pendingCount} LOG${pendingCount === 1 ? '' : 'S'} PENDING UPLOAD`}
        </Text>
      </View>
      <View style={styles.header}>
        <Text style={styles.headerCount}>{filteredLogs.length}</Text>
        <Text style={styles.headerLabel}>ENTRIES</Text>
      </View>

      {/* Today's Shift Summary */}
      <View style={styles.shiftSummaryRow}>
        <View style={styles.shiftStat}>
          <Ionicons name="school" size={14} color="#00C853" />
          <Text style={styles.shiftStatValue}>{shiftStats.verified}</Text>
          <Text style={styles.shiftStatLabel}>OK</Text>
        </View>
        <View style={styles.shiftStat}>
          <Ionicons name="close-circle" size={14} color="#FF3B30" />
          <Text style={[styles.shiftStatValue, { color: '#FF3B30' }]}>{shiftStats.denied}</Text>
          <Text style={styles.shiftStatLabel}>DENIED</Text>
        </View>
        <View style={styles.shiftStat}>
          <Ionicons name="people" size={14} color="#F59E0B" />
          <Text style={styles.shiftStatValue}>{shiftStats.visitors}</Text>
          <Text style={styles.shiftStatLabel}>VISIT</Text>
        </View>
        <View style={styles.shiftStat}>
          <Ionicons name="car" size={14} color="#0EA5E9" />
          <Text style={styles.shiftStatValue}>{shiftStats.vehicles}</Text>
          <Text style={styles.shiftStatLabel}>VEHICLE</Text>
        </View>
      </View>

      {/* Filter Chips */}
      <View style={styles.filterRow}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, activeFilter === f.key && styles.filterChipActive]}
            onPress={() => setActiveFilter(f.key)}
          >
            <Ionicons name={f.icon} size={14} color={activeFilter === f.key ? '#FFFFFF' : '#64748B'} />
            <Text style={[styles.filterChipText, activeFilter === f.key && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {filteredLogs.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="document-text-outline" size={64} color="#CBD5E1" />
          <Text style={styles.emptyText}>NO LOGS YET</Text>
          <Text style={styles.emptySubtext}>
            Activity will appear here
          </Text>
        </View>
      ) : (
        <FlatList
          testID="access-log-list"
          data={filteredLogs}
          keyExtractor={(item) => item.id}
          renderItem={renderLogItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
      )}

      {/* Log Detail Modal */}
      {selectedLog && (
        <Modal visible={!!selectedLog} animationType="slide" transparent={false} onRequestClose={() => setSelectedLog(null)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
            <TouchableOpacity onPress={() => setSelectedLog(null)} style={styles.detailBackBtn} activeOpacity={0.6}>
              <Ionicons name="arrow-back" size={28} color="#FFFFFF" />
              <Text style={styles.detailBackText}>BACK</Text>
            </TouchableOpacity>
            <ScrollView contentContainerStyle={styles.detailContent}>
              <View style={[styles.detailIconCircle, { backgroundColor: selectedLog.color + '20' }]}>
                {selectedLog.vehicleType === 'auto' ? (
                  <AutoRickshawIcon size={32} color={selectedLog.color} />
                ) : selectedLog.vehicleType === 'tempo' ? (
                  <TruckIcon size={32} color={selectedLog.color} />
                ) : (
                  <Ionicons name={selectedLog.icon} size={32} color={selectedLog.color} />
                )}
              </View>
              <Text style={styles.detailTitle}>{selectedLog.title}</Text>
              <View style={[styles.detailTypeBadge, { backgroundColor: selectedLog.color }]}>
                <Text style={styles.detailTypeBadgeText}>{selectedLog.type.toUpperCase()}{selectedLog.isDenied ? ' • DENIED' : ''}</Text>
              </View>

              <View style={styles.detailCard}>
                {selectedLog.type === 'access' && selectedLog.rawData && (
                  <>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>RESIDENT ID</Text><Text style={styles.detailValue}>{selectedLog.rawData.resident_id}</Text></View>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>NAME</Text><Text style={styles.detailValue}>{selectedLog.rawData.resident_name}</Text></View>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>FLAT</Text><Text style={styles.detailValue}>{selectedLog.rawData.unit}</Text></View>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>STATUS</Text><Text style={[styles.detailValue, { color: selectedLog.rawData.status === 'verified' ? '#00C853' : '#FF3B30' }]}>{selectedLog.rawData.status?.toUpperCase()}</Text></View>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>TIMESTAMP</Text><Text style={styles.detailValue}>{new Date(selectedLog.rawData.timestamp).toLocaleString('en-IN')}</Text></View>
                    {selectedLog.rawData.location ? <View style={styles.detailRow}><Text style={styles.detailLabel}>LOCATION</Text><Text style={styles.detailValue}>{selectedLog.rawData.location}</Text></View> : null}
                  </>
                )}

                {selectedLog.type === 'visitor' && selectedLog.rawData && (
                  <>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>VISITOR NAME</Text><Text style={styles.detailValue}>{selectedLog.rawData.visitor?.name}</Text></View>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>FLAT</Text><Text style={styles.detailValue}>{selectedLog.rawData.visitor?.flat}</Text></View>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>AADHAR</Text><Text style={styles.detailValue}>{selectedLog.rawData.visitor?.aadhar || 'N/A'}</Text></View>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>PURPOSE</Text><Text style={styles.detailValue}>{selectedLog.rawData.visitor?.purpose || 'N/A'}</Text></View>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>TIMESTAMP</Text><Text style={styles.detailValue}>{new Date(selectedLog.rawData.timestamp).toLocaleString('en-IN')}</Text></View>
                    {selectedLog.rawData.location ? <View style={styles.detailRow}><Text style={styles.detailLabel}>LOCATION</Text><Text style={styles.detailValue}>{selectedLog.rawData.location}</Text></View> : null}
                    {selectedLog.rawData.compositeBase64 ? (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>PHOTO</Text>
                        <Image source={{ uri: `data:image/jpeg;base64,${selectedLog.rawData.compositeBase64}` }} style={styles.detailPhoto} resizeMode="contain" />
                      </View>
                    ) : null}
                  </>
                )}

                {selectedLog.type === 'maidcook' && selectedLog.rawData && (
                  <>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>ID</Text><Text style={styles.detailValue}>{selectedLog.rawData.maid_cook_id}</Text></View>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>NAME</Text><Text style={styles.detailValue}>{selectedLog.rawData.name}</Text></View>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>FLAT</Text><Text style={styles.detailValue}>{selectedLog.rawData.flat}</Text></View>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>DIRECTION</Text><Text style={[styles.detailValue, { color: selectedLog.rawData.direction === 'IN' ? '#7C3AED' : '#6366F1' }]}>{selectedLog.rawData.direction}</Text></View>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>TIMESTAMP</Text><Text style={styles.detailValue}>{new Date(selectedLog.rawData.timestamp).toLocaleString('en-IN')}</Text></View>
                    {selectedLog.rawData.location ? <View style={styles.detailRow}><Text style={styles.detailLabel}>LOCATION</Text><Text style={styles.detailValue}>{selectedLog.rawData.location}</Text></View> : null}
                  </>
                )}

                {selectedLog.type === 'taxi' && selectedLog.rawData && (
                  <>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>VEHICLE NUMBER</Text><Text style={styles.detailValue}>{selectedLog.rawData.vehicle_number}</Text></View>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>VEHICLE TYPE</Text><Text style={styles.detailValue}>{(selectedLog.rawData.vehicle_type || 'auto').toUpperCase()}</Text></View>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>TOWER</Text><Text style={styles.detailValue}>{selectedLog.rawData.flat}</Text></View>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>TIMESTAMP</Text><Text style={styles.detailValue}>{new Date(selectedLog.rawData.timestamp).toLocaleString('en-IN')}</Text></View>
                    {selectedLog.rawData.location ? <View style={styles.detailRow}><Text style={styles.detailLabel}>LOCATION</Text><Text style={styles.detailValue}>{selectedLog.rawData.location}</Text></View> : null}
                    {selectedLog.rawData.compositeBase64 ? (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>PHOTO</Text>
                        <Image source={{ uri: `data:image/jpeg;base64,${selectedLog.rawData.compositeBase64}` }} style={styles.detailPhoto} resizeMode="contain" />
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            </ScrollView>
          </SafeAreaView>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  titleBar: { backgroundColor: '#78350F', paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleText: { fontSize: fs(20), fontWeight: '900', color: '#FFFBEB', letterSpacing: 2 },
  pushButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  pushBadge: { position: 'absolute', top: -6, right: -8, backgroundColor: '#FF3B30', borderRadius: 10, minWidth: 18, height: 18, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
  pushBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  pushStatusBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  pushStatusText: { fontSize: fs(11), fontWeight: '800', letterSpacing: 0.5 },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    padding: 24,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerCount: {
    fontSize: fs(36),
    fontWeight: '900',
    color: '#000000',
    marginRight: 8,
  },
  headerLabel: {
    fontSize: fs(14),
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 2,
  },
  shiftSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 8,
    paddingHorizontal: 8,
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  shiftStat: {
    alignItems: 'center',
    gap: 2,
  },
  shiftStatValue: {
    fontSize: fs(16),
    fontWeight: '900',
    color: '#000000',
  },
  shiftStatLabel: {
    fontSize: fs(8),
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterChipActive: {
    backgroundColor: '#78350F',
    borderColor: '#78350F',
  },
  filterChipText: {
    fontSize: fs(10),
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyText: {
    fontSize: fs(18),
    fontWeight: '900',
    color: '#475569',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: fs(14),
    color: '#94A3B8',
    marginTop: 8,
  },
  listContent: {
    padding: 16,
  },
  logItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  logLeft: {
    marginRight: 12,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logCenter: {
    flex: 1,
  },
  logName: {
    fontSize: fs(16),
    fontWeight: '800',
    color: '#000000',
  },
  logUnit: {
    fontSize: fs(13),
    fontWeight: '600',
    color: '#64748B',
    marginTop: 2,
  },
  logRight: {
    alignItems: 'flex-end',
  },
  logTime: {
    fontSize: fs(16),
    fontWeight: '900',
    color: '#000000',
  },
  logDate: {
    fontSize: fs(11),
    fontWeight: '600',
    color: '#94A3B8',
    marginTop: 2,
  },
  // Detail modal
  detailBackBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#0F172A', paddingVertical: 18, paddingHorizontal: 24, minHeight: 64 },
  detailBackText: { color: '#FFFFFF', fontSize: fs(18), fontWeight: '900', letterSpacing: 1 },
  detailContent: { padding: 24, alignItems: 'center' },
  detailIconCircle: { width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  detailTitle: { fontSize: fs(22), fontWeight: '900', color: '#0F172A', marginBottom: 8 },
  detailTypeBadge: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 4, marginBottom: 20 },
  detailTypeBadgeText: { fontSize: fs(12), fontWeight: '900', color: '#FFFFFF', letterSpacing: 1 },
  detailCard: { width: '100%', borderWidth: 2, borderColor: '#000000', backgroundColor: '#F8FAFC', padding: 16 },
  detailRow: { marginBottom: 14, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', paddingBottom: 10 },
  detailLabel: { fontSize: fs(11), fontWeight: '700', color: '#64748B', letterSpacing: 2, marginBottom: 4 },
  detailValue: { fontSize: fs(16), fontWeight: '800', color: '#000000' },
  detailPhoto: { width: '100%', height: 200, marginTop: 8, borderWidth: 1, borderColor: '#E2E8F0' },
});
