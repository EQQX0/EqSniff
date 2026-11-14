Network Toolkit (portable)

What it is
A Windows app that shows the network traffic on your own computer, lets you filter it, copy it, and save or open .pcap files, and scans your own network for devices and open ports. It shows the country at the far end of each connection. Everything stays on your computer. The app has no account and sends none of your data anywhere. Its only connection is an optional update check, which you can turn off in Settings.

What you need
1. Windows 10 or 11 (64-bit).
2. Npcap, free from npcap.com. Install it first. The app tells you if it is missing.
3. Microsoft Edge WebView2. Windows 11 and current Windows 10 already have it.

How to start
Unzip the folder anywhere and double-click network-toolkit.exe.

Where it saves things
Settings, filters and device names go in:
%APPDATA%\app.networktoolkit.desktop
Delete that folder to remove everything the app saved. To uninstall, delete the unzipped folder.

Network scan
The scan checks only the network your computer is connected to, up to 256 addresses. Scan only networks you own or have permission to scan.

Limits of this version
- The file is self-signed, not signed by a certificate authority, so Windows SmartScreen may warn you. To trust it on your own PC, import EqSniff-selfsigned.cer (included) into Trusted Publishers. Run the file only if you trust where you got it.
- The update check shows a notice only. It does not download or install anything. Turn it off in Settings and the app never connects.
- The Country column uses a database built into the app. It is a rough guide.
- Capture shows traffic that crosses your selected network adapter.
