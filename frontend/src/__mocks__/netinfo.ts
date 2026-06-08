// Mock for @react-native-community/netinfo
const listeners: Array<(state: any) => void> = [];

const NetInfo = {
  fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addEventListener: jest.fn((callback: (state: any) => void) => {
    listeners.push(callback);
    return () => {
      const idx = listeners.indexOf(callback);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }),
  _triggerChange: (state: any) => { listeners.forEach(cb => cb(state)); },
  _listeners: listeners,
};

export default NetInfo;
