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

/** City, ISP and VPN flag from an online lookup the user asked for. */
export interface IpDetails {
  address: string;
  city: string;
  region: string;
  isp: string;
  vpn: boolean;
  mobile: boolean;
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

export interface CaptureInterface {
  link: number;
  linkName: string;
  name: string | null;
  description: string | null;
  snaplen: number;
  /** False when the app cannot decode this link type, so its packets are not shown. */
  supported: boolean;
}

export interface ImportResult {
  rows: PacketRow[];
  /** Records in the file. */
  totalRecords: number;
  /** Records looked at. Less than totalRecords only when the file was really cut short. */
  readRecords: number;
  format: "pcap" | "pcapng";
  interfaces: CaptureInterface[];
  /** What the file says about itself (program and system that wrote it). */
  info: string[];
  /** What was not kept or could not be read. Always show these to the person. */
  notes: string[];
}

export interface PacketDetail {
  id: number;
  time: number;
  wireLen: number;
  capLen: number;
  /** The capture holds fewer bytes than the packet had on the wire. */
  truncated: boolean;
  link: number;
  linkName: string;
  iface: number;
  ifaceName: string | null;
  /** The captured bytes, exactly as saved, as base64. */
  data: string;
  fields: { name: string; value: string; start: number; len: number; depth: number }[];
  hexDump: string | null;
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
  exportPcapng: (ids: number[]) => invoke<string>("export_pcapng", { ids }),
  importPcap: (data: string) => invoke<ImportResult>("import_pcap", { data }),
  packetDetail: (id: number, hexDump = false) => invoke<PacketDetail>("packet_detail", { id, hexDump }),
  getStore: (name: string) => invoke<unknown>("get_store", { name }),
  saveStore: (name: string, value: unknown) => invoke<void>("save_store", { name, value }),
  scanStart: (target: string) => invoke<string>("scan_start", { target }),
  scanPoll: () => invoke<ScanPoll>("scan_poll"),
  scanCancel: () => invoke<void>("scan_cancel"),
  vpnStatus: () => invoke<VpnStatus>("vpn_status"),
  vpnImport: (name: string, text: string) => invoke<void>("vpn_import", { name, text }),
  vpnSet: (name: string, on: boolean) => invoke<void>("vpn_set", { name, on }),
  vpnJob: () => invoke<{ running: boolean; error: string | null }>("vpn_job"),
  vpnDelete: async (name: string) => {
    await invoke<void>("vpn_delete", { name });
    // remember it, so a sync removes the tunnel from the account instead of bringing it back
    try {
      const old = await invoke<unknown>("get_store", { name: "vpn-deleted" });
      const map = old && typeof old === "object" && !Array.isArray(old) ? (old as Record<string, number>) : {};
      await invoke<void>("save_store", { name: "vpn-deleted", value: { ...map, [name]: Date.now() } });
    } catch {
      /* the tunnel is gone either way */
    }
  },
  vpnSyncList: () => invoke<{ name: string; hash: string; modified: number }[]>("vpn_sync_list"),
  vpnSyncRead: (name: string) => invoke<string>("vpn_sync_read", { name }),
  vpnSyncWrite: (name: string, text: string) => invoke<void>("vpn_sync_write", { name, text }),
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
  ipDetails: (ips: string[]) => invoke<IpDetails[]>("ip_details", { ips }),
  checkUpdate: () => invoke<UpdateInfo>("check_update"),
  installUpdate: () => invoke<string>("install_update"),
  dataFolder: () => invoke<string>("data_folder"),
};
