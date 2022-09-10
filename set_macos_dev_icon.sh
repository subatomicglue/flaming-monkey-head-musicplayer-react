ELECTRON_DEV_APP="node_modules/electron/dist/Electron.app"
ELECTRON_DEV_APP_ICON="$ELECTRON_DEV_APP/Contents/Resources/electron.icns"

# replace the electron development app icon:
cp assets/icon.icns "$ELECTRON_DEV_APP_ICON"

# force MacOS to reload it's icon cache for this app:
touch "$ELECTRON_DEV_APP"


# if touch alone doesn't work:
#sudo killall Finder && sudo killall Finder
