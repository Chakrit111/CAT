import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type MouseApi, type MouseMessage } from './shared/types';

const api: MouseApi = {
  onState: (listener) => {
    ipcRenderer.on(IPC.mouseState, (_event, msg: MouseMessage) => listener(msg));
  },
};

contextBridge.exposeInMainWorld('mouse', api);
