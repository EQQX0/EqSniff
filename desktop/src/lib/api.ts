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
  error: string | null;
}

export interface ImportResult {
  rows: PacketRow[];
  totalRecords: number;
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
  stopCapture: () => invoke<void>("stop_capture"),
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
  geoLookup: (ips: string[]) => invoke<Record<string, Country>>("geo_lookup", { ips }),
  checkUpdate: () => invoke<UpdateInfo>("check_update"),
  dataFolder: () => invoke<string>("data_folder"),
};
