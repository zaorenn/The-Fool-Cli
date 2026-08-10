/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcMain, BrowserWindow, app } from 'electron'
import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'

/**
 * IPC Handlers for main process
 */

// Type guards and handlers interface
export interface IpcHandlerRegistry {
  [key: string]: (args?: any) => unknown
}

const handlers: IpcHandlerRegistry = {}

/**
 * File read handler
 */
ipcMain.handle('read-file', async (_event, filePath: string): Promise<string | null> => {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8')
    return content
  } catch (error) {
    console.error('[IPC] Failed to read file:', error)
    throw new Error('File not found or cannot be read', { cause: error })
  }
})

/**
 * File write handler
 */
ipcMain.handle('write-file', async (_event, filePath: string, content: string): Promise<void> => {
  try {
    const dir = path.dirname(filePath)
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.writeFile(filePath, content, 'utf-8')
  } catch (error) {
    console.error('[IPC] Failed to write file:', error)
    throw new Error('Failed to write file', { cause: error })
  }
})

/**
 * Read directory contents handler
 */
ipcMain.handle('readdir', async (_event, dirPath: string): Promise<string[]> => {
  try {
    const files = await fs.promises.readdir(dirPath, { withFileTypes: true })
    return files.map((file) => file.name)
  } catch (error) {
    console.error('[IPC] Failed to read directory:', error)
    throw new Error('Failed to read directory', { cause: error })
  }
})

/**
 * File stat handler
 */
ipcMain.handle('stat', async (_event, filePath: string): Promise<any> => {
  const stat = await fs.promises.stat(filePath)
  return {
    isFile: stat.isFile(),
    isDirectory: stat.isDirectory(),
    size: stat.size,
    mtime: stat.mtimeMs,
    birthtime: stat.birthtimeMs,
  }
})

/**
 * File existence check handler
 */
ipcMain.handle('file-exists', async (_event, filePath: string): Promise<boolean> => {
  return fs.existsSync(filePath)
})

/**
 * Watch file system changes handler
 */
let watchers: Map<string, (eventType: string, filename?: string) => void> = new Map()
ipcMain.handle('watch', async (_event, dirPath: string, callback: (eventType: string, filename?: string) => void): Promise<() => void> => {
  // This is a simplified implementation - actual fs.watch needs more care
  return () => {}
})

/**
 * Read multiple files handler
 */
ipcMain.handle('read-files', async (_event, filePaths: string[]): Promise<any[]> => {
  const results = await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        const content = await fs.promises.readFile(filePath, 'utf-8')
        return { filePath, content }
      } catch (error) {
        console.error(`[IPC] Failed to read file ${filePath}:`, error)
        return { filePath, content: null }
      }
    })
  )
  return results
})

/**
 * Write multiple files handler
 */
ipcMain.handle('write-files', async (_event, files: { path: string; content: string }[]): Promise<void> => {
  for (const file of files) {
    await fs.promises.writeFile(file.path, file.content, 'utf-8')
  }
})

/**
 * Delete file/directory handler
 */
ipcMain.handle('delete', async (_event, filePath: string): Promise<void> => {
  try {
    const dir = path.dirname(filePath)
    
    const stat = await fs.promises.stat(filePath)
    
    if (stat.isDirectory()) {
      await fs.promises.rm(dir, { recursive: true, force: true })
    } else {
      await fs.promises.unlink(filePath)
    }
  } catch (error) {
    console.error('[IPC] Failed to delete file:', error)
    throw new Error('Failed to delete file or directory', { cause: error })
  }
})

/**
 * Execute shell command handler
 */
ipcMain.handle('exec', async (_event, { command, cwd }: { command: string; cwd?: string }): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
  return new Promise((resolve, reject) => {
    const cmd = spawn(command.split(' ')[0], command.split(' ').slice(1), {
      cwd,
      shell: true,
    })

    let stdout = ''
    let stderr = ''

    cmd.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    cmd.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    cmd.on('error', (error) => {
      reject(new Error(`Command failed: ${error.message}`))
    })

    cmd.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code || 0,
      })
    })
  })
})

