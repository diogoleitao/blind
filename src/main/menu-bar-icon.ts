import { join } from "node:path";
import { Menu, type MenuItemConstructorOptions, nativeImage, Tray } from "electron";
import type { MenuBarIcon } from "../core/config";
import type { Core, MenuBarSession } from "../core/core";

// Each icon's image in the resources folder, found with its @2x next to it. macOS tints an image whose name ends in
// `Template` to suit the menu bar, light or dark.
const imageFileNames: Record<MenuBarIcon, string> = {
  monochrome: "trayTemplate.png",
  colour: "trayIcon.png",
};

// The menu bar icon, showing the icon in effect from `resourcesDirectory`. Its menu follows the state.
export function createMenuBarIcon(core: Core, resourcesDirectory: string) {
  const tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("Blind");
  // The menu bar the menu was last built from, compared by value: most state changes leave it as it is.
  let builtFrom: string | undefined;

  // Without its image, the icon is the app's name, so it's never missing.
  function show(icon: MenuBarIcon) {
    const image = nativeImage.createFromPath(join(resourcesDirectory, imageFileNames[icon]));
    tray.setImage(image);
    tray.setTitle(image.isEmpty() ? "Blind" : "");
  }

  // Left out when there are no Sessions to list under the header.
  function sessionSection(header: string, sessions: MenuBarSession[]): MenuItemConstructorOptions[] {
    if (sessions.length === 0) return [];
    return [
      { type: "header", label: header },
      ...sessions.map(({ sessionId, label }) => ({ label, click: () => core.menuBarSessionChosen(sessionId) })),
      { type: "separator" },
    ];
  }

  function update() {
    const menuBar = core.menuBar();
    const key = JSON.stringify(menuBar);
    if (key === builtFrom) return;
    builtFrom = key;
    tray.setContextMenu(
      Menu.buildFromTemplate([
        ...sessionSection("Open Sessions", menuBar.open),
        ...sessionSection("Closed Sessions", menuBar.closed),
        ...menuBar.actions.map(({ action, label }) => ({ label, click: () => core.menuBarActionChosen(action) })),
      ]),
    );
  }

  show(core.menuBarIcon());
  update();
  core.onStateChange(update);
  return {
    show,
    // Builds the menu again, e.g. after the cycle order setting changed, which isn't a change to the state.
    update,
  };
}
