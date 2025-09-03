const { chromium } = require("playwright")
const util = require("util")
const { exec } = require("child_process")
const execAsync = util.promisify(exec)
const fs = require("fs").promises
const path = require("path")
const axios = require("axios")
const crypto = require("crypto")

class FabricServerUpdater {
  constructor(config) {
    this.config = {
      serverPath: "./server",
      modsPath: "./server/mods",
      minecraftVersion: "1.20.4",
      fabricVersion: null, // null = latest
      timeout: 30000,
      backupMods: true,
      ...config,
    }
    this.page = null
    this.browser = null
  }

  async init() {
    this.browser = await chromium.launch({ headless: true })
    this.page = await this.browser.newPage()

    // Ensure directories exist
    await fs.mkdir(this.config.serverPath, { recursive: true })
    await fs.mkdir(this.config.modsPath, { recursive: true })

    if (this.config.backupMods) {
      await fs.mkdir(path.join(this.config.serverPath, "mods-backup"), {
        recursive: true,
      })
    }
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close()
    }
  }

  // Updated Fabric loader update function for current website
  async updateFabricLoader() {
    if (!this.config.fabricVersion) {
      console.log("🔄 Checking for latest Fabric loader...")
    } else {
      console.log(
        `🔄 Updating Fabric loader to ${this.config.fabricVersion}...`,
      )
    }

    try {
      await this.page.goto("https://fabricmc.net/use/server/", {
        waitUntil: "networkidle",
        timeout: this.config.timeout,
      })

      // Wait for the page to fully load and JavaScript to initialize
      await this.page.waitForTimeout(5000)

      // Find the minecraft version dropdown (id="minecraft-version")
      const gameVersionSelect = this.page.locator("#minecraft-version")

      if ((await gameVersionSelect.count()) === 0) {
        throw new Error("Could not find Minecraft version selector")
      }

      console.log("Found Minecraft version selector")

      // Select the minecraft version
      await gameVersionSelect.selectOption(this.config.minecraftVersion)
      console.log(`Selected Minecraft version: ${this.config.minecraftVersion}`)

      // Wait for the page to update
      await this.page.waitForTimeout(2000)

      // Find and optionally set loader version (id="loader-version")
      const loaderVersionSelect = this.page.locator("#loader-version")

      if (
        this.config.fabricVersion &&
        (await loaderVersionSelect.count()) > 0
      ) {
        await loaderVersionSelect.selectOption(this.config.fabricVersion)
        console.log(
          `Selected Fabric loader version: ${this.config.fabricVersion}`,
        )
        await this.page.waitForTimeout(1000)
      }

      // Find the download link - it should be a direct link now
      const downloadLink = this.page.locator(
        'a.button:has-text("Executable Server")',
      )

      if ((await downloadLink.count()) === 0) {
        // Try alternative selectors
        const alternativeSelectors = [
          'a[href*="server/jar"]',
          'a:has-text("Download")',
          ".download a.button",
        ]

        let foundLink = false
        for (const selector of alternativeSelectors) {
          const altLink = this.page.locator(selector)
          if ((await altLink.count()) > 0) {
            console.log(`Found download link with selector: ${selector}`)
            const downloadPromise = this.page.waitForEvent("download")
            await altLink.first().click()
            const download = await downloadPromise

            const targetPath = path.join(this.config.serverPath, "server.jar")
            await download.saveAs(targetPath)
            console.log(`✅ Fabric server launcher updated: ${targetPath}`)
            foundLink = true
            return targetPath
          }
        }

        if (!foundLink) {
          throw new Error(
            "Could not find download link for Fabric server launcher",
          )
        }
      } else {
        // Click the main download button
        console.log("Found Executable Server download button")
        const downloadPromise = this.page.waitForEvent("download")
        await downloadLink.first().click()
        const download = await downloadPromise

        const targetPath = path.join(this.config.serverPath, "server.jar")
        await download.saveAs(targetPath)
        console.log(`✅ Fabric server launcher updated: ${targetPath}`)
        return targetPath
      }
    } catch (error) {
      console.error("❌ Fabric loader update failed:", error.message)
      console.log(
        "⚠️  Skipping Fabric loader update, continuing with mod updates...",
      )
      return null
    }
  }

  // Systemd service management
  async checkSystemdService() {
    if (!this.config.systemdService) return null

    try {
      const { stdout } = await execAsync(
        `systemctl is-active ${this.config.systemdService}`,
      )
      return stdout.trim()
    } catch (error) {
      return "inactive"
    }
  }

  async stopServer() {
    if (!this.config.systemdService) return

    console.log(`🛑 Stopping ${this.config.systemdService} service...`)
    try {
      await execAsync(`sudo systemctl stop ${this.config.systemdService}`)

      // Wait a bit to ensure it's fully stopped
      await new Promise((resolve) => setTimeout(resolve, 5000))

      const status = await this.checkSystemdService()
      if (status === "inactive") {
        console.log("✅ Server stopped successfully")
      } else {
        console.warn(`⚠️  Server status: ${status}`)
      }
    } catch (error) {
      console.error("❌ Failed to stop server:", error.message)
      throw error
    }
  }

  async startServer() {
    if (!this.config.systemdService) return

    console.log(`🚀 Starting ${this.config.systemdService} service...`)
    try {
      await execAsync(`sudo systemctl start ${this.config.systemdService}`)

      // Wait a bit and check status
      await new Promise((resolve) => setTimeout(resolve, 5000))

      const status = await this.checkSystemdService()
      if (status === "active") {
        console.log("✅ Server started successfully")
      } else {
        console.warn(`⚠️  Server status: ${status}`)
      }
    } catch (error) {
      console.error("❌ Failed to start server:", error.message)
      throw error
    }
  }

  // Fix file permissions for minecraft user
  async fixPermissions() {
    if (!this.config.serverUser) return

    console.log("🔧 Fixing file permissions...")
    try {
      await execAsync(
        `sudo chown -R ${this.config.serverUser}:${this.config.serverGroup} ${this.config.serverPath}`,
      )
      console.log("✅ Permissions fixed")
    } catch (error) {
      console.warn("⚠️  Failed to fix permissions:", error.message)
    }
  }

  // Get mod metadata from Modrinth
  async getModInfo(projectId) {
    try {
      const response = await axios.get(
        `https://api.modrinth.com/v2/project/${projectId}`,
      )
      return response.data
    } catch (error) {
      console.error(
        `❌ Failed to get mod info for ${projectId}:`,
        error.message,
      )
      return null
    }
  }

  // Get latest version for a mod
  async getLatestModVersion(
    projectId,
    gameVersions = null,
    loaders = ["fabric"],
  ) {
    try {
      const versions = gameVersions
        ? gameVersions
        : [this.config.minecraftVersion]
      const params = new URLSearchParams({
        loaders: JSON.stringify(loaders),
        game_versions: JSON.stringify(versions),
      })

      const response = await axios.get(
        `https://api.modrinth.com/v2/project/${projectId}/version?${params}`,
      )
      const modVersions = response.data

      if (modVersions.length === 0) {
        console.warn(`⚠️  No compatible versions found for ${projectId}`)
        return null
      }

      // Return the latest version (first in the array)
      return modVersions[0]
    } catch (error) {
      console.error(
        `❌ Failed to get versions for ${projectId}:`,
        error.message,
      )
      return null
    }
  }

  // Download a mod file
  async downloadMod(versionData, modInfo) {
    try {
      const primaryFile =
        versionData.files.find((f) => f.primary) || versionData.files[0]
      if (!primaryFile) {
        throw new Error("No downloadable file found")
      }

      console.log(
        `📥 Downloading ${modInfo.title} v${versionData.version_number}...`,
      )

      const response = await axios.get(primaryFile.url, {
        responseType: "stream",
      })
      const filePath = path.join(this.config.modsPath, primaryFile.filename)

      const writer = require("fs").createWriteStream(filePath)
      response.data.pipe(writer)

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve)
        writer.on("error", reject)
      })

      // Verify file integrity if hash is provided
      if (primaryFile.hashes && primaryFile.hashes.sha1) {
        const fileBuffer = await fs.readFile(filePath)
        const hash = crypto.createHash("sha1").update(fileBuffer).digest("hex")
        if (hash !== primaryFile.hashes.sha1) {
          throw new Error("File hash verification failed")
        }
      }

      console.log(`✅ Downloaded ${primaryFile.filename}`)
      return filePath
    } catch (error) {
      console.error(`❌ Failed to download ${modInfo.title}:`, error.message)
      return null
    }
  }

  // Backup existing mods
  async backupMods() {
    if (!this.config.backupMods) return

    console.log("💾 Backing up existing mods...")
    const backupDir = path.join(this.config.serverPath, "mods-backup")
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const backupPath = path.join(backupDir, `mods-${timestamp}`)

    try {
      await fs.mkdir(backupPath, { recursive: true })
      const modFiles = await fs.readdir(this.config.modsPath)

      for (const file of modFiles) {
        if (file.endsWith(".jar")) {
          const source = path.join(this.config.modsPath, file)
          const dest = path.join(backupPath, file)
          await fs.copyFile(source, dest)
        }
      }

      console.log(`✅ Mods backed up to ${backupPath}`)
    } catch (error) {
      console.warn("⚠️  Failed to backup mods:", error.message)
    }
  }

  // Update mods from a list
  async updateMods(modList) {
    console.log("🔄 Starting mod updates...")

    await this.backupMods()

    const results = {
      successful: [],
      failed: [],
      skipped: [],
    }

    for (const modId of modList) {
      try {
        console.log(`\n📦 Processing ${modId}...`)

        const modInfo = await this.getModInfo(modId)
        if (!modInfo) {
          results.failed.push({ modId, reason: "Failed to get mod info" })
          continue
        }

        const latestVersion = await this.getLatestModVersion(modId)
        if (!latestVersion) {
          results.skipped.push({ modId, reason: "No compatible version found" })
          continue
        }

        // Check if we already have this version
        const primaryFile =
          latestVersion.files.find((f) => f.primary) || latestVersion.files[0]
        const existingFile = path.join(
          this.config.modsPath,
          primaryFile.filename,
        )

        try {
          await fs.access(existingFile)
          console.log(
            `⏭️  ${modInfo.title} v${latestVersion.version_number} already exists`,
          )
          results.skipped.push({ modId, reason: "Already up to date" })
          continue
        } catch {
          // File doesn't exist, proceed with download
        }

        // Remove old versions of this mod. This currently uses substring comparison, but might break if one mod name contains the other. For example, `lithium` and `lithium-addons`.
        const modFiles = await fs.readdir(this.config.modsPath)
        for (const file of modFiles) {
          if (
            file.toLowerCase().includes(modInfo.slug.toLowerCase()) &&
            file.endsWith(".jar")
          ) {
            const oldFile = path.join(this.config.modsPath, file)
            await fs.unlink(oldFile)
            console.log(`🗑️  Removed old version: ${file}`)
          }
        }

        const downloadPath = await this.downloadMod(latestVersion, modInfo)
        if (downloadPath) {
          results.successful.push({
            modId,
            name: modInfo.title,
            version: latestVersion.version_number,
            file: primaryFile.filename,
          })
        } else {
          results.failed.push({ modId, reason: "Download failed" })
        }
      } catch (error) {
        console.error(`❌ Error processing ${modId}:`, error.message)
        results.failed.push({ modId, reason: error.message })
      }
    }

    return results
  }

  // Main update function
  async updateServer(modList = []) {
    let serverWasRunning = false

    try {
      await this.init()

      console.log("🚀 Starting Fabric server update...\n")

      // Check if server is running
      if (this.config.systemdService) {
        const status = await this.checkSystemdService()
        serverWasRunning = status === "active"

        if (serverWasRunning) {
          console.log(`📊 Server is currently running (${status})`)
          if (this.config.restartServer) {
            await this.stopServer()
          } else {
            console.log(
              "⚠️  Server is running. Consider stopping it before updating mods.",
            )
          }
        }
      }

      // Update Fabric loader
      await this.updateFabricLoader()

      // Update mods if list provided
      if (modList.length > 0) {
        const results = await this.updateMods(modList)

        console.log("\n📊 Update Summary:")
        console.log(`✅ Successful updates: ${results.successful.length}`)
        console.log(`❌ Failed updates: ${results.failed.length}`)
        console.log(`⏭️  Skipped: ${results.skipped.length}`)

        if (results.successful.length > 0) {
          console.log("\n✅ Successfully updated mods:")
          results.successful.forEach((mod) => {
            console.log(`  - ${mod.name} v${mod.version}`)
          })
        }

        if (results.failed.length > 0) {
          console.log("\n❌ Failed to update:")
          results.failed.forEach((mod) => {
            console.log(`  - ${mod.modId}: ${mod.reason}`)
          })
        }

        // Fix permissions after mod updates
        await this.fixPermissions()
      }
      console.log("\n🎉 Server update completed!")
    } catch (error) {
      console.error("💥 Server update failed:", error.message)
    } finally {
      await this.cleanup()
    }
  }
}

// Example usage
async function main() {
  const updater = new FabricServerUpdater({
    serverPath: "/var/minecraft",
    modsPath: "/var/minecraft/mods",
    minecraftVersion: "1.21.6",
    fabricVersion: null, // Use latest
    backupMods: true,
  })

  // List of Modrinth project IDs or slugs for your mods, as an example
  const modList = ["krypton", "lithium"]

  await updater.updateServer(modList)
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error)
}

module.exports = FabricServerUpdater
