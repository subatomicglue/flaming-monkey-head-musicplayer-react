/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import MenuBuilder from './menu';
import { resolveHtmlPath } from './util';

import { app, BrowserWindow, screen, shell, ipcMain, globalShortcut, Menu, protocol } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as url from 'url';
import isPi from 'detect-rpi'; // detect raspberry pi
import mediafs from 'media-fsjs/media-fs';
mediafs.init({ configname: "settings.json", appname: "flaming-monkey-head" });
mediafs.setVerbose( true );

const env = process.env.NODE_ENV || 'development';
let VERBOSE = false;//env != 'development' ? false : true;
console.log( `\n` );
console.log( `[main.ts] -----------------------------------------` );
console.log( `[main.ts] environment = ${env}, VERBOSE=${VERBOSE}` )

// fs.accessSync is so close, yet just not there.   Make it return true/false:
function checkPermissions( file, perms ) {
  try {
    fs.accessSync(file, perms);
    return true;
  } catch (err) {
    return false;
  }
};
function mkdir( dir ) {
  if (!fs.existsSync(dir)){
    VERBOSE && console.log( `[mkdir] creating directory ${dir}` )
    fs.mkdirSync(dir, { recursive: true });
  }
}
// check the directory for write abilities
function dirIsGood( dir ) {
  return fs.existsSync( dir ) && checkPermissions( dir, fs.constants.R_OK | fs.constants.W_OK )
}
function getPlatform() {
  console.log( "IS PI?", isPi )
  return isPi() ? "pi" : process.platform;
}
function getUserDir( name ) {
  const appname = name;
  const dotappname = "." + name;
  // every path in the checklist needs to point to an app subfolder e.g. /subatomic3ditor,
  let checklist = {
    "pi": [
      path.join( "/media/pi/USB", appname ),
      path.join( "/media/pi/SDCARD", appname ),
      path.join( process.env.HOME, dotappname ),
      path.join( process.env.HOME, "Documents", appname ),
      path.join( process.env.HOME, "Downloads", appname ),
      path.join( process.env.HOME, "Desktop", appname ),
    ],
    "darwin": [
      path.join( process.env.HOME, "Library/Preferences", appname ),
      path.join( process.env.HOME, dotappname ),
      path.join( process.env.HOME, "Documents", appname ),
      path.join( process.env.HOME, "Downloads", appname ),
      path.join( process.env.HOME, "Desktop", appname ),
    ],
    "win32": [
      path.join( process.env.HOME, "AppData", appname ),
      path.join( process.env.HOME, dotappname ),
      path.join( process.env.HOME, "Documents", appname ),
      path.join( process.env.HOME, "Downloads", appname ),
      path.join( process.env.HOME, "Desktop", appname ),
    ],
    "linux": [
      path.join( process.env.HOME, dotappname ),
      path.join( process.env.HOME, "Documents", appname ),
      path.join( process.env.HOME, "Downloads", appname ),
      path.join( process.env.HOME, "Desktop", appname ),
    ],
    "unknown": [
      path.join( process.env.HOME, dotappname ),
      path.join( process.env.HOME, "Documents", appname ),
      path.join( process.env.HOME, "Downloads", appname ),
      path.join( process.env.HOME, "Desktop", appname ),
    ],
  }
  let platform = getPlatform();
  let cl = checklist[platform] ? checklist[platform] : checklist["unknown"];
  for (let d of cl) {
    // every path in the checklist points to an app subfolder /${name},
    // so check for the parent dir existing (we dont want to create Documents on a system that doesn't have it!)
    let onelevelup = d.replace( /[\\/][^\\/]+$/, "" )
    VERBOSE && console.log( `[getUserDir] checking "${d}", "${onelevelup}" == ${dirIsGood( onelevelup )}` )
    if (dirIsGood( onelevelup )) {
      mkdir( d );
      return d;
    }
  }
  VERBOSE && console.log( `[getUserDir] ERROR: no user directory found on this "${platform}" system!  After checking through these options: `, cl );
  return undefined;
}

function getExt( filename ) {
  let m = filename.match( /\.[^\.]+$/ );
  //console.log( path, m )
  return m ? m[0] : ""
}

function getPath( filepath ) {
  return filepath.replace( /\/[^\/]+$/, "" )
}

