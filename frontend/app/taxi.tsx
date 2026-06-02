import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Image, Alert, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { readAsStringAsync, EncodingType, documentDirectory, copyAsync } from 'expo-file-system/legacy';
import ViewShot, { captureRef } from 'react-native-view-shot';
import { useFocusEffect } from 'expo-router';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import HamburgerMenu from '../src/components/HamburgerMenu';
import { AutoRickshawIcon, TruckIcon } from '../src/components/VehicleIcons';
import { fs } from '../src/utils/scale';
import {
  addTaxiLog,
  hasCameraConsent,
  setCameraConsent,
  getDeviceLocation,
  type VehicleType,
} from '../src/services/storage';
import { pushAllUnpushed } from '../src/services/autoPush';

const VEHICLE_TYPES: { type: VehicleType; label: string; icon?: keyof typeof Ionicons.glyphMap }[] = [
  { type: 'auto', label: 'AUTO' },
  { type: 'car', label: 'CAR', icon: 'car' },
  { type: 'tempo', label: 'TEMPO' },
];

export default function TaxiScreen() {
  const [flatNumber, setFlatNumber] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [numberPlatePhoto, setNumberPlatePhoto] = useState('');
  const [driverPhoto, setDriverPhoto] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [photoType, setPhotoType] = useState<'plate' | 'driver'>('plate');
  const [saving, setSaving] = useState(false);
  const [vehicleType, setVehicleType] = useState<VehicleType>('auto');
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<any>(null);
  const compositeRef = useRef<any>(null);
  const [zoom, setZoom] = useState(0);
  const lastZoom = useRef(0);
  const initialPinchDistance = useRef<number | null>(null);

  const getDistance = (touches: any) => {
    const [t1, t2] = [touches[0], touches[1]];
    return Math.sqrt(
      Math.pow(t1.pageX - t2.pageX, 2) + Math.pow(t1.pageY - t2.pageY, 2)
    );
  };

  const handleTouchStart = (e: any) => {
    if (e.nativeEvent.touches.length === 2) {
      initialPinchDistance.current = getDistance(e.nativeEvent.touches);
    }
  };

  const handleTouchMove = (e: any) => {
    if (e.nativeEvent.touches.length === 2 && initialPinchDistance.current) {
      const currentDist = getDistance(e.nativeEvent.touches);
      const scale = currentDist / initialPinchDistance.current;
      const newZoom = Math.min(1, Math.max(0, lastZoom.current + (scale - 1) * 0.3));
      setZoom(newZoom);
    }
  };

  const handleTouchEnd = (e: any) => {
    if (initialPinchDistance.current) {
      lastZoom.current = zoom;
      initialPinchDistance.current = null;
    }
  };

  // Reset state on tab focus
  useFocusEffect(
    useCallback(() => {
      setFlatNumber('');
      setVehicleNumber('');
      setNumberPlatePhoto('');
      setDriverPhoto('');
      setShowCamera(false);
      setVehicleType('auto');
      setZoom(0);
      lastZoom.current = 0;
    }, [])
  );

  const openCamera = async (type: 'plate' | 'driver') => {
    if (!permission?.granted) {
      requestPermission();
      return;
    }
    const consented = await hasCameraConsent();
    if (!consented) {
      Alert.alert(
        'Photo Consent',
        'This app will capture photos of vehicles and drivers for security verification purposes. Photos will be uploaded to the society\'s secure Drive folder.\n\nDo you consent to proceed?',
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
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.3 });
      setShowCamera(false);
      setZoom(0);
      lastZoom.current = 0;

      const filename = `taxi_${photoType}_${Date.now()}.jpg`;
      const destUri = documentDirectory + filename;
      await copyAsync({ from: photo.uri, to: destUri });

      if (photoType === 'plate') {
        setNumberPlatePhoto(destUri);
        // Auto-parse vehicle number from plate photo using ML Kit OCR
        try {
          const result = await TextRecognition.recognize(destUri);
          const raw = (result.text || '').replace(/\n/g, ' ');
          // Indian plate pattern: 2 letters, 1-2 digits, 1-2 letters, 4 digits (e.g. TN 01 AB 1234)
          const match = raw.match(/[A-Z]{2}\s*\d{1,2}\s*[A-Z]{1,3}\s*\d{4}/i);
          if (match) {
            setVehicleNumber(match[0].toUpperCase().replace(/\s+/g, ' ').trim());
          }
        } catch (_) {
          // OCR failed silently – user can type manually
        }
      } else {
        setDriverPhoto(destUri);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to capture photo');
    }
  };

  const handleDone = async () => {
    if (!numberPlatePhoto && !driverPhoto) {
      Alert.alert('No Photos', 'Please take at least the number plate photo.');
      return;
    }
    if (!flatNumber.trim()) {
      Alert.alert('Missing Tower', 'Please enter the tower number.');
      return;
    }

    setSaving(true);
    try {
      // Wait for composite to render
      await new Promise(r => setTimeout(r, 300));
      const uri = await captureRef(compositeRef, { format: 'jpg', quality: 0.7 });
      const compositeBase64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });

      const location = await getDeviceLocation();
      const logId = Date.now().toString();
      await addTaxiLog({
        id: logId,
        vehicle_number: vehicleNumber.trim(),
        vehicle_type: vehicleType,
        flat: flatNumber.trim(),
        timestamp: new Date().toISOString(),
        compositeBase64,
        location,
      });

      void pushAllUnpushed();
      Alert.alert('Saved', 'Taxi/cab entry logged.');

      // Reset
      setFlatNumber('');
      setVehicleNumber('');
      setNumberPlatePhoto('');
      setDriverPhoto('');
      setVehicleType('auto');
    } catch (err: any) {
      Alert.alert('Error', 'Failed to save entry.\n' + (err.message || ''));
    } finally {
      setSaving(false);
    }
  };

  // ── Camera Modal ──
  if (showCamera) {
    return (
      <SafeAreaView style={styles.container}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" zoom={zoom} flash="auto">
          <View
            style={styles.cameraOverlay}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <View style={styles.cameraTopBar}>
              <TouchableOpacity style={styles.cameraCancelBtn} onPress={() => { setShowCamera(false); setZoom(0); lastZoom.current = 0; }}>
                <Ionicons name="close" size={32} color="#FFFFFF" />
              </TouchableOpacity>
              <View style={styles.photoTypeLabel}>
                <Ionicons name={photoType === 'plate' ? 'car' : 'person'} size={20} color="#FFFFFF" />
                <Text style={styles.photoTypeLabelText}>
                  {photoType === 'plate' ? 'NUMBER PLATE' : 'DRIVER PHOTO'}
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

  // ── Main Screen ──
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.titleBar}>
        <HamburgerMenu />
        <Text style={styles.titleText}>TAXI / AUTO / CAB</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Vehicle Type Selector */}
        <Text style={styles.sectionLabel}>VEHICLE TYPE</Text>
        <View style={styles.vehicleTypeRow}>
          {VEHICLE_TYPES.map(vt => (
            <TouchableOpacity
              key={vt.type}
              style={[styles.vehicleTypeBtn, vehicleType === vt.type && styles.vehicleTypeBtnActive]}
              onPress={() => setVehicleType(vt.type)}
            >
              {vt.type === 'auto' ? (
                <AutoRickshawIcon size={28} color={vehicleType === vt.type ? '#FFFFFF' : '#78350F'} />
              ) : vt.type === 'tempo' ? (
                <TruckIcon size={28} color={vehicleType === vt.type ? '#FFFFFF' : '#78350F'} />
              ) : (
                <Ionicons name={vt.icon!} size={28} color={vehicleType === vt.type ? '#FFFFFF' : '#78350F'} />
              )}
              <Text style={[styles.vehicleTypeBtnText, vehicleType === vt.type && styles.vehicleTypeBtnTextActive]}>
                {vt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Number Plate Photo */}
        <Text style={styles.sectionLabel}>VEHICLE NUMBER PLATE</Text>
        <View style={styles.photoContainer}>
          {numberPlatePhoto ? (
            <Image source={{ uri: numberPlatePhoto }} style={styles.photo} resizeMode="cover" />
          ) : (
            <View style={styles.noPhoto}>
              <Ionicons name="car" size={64} color="#CBD5E1" />
              <Text style={styles.noPhotoText}>NO PHOTO</Text>
            </View>
          )}
          <TouchableOpacity style={styles.photoOverlayBtn} onPress={() => openCamera('plate')}>
            <Ionicons name="camera" size={24} color="#FFFFFF" />
            <Text style={styles.photoOverlayBtnText}>{numberPlatePhoto ? 'RETAKE' : 'CAPTURE'}</Text>
          </TouchableOpacity>
        </View>

        {/* Vehicle Number (manual entry / auto-parsed) */}
        <Text style={styles.sectionLabel}>VEHICLE NUMBER</Text>
        <TextInput
          style={styles.textInput}
          value={vehicleNumber}
          onChangeText={setVehicleNumber}
          placeholder="e.g. TN 09 AB 1234"
          placeholderTextColor="#94A3B8"
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="next"
        />

        {/* Driver Photo */}
        <Text style={styles.sectionLabel}>DRIVER PHOTO</Text>
        <View style={styles.photoContainer}>
          {driverPhoto ? (
            <Image source={{ uri: driverPhoto }} style={styles.photo} resizeMode="cover" />
          ) : (
            <View style={styles.noPhoto}>
              <Ionicons name="person" size={64} color="#CBD5E1" />
              <Text style={styles.noPhotoText}>NO PHOTO</Text>
            </View>
          )}
          <TouchableOpacity
            style={[styles.photoOverlayBtn, { backgroundColor: 'rgba(124,58,237,0.75)' }]}
            onPress={() => openCamera('driver')}
          >
            <Ionicons name="camera" size={24} color="#FFFFFF" />
            <Text style={styles.photoOverlayBtnText}>{driverPhoto ? 'RETAKE' : 'CAPTURE'}</Text>
          </TouchableOpacity>
        </View>

        {/* Tower Number */}
        <Text style={styles.sectionLabel}>TOWER NUMBER</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
          {['1', '2', '3', '4', '5'].map(t => (
            <TouchableOpacity
              key={t}
              onPress={() => setFlatNumber(t)}
              style={{
                flex: 1, height: 48, borderWidth: 2,
                borderColor: flatNumber === t ? '#0055FF' : '#CBD5E1',
                backgroundColor: flatNumber === t ? '#0055FF' : '#FFFFFF',
                justifyContent: 'center', alignItems: 'center',
              }}
            >
              <Text style={{
                fontSize: fs(18), fontWeight: '900',
                color: flatNumber === t ? '#FFFFFF' : '#0F172A',
              }}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Done Button */}
        <TouchableOpacity
          style={[styles.doneBtnBig, saving && { opacity: 0.6 }]}
          onPress={handleDone}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color="#FFFFFF" size="large" /> : (
            <>
              <Ionicons name="checkmark-circle" size={32} color="#FFFFFF" />
              <Text style={styles.doneBtnBigText}>LOG ENTRY</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Hidden composite view for capture */}
      <View style={styles.compositeWrapper}>
        <View ref={compositeRef} style={styles.compositeView} collapsable={false}>
          <Text style={styles.compositeTitle}>TAXI / AUTO / CAB LOG</Text>
          <Text style={styles.compositeTimestamp}>{new Date().toLocaleString()}</Text>

          <View style={styles.compositePhotos}>
            {numberPlatePhoto ? (
              <View style={styles.compositePhotoBox}>
                <Text style={styles.compositeLabel}>NUMBER PLATE</Text>
                <Image source={{ uri: numberPlatePhoto }} style={styles.compositeImg} resizeMode="cover" />
              </View>
            ) : null}
            {driverPhoto ? (
              <View style={styles.compositePhotoBox}>
                <Text style={styles.compositeLabel}>DRIVER</Text>
                <Image source={{ uri: driverPhoto }} style={styles.compositeImg} resizeMode="cover" />
              </View>
            ) : null}
          </View>

          <View style={styles.compositeDetails}>
            <Text style={styles.compositeRow}>Vehicle Type: {vehicleType.toUpperCase()}</Text>
            <Text style={styles.compositeRow}>Vehicle Number: {vehicleNumber || 'N/A'}</Text>
            <Text style={styles.compositeRow}>Tower: {flatNumber || 'N/A'}</Text>
            <Text style={styles.compositeRow}>In Time: {new Date().toLocaleString()}</Text>
          </View>
        </View>
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
  content: { padding: 20, paddingBottom: 40 },

  vehicleTypeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  vehicleTypeBtn: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderWidth: 2,
    borderColor: '#78350F',
    borderRadius: 8,
    backgroundColor: '#FFFBEB',
    gap: 4,
  },
  vehicleTypeBtnActive: {
    backgroundColor: '#78350F',
  },
  vehicleTypeBtnText: {
    fontSize: fs(11),
    fontWeight: '800',
    color: '#78350F',
    letterSpacing: 1,
  },
  vehicleTypeBtnTextActive: {
    color: '#FFFFFF',
  },

  sectionLabel: {
    fontSize: fs(11),
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 1,
    marginTop: 12,
    marginBottom: 4,
    marginLeft: 4,
  },
  photoContainer: {
    width: '100%',
    height: 220,
    backgroundColor: '#F1F5F9',
    borderWidth: 2,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    overflow: 'hidden',
  },
  photo: { width: '100%', height: '100%' },
  noPhoto: { justifyContent: 'center', alignItems: 'center' },
  noPhotoText: { fontSize: fs(12), color: '#94A3B8', fontWeight: '700', marginTop: 4 },
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
  textInput: {
    borderWidth: 2,
    borderColor: '#78350F',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: fs(16),
    fontWeight: '700',
    color: '#0F172A',
    backgroundColor: '#FFFBEB',
    marginBottom: 12,
  },
  doneBtn: {
    height: 60,
    backgroundColor: '#16A34A',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    borderWidth: 2,
    borderColor: '#000000',
    marginTop: 16,
  },
  doneBtnText: { fontSize: fs(18), fontWeight: '900', color: '#FFFFFF', letterSpacing: 2 },
  doneBtnBig: {
    height: 80,
    backgroundColor: '#16A34A',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    borderWidth: 3,
    borderColor: '#000000',
    marginTop: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  doneBtnBigText: { fontSize: fs(22), fontWeight: '900', color: '#FFFFFF', letterSpacing: 3 },

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
});
