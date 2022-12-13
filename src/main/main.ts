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
const Store = require('electron-store'); // The data is saved in a JSON file named config.json in app.getPath('userData').
let settings:any = undefined; // will be initialized later with the real settings path.
import log from 'electron-log';
import MenuBuilder from './menu';
import { resolveHtmlPath } from './util';

import { app, BrowserWindow, screen, shell, ipcMain, globalShortcut, Menu, protocol } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as url from 'url';
import isPi from 'detect-rpi'; // detect raspberry pi
import mediafs from 'media-fsjs/media-fs';
console.log( "[main] init media fs")
const { clipboard } = require('electron')



// debug what it's like running from a different dir.
process.chdir('/Users/kevinmeinert/src/flaming-monkey-head-musicplayer-react/dummydir');

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
      path.join( process.env.HOME, "Library/Application Support", appname ),
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

ipcMain.handle('settings', async (event, FUNC, ...values) => {
  let name='settings'
  let lib = settings;
  let result = lib.hasOwnProperty( FUNC ) ? await lib[FUNC](...values) : `ERROR: no such function as ${name}.${FUNC}(...)`;
  consoleLogIPC( "main.ts", name, FUNC, values, result )
  return result;
})

ipcMain.handle('loadBrowserLocalStorage', async (event) => await loadBrowserLocalStorage() )
ipcMain.handle('saveBrowserLocalStorage', async (event) => await saveBrowserLocalStorage() )

async function saveBrowserLocalStorage() {
  if (mainWindow)
    mainWindow.webContents
      .executeJavaScript('({...localStorage});', true)
      .then(ls => {
        settings.set( "browser-localStorage", JSON.stringify( ls ) )
        //console.log("localStorage", ls);
      });
}
async function loadBrowserLocalStorage() {
  // init Local Store
  // https://www.npmjs.com/package/electron-store
  let ls = settings.get('browser-localStorage')
  if (ls && mainWindow) {
    ls = JSON.parse( ls );
    let js = Object.keys(ls).map( r => `localStorage.setItem( "${r}", "${ls[r].replace( /["]/g, `\\"` )}" );` ).join( "\n" );
    //console.log( "[main.ts] sending js to the renderer:\n", js )
    let r = await mainWindow.webContents.executeJavaScript( js + "({...localStorage});", true )
    //console.log( "[main.ts] localStorage set to", r )
  }
}


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

ipcMain.handle('quit',  async (event, ...args) => {
  console.log( `[main.ts] handle quit()` )
  app.quit();
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
      enableRemoteModule: true,
      //webSecurity: false,                 // THIS SEEMS TO ALSO ENABLE InsecureContent....  xxxxxx maybe not safe in this case: //////it is SAFE to disable when we interceptFileProtocol('file') and handle all file:// access ourselves. (otherwise we write our own handler for res:// where we STILL have to gaurentee security for the filesystem, meh, webSecurity:true is default for when we dont have interceptFileProtocol('file'))
      //allowRunningInsecureContent: false,  // true - allows running .js downloaded from external addresses (not secure, we dont want this)
      sandbox: false,

      //nodeIntegration: true,      // KEVIN: https://github.com/electron-react-boilerplate/electron-react-boilerplate/issues/2949
      //contextIsolation: true,    // KEVIN: https://github.com/electron-react-boilerplate/electron-react-boilerplate/issues/2949
      preload: app.isPackaged  // KEVIN: https://github.com/electron-react-boilerplate/electron-react-boilerplate/issues/2949
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),

    },
  });

  mainWindow.loadURL(resolveHtmlPath('index.html'));

  mainWindow.on('ready-to-show', async () => {
    console.log( "[main.ts] ready to show" )
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
  });

  mainWindow.on('close', () => {
    console.log( "[main.ts] closing" )
    if (mainWindow) {
      saveBrowserLocalStorage();
    }
  });

  mainWindow.on('closed', () => {
    console.log( "[main.ts] closed" )
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-start-loading', (e) => {
    console.log( "[main.ts] did-start-loading" )
    //createLoadingWindow();
  });

  mainWindow.webContents.on('did-stop-loading', (e) => {
    console.log( "[main.ts] did-stop-loading" )
    //closeLoadingWindow();
  });

  mainWindow.webContents.on('did-finish-load', (e) => {
    console.log( "[main.ts] did-finish-load" )
    //createLoadingWindow();
  });

  mainWindow.webContents.on('dom-ready', (e) => {
    console.log( "[main.ts] dom-ready" )
  });

  // Remove this if your app does not use auto updates
  // eslint-disable-next-line
  new AppUpdater();
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  console.log( "[window-all-closed] app.quit()" )
  app.quit();
});

process.on('exit', () => {
  console.log( "[exit] app.quit()" )
  app.quit();
});

app
  .whenReady()
  .then(() => {

    // square away all the paths!   fun...
    let appname = app.getPath('userData').replace( /^.*\//, "");  // set in one of the "package.json"s
    let userdir = getUserDir( appname );
    app.setPath( 'userData', userdir );

    settings = new Store(); // gets path from app.getPath('userData')
    mediafs.init({ configname: "settings.json", appname: appname });
    mediafs.setVerbose( false );

    console.log( "[main.ts] AppPath: ",     app.getAppPath() );
    console.log( "[main.ts] appData: ",     app.getPath('appData') );     // Per-user application data directory, which by default points to: %APPDATA% on Windows, ~/Library/Application Support on macOS, $XDG_CONFIG_HOME or ~/.config on Linux
    console.log( "[main.ts] userData:",     app.getPath('userData') );    // The directory for storing your app's configuration files, which by default is the appData directory appended with your app's name
    console.log( "[main.ts] sessionData:",  app.getPath('sessionData') ); // The directory for storing data generated by Session, such as localStorage, cookies, disk cache, downloaded dictionaries, network state, devtools files. By default this points to userData
    console.log( "[main.ts] settings:",     settings.path );
    console.log( "[main.ts] temp:",         app.getPath('temp') );        // Temporary directory.
    console.log( "[main.ts] logs:",         app.getPath('logs') );        // Directory for your app's log folder
    console.log( "[main.ts] Desktop:",      app.getPath('desktop') );     // The current user's desktop directory
    console.log( "[main.ts] documents:",    app.getPath('documents') );   // The current user's documents directory
    console.log( "[main.ts] downloads:",    app.getPath('downloads') );   // The current user's downloads directory
    console.log( "[main.ts] music:",        app.getPath('music') );       // The current user's music directory
    console.log( "[main.ts] pictures:",     app.getPath('pictures') );    // The current user's pictures directory
    console.log( "[main.ts] videos:",       app.getPath('videos') );      // The current user's videos directory
    console.log( "[main.ts] VERSION:",      app.getVersion() );

    createWindow();
    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) createWindow();
    });

  })
  .catch(console.log);
