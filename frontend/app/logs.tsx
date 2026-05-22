import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import HamburgerMenu from '../src/components/HamburgerMenu';
import { fs } from '../src/utils/scale';
import { getLocalAccessLogs, getPendingVisitorCheckins, removePendingVisitorCheckin, type AccessLogEntry } from '../src/services/storage';
import { pushLogsToGoogleDrive, uploadVisitorCheckin } from '../src/services/api';

export default function LogsScreen() {
  const [logs, setLogs] = useState<AccessLogEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [pushing, setPushing] = useState(false);

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    const data = await getLocalAccessLogs();
    setLogs(data);
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadLogs();
    setRefreshing(false);
  }, []);

  const handlePushLogs = async () => {
    const pendingCheckins = await getPendingVisitorCheckins();
    if (logs.length === 0 && pendingCheckins.length === 0) {
      Alert.alert('Nothing to Push', 'There are no logs or visitor check-ins to push.');
      return;
    }
    setPushing(true);
    const results: string[] = [];
    try {
      // Push access logs
      if (logs.length > 0) {
        const result = await pushLogsToGoogleDrive(logs);
        results.push(`${result.rowCount} logs uploaded`);
      }

      // Push pending visitor check-ins
      let checkinOk = 0, checkinFail = 0;
      for (const checkin of pendingCheckins) {
        try {
          await uploadVisitorCheckin({
            visitor: checkin.visitor,
            photoBase64: checkin.compositeBase64,
            timestamp: checkin.timestamp,
          });
          await removePendingVisitorCheckin(checkin.id);
          checkinOk++;
        } catch {
          checkinFail++;
        }
      }
      if (checkinOk > 0) results.push(`${checkinOk} visitor check-in(s) uploaded`);
      if (checkinFail > 0) results.push(`${checkinFail} check-in(s) failed`);

      Alert.alert('Done', results.join('\n'));
    } catch (error: any) {
      Alert.alert('Upload Failed', error.message || 'Something went wrong');
    } finally {
      setPushing(false);
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

  const renderLogItem = ({ item }: { item: AccessLogEntry }) => (
    <View testID={`log-item-${item.id}`} style={styles.logItem}>
      <View style={styles.logLeft}>
        <View
          style={[
            styles.statusDot,
            item.status === 'verified' ? styles.dotGreen : styles.dotRed,
          ]}
        />
      </View>
      <View style={styles.logCenter}>
        <Text style={styles.logName}>{item.resident_name}</Text>
        <Text style={styles.logUnit}>
          ID: {item.resident_id} • Flat: {item.unit}
        </Text>
      </View>
      <View style={styles.logRight}>
        <Text style={styles.logTime}>{formatTime(item.timestamp)}</Text>
        <Text style={styles.logDate}>{formatDate(item.timestamp)}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView testID="access-log-screen" style={styles.container}>
      <View style={styles.titleBar}>
        <HamburgerMenu />
        <Text style={styles.titleText}>LOGS</Text>
        <TouchableOpacity onPress={handlePushLogs} disabled={pushing} style={styles.pushButton}>
          {pushing ? (
            <ActivityIndicator size="small" color="#FFFBEB" />
          ) : (
            <Ionicons name="cloud-upload-outline" size={28} color="#FFFBEB" />
          )}
        </TouchableOpacity>
      </View>
      <View style={styles.header}>
        <Text style={styles.headerCount}>{logs.length}</Text>
        <Text style={styles.headerLabel}>ENTRIES</Text>
      </View>

      {logs.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="document-text-outline" size={64} color="#CBD5E1" />
          <Text style={styles.emptyText}>NO ACCESS LOGS YET</Text>
          <Text style={styles.emptySubtext}>
            Scan a resident ID to start logging
          </Text>
        </View>
      ) : (
        <FlatList
          testID="access-log-list"
          data={logs}
          keyExtractor={(item) => item.id}
          renderItem={renderLogItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
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
  statusDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  dotGreen: {
    backgroundColor: '#00C853',
  },
  dotRed: {
    backgroundColor: '#FF3B30',
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
});
