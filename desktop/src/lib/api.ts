import { invoke } from "@tauri-apps/api/core";

export interface Adapter {
  name: string;
  description: string;
  connected: boolean;
}

export interface PacketRow {
  id: number;
  time: number;
  src: string;
  dst: string;
  srcPort: number | null;
  dstPort: number | null;
  protocol: string;
  length: number;
  head: string;
}

export interface Settings {
  updateCheck: boolean;
  lastAdapter: string | null;
}

export interface VpnPeer {
  publicKey: string;
  hasPresharedKey: boolean;
  allowedIps: string[];
  endpoint: string | null;
  keepalive: number | null;
}

export interface VpnTunnel {
  name: string;
  active: boolean;
  publicKey: string | null;
  addresses: string[];
  dns: string[];
  mtu: number | null;
  listenPort: number | null;
  fullTunnel: boolean;
  killswitch: boolean;
  peers: VpnPeer[];
}

export interface VpnStatus {
  installed: boolean;
  tunnels: VpnTunnel[];
}

export interface HotspotStatus {
  state: "on" | "off" | "intransition" | "unavailable" | string;
  clients: number;
  wifiAvailable: boolean;
  ssid: string;
  hasPassword: boolean;
  message: string | null;
  autoShare: boolean;
  publicAdapter: string;
}

export interface SharingStatus {
  on: boolean;
  public: string | null;
  private: string | null;
  byApp: boolean;
}

export interface SharingAdapter {
  name: string;
  description: string;
  connected: boolean;
  isVirtual: boolean;
  ipv4: string | null;
}

export interface HotspotDevice {
  name: string;
  ip: string;
  mac: string;
}

export interface HotspotJob {
  running: boolean;
  kind: string;
  error: string | null;
  note: string | null;
  warning: string | null;
}

export interface Country {
  code: string;
  name: string;
}

export interface UpdateInfo {
  status: "disabled" | "up-to-date" | "available" | "unreachable";
  current: string;
  latest: string | null;
  url: string | null;
  notes: string | null;
  canInstall: boolean;
  message: string;
}

export interface ScanHost {
  ip: string;
  mac: string | null;
  ports: { port: number; service: string }[];
}

export interface ScanPoll {
  running: boolean;
  scanned: number;
  total: number;
  hosts: ScanHost[];
}

export interface ImportResult {
  rows: PacketRow[];
  /** Records in the file. */
  totalRecords: number;
  /** Records looked at. Less than totalRecords only when the file was really cut short. */
  readRecords: number;
}

export interface Poll {
  rows: PacketRow[];
  running: boolean;
  error: string | null;
}

export const api = {
  listAdapters: () => invoke<Adapter[]>("list_adapters"),
  startCapture: (adapter: string, filter: string) => invoke<void>("start_capture", { adapter, filter }),
  pollCapture: () => invoke<Poll>("poll_capture"),
  stopCapture: () => invoke<PacketRow[]>("stop_capture"),
  getSettings: () => invoke<Settings>("get_settings"),
  setSettings: (settings: Settings) => invoke<void>("set_settings", { settings }),
  getFilters: () => invoke<unknown>("get_filters"),
  saveFilters: (filters: unknown) => invoke<void>("save_filters", { filters }),
  replayPacket: (id: number) => invoke<string>("replay_packet", { id }),
  exportPcap: (ids: number[]) => invoke<string>("export_pcap", { ids }),
  importPcap: (data: string) => invoke<ImportResult>("import_pcap", { data }),
  getStore: (name: string) => invoke<unknown>("get_store", { name }),
  saveStore: (name: string, value: unknown) => invoke<void>("save_store", { name, value }),
  scanStart: (target: string) => invoke<string>("scan_start", { target }),
  scanPoll: () => invoke<ScanPoll>("scan_poll"),
  scanCancel: () => invoke<void>("scan_cancel"),
  vpnStatus: () => invoke<VpnStatus>("vpn_status"),
  vpnImport: (name: string, text: string) => invoke<void>("vpn_import", { name, text }),
  vpnSet: (name: string, on: boolean) => invoke<void>("vpn_set", { name, on }),
  vpnJob: () => invoke<{ running: boolean; error: string | null }>("vpn_job"),
  vpnDelete: (name: string) => invoke<void>("vpn_delete", { name }),
  vpnRead: (name: string) => invoke<string>("vpn_read", { name }),
  vpnUpdate: (name: string, text: string) => invoke<void>("vpn_update", { name, text }),
  vpnLog: (name: string) => invoke<string>("vpn_log", { name }),
  vpnSetOption: (name: string, killswitch: boolean) => invoke<void>("vpn_set_option", { name, killswitch }),
  hotspotStatus: () => invoke<HotspotStatus>("hotspot_status"),
  hotspotSave: (ssid: string, password: string | null) => invoke<void>("hotspot_save", { ssid, password }),
  hotspotPrefs: (publicAdapter: string, autoShare: boolean) =>
    invoke<void>("hotspot_prefs", { publicAdapter, autoShare }),
  hotspotStart: () => invoke<void>("hotspot_start"),
  hotspotStop: () => invoke<void>("hotspot_stop"),
  hotspotJob: () => invoke<HotspotJob>("hotspot_job"),
  hotspotDevices: (interfaceIp: string | null) => invoke<HotspotDevice[]>("hotspot_devices", { interfaceIp }),
  sharingStatus: () => invoke<SharingStatus>("sharing_status"),
  sharingAdapters: () => invoke<SharingAdapter[]>("sharing_adapters"),
  sharingApply: (publicName: string, privateName: string) =>
    invoke<void>("sharing_apply", { public: publicName, private: privateName }),
  sharingReset: () => invoke<void>("sharing_reset"),
  geoLookup: (ips: string[]) => invoke<Record<string, Country>>("geo_lookup", { ips }),
  checkUpdate: () => invoke<UpdateInfo>("check_update"),
  installUpdate: () => invoke<string>("install_update"),
  dataFolder: () => invoke<string>("data_folder"),
};
