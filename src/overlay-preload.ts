import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type BubbleMessage, type FieldMessage, type OverlayApi } from './shared/types';

const api: OverlayApi = {
  onBubble: (listener) => {
    ipcRenderer.on(IPC.bubble, (_event, msg: BubbleMessage) => listener(msg));
  },
  onField: (listener) => {
    ipcRenderer.on(IPC.field, (_event, msg: FieldMessage) => listener(msg));
  },
};

contextBridge.exposeInMainWorld('overlay', api);
