import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  printSilent: () => ipcRenderer.invoke('print-silent'),
  // Generic listener registration from renderer
  on: (channel: string, listener: (...args: any[]) => void) => {
    const wrapped = (_event: IpcRendererEvent, ...args: any[]) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  // Trigger install of downloaded update
  installUpdate: () => ipcRenderer.send('install-update'),
});