/**
 * Get system info handler
 */
ipcMain.handle('get-system-info', async (): Promise<any> => {
  const platform = process.platform
  const arch = process.arch
  const cpuModel = osCpu()
  
  return {
    platform,
    arch,
    cpuModel,
    memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    gpuCount: -1, // Requires GPU detection library
  }
})

function osCpu(): string {
  const platforms = {
    darwin: 'Apple M3',
    win32: 'Intel/AMD CPU',
    linux: 'Intel/AMD CPU',
  }
  
  return platforms[process.platform as keyof typeof platforms] || 'Unknown'
}

/**
 * Get application version handler
 */
ipcMain.handle('get-version', async (): Promise<string> => {
  const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json')
  try {
    const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf-8'))
    return packageJson.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
})

/**
 * Open file handler
 */
ipcMain.handle('open-file', async (_event, filePath: string): Promise<void> => {
  BrowserWindow.getFocusedWindow()?.webContents.send('file-opened', filePath)
})

/**
 * Get window size handler
 */
ipcMain.handle('get-window-size', async (event): Promise<any> => {
  const window = BrowserWindow.fromWebContents(event.sender!)
  if (window) {
    return {
      width: window.getBounds().width,
      height: window.getBounds().height,
    }
  }
  return { width: 0, height: 0 }
})

/**
 * Set window size handler
 */
ipcMain.handle('set-window-size', async (_event, { width, height }): Promise<void> => {
  const window = BrowserWindow.fromWebContents((_event.sender as any)!.webContents)
  if (window) {
    window.setSize(width, height)
  }
})

/**
 * Show menu handler
 */
ipcMain.handle('show-menu', async (_event, menuItemIds: string[]): Promise<void> => {
  console.log('[IPC] Showing menu items:', menuItemIds)
})

/**
 * Hide app handler
 */
ipcMain.handle('hide-app', async () => {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.hide()
  })
})

/**
 * Minimize window handler
 */
ipcMain.handle('minimize-window', async () => {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.minimize()
  })
})

/**
 * Maximize/restore window handler
 */
ipcMain.handle('maximize-window', async (_event, { maximized }): Promise<void> => {
  const window = BrowserWindow.fromWebContents((_event.sender as any)!.webContents)
  if (window) {
    window.setResizable(true)
    window.maximize()
  }
})

/**
 * Close window handler
 */
ipcMain.handle('close-window', async () => {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.close()
  })
})

/**
 * Restart app handler
 */
let restartScheduled = false
ipcMain.handle('restart-app', async (): Promise<void> => {
  if (restartScheduled) return
  
  restartScheduled = true
  
  setTimeout(() => {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach((window) => window.destroy())
    
    // Restart app
    app.relaunch()
    app.quit()
  }, 2000)
})

/**
 * Quit app handler
 */
ipcMain.handle('quit-app', async (): Promise<void> => {
  app.quit()
})

/**
 * Reload window handler
 */
ipcMain.handle('reload-window', async () => {
  const window = BrowserWindow.fromWebContents((_event.sender as any)!.webContents)
  if (window && !window.isDestroyed()) {
    window.reload()
  }
})

/**
 * Copy to clipboard handler
 */
ipcMain.handle('copy-clipboard', async (_event, data: string | Buffer): Promise<boolean> => {
  const clipboard = require('electron').clipboard
  clipboard.writeText(data.toString())
  return true
})

/**
 * Read from clipboard handler
 */
ipcMain.handle('read-clipboard', async (): Promise<string | null> => {
  const clipboard = require('electron').clipboard
  return clipboard.readText()
})

/**
 * Clear clipboard handler
 */
ipcMain.handle('clear-clipboard', async () => {
  const clipboard = require('electron').clipboard
  clipboard.clearAll()
})

/**
 * Open folder handler
 */
ipcMain.handle('open-folder', async (_event, folderPath: string): Promise<void> => {
  const shell = require('electron').shell
  shell.openPath(folderPath)
})

// Export registry for testing
export default handlers
