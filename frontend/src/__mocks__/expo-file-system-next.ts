// Mock for expo-file-system/next
export class File {
  uri: string;
  constructor(...args: any[]) { this.uri = args.join('/'); }
  get exists() { return false; }
  text() { return ''; }
  write() {}
  delete() {}
}

export class Directory {
  uri: string;
  constructor(...args: any[]) { this.uri = args.join('/'); }
  get exists() { return false; }
  create() {}
  delete() {}
}

export const Paths = {
  document: 'file:///mock/documents',
  cache: 'file:///mock/cache',
};
