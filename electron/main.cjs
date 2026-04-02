const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

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
    show: false,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const loadMain = async () => {
    if (!app.isPackaged) {
      await mainWindow.loadURL('http://localhost:5173');
    } else {
      await mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
    }
  };

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) mainWindow.show();
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.warn('Main window failed to load', { errorCode, errorDescription, validatedURL });
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setBackgroundColor('#0a0a0a');
    if (!mainWindow.isVisible()) mainWindow.show();
  });

  // fallback in case the renderer takes too long
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) mainWindow.show();
  }, 10000);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  loadMain().catch((err) => {
    console.error('Failed to load main window', err);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
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