function getFilename( filepath ) {
  return filepath.replace( /^.*\//, "" ).replace( /\.[^\.]+$/, "" ); // remove path and ext
}

let userdir = getUserDir( "flamingMonkeyHead" );

class AppUpdater {
  constructor() {
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
    autoUpdater.checkForUpdatesAndNotify();
  }
}

let mainWindow: BrowserWindow | null = null;

function consoleLogIPC( module, funcname, FUNC, values, result ) {
  let result_str = result === undefined ? "undefined" : JSON.stringify( result );
  let limit = 10;
  VERBOSE && console.log( `[${module}] ${funcname}.${FUNC}(${values.length>0?' ':''}${values.map(r=>typeof r == "string" ? `"${r}"` : r).join(", ")}${values.length>0?' ':''})`, result_str.length <= limit ? `=> ${result_str}` : '' )
  VERBOSE && result_str.length > limit && console.log( `       <= ${JSON.stringify( result )}` )
}


ipcMain.on('ipc-example', async (event, arg) => {
  const msgTemplate = (pingPong: string) => `IPC test: ${pingPong}`;
  console.log(msgTemplate(arg));
  event.reply('ipc-example', msgTemplate('pong'));
});

ipcMain.handle('fs', async (event, FUNC, ...values) => {
  let result = fs.hasOwnProperty( FUNC ) ? await fs[FUNC](...values) : `ERROR: no such function as fs.${FUNC}(...)`;
  consoleLogIPC( "main.ts", "fs", FUNC, values, result )
  return result;
})

ipcMain.handle('mediafs', async (event, FUNC, ...values) => {
  let name='mediafs'
  let lib = mediafs;
  let result = lib.hasOwnProperty( FUNC ) ? await lib[FUNC](...values) : `ERROR: no such function as ${name}.${FUNC}(...)`;
  consoleLogIPC( "main.ts", name, FUNC, values, result )
  return result;
})

function getMime( filename ) {
  switch (getExt( filename )) {
    case ".jpg": return "image/jpeg";
    case ".png": return "image/png";
    case ".gif": return "image/gif";
    case ".wav": return "audio/wav";
    case ".mp3": return "audio/mp3";
    case ".m4a": return "audio/x-m4a";
    default: return "data/blob" // todo: what's the real type here?
  }
}
function convertFileToImageEmbed( fileURL ) {
  const filepath = fileURL.replace( /^file:\/\//, '' );
  let result = undefined;
  if (fs.existsSync( filepath ) && fs.statSync( filepath ).isFile()) {
    result = `data:${getMime(filepath)};base64,` + fs.readFileSync( filepath, { encoding: "base64" } )
  }
  return result;
}

ipcMain.handle('readFileSync', async (event, fileURL, mimeType="base64") => {
  console.log( `[main.ts] readFileSync( "${fileURL}" )` )
  let result = convertFileToImageEmbed( fileURL );
  //let base64 = "data:audio/m4a;base64," + result.toString('base64');
  console.log( `       <= ${result.length} bytes` )
  //console.log( result.slice( 0, 100 ) );
  return result;
})


if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  require('electron-debug')();
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS'];

  return installer
    .default(
      extensions.map((name) => installer[name]),
      forceDownload
    )
    .catch(console.log);
};

const createWindow = async () => {
  if (isDebug) {
    await installExtensions();
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  // can't, it's built in, already registered (I think!?), use intercept instead.
  protocol.registerFileProtocol('res', (req, callback) => {
    const url = req.url.substr(7)
    console.log( "[main.ts] registerFileProtocol", url );
    callback({ path: path.normalize(`${__dirname}/${url}`) })
  })
  protocol.interceptFileProtocol('res', (req, callback) => {
    if (req.url.match( /^res:\/\// )) {
      let p = path.normalize( req.url.replace( /^res:\/\//, "" ) );
      // this is great - but - we aren't auto copying the default icon into the build folder... yet.
      if (p.match( /^assets\// )) {
        p = getAssetPath( p.replace(/^assets\//, '') );
      }
      console.log( "[main.ts] interceptFileProtocol FILE", p );
      callback( { path: p } );
    } else {
      console.log( "[main.ts] interceptFileProtocol URL", req.url );
      callback( { url: req.url } );
    }
  });

  mainWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
    icon: getAssetPath( 'icon.png' ),
    webPreferences: {
      //webSecurity: false, // allow file://
      //allowRunningInsecureContent: true,
      sandbox: false,
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
    },
  });

  mainWindow.loadURL(resolveHtmlPath('index.html'));

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });

  // Remove this if your app does not use auto updates
  // eslint-disable-next-line
  new AppUpdater();
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app
  .whenReady()
  .then(() => {

    console.log( "[main.ts] appData:", app.getPath('appData') );
    console.log( "[main.ts] userData:", app.getPath('userData') );
    console.log( "[main.ts] userdir:", userdir );
    createWindow();
    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) createWindow();
    });

  })
  .catch(console.log);
