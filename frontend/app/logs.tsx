import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getLocalAccessLogs, type AccessLogEntry } from '../src/services/storage';

export default function LogsScreen() {
  const [logs, setLogs] = useState<AccessLogEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);

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
        <Text style={styles.titleText}>ESTANCIA ID CHECK</Text>
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
  titleBar: { backgroundColor: '#0F172A', paddingVertical: 14, paddingHorizontal: 24, alignItems: 'center' },
  titleText: { fontSize: 20, fontWeight: '900', color: '#FFFFFF', letterSpacing: 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    padding: 24,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerCount: {
    fontSize: 36,
    fontWeight: '900',
    color: '#000000',
    marginRight: 8,
  },
  headerLabel: {
    fontSize: 14,
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
    fontSize: 18,
    fontWeight: '900',
    color: '#475569',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
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
    fontSize: 16,
    fontWeight: '800',
    color: '#000000',
  },
  logUnit: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 2,
  },
  logRight: {
    alignItems: 'flex-end',
  },
  logTime: {
    fontSize: 16,
    fontWeight: '900',
    color: '#000000',
  },
  logDate: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
    marginTop: 2,
  },
});
