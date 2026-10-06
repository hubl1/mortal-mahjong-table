"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mortalDesktop", {
  postMessage(message) {
    ipcRenderer.send("mortal-message", message);
  },
});
