import { Card } from "@/components/ui/Card";

const FAQ: { q: string; a: string }[] = [
  {
    q: "Does this app send my data anywhere?",
    a: "No. Captures, filters and device names stay in a folder on this computer (see Settings). The app contacts only three things: an update server (you can turn that off in Settings), db-ip.com once a month to download the city database, and, only if you sign in to an account, your sync account, which keeps your IP Storage, filters and VPN tunnels the same on every computer. Tunnels, filters and IP addresses you choose to share become visible to other signed-in accounts; nothing is shared unless you press Share. You can also export and import everything as a file in Settings. Capture works out each address's country, city, ISP and VPN or hosting status from databases stored on this computer, so no address is ever sent anywhere.",
  },
  {
    q: "The capture will not start. What do I check?",
    a: "Install Npcap (npcap.com), then restart the app. If Windows blocks access to the adapter, run the app as administrator or reinstall Npcap with the option that lets non-administrators capture.",
  },
  {
    q: "Which adapter should I pick?",
    a: "The one marked (connected). That is the adapter your computer uses to reach the internet. Wi-Fi and Ethernet are separate adapters.",
  },
  {
    q: "Why do I see only my own computer's traffic?",
    a: "Capture shows what crosses the selected adapter. On a normal switched network that is your computer's traffic plus broadcasts. Seeing other devices' private traffic would need special equipment, and this app does not try to do it.",
  },
  
  {
    q: "How does the VPN page work?",
    a: "It keeps your WireGuard tunnels in one list, like the WireGuard app. Add a tunnel with a .conf file from your VPN provider, pick it, and press Activate. The app carries the traffic itself with a built-in WireGuard engine, so nothing else needs installing. Windows asks you to allow each start, because the virtual network adapter needs administrator rights. Traffic that your tunnel's allowed addresses cover goes through the VPN. If the app closes while a tunnel is on, the adapter disappears and traffic goes back to your normal connection. You can edit a tunnel that is off with the Edit button, and the Log tab shows what the engine did. The kill switch checkbox blocks all traffic outside the VPN while the tunnel is active, except the VPN server and your local network; if the tunnel drops, traffic stays blocked until you press Deactivate. It is off by default. The private key stays in the saved file and is never shown. Files that try to run commands (PostUp and similar) are refused.",
  },
  {
    q: "How do I share this PC's internet with my console?",
    a: "Open the Hotspot page. With a Wi-Fi adapter, save a name and password. On the right, pick the Public adapter (the connection that has internet; the list shows every connection the way Windows names it). Leave \"Share internet automatically\" on and press Start Hotspot: the app starts the hotspot, finds the adapter Windows made for it, and shares the internet through it. Windows asks for administrator permission once. Stop Hotspot turns that sharing off again. Without Wi-Fi (a wired PC), use Sharing / Bridge by hand: Public is the adapter with internet, Private is the adapter that goes to the console, then press Share internet. Windows gives the private side the address 192.168.137.1 and hands the console an address by itself, so leave the console on automatic (DHCP). If sharing was turned on outside this app, press Reset first. Press Disable Sharing when you are done. The hotspot password is saved on this PC and never shown again.",
  },
  {
    q: "How do filters work?",
    a: "A filter is either a Show filter (keeps only the packets it matches) or a Hide filter (removes them). There is one filter system for everything: the capture records all traffic on the adapter, and filters only change what the table shows, so you can switch them off to bring hidden packets back. A packet must match every box that is filled in: protocol, port, address, packet size, and bytes in the payload (hex). Direction says whether the port and address boxes check the sender, the receiver or either. Switch filters on and off with the chips above the table or the checkboxes on the Filters page. With several Show filters on, a packet stays if it matches any of them. A Hide filter always wins. With none on, everything shows. The table keeps the latest 3,000 packets. Filters change the view only; the capture keeps running underneath. Export and import filters as files from the Filters page.",
  },
  {
    q: "How do I label an address, and how do I sort the table?",
    a: "Click + Add label in the Label column of any row and type a label. It is saved in IP Storage as the label for the address on the other end of that packet, so every row with that address shows it, and you can edit it on the IP Storage page too. Clear the box to remove it. Click a column heading to sort by it (Label, IP, port, country, protocol, bytes or time). Click again to reverse, and a third time to go back to arrival order. The Columns button chooses which columns show. Double-click a cell to copy it.",
  },

  {
    q: "What does the scan on the Devices page do?",
    a: "It finds the devices on your own network and checks 22 common ports on each, using ordinary connections like a browser makes. It scans only the network this computer is on, up to 256 addresses,. Devices that block every connection may show up only by their MAC address, or not at all. Found devices appear in the Devices table.",
  },
  {
    q: "Can I save a capture and open it in Wireshark?",
    a: "Yes. The PCAP and PCAPNG buttons save the packets in the table as standard capture files that Wireshark opens. Open capture file loads .pcap and .pcapng files (up to 5,000 packets are shown, from the first 32 MB). Anything in a file the app does not keep is listed under the table. Opening a file replaces the table, and its packets can be exported again but not replayed. To see a packet byte by byte, right-click it and choose Inspect bytes (HEX).",
  },
  {
    q: "How do I copy packets?",
    a: "Copy on a row copies that packet as tab-separated text. Double-click a cell to copy just that cell. Copy table copies every row in the table with a header line, and pastes into a spreadsheet as separate cells.",
  },
  {
    q: "How do I watch one device?",
    a: "On the Devices page, press Watch next to the device. The Capture page then shows only packets to or from that address. This computer sees only the traffic sent to or from itself, plus traffic the network shares with everyone. The app does not intercept other devices' traffic.",
  },
  {
    q: "What does the Country column show?",
    a: "The country of the computer on the other end of a connection, looked up in a database built into the app. Nothing is sent anywhere, and it shows the country only. Many sites use servers in other countries, so treat it as a rough guide.",
  },
  {
    q: "What is IP Storage for?",
    a: "A plain address book for your own labels: an address and a label, nothing more. Save a router address, a server, or anything else you want to remember, then search, edit or delete it later. It is not tied to a capture and does not feed into any filter. It stays on this computer unless you sign in under Settings and turn on Sync IP Storage, which keeps the list the same on your other computers. Filters and VPN tunnels can be synced the same way, privately to your account.",
  },
  {
    q: "Where are my files?",
    a: "Settings shows the data folder. Deleting that folder removes everything the app saved.",
  },
];

export function HelpView() {
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-text">Help</h1>
        <p className="mt-1 text-sm text-muted">Everything here works offline.</p>
      </div>
      <Card className="divide-y divide-border p-0">
        {FAQ.map((item) => (
          <details key={item.q} className="group px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft">
              {item.q}
            </summary>
            <p className="mt-2 text-sm text-muted">{item.a}</p>
          </details>
        ))}
      </Card>
    </div>
  );
}
