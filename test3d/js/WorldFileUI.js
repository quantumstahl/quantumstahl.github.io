import { WorldFileSession, rememberedWorldFile } from "./terrain/WorldFile.js";

export async function pickWorldFile() {
  if (!globalThis.showOpenFilePicker) throw new Error("Open MaxWorld in Chrome or Edge at localhost (or HTTPS) to open and update world files directly.");
  const [handle] = await showOpenFilePicker({ id: "maxworld-world", multiple: false, types: [{ description: "MaxWorld world", accept: { "application/json": [".json"] } }] });
  return WorldFileSession.fromHandle(handle);
}

export async function loadWorldSession(statusElement, options = {}) {
  const remember = options.remember ?? rememberedWorldFile;
  statusElement.textContent = "Loading world…";
  try { return await WorldFileSession.load(options); }
  catch (error) {
    // Permission requests require a click after a browser restart. Keep the
    // editor stopped rather than loading the wrong world behind the prompt.
    return new Promise(resolve => {
      const dialog = document.createElement("dialog");
      dialog.className = "world-dialog";
      const title = document.createElement("h2"); title.textContent = error.missing ? "World file missing" : "Open world";
      const message = document.createElement("p"); message.textContent = error.missing ? error.message : error.cause?.message ?? error.message;
      const actions = document.createElement("div"); actions.className = "world-dialog-actions";
      dialog.append(title, message, actions);
      function action(label, run) {
        const button = document.createElement("button"); button.textContent = label;
        button.onclick = async () => {
          try { const session = await run(); dialog.close(); dialog.remove(); resolve(session); }
          catch (next) {
            if (next.name === "NotFoundError") {
              title.textContent = "World file missing";
              message.textContent = "That world file was removed or moved. Choose another file or start a new world.";
              if (reopenButton) reopenButton.hidden = true;
              try { await remember.clear(); } catch {}
            } else if (next.name !== "AbortError") message.textContent = next.message;
          }
        };
        actions.append(button);
        return button;
      }
      let reopenButton;
      if (error.handle && !error.missing) reopenButton = action(`Reopen ${error.handle.name}`, async () => {
        if (await error.handle.requestPermission({ mode: "readwrite" }) !== "granted") throw new Error("File access was not granted. Choose a world file to continue.");
        return WorldFileSession.fromHandle(error.handle, { ...options, remember });
      });
      action("Choose world file…", async () => { const session = await pickWorldFile(); await remember.set(session.handle); return session; });
      action("Use project world", async () => { const session = await WorldFileSession.project({ ...options, importLegacy: false }); await remember.clear(); return session; });
      action("Start new world", async () => { await remember.clear(); return new WorldFileSession({ remember, name: "New world" }); });
      dialog.addEventListener("cancel", event => event.preventDefault());
      document.body.append(dialog); dialog.showModal();
    });
  }
}
