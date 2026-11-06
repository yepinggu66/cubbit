/**
 * 宠物窗口预加载脚本。
 * 只暴露桌宠需要的最小能力（窗口拖动、命中穿透、状态订阅、互动上报）。
 */
const { contextBridge, ipcRenderer } = require('electron');
const { INVOKE, EVENTS } = require('../shared/ipc.js');

function on(channel, cb) {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('cubbit', {
  pet: {
    ready: () => ipcRenderer.invoke(INVOKE.APP_STATE),
    state: () => ipcRenderer.invoke(INVOKE.APP_STATE),
    onState: (cb) => on(EVENTS.STATE_CHANGED, cb),
    onCursor: (cb) => on(EVENTS.PET_CURSOR, cb),
    onEvent: (cb) => on(EVENTS.PET_EVENT, cb),
    setIgnoreMouse: (ignore) => ipcRenderer.invoke(INVOKE.PET_SET_IGNORE_MOUSE, !!ignore),
    dragStart: (offset) => ipcRenderer.invoke(INVOKE.PET_DRAG_START, offset || {}),
    dragEnd: (velocity) => ipcRenderer.invoke(INVOKE.PET_DRAG_END, velocity || {}),
    bounds: () => ipcRenderer.invoke(INVOKE.PET_BOUNDS),
    moveTo: (pos) => ipcRenderer.invoke(INVOKE.PET_MOVE, pos || {}),
    interaction: (type, meta) => ipcRenderer.invoke(INVOKE.PET_INTERACTION, { type, meta: meta || {} }),
    contextMenu: () => ipcRenderer.invoke(INVOKE.PET_CONTEXT_MENU, {}),
    say: (text, durationMs) => ipcRenderer.invoke(INVOKE.PET_SAY, { text, durationMs }),
    setHitboxes: (rects) => ipcRenderer.invoke(INVOKE.PET_HITBOXES, { rects }),
    resetPosition: () => ipcRenderer.invoke(INVOKE.PET_RESET_POSITION, {}),
    openPanel: (name) => ipcRenderer.invoke(INVOKE.APP_PANEL_OPEN, { name }),
    voiceTalk: () => ipcRenderer.invoke(INVOKE.VOICE_LISTEN, {}),
    tts: (text, kind) => ipcRenderer.invoke(INVOKE.TTS_SPEAK, { text, kind }),
  },
});
