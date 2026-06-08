// Mock for expo-file-system/legacy
export const documentDirectory = 'file:///mock/documents/';
export const cacheDirectory = 'file:///mock/cache/';
export const EncodingType = { Base64: 'base64', UTF8: 'utf8' };

export const getInfoAsync = jest.fn(async () => ({ exists: false, isDirectory: false }));
export const makeDirectoryAsync = jest.fn(async () => {});
export const readAsStringAsync = jest.fn(async () => '');
export const writeAsStringAsync = jest.fn(async () => {});
export const readDirectoryAsync = jest.fn(async () => []);
export const downloadAsync = jest.fn(async () => ({ uri: '', status: 200 }));
export const deleteAsync = jest.fn(async () => {});
export const copyAsync = jest.fn(async () => {});

export default {
  documentDirectory,
  cacheDirectory,
  EncodingType,
  getInfoAsync,
  makeDirectoryAsync,
  readAsStringAsync,
  writeAsStringAsync,
  readDirectoryAsync,
  downloadAsync,
  deleteAsync,
  copyAsync,
};
