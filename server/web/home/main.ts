// Entry for index.html (the launcher).
import { startCommands } from './commands.js';
import { startLauncher } from './launcher.js';
import { saverCommand, startSaver } from './saver.js';
import { startTheme, themeCommand } from './theme.js';
import { audioCommand } from './wii/audio.js';
import { startWii, wiiSaver } from './wii/menu.js';

startTheme();
startLauncher();
startSaver(wiiSaver);
startWii(() => {
  saverCommand('saver');
});
startCommands(saverCommand, themeCommand, audioCommand);
