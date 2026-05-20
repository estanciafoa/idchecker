import { Dimensions } from 'react-native';

const { width } = Dimensions.get('window');

// Tablet threshold: screens wider than 600dp
const isTablet = width >= 600;

// Scale factor for fonts on tablet (1.5x)
const TABLET_SCALE = 1.5;

/**
 * Returns a scaled font size: 1.5x on tablets, unchanged on phones.
 */
export function fs(size: number): number {
  return isTablet ? Math.round(size * TABLET_SCALE) : size;
}
