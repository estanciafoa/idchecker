import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList,
  ActivityIndicator, Image, Alert, Modal, ScrollView,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { readAsStringAsync, EncodingType, documentDirectory, copyAsync } from 'expo-file-system/legacy';
import ViewShot, { captureRef } from 'react-native-view-shot';
import { useFocusEffect } from 'expo-router';
import HamburgerMenu from '../src/components/HamburgerMenu';
import { fs } from '../src/utils/scale';
import {
  getVisitorsByFlat,
  getVisitorByCard,
  getVisitorsInsideCampus,
  assignCardToVisitor,
  returnCard,
  updateVisitorPhoto,
  updateVisitorIdPhoto,
  addAccessLog,
  addPendingVisitorCheckin,
  hasCameraConsent,
  setCameraConsent,
  getDeviceLocation,
  type Visitor,
  type AccessLogEntry,
} from '../src/services/storage';
import { pushAllUnpushed } from '../src/services/autoPush';

export default function VisitorsScreen() {
  const [flatNumber, setFlatNumber] = useState('');
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  const [selectedVisitor, setSelectedVisitor] = useState<Visitor | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [photoType, setPhotoType] = useState<'face' | 'id'>('face');
  const [uploading, setUploading] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<any>(null);
  const compositeRef = useRef<any>(null);
  const [assigningCard, setAssigningCard] = useState('');
  const [detailMode, setDetailMode] = useState<'checkin' | 'return'>('checkin');
  const [mainMode, setMainMode] = useState<'entry' | 'return'>('entry');
  const [insideVisitors, setInsideVisitors] = useState<Visitor[]>([]);
  const [showInsideModal, setShowInsideModal] = useState(false);
  const [showCardScanner, setShowCardScanner] = useState(false);
  const [cardScanned, setCardScanned] = useState(false);
  const [scannerMode, setScannerMode] = useState<'assign' | 'return'>('assign');
  // Reset all state when screen gains focus (tab switch / navigate back)
  useFocusEffect(
    useCallback(() => {
      setFlatNumber('');
      setVisitors([]);
      setSearched(false);
      setSelectedVisitor(null);
      setShowCamera(false);
      setAssigningCard('');
      setMainMode('entry');
      setShowInsideModal(false);
      setShowCardScanner(false);
      setCardScanned(false);
      setDetailMode('checkin');
      setScannerMode('assign');
      getVisitorsInsideCampus().then(setInsideVisitors);
    }, [])
  );

  const loadInsideVisitors = async () => {
    const inside = await getVisitorsInsideCampus();
    setInsideVisitors(inside);
  };

  const handleSearch = async () => {
    if (!flatNumber.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const results = await getVisitorsByFlat(flatNumber.trim());
      setVisitors(results);
    } catch (_) {
      setVisitors([]);
    }
    setLoading(false);
    setFlatNumber('');
  };

  const formatCard = (num: string) => {
    const n = num.trim();
    if (!n) return '';
    return n.startsWith('EST-V-') ? n : `EST-V-${n}`;
  };

  const handleAssignCard = async (overrideCard?: string) => {
    if (!selectedVisitor) return;
    const raw = overrideCard !== undefined ? overrideCard : assigningCard;
    if (!raw.trim()) return;
    const card = formatCard(raw);
    // Check if card is currently with someone else
    const current = await getVisitorByCard(card);
    if (current && current.id !== selectedVisitor.id) {
      Alert.alert(
        'Card In Use',
        `Card ${card} is currently assigned to ${current.name} (Flat ${current.flat}). Reassign to ${selectedVisitor.name}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Reassign',
            onPress: async () => {
              await assignCardToVisitor(selectedVisitor.id, card);
              setSelectedVisitor(prev => prev ? { ...prev, card_number: card } : null);
              setAssigningCard('');
              Alert.alert('Card Reassigned', `Card ${card} moved from ${current.name} to ${selectedVisitor.name}`);
            },
          },
        ],
      );
    } else {
      await assignCardToVisitor(selectedVisitor.id, card);
      setSelectedVisitor(prev => prev ? { ...prev, card_number: card } : null);
      setAssigningCard('');
      Alert.alert('Card Assigned', `Card ${card} assigned to ${selectedVisitor.name}`);
    }
  };

  const handleCardBarcodeScanned = useCallback(async ({ data }: { data: string }) => {
    if (cardScanned) return;
    setCardScanned(true);
    const trimmed = (data || '').trim();
    if (!trimmed) {
      setCardScanned(false);
      return;
    }
    setShowCardScanner(false);

    if (scannerMode === 'return') {
      const fullCard = formatCard(trimmed);
      try {
        const visitor = await getVisitorByCard(fullCard);
        if (!visitor) {
          Alert.alert('Not Found', `No visitor assigned to card ${fullCard}`);
        } else {
          setSelectedVisitor(visitor);
          setAssigningCard(visitor.card_number || fullCard);
          setDetailMode('return');
        }
      } catch (_) {
        Alert.alert('Error', 'Failed to look up card');
      }
    } else {
      // Assign mode: if the barcode is EST-V-NNN, extract digits; else use raw
      let cardValue = trimmed;
      const m = trimmed.match(/EST-V-(\d+)/i);
      if (m) cardValue = m[1];
      await handleAssignCard(cardValue);
    }

    setTimeout(() => setCardScanned(false), 500);
  }, [cardScanned, scannerMode, selectedVisitor, assigningCard]);

  const openCardScanner = async (mode: 'assign' | 'return') => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) return;
    }
    setScannerMode(mode);
    setCardScanned(false);
    setShowCardScanner(true);
  };

  const openInsideVisitors = async () => {
    await loadInsideVisitors();
    setShowInsideModal(true);
  };

  const handleReturnSelectedCard = async () => {
    if (!selectedVisitor?.card_number) return;
    const cardNum = selectedVisitor.card_number;
    await returnCard(cardNum);
    const location = await getDeviceLocation();
    const exitLog: AccessLogEntry = {
      id: Date.now().toString(),
      resident_id: selectedVisitor.id,
      resident_name: selectedVisitor.name,
      unit: selectedVisitor.flat,
      timestamp: new Date().toISOString(),
      status: 'visitor_checkout',
      location,
    };
    await addAccessLog(exitLog);
    void pushAllUnpushed();
    Alert.alert('Card Returned', `Card ${cardNum} returned. Exit logged for ${selectedVisitor.name}.`);
    setSelectedVisitor(null);
    setAssigningCard('');
    setDetailMode('checkin');
    if (flatNumber.trim()) {
      const results = await getVisitorsByFlat(flatNumber.trim());
      setVisitors(results);
    }
    await loadInsideVisitors();
  };

  const handleSelectVisitor = (visitor: Visitor) => {
    setSelectedVisitor(visitor);
    setAssigningCard(visitor.card_number || '');
    setDetailMode('checkin');
  };

  const openCamera = async (type: 'face' | 'id') => {
    if (!permission?.granted) {
      requestPermission();
      return;
    }
    // One-time consent dialog for photo capture
    const consented = await hasCameraConsent();
    if (!consented) {
      Alert.alert(
        'Photo Consent',
        'This app will capture and store photos of visitors and their ID documents for security verification purposes. Photos will be uploaded to the society\'s secure Drive folder.\n\nDo you consent to proceed?',
        [
          { text: 'Decline', style: 'cancel' },
          {
            text: 'I Consent',
            onPress: async () => {
              await setCameraConsent();
              setPhotoType(type);
              setShowCamera(true);
            },
          },
        ],
      );
      return;
    }
    setPhotoType(type);
    setShowCamera(true);
  };

  const handleTakePhoto = async () => {
    if (!cameraRef.current || !selectedVisitor) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.3 });
      setShowCamera(false);

      // Copy to document directory for persistence across installs
      const filename = `visitor_${selectedVisitor.id}_${photoType}_${Date.now()}.jpg`;
      const destUri = documentDirectory + filename;
      await copyAsync({ from: photo.uri, to: destUri });

      // Save locally based on type
      if (photoType === 'face') {
        await updateVisitorPhoto(selectedVisitor.id, destUri);
        setSelectedVisitor(prev => prev ? { ...prev, local_photo: destUri } : null);
      } else {
        await updateVisitorIdPhoto(selectedVisitor.id, destUri);
        setSelectedVisitor(prev => prev ? { ...prev, local_photo_id: destUri } : null);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to capture photo');
    }
  };

  const handleDone = async () => {
    if (!selectedVisitor) return;
    if (!selectedVisitor.card_number || !selectedVisitor.card_number.trim()) {
      Alert.alert('Card Required', 'Please assign a visitor card before check-in.');
      return;
    }
    if (!selectedVisitor.local_photo && !selectedVisitor.local_photo_id) {
      Alert.alert('No Photos', 'Please take at least one photo before submitting.');
      return;
    }

    // Create access log
    const location = await getDeviceLocation();
    const logEntry: AccessLogEntry = {
      id: Date.now().toString(),
      resident_id: selectedVisitor.id,
      resident_name: selectedVisitor.name,
      unit: selectedVisitor.flat,
      timestamp: new Date().toISOString(),
      status: 'visitor_checkin',
      location,
    };
    await addAccessLog(logEntry);

    // Capture composite and queue for upload during next log sync
    setUploading(true);
    try {
      await new Promise(r => setTimeout(r, 300));
      const uri = await captureRef(compositeRef, { format: 'jpg', quality: 0.7 });
      const compositeBase64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });

      await addPendingVisitorCheckin({
        id: Date.now().toString(),
        visitor: {
          id: selectedVisitor.id,
          name: selectedVisitor.name,
          flat: selectedVisitor.flat,
          phone: '',
          aadhar: selectedVisitor.aadhar_last4,
          purpose: selectedVisitor.nature,
        },
        compositeBase64,
        timestamp: new Date().toISOString(),
        location,
      });
      void pushAllUnpushed();
      Alert.alert('Saved', 'Visitor check-in saved.');
    } catch (err: any) {
      Alert.alert('Error', 'Failed to save check-in.\n' + (err.message || ''));
    } finally {
      setUploading(false);
    }

    // Refresh list
    const results = await getVisitorsByFlat(flatNumber.trim());
    setVisitors(results);
  };

  const isValidTill = (v: Visitor): boolean => {
    // Visitor is valid any day between check_in and check_out
    const text = (v.check_out || '').trim();
    if (!text) return true; // no checkout date means always valid

    const parseDate = (s: string): Date | null => {
      // dd/mm/yyyy or dd-mm-yyyy
      let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
      if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      // yyyy-mm-dd
      m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return null;
    };

    const endDate = parseDate(text);
    if (!endDate) return true;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return today <= endDate;
  };

  // ── Camera Modal ──
  if (showCamera) {
    return (
      <SafeAreaView style={styles.container}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back">
          <View style={styles.cameraOverlay}>
            <View style={styles.cameraTopBar}>
              <TouchableOpacity style={styles.cameraCancelBtn} onPress={() => setShowCamera(false)}>
                <Ionicons name="close" size={32} color="#FFFFFF" />
              </TouchableOpacity>
              <View style={styles.photoTypeLabel}>
                <Ionicons name={photoType === 'face' ? 'person' : 'card'} size={20} color="#FFFFFF" />
                <Text style={styles.photoTypeLabelText}>
                  {photoType === 'face' ? 'FACE PHOTO' : 'ID DOCUMENT'}
                </Text>
              </View>
            </View>
            <TouchableOpacity style={styles.captureBtn} onPress={handleTakePhoto}>
              <View style={styles.captureBtnInner} />
            </TouchableOpacity>
          </View>
        </CameraView>
      </SafeAreaView>
    );
  }

  // ── Card Barcode Scanner Modal ──
  if (showCardScanner) {
    return (
      <SafeAreaView style={styles.container}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'ean8'] }}
          onBarcodeScanned={cardScanned ? undefined : handleCardBarcodeScanned}
        >
          <View style={styles.cameraOverlay}>
            <View style={styles.cameraTopBar}>
              <TouchableOpacity style={styles.cameraCancelBtn} onPress={() => setShowCardScanner(false)}>
                <Ionicons name="close" size={32} color="#FFFFFF" />
              </TouchableOpacity>
              <View style={styles.photoTypeLabel}>
                <Ionicons name="barcode-outline" size={20} color="#FFFFFF" />
                <Text style={styles.photoTypeLabelText}>
                  {scannerMode === 'return' ? 'SCAN CARD TO RETURN' : 'SCAN CARD BARCODE'}
                </Text>
              </View>
            </View>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <View style={{ width: 280, height: 120, borderWidth: 3, borderColor: '#7C3AED', borderRadius: 12 }} />
              <Text style={{ color: '#FFFFFF', marginTop: 16, fontSize: fs(16), fontWeight: '700' }}>
                {scannerMode === 'return' ? 'ALIGN CARD BARCODE TO FETCH VISITOR' : 'ALIGN VISITOR CARD BARCODE'}
              </Text>
            </View>
          </View>
        </CameraView>
      </SafeAreaView>
    );
  }

  // ── Visitor Detail Modal ──
  if (selectedVisitor) {
    const expired = !isValidTill(selectedVisitor);
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.titleBar}>
          <TouchableOpacity onPress={() => setSelectedVisitor(null)}>
            <Ionicons name="arrow-back" size={24} color="#FFFBEB" />
          </TouchableOpacity>
          <Text style={styles.titleText}>VISITOR DETAILS</Text>
          <View style={{ width: 24 }} />
        </View>
        <ScrollView contentContainerStyle={styles.detailContent}>
          {/* Face Photo with camera overlay */}
          <Text style={styles.photoSectionLabel}>FACE PHOTO</Text>
          <View style={styles.photoContainer}>
            {selectedVisitor.local_photo ? (
              <Image source={{ uri: selectedVisitor.local_photo }} style={styles.visitorPhoto} resizeMode="cover" />
            ) : (
              <View style={styles.noPhoto}>
                <Ionicons name="person" size={64} color="#CBD5E1" />
                <Text style={styles.noPhotoText}>NO PHOTO</Text>
              </View>
            )}
            {!expired && (
              <TouchableOpacity style={styles.photoOverlayBtn} onPress={() => openCamera('face')}>
                <Ionicons name="camera" size={24} color="#FFFFFF" />
                <Text style={styles.photoOverlayBtnText}>{selectedVisitor.local_photo ? 'RETAKE' : 'CAPTURE'}</Text>
              </TouchableOpacity>
            )}
            {expired && (
              <View style={styles.expiredOverlay}>
                <Text style={styles.expiredText}>EXPIRED</Text>
              </View>
            )}
          </View>

          {/* ID Photo with camera overlay */}
          <Text style={styles.photoSectionLabel}>ID DOCUMENT (SRM ID / AADHAR / LICENCE)</Text>
          <View style={styles.photoContainer}>
            {selectedVisitor.local_photo_id ? (
              <Image source={{ uri: selectedVisitor.local_photo_id }} style={styles.visitorPhoto} resizeMode="cover" />
            ) : (
              <View style={styles.noPhoto}>
                <Ionicons name="card" size={64} color="#CBD5E1" />
                <Text style={styles.noPhotoText}>NO ID PHOTO</Text>
              </View>
            )}
            {!expired && (
              <TouchableOpacity style={[styles.photoOverlayBtn, { backgroundColor: 'rgba(124,58,237,0.75)' }]} onPress={() => openCamera('id')}>
                <Ionicons name="camera" size={24} color="#FFFFFF" />
                <Text style={styles.photoOverlayBtnText}>{selectedVisitor.local_photo_id ? 'RETAKE' : 'CAPTURE'}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Info */}
          <View style={styles.infoCard}>
            <InfoRow label="NAME" value={selectedVisitor.name} />
            <InfoRow label="FLAT" value={selectedVisitor.flat} />
            <InfoRow label="NATURE" value={selectedVisitor.nature || 'N/A'} />
            <InfoRow label="AADHAR (LAST 4)" value={selectedVisitor.aadhar_last4 || 'N/A'} />
            <InfoRow label="VISIT DATE" value={selectedVisitor.visit_date || 'N/A'} />
            <InfoRow label="REQUESTED BY" value={selectedVisitor.requested_by || 'N/A'} />
            <InfoRow label="CHECK IN" value={selectedVisitor.check_in || 'N/A'} />
            <InfoRow label="CHECK OUT" value={selectedVisitor.check_out || 'N/A'} />
            <InfoRow label="NIGHT STAY" value={selectedVisitor.night_stay || 'No'} />
            <InfoRow label="STATUS" value={selectedVisitor.office_status || 'N/A'} />
          </View>

          {/* Card Number Assignment – hidden when expired, but allow return even if expired */}
          {!expired && detailMode !== 'return' ? (
            <View style={styles.cardAssignSection}>
              <Text style={styles.searchLabel}>ASSIGN CARD NUMBER</Text>
              <TouchableOpacity
                style={styles.scanCardBtn}
                onPress={() => openCardScanner('assign')}
              >
                <Ionicons name="barcode-outline" size={22} color="#FFFFFF" />
                <Text style={styles.scanCardBtnText}>ASSIGN CARD</Text>
              </TouchableOpacity>
              <Text style={styles.scanCardHint}>Scan the visitor card barcode to assign it automatically.</Text>
              {selectedVisitor.card_number ? (
                <View style={styles.currentCardRow}>
                  <Text style={styles.currentCardText}>Current card: {selectedVisitor.card_number}</Text>
                  <TouchableOpacity
                    style={styles.returnCardBtn}
                    onPress={handleReturnSelectedCard}
                  >
                    <Ionicons name="arrow-undo" size={16} color="#DC2626" />
                    <Text style={styles.returnCardText}>RETURN</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          ) : selectedVisitor.card_number ? (
            <View style={styles.cardAssignSection}>
              <View style={styles.currentCardRow}>
                <Text style={styles.currentCardText}>Current card: {selectedVisitor.card_number}</Text>
                <TouchableOpacity
                  style={styles.returnCardBtn}
                  onPress={handleReturnSelectedCard}
                >
                  <Ionicons name="arrow-undo" size={16} color="#DC2626" />
                  <Text style={styles.returnCardText}>RETURN</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {/* Done / Upload Button */}
          {!expired && detailMode === 'checkin' && (
            <TouchableOpacity
              style={[styles.doneBtn, uploading && { opacity: 0.6 }]}
              onPress={handleDone}
              disabled={uploading}
            >
              {uploading ? <ActivityIndicator color="#FFFFFF" /> : (
                <>
                  <Ionicons name="checkmark-circle" size={24} color="#FFFFFF" />
                  <Text style={styles.doneBtnText}>DONE</Text>
                </>
              )}
            </TouchableOpacity>
          )}
          {detailMode === 'return' && !!selectedVisitor.card_number && (
            <TouchableOpacity style={styles.returnActionBtn} onPress={handleReturnSelectedCard}>
              <Ionicons name="arrow-undo" size={24} color="#FFFFFF" />
              <Text style={styles.doneBtnText}>RETURN</Text>
            </TouchableOpacity>
          )}
          {expired && (
            <View style={styles.expiredBanner}>
              <Ionicons name="alert-circle" size={20} color="#DC2626" />
              <Text style={styles.expiredBannerText}>VISITOR PASS EXPIRED</Text>
            </View>
          )}
        </ScrollView>

        {/* Hidden composite view for capture */}
        <View style={styles.compositeWrapper}>
          <View ref={compositeRef} style={styles.compositeView} collapsable={false}>
            <Text style={styles.compositeTitle}>VISITOR CHECK-IN</Text>
            <Text style={styles.compositeTimestamp}>{new Date().toLocaleString()}</Text>

            <View style={styles.compositePhotos}>
              {selectedVisitor.local_photo ? (
                <View style={styles.compositePhotoBox}>
                  <Text style={styles.compositeLabel}>FACE</Text>
                  <Image source={{ uri: selectedVisitor.local_photo }} style={styles.compositeImg} resizeMode="cover" />
                </View>
              ) : null}
              {selectedVisitor.local_photo_id ? (
                <View style={styles.compositePhotoBox}>
                  <Text style={styles.compositeLabel}>ID DOCUMENT</Text>
                  <Image source={{ uri: selectedVisitor.local_photo_id }} style={styles.compositeImg} resizeMode="cover" />
                </View>
              ) : null}
            </View>

            <View style={styles.compositeDetails}>
              <Text style={styles.compositeRow}>Name: {selectedVisitor.name}</Text>
              <Text style={styles.compositeRow}>Flat: {selectedVisitor.flat}</Text>
              <Text style={styles.compositeRow}>Nature: {selectedVisitor.nature || 'N/A'}</Text>
              <Text style={styles.compositeRow}>Aadhar (Last 4): {selectedVisitor.aadhar_last4 || 'N/A'}</Text>
              <Text style={styles.compositeRow}>Visit Date: {selectedVisitor.visit_date || 'N/A'}</Text>
              <Text style={styles.compositeRow}>Requested By: {selectedVisitor.requested_by || 'N/A'}</Text>
              <Text style={styles.compositeRow}>Check In: {selectedVisitor.check_in || 'N/A'}</Text>
              <Text style={styles.compositeRow}>Check Out: {selectedVisitor.check_out || 'N/A'}</Text>
              <Text style={styles.compositeRow}>Night Stay: {selectedVisitor.night_stay || 'No'}</Text>
              <Text style={styles.compositeRow}>Status: {selectedVisitor.office_status || 'N/A'}</Text>
            </View>
          </View>
        </View>

      </SafeAreaView>
    );
  }

  // ── Main Screen ──
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.titleBar}>
        <HamburgerMenu />
        <Text style={styles.titleText}>VISITORS</Text>
        <TouchableOpacity style={styles.insideIconBtn} onPress={openInsideVisitors}>
          <Ionicons name="people" size={20} color="#FFFBEB" />
        </TouchableOpacity>
      </View>

      {/* Entry / Return Mode */}
      <View style={styles.modeSection}>
        <TouchableOpacity
          style={[styles.modeBtn, mainMode === 'entry' && styles.modeBtnActive]}
          onPress={() => setMainMode('entry')}
        >
          <Ionicons name="log-in" size={18} color={mainMode === 'entry' ? '#FFFFFF' : '#78350F'} />
          <Text style={[styles.modeBtnText, mainMode === 'entry' && styles.modeBtnTextActive]}>ENTRY</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, mainMode === 'return' && styles.modeBtnActiveReturn]}
          onPress={() => {
            setMainMode('return');
            openCardScanner('return');
          }}
        >
          <Ionicons name="log-out" size={18} color={mainMode === 'return' ? '#FFFFFF' : '#7C3AED'} />
          <Text style={[styles.modeBtnText, mainMode === 'return' && styles.modeBtnTextActive]}>RETURN</Text>
        </TouchableOpacity>
      </View>

      {mainMode === 'entry' ? (
        <>
          <View style={styles.searchSection}>
            <Text style={styles.searchLabel}>ENTER FLAT NUMBER</Text>
            <View style={styles.searchRow}>
              <TextInput
                style={styles.searchInput}
                value={flatNumber}
                onChangeText={setFlatNumber}
                placeholder="e.g. 5162"
                placeholderTextColor="#94A3B8"
                keyboardType="numeric"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={handleSearch}
              />
              <TouchableOpacity style={styles.searchBtn} onPress={handleSearch} disabled={loading}>
                {loading ? <ActivityIndicator color="#FFFFFF" size="small" /> : (
                  <Ionicons name="search" size={22} color="#FFFFFF" />
                )}
              </TouchableOpacity>
            </View>
          </View>

          {searched && !loading && visitors.length === 0 && (
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={48} color="#CBD5E1" />
              <Text style={styles.emptyText}>No approved visitors for flat {flatNumber}</Text>
            </View>
          )}

          {visitors.length > 0 && (
            <FlatList
              data={visitors}
              keyExtractor={item => item.id}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
              renderItem={({ item }) => {
                const expired = !isValidTill(item);
                return (
                  <TouchableOpacity
                    style={[styles.visitorCard, expired && styles.visitorCardExpired]}
                    onPress={() => handleSelectVisitor(item)}
                  >
                    <View style={styles.visitorAvatar}>
                      {item.local_photo ? (
                        <Image source={{ uri: item.local_photo }} style={styles.avatarImg} />
                      ) : (
                        <Text style={styles.avatarInitial}>{item.name.charAt(0).toUpperCase()}</Text>
                      )}
                    </View>
                    <View style={styles.visitorInfo}>
                      <Text style={styles.visitorName}>{item.name}</Text>
                      <Text style={styles.visitorPurpose}>{item.nature || 'Visitor'}</Text>
                      {item.visit_date ? (
                        <Text style={[styles.visitorValidity, expired && { color: '#DC2626' }]}>
                          {expired ? 'PAST VISIT' : `Visit: ${item.visit_date}`}
                        </Text>
                      ) : null}
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </>
      ) : (
        <View style={styles.returnHelpBox}>
          <Ionicons name="barcode-outline" size={34} color="#7C3AED" />
          <Text style={styles.returnHelpTitle}>Return Flow</Text>
          <Text style={styles.returnHelpText}>Tap RETURN again to scan card barcode and fetch visitor details.</Text>
          <TouchableOpacity style={styles.scanCardBtn} onPress={() => openCardScanner('return')}>
            <Ionicons name="scan" size={22} color="#FFFFFF" />
            <Text style={styles.scanCardBtnText}>SCAN CARD</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal visible={showInsideModal} transparent animationType="slide" onRequestClose={() => setShowInsideModal(false)}>
        <View style={styles.insideModalOverlay}>
          <View style={styles.insideModalCard}>
            <View style={styles.insideModalHeader}>
              <Text style={styles.insideModalTitle}>Visitors inside campus</Text>
              <TouchableOpacity onPress={() => setShowInsideModal(false)}>
                <Ionicons name="close" size={24} color="#0F172A" />
              </TouchableOpacity>
            </View>
            {insideVisitors.length === 0 ? (
              <View style={styles.insideEmpty}>
                <Text style={styles.insideEmptyText}>No visitors currently inside</Text>
              </View>
            ) : (
              <FlatList
                data={insideVisitors}
                keyExtractor={item => item.id}
                contentContainerStyle={{ paddingBottom: 8 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.insideCard}
                    onPress={() => {
                      setShowInsideModal(false);
                      handleSelectVisitor(item);
                    }}
                  >
                    <View style={[styles.visitorAvatar, { backgroundColor: '#7C3AED20' }]}>
                      {item.local_photo ? (
                        <Image source={{ uri: item.local_photo }} style={styles.avatarImg} />
                      ) : (
                        <Text style={[styles.avatarInitial, { color: '#7C3AED' }]}>{item.name.charAt(0).toUpperCase()}</Text>
                      )}
                    </View>
                    <View style={styles.visitorInfo}>
                      <Text style={styles.visitorName}>{item.name}</Text>
                      <Text style={styles.visitorPurpose}>Flat {item.flat} • Card #{item.card_number}</Text>
                      <Text style={styles.visitorValidity}>
                        {item.check_out ? `Expected out: ${item.check_out}` : 'No check-out time'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#7C3AED" />
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
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
  insideIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Search
  modeSection: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  modeBtn: {
    flex: 1,
    borderWidth: 2,
    borderColor: '#78350F',
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  modeBtnActive: {
    backgroundColor: '#78350F',
  },
  modeBtnActiveReturn: {
    backgroundColor: '#7C3AED',
    borderColor: '#7C3AED',
  },
  modeBtnText: {
    color: '#334155',
    fontSize: fs(14),
    fontWeight: '900',
    letterSpacing: 1,
  },
  modeBtnTextActive: {
    color: '#FFFFFF',
  },
  searchSection: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  cardSearchSection: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  searchLabel: { fontSize: fs(11), fontWeight: '700', color: '#64748B', letterSpacing: 2, marginBottom: 8 },
  searchRow: { flexDirection: 'row', gap: 8 },
  searchInput: {
    flex: 1,
    borderWidth: 2,
    borderColor: '#78350F',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: fs(16),
    fontWeight: '700',
    color: '#0F172A',
    backgroundColor: '#FFFBEB',
  },
  searchBtn: {
    width: 52,
    backgroundColor: '#78350F',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#78350F',
  },

  // Empty state
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyText: { fontSize: fs(14), color: '#94A3B8', marginTop: 12, textAlign: 'center' },
  returnHelpBox: {
    margin: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: '#DDD6FE',
    backgroundColor: '#F5F3FF',
    borderRadius: 14,
    alignItems: 'center',
    gap: 10,
  },
  returnHelpTitle: { fontSize: fs(18), fontWeight: '900', color: '#5B21B6' },
  returnHelpText: { fontSize: fs(13), color: '#6D28D9', textAlign: 'center' },

  // Visitor card
  visitorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    marginTop: 10,
    gap: 12,
  },
  visitorCardExpired: { borderColor: '#FECACA', backgroundColor: '#FFF5F5' },
  visitorAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#78350F',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: 48, height: 48, borderRadius: 24 },
  avatarInitial: { fontSize: fs(20), fontWeight: '900', color: '#FFFBEB' },
  visitorInfo: { flex: 1 },
  visitorName: { fontSize: fs(15), fontWeight: '900', color: '#0F172A' },
  visitorPurpose: { fontSize: fs(12), color: '#64748B', marginTop: 2 },
  visitorValidity: { fontSize: fs(11), color: '#059669', fontWeight: '700', marginTop: 2 },

  // Detail
  detailContent: { padding: 20 },
  photoContainer: {
    width: '100%',
    height: 280,
    backgroundColor: '#F1F5F9',
    borderWidth: 2,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    overflow: 'hidden',
  },
  visitorPhoto: { width: '100%', height: '100%' },
  noPhoto: { justifyContent: 'center', alignItems: 'center' },
  noPhotoText: { fontSize: fs(12), color: '#94A3B8', fontWeight: '700', marginTop: 4 },
  expiredOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(220,38,38,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  expiredText: { fontSize: fs(28), fontWeight: '900', color: '#FFFFFF', letterSpacing: 4 },
  infoCard: {
    borderWidth: 2,
    borderColor: '#000000',
    padding: 16,
    backgroundColor: '#F8FAFC',
    marginBottom: 20,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  infoLabel: { fontSize: fs(11), fontWeight: '700', color: '#64748B', letterSpacing: 1 },
  infoValue: { fontSize: fs(14), fontWeight: '700', color: '#0F172A', textAlign: 'right', flex: 1, marginLeft: 16 },
  photoOverlayBtn: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,85,255,0.75)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  photoOverlayBtnText: {
    fontSize: fs(12),
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  cardAssignSection: { marginBottom: 20 },
  scanCardBtn: {
    marginTop: 10,
    backgroundColor: '#7C3AED',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  scanCardBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: fs(14), letterSpacing: 0.5 },
  scanCardHint: { marginTop: 8, color: '#475569', fontSize: fs(12), lineHeight: fs(16) },
  currentCardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  currentCardText: { fontSize: fs(12), fontWeight: '700', color: '#7C3AED', marginLeft: 4 },
  returnCardBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FEF2F2', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#FECACA' },
  returnCardText: { fontSize: fs(11), fontWeight: '900', color: '#DC2626', letterSpacing: 1 },
  doneBtn: {
    height: 60,
    backgroundColor: '#16A34A',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    borderWidth: 2,
    borderColor: '#000000',
    marginTop: 8,
  },
  doneBtnText: { fontSize: fs(18), fontWeight: '900', color: '#FFFFFF', letterSpacing: 2 },
  returnActionBtn: {
    height: 60,
    backgroundColor: '#DC2626',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    borderWidth: 2,
    borderColor: '#7F1D1D',
    marginTop: 8,
  },
  photoSectionLabel: {
    fontSize: fs(11),
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: 4,
    marginLeft: 4,
  },
  expiredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  expiredBannerText: { fontSize: fs(14), fontWeight: '900', color: '#DC2626', letterSpacing: 1 },

  // Camera
  cameraOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 40,
  },
  cameraTopBar: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cameraCancelBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoTypeLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  photoTypeLabelText: {
    color: '#FFFFFF',
    fontSize: fs(13),
    fontWeight: '800',
    letterSpacing: 1,
  },
  captureBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureBtnInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
  },

  // Hidden composite for capture
  compositeWrapper: {
    position: 'absolute',
    left: -9999,
    top: 0,
  },
  compositeView: {
    width: 600,
    backgroundColor: '#FFFFFF',
    padding: 24,
  },
  compositeTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 4,
  },
  compositeTimestamp: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 16,
  },
  compositePhotos: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 16,
  },
  compositePhotoBox: {
    alignItems: 'center',
  },
  compositeLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 1,
    marginBottom: 4,
  },
  compositeImg: {
    width: 260,
    height: 260,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#E2E8F0',
  },
  compositeDetails: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  compositeRow: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
    paddingVertical: 4,
  },

  // Inside campus modal
  insideModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  insideModalCard: {
    maxHeight: '75%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  insideModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  insideModalTitle: { fontSize: fs(16), fontWeight: '900', color: '#0F172A' },
  insideEmpty: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  insideEmptyText: {
    fontSize: fs(13),
    color: '#94A3B8',
    fontWeight: '600',
  },
  insideCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#7C3AED30',
    backgroundColor: '#F5F3FF',
    marginTop: 10,
    gap: 12,
  },
});
