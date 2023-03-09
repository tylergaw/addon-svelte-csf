// This file is a rewrite of `@sveltejs/vite-plugin-svelte` without the `Vite`
// parts: https://github.com/sveltejs/vite-plugin-svelte/blob/e8e52deef93948da735c4ab69c54aced914926cf/packages/vite-plugin-svelte/src/utils/load-svelte-config.ts
import { logger } from '@storybook/client-logger';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';

/**
 * Try find svelte config and then load it.
 *
 * @returns {import('@sveltejs/kit').Config}
 * Returns the svelte configuration object.
 */
export async function loadSvelteConfig() {
  const configFile = findSvelteConfig();
  let err;

  // try to use dynamic import for svelte.config.js first
  if (configFile.endsWith('.js') || configFile.endsWith('.mjs')) {
    try {
      return importSvelteOptions(configFile);
    } catch (e) {
      logger.error(`failed to import config ${configFile}`, e);
      err = e;
    }
  }
  // cjs or error with dynamic import
  if (configFile.endsWith('.js') || configFile.endsWith('.cjs')) {
    try {
      return requireSvelteOptions(configFile);
    } catch (e) {
      logger.error(`failed to require config ${configFile}`, e);
      if (!err) {
        err = e;
      }
    }
  }
  // failed to load existing config file
  throw new Error(`failed to load config ${configFile}`, { cause: err });
}

const importSvelteOptions = (() => {
  // hide dynamic import from ts transform to prevent it turning into a require
  // see https://github.com/microsoft/TypeScript/issues/43329#issuecomment-811606238
  // also use timestamp query to avoid caching on reload
  const dynamicImportDefault = new Function(
    'path',
    'timestamp',
    'return import(path + "?t=" + timestamp).then(m => m.default)'
  );

  /**
   * Try import specified svelte configuration.
   *
   * @param {string} configFile
   * Absolute path of the svelte config file to import.
   *
   * @returns {import('@sveltejs/kit').Config}
   * Returns the svelte configuration object.
   */
  return async (configFile) => {
    const result = await dynamicImportDefault(
      pathToFileURL(configFile).href,
      fs.statSync(configFile).mtimeMs
    );

    if (result != null) {
      return { ...result, configFile };
    }
    throw new Error(`invalid export in ${configFile}`);
  };
})();

const requireSvelteOptions = (() => {
  /** @type {NodeRequire} */
  let esmRequire;

  /**
   * Try import specified svelte configuration.
   *
   * @param {string} configFile
   * Absolute path of the svelte config file to require.
   *
   * @returns {import('@sveltejs/kit').Config}
   * Returns the svelte configuration object.
   */
  return (configFile) => {
    // identify which require function to use (esm and cjs mode)
    const requireFn = import.meta.url
      ? (esmRequire = esmRequire ?? createRequire(import.meta.url))
      : require;

    // avoid loading cached version on reload
    delete requireFn.cache[requireFn.resolve(configFile)];
    const result = requireFn(configFile);

    if (result != null) {
      return { ...result, configFile };
    }
    throw new Error(`invalid export in ${configFile}`);
  };
})();

/**
 * Try find svelte config. First in current working dir otherwise try to
 * founding it by climbing up the directory tree.
 *
 * @returns {string}
 * Returns an array containing all available config files.
 */
function findSvelteConfig() {
  const lookupDir = process.cwd();
  let configFiles = getConfigFiles(lookupDir);

  if (configFiles.length === 0) {
    configFiles = getConfigFilesUp();
  }
  if (configFiles.length === 0) {
    throw new Error('no svelte config found');
  } else if (configFiles.length > 1) {
    logger.warn(
      `found more than one svelte config file, using ${configFiles[0]}. ` +
        'you should only have one!',
      configFiles
    );
  }
  return configFiles[0];
}

/**
 * Gets the file path of the svelte config by walking up the tree.
 * Returning the first found. Should solves most of monorepos with
 * only one config at workspace root.
 *
 * @returns {string[]}
 * Returns an array containing all available config files.
 */
async function getConfigFilesUp() {
  const importPath = fileURLToPath(import.meta.url);
  const pathChunks = path.dirname(importPath).split(path.sep);

  while (pathChunks.length) {
    pathChunks.pop();

    const parentDir = pathChunks.join(path.posix.sep);
    const configFiles = getConfigFiles(parentDir);

    if (configFiles.length !== 0) {
      return configFiles;
    }
  }
  return [];
}

/**
 * Gets all svelte config from a specified `lookupDir`.
 *
 * @param {string} lookupDir
 * Directory in which to look for svelte files.
 *
 * @returns {string[]}
 * Returns an array containing all available config files.
 */
function getConfigFiles(lookupDir) {
  return knownConfigFiles
    .map((candidate) => path.resolve(lookupDir, candidate))
    .filter((file) => fs.existsSync(file));
}

const knownConfigFiles = ['js', 'cjs', 'mjs'].map((ext) => `svelte.config.${ext}`);