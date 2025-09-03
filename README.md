Got it 👍 — here’s a polished `README.md` draft tailored for your repo:

# Minecraft Server Auto-Updater

A Node.js script that automatically updates a [Fabric](https://fabricmc.net/) Minecraft server and its mods.  
It handles downloading the latest Fabric loader, fetching updated mods from [Modrinth](https://modrinth.com/), backing up old files, verifying file integrity, and restarting the server with minimal downtime.

---

## ✨ Features

- **Fabric Loader Updates** — Uses Playwright to scrape the Fabric website and grab the latest server `.jar`.
- **Mod Updates via Modrinth API** — Fetches the latest compatible mod versions automatically.
- **Automatic Backups** — Creates timestamped backups of your `mods/` directory before replacing anything.
- **File Integrity Verification** — Verifies SHA-1 hashes of downloaded files to ensure integrity.
- **Duplicate Cleanup** — Removes old versions of mods before downloading the new ones.
- **Systemd Integration**
- Default: checks if the `minecraft` service is active and skips updates if running.
- Optional: stop/restart the server automatically when configured.
- **Logging & Update Summary** — Prints detailed logs of success, skipped, and failed updates.

Example output:

```

📦 Processing noisium...
⏭️  Noisium v2.7.0+mc1.21.6 already exists

📊 Update Summary:
✅ Successful updates: 0
❌ Failed updates: 0
⏭️  Skipped: 1

```

---

## 🚀 Usage

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/minecraft-server-auto-updater.git
cd minecraft-server-auto-updater
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure

Edit the `config` field of the constructor:


- `minecraftVersion`: Minecraft version to track.
- `mods`: Modrinth project slugs to update.
- `serverDir`: Your server install path.
- `restartServer`: If true, the script will stop/start the `minecraft` systemd unit.

### 4. Run manually

```bash
node updater.js
```

### 5. Automate with systemd

Create a timer to run daily/weekly. Example:

```ini
# /etc/systemd/system/mc-updater.service
[Unit]
Description=Minecraft Server Auto-Updater

[Service]
WorkingDirectory=/path/to/minecraft-server-auto-updater
ExecStart=/usr/bin/node updater.js
```

```ini
# /etc/systemd/system/mc-updater.timer
[Unit]
Description=Run Minecraft Server Auto-Updater Daily

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

Enable the timer:

```bash
sudo systemctl enable --now mc-updater.timer
```

---

## 🛠️ Requirements

- Node.js 18+
- [Playwright](https://playwright.dev/) (installed via npm)
- [Axios](https://axios-http.com/)
- Linux server with `systemd`

---

## 📖 Blog Post

This project is documented in detail here:
👉 [How to Automatically Update a Fabric Minecraft Server with Node.js](LINK_TO_YOUR_POST)

---

## 📜 License

MIT License — see [LICENSE](LICENSE).
