# Troubleshooting

- Add a package for renderer only, and nodejs complains:
```
> cross-env NODE_ENV=development TS_NODE_TRANSPILE_ONLY=true webpack --config ./.erb/configs/webpack.config.renderer.dev.dll.ts
ERROR in dll renderer renderer[10]
Module not found: Error: Can't resolve 'xhrjs' in '~/src/electron-react-boilerplate'

webpack compiled with 1 error
```

edit `./.erb/configs/webpack.config.renderer.dev.dll.ts`, and add your package to
```
externals: ['fsevents', 'crypto-browserify', 'xhrjs'],
```
like so ^^^, to exclude

(I dont understand this, but it works, YMMV.)

