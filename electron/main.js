import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { autoUpdater } from 'electron-updater';

let mainWindow = null;

function setupAutoUpdates() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.info('Checking for desktop updates...');
  });

  autoUpdater.on('update-available', (info) => {
    console.info('Update available', { version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    console.info('No updates available');
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.info('Update downloaded and will install on quit', { version: info.version });
  });

  autoUpdater.on('error', (error) => {
    console.error('Auto update error', error);
  });

  autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    console.error('Initial update check failed', error);
  });

  setInterval(() => {
    autoUpdater.checkForUpdates().catch((error) => {
      console.error('Scheduled update check failed', error);
    });
  }, 6 * 60 * 60 * 1000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 768,
    kiosk: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdates();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('print-silent', async () => {
  if (!mainWindow) return;
  return new Promise((resolve, reject) => {
    mainWindow.webContents.print({ silent: true, printBackground: true }, (success, errorType) => {
      if (!success) {
        reject(new Error(`Silent print failed: ${String(errorType)}`));
      } else {
        resolve();
      }
    });
  });
});
