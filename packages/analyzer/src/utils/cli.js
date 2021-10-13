import { readConfig, ConfigLoaderError } from '@web/config-loader';
import ts from 'typescript';
import fs from 'fs';
import globby from 'globby';
import path from 'path';
import commandLineArgs from 'command-line-args';
import { has } from './index.js';

const IGNORE = [
  '!node_modules/**/*.*', 
  '!bower_components/**/*.*', 
  '!**/*.test.{js,ts}', 
  '!**/*.suite.{js,ts}', 
  '!**/*.config.{js,ts}'
];

export function mergeGlobsAndExcludes(defaults, userConfig, cliConfig) {
  const hasProvidedCliGlobs = has(cliConfig?.globs) || has(userConfig?.globs);

  if(hasProvidedCliGlobs) {
    defaults.globs = defaults.globs.filter(glob => glob !== '**/*.{js,ts,tsx}');
  }

  const merged = [
    ...defaults.globs,
    ...(userConfig?.globs || []),
    ...(cliConfig?.globs || []),
    ...(userConfig?.exclude?.map((i) => `!${i}`) || []),
    ...(cliConfig?.exclude?.map((i) => `!${i}`) || []),
    ...IGNORE,
  ];

  return merged;
}

export async function getUserConfig(configPath) {
  let userConfig = {};
  try {
    userConfig = await readConfig('custom-elements-manifest.config', configPath);
  } catch (error) {
    if (error instanceof ConfigLoaderError) {
      console.error(error.message);
      return;
    }
    console.error(error);
    return;
  }
  return userConfig || {};
}

export const DEFAULTS = {
  outdir: '',
  globs: ['**/*.{js,ts,tsx}'],
  dependencies: [],
  dev: false,
  watch: false,
  litelement: false,
  stencil: false,
  fast: false,
  catalyst: false
}

export function getCliConfig(argv) {
  const optionDefinitions = [
    { name: 'config', type: String},
    { name: 'globs', type: String, multiple: true },
    { name: 'exclude', type: String, multiple: true },
    { name: 'outdir', type: String },
    { name: 'dev', type: Boolean },
    { name: 'watch', type: Boolean },
    { name: 'litelement', type: Boolean },
    { name: 'stencil', type: Boolean },
    { name: 'fast', type: Boolean },
    { name: 'catalyst', type: Boolean },
  ];
  
  return commandLineArgs(optionDefinitions, { argv });
}

export async function createPackage(name, packageConfig, overrideModuleCreation, overrideGlobCreation) {
  let globs;
  let basePath;

  if(name === 'default') {
    basePath = process.cwd();
  }

  if(overrideGlobCreation) {
    globs = await overrideGlobCreation();
  } else {
    basePath = packageConfig?.nodeModulesPath 
      ? `${packageConfig?.nodeModulesPath}${path.sep}${name}` 
      : `${process.cwd()}${path.sep}node_modules${path.sep}${name}`;
  
    const mergedGlobs = [...(packageConfig.globs || []), ...(packageConfig.exclude?.map((i) => `!${i}`) || []) ];
    globs = await globby(mergedGlobs, { cwd: basePath });
  }

  const modules = overrideModuleCreation 
    ? overrideModuleCreation({ts, globs})
    : globs.map(g => compileGlob(g, basePath));

  /** @TODO 🚨 this breaks flags passed from the cli, like `--litelement`, because the cli options isnt passed down for 'default' */
  let plugins = await addFrameworkPlugins(packageConfig);
  plugins = [...plugins, ...(packageConfig?.plugins || [])];

  return {
    name,
    modules,
    plugins,
  };
}

const compileGlob = (glob, basePath) => {
  const modulePath = path.join(basePath, glob);
  const source = fs.readFileSync(modulePath).toString();

  return ts.createSourceFile(
    modulePath,
    source,
    ts.ScriptTarget.ES2015,
    true,
  );
}

export async function addFrameworkPlugins(mergedOptions) {
  let plugins = [];
  if(mergedOptions?.litelement) {
    const { litPlugin } = await import('../features/framework-plugins/lit/lit.js');
    plugins = [...(litPlugin() || [])]
  }

  if(mergedOptions?.fast) {
    const { fastPlugin } = await import('../features/framework-plugins/fast/fast.js');
    plugins = [...(fastPlugin() || [])]
  }

  if(mergedOptions?.stencil) {
    const { stencilPlugin } = await import('../features/framework-plugins/stencil/stencil.js');
    plugins.push(stencilPlugin());
  }

  if(mergedOptions?.catalyst) {
    const { catalystPlugin } = await import('../features/framework-plugins/catalyst/catalyst.js');
    plugins = [...(catalystPlugin() || [])]
  }

  return plugins;
}

export function timestamp() {
  const date = new Date();
  return date.toLocaleTimeString();
}

export function addCustomElementsPropertyToPackageJson(outdir) {
  const packageJsonPath = `${process.cwd()}${path.sep}package.json`;
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath).toString());
  const manifestPath = path.posix.join(outdir, 'custom-elements.json');
  if(packageJson?.customElements) {
    if(packageJson?.customElements !== manifestPath) {
      packageJson.customElements = manifestPath;
      fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
    }
    return;
  } else {
    packageJson.customElements = manifestPath;
    fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  }
}

export const MENU = `
@custom-elements-manifest/analyzer

Available commands:
    | Command/option   | Type       | Description                                                 | Example                                                 |
    | ---------------- | ---------- | ----------------------------------------------------------- | ------------------------------------------------------- |
    | analyze          |            | Analyze your components                                     |                                                         |
    | --config         | string     | Path to custom config location                              | \`--config "../custom-elements-manifest.config.js"\`    |
    | --globs          | string[]   | Globs to analyze                                            | \`--globs "foo.js"\`                                    |
    | --exclude        | string[]   | Globs to exclude                                            | \`--exclude "foo.js"\`                                  |
    | --outdir         | string     | Directory to output the Manifest to                         | \`--outdir dist\`                                       |
    | --watch          | boolean    | Enables watch mode, generates a new manifest on file change | \`--watch\`                                             |
    | --dev            | boolean    | Enables extra logging for debugging                         | \`--dev\`                                               |
    | --litelement     | boolean    | Enable special handling for LitElement syntax               | \`--litelement\`                                        |
    | --fast           | boolean    | Enable special handling for FASTElement syntax              | \`--fast\`                                              |
    | --stencil        | boolean    | Enable special handling for Stencil syntax                  | \`--stencil\`                                           |
    | --catalyst       | boolean    | Enable special handling for Catalyst syntax                 | \`--catalyst\`                                          |

Examples:
    custom-elements-manifest analyze --litelement --globs "**/*.js" --exclude "foo.js" "bar.js"
`