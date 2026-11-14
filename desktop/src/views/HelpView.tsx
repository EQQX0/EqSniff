import { Card } from "@/components/ui/Card";

const FAQ: { q: string; a: string }[] = [
  {
    q: "Does this app send my data anywhere?",
    a: "No. Captures, filters and device names stay in a folder on this computer (see Settings). The only thing the app may ever contact is an update server, and you can turn that off in Settings.",
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
    q: "How do filters work?",
    a: "A filter picks which packets the table shows. A packet must match every box that is filled in: protocol, port, address, packet size, and bytes in the payload (hex). Direction says whether the port and address boxes check the sender, the receiver or either. Switch filters on and off with the chips above the table or the checkboxes on the Filters page. With several on, a packet shows if it matches any of them; with none on, everything shows. Filters change the view only; the capture keeps running underneath. Export and import filters as files from the Filters page.",
  },
  {
    q: "What does Replay do?",
    a: "It sends one saved packet again, once, from the adapter it was captured on. It only works for packets between two devices on your own network (neither end can be an internet address), and it asks you to confirm first. The app keeps the most recent 20,000 packets. Packets opened from a file cannot be replayed. Packets larger than the saved size cannot be replayed.",
  },
  {
    q: "What does the Network scan do?",
    a: "It finds the devices on your own network and checks 22 common ports on each, using ordinary connections like a browser makes. It scans only the network this computer is on, up to 256 addresses, and asks you to confirm you own or manage the network. Devices that block every connection may show up only by their MAC address, or not at all. Scan only networks you are allowed to scan.",
  },
  {
    q: "Can I save a capture and open it in Wireshark?",
    a: "Yes. The PCAP button saves the packets in the table as a standard .pcap file. Open capture file loads a .pcap file (up to 5,000 packets are shown, from the first 32 MB). Files saved as pcapng must be converted to classic pcap first. Opening a file replaces the table, and its packets can be exported again but not replayed.",
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
            <summary className="cursor-pointer text-sm font-medium text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              {item.q}
            </summary>
            <p className="mt-2 text-sm text-muted">{item.a}</p>
          </details>
        ))}
      </Card>
    </div>
  );
}
