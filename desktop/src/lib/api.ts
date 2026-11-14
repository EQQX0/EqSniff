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

export interface LimitStatus {
  active: boolean;
  kbps: number | null;
}

export interface Poll {
  rows: PacketRow[];
  running: boolean;
  error: string | null;
}

export const api = {
  listAdapters: () => invoke<Adapter[]>("list_adapters"),
  startCapture: (adapter: string) => invoke<void>("start_capture", { adapter }),
  pollCapture: () => invoke<Poll>("poll_capture"),
  stopCapture: () => invoke<void>("stop_capture"),
  getSettings: () => invoke<Settings>("get_settings"),
  setSettings: (settings: Settings) => invoke<void>("set_settings", { settings }),
  getFilters: () => invoke<unknown>("get_filters"),
  saveFilters: (filters: unknown) => invoke<void>("save_filters", { filters }),
  replayPacket: (id: number) => invoke<string>("replay_packet", { id }),
  getStore: (name: string) => invoke<unknown>("get_store", { name }),
  saveStore: (name: string, value: unknown) => invoke<void>("save_store", { name, value }),
  trafficStatus: () => invoke<LimitStatus>("traffic_status"),
  trafficLimit: (kbps: number) => invoke<LimitStatus>("traffic_limit", { kbps }),
  trafficStop: () => invoke<LimitStatus>("traffic_stop"),
  geoLookup: (ips: string[]) => invoke<Record<string, Country>>("geo_lookup", { ips }),
  checkUpdate: () => invoke<UpdateInfo>("check_update"),
  dataFolder: () => invoke<string>("data_folder"),
};
