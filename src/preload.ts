import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type FrameMessage,
  type PetApi,
  type SoundMessage,
  type SpriteManifest,
  type VoiceListenRequest,
} from './shared/types';

const api: PetApi = {
  getManifest: () => ipcRenderer.invoke(IPC.manifest) as Promise<SpriteManifest>,
  ready: () => ipcRenderer.send(IPC.ready),
  onFrame: (listener) => {
    ipcRenderer.on(IPC.frame, (_event, msg: FrameMessage) => listener(msg));
  },
  pointerDown: () => ipcRenderer.send(IPC.pointerDown),
  pointerUp: () => ipcRenderer.send(IPC.pointerUp),
  contextMenu: () => ipcRenderer.send(IPC.contextMenu),
  onVoiceListen: (listener) => {
    ipcRenderer.on(IPC.voiceListen, (_event, request: VoiceListenRequest) => listener(request));
  },
  onVoiceEnd: (listener) => {
    ipcRenderer.on(IPC.voiceEnd, () => listener());
  },
  voiceAudio: (pcm, error) => ipcRenderer.send(IPC.voiceAudio, pcm, error),
  onSound: (listener) => {
    ipcRenderer.on(IPC.sound, (_event, msg: SoundMessage) => listener(msg));
  },
};

contextBridge.exposeInMainWorld('pet', api);
