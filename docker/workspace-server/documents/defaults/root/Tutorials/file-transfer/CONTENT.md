# File Transfer & RE-VFS Guide

Share files securely with post-quantum cryptographic protection.

## Transfer Modes

### "Send File" (Recommended)
- Files uploaded to server temporarily
- Recipient downloads when ready
- Works even when recipient is offline
- **Auto-deleted after download**

### "P2P Only Transfer"
- Direct peer-to-peer streaming
- Fastest for large files
- Both users must be online simultaneously
- No server storage involved

## How to Send a File

1. Open a P2P conversation
2. Click the paperclip icon in the message bar
3. Drag & drop or click to select your file
4. Choose your transfer mode
5. Click **Send**

## Receiving Files

When someone sends you a file:
- A file bubble appears in your chat
- Click **Accept** to download
- Click **Decline** to reject
- Files are encrypted end-to-end

## RE-VFS: Decentralized Storage

RE-VFS (Remote Encrypted Virtual File System) lets you store files across peer devices.

### Why RE-VFS is Different

| Feature | Traditional Services | RE-VFS (Citadel) |
|---------|---------------------|------------------|
| **Who sees your files?** | Service provider | Only YOU |
| **Encryption** | Provider has keys | End-to-end, post-quantum |
| **Single point of failure** | Yes | No (distributed) |

### Zero-Knowledge Storage

When you allow a peer to store files on your device:
- You become a **blind host**
- Files are encrypted with post-quantum algorithms
- You **cannot** view or decrypt their contents
- Only the file owner holds the decryption keys

### Managing Storage

**Via Chat Settings:**
1. Click the settings icon in a P2P chat
2. Go to the **RE-VFS Storage** tab
3. Toggle "Allow [peer] to store files on your device"
4. Adjust storage quota per-peer

**Via File Manager:**
- Access from the sidebar
- Browse storage locations
- Right-click files: Open, Info, Delete

## Per-Peer Settings

Customize settings for each peer in Chat Settings:

**File Transfers Tab:**
- Auto-accept files toggle
- Max file size to accept

**RE-VFS Storage Tab:**
- Allow storage toggle
- Storage quota slider

---

*Post-quantum cryptography ensures your files remain secure even against future quantum computers.*
