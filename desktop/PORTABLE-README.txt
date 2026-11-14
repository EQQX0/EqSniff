Network Toolkit (portable)

What it is
A Windows app that shows the network traffic on your own computer, lets you filter and export it, and lets you cap your own computer's upload speed for testing. Everything stays on your computer. The app has no account and sends no data anywhere.

What you need
1. Windows 10 or 11 (64-bit).
2. Npcap, free from npcap.com. Install it first. The app tells you if it is missing.
3. Microsoft Edge WebView2. Windows 11 and current Windows 10 already have it.

How to start
Unzip the folder anywhere and double-click network-toolkit.exe.
To use Traffic control, right-click the file and choose Run as administrator. Windows requires this to change speed limits.

Where it saves things
Settings, filters and device names go in:
%APPDATA%\app.networktoolkit.desktop
Delete that folder to remove everything the app saved. To uninstall, delete the unzipped folder.

Emergency stop
Press Ctrl+Shift+X in the app to remove a speed limit at once. Closing the app removes it too.

Limits of this version
- The file is not code-signed, so Windows SmartScreen may warn you the first time. Choose More info, then Run anyway, only if you trust where you got the file.
- No automatic updates yet.
- Capture shows traffic that crosses your selected network adapter.
