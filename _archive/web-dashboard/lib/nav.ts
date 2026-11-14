export interface NavItem {
  href: string;
  label: string;
  screenId: string;
  locked?: boolean;
}

export const NAV_MAIN: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", screenId: "S03" },
  { href: "/tools", label: "Tools", screenId: "S18" },
  { href: "/devices", label: "Devices", screenId: "S20" },
  { href: "/filters", label: "Packet Filters", screenId: "S21" },
  { href: "/downloads", label: "Downloads", screenId: "S23" },
  { href: "/device-access", label: "Device Access", screenId: "S24" },
  { href: "/xbox", label: "Xbox", screenId: "S25", locked: true },
];

export const NAV_SHOP: NavItem[] = [
  { href: "/store", label: "Store", screenId: "S16" },
  { href: "/products", label: "My Products", screenId: "S26" },
  { href: "/billing", label: "Billing", screenId: "S27" },
];

export const NAV_SUPPORT: NavItem[] = [
  { href: "/settings", label: "Settings", screenId: "S14" },
  { href: "/integrations", label: "Linked Accounts", screenId: "S13" },
  { href: "/support", label: "Support", screenId: "S17" },
];
