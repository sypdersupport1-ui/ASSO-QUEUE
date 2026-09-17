export type RealtimeConnectionState = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

export interface RealtimeChannelConfig {
  channelName: string;
  table?: string;
  schema?: string;
  filter?: string;
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
}
