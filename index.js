'use strict';

var fs = require('fs');
var path = require('path');
var RSVP = require('rsvp');
var rimraf = RSVP.denodeify(require('rimraf'));
var helpers = require('broccoli-kitchen-sink-helpers');
var symlinkOrCopy = require('symlink-or-copy');
var assign = require('lodash-node/modern/object/assign');
var Plugin = require('broccoli-plugin');
var debugGenerator = require('debug');
var Key = require('./key');
var canUseInputFiles = require('./can-use-input-files');

CachingWriter.prototype = Object.create(Plugin.prototype);
CachingWriter.prototype.constructor = CachingWriter;
function CachingWriter (inputNodes, options) {
  options = options || {};

  Plugin.call(this, inputNodes, {
    name: options.name,
    annotation: options.annotation,
    persistentOutput: true
  });

  this._cachingWriterPersistentOutput = !!options.persistentOutput;

  this._lastKeys = null;
  this._shouldBeIgnoredCache = Object.create(null);
  this._resetStats();

  this._filterFromCache = options.filterFromCache || {};
  this._inputFiles = options.inputFiles || {};

  if (this._filterFromCache.include === undefined) {
    this._filterFromCache.include = [];
  }

  if (this._filterFromCache.exclude === undefined) {
    this._filterFromCache.exclude = [];
  }

  if (!Array.isArray(this._filterFromCache.include)) {
    throw new Error('Invalid filterFromCache.include option, it must be an array or undefined.');
  }

  if (!Array.isArray(this._filterFromCache.exclude)) {
    throw new Error('Invalid filterFromCache.exclude option, it must be an array or undefined.');
  }
}

CachingWriter.prototype.debug = function() {
  return this._debug || (this._debug = debugGenerator(
    'broccoli-caching-writer:' +
    this._name +
    (this._annotation ? (' > [' + this._annotation + ']') : '')));
};

CachingWriter.prototype._resetStats = function() {
  this._stats = {
    stats: 0,
    files: 0
  };
};

CachingWriter.prototype.getCallbackObject = function() {
  return { build: this._conditionalBuild.bind(this) };
};

CachingWriter.prototype._conditionalBuild = function () {
  var writer = this;
  var start = new Date();

  var invalidateCache = false;
  var key, dir;
  var lastKeys = [];

  if (!writer._lastKeys) {
    writer._lastKeys = [];
    // Force initial build even if inputNodes is []
    invalidateCache = true;
  }

  for (var i = 0, l = writer.inputPaths.length; i < l; i++) {
    dir = writer.inputPaths[i];

    key = writer.keyForTree(dir, undefined, dir);
    var lastKey = writer._lastKeys[i];
    lastKeys.push(key);

    if (!invalidateCache /* short circuit */ && !key.equal(lastKey)) {
      invalidateCache = true;
    }
  }

  this._stats.inputPaths = writer.inputPaths;
  this.debug()('rebuild %o in %dms', this._stats, new Date() - start);
  this._resetStats();

  if (invalidateCache) {
    writer._lastKeys = lastKeys;

    var promise = RSVP.Promise.resolve();
    if (!this._cachingWriterPersistentOutput) {
      promise = promise.then(function() {
        return rimraf(writer.outputPath);
      }).then(function() {
        fs.mkdirSync(writer.outputPath);
      });
    }
    return promise.then(function() {
      return writer.build();
    });
  }
};

// Takes in a path and { include, exclude }. Tests the path using regular expressions and
// returns true if the path does not match any exclude patterns AND matches atleast
// one include pattern.
CachingWriter.prototype.shouldBeIgnored = function (fullPath) {
  if (this._shouldBeIgnoredCache[fullPath] !== undefined) {
    return this._shouldBeIgnoredCache[fullPath];
  }

  var excludePatterns = this._filterFromCache.exclude;
  var includePatterns = this._filterFromCache.include;
  var i = null;

  // Check exclude patterns
  for (i = 0; i < excludePatterns.length; i++) {
    // An exclude pattern that returns true should be ignored
    if (excludePatterns[i].test(fullPath) === true) {
      return (this._shouldBeIgnoredCache[fullPath] = true);
    }
  }

  // Check include patterns
  if (includePatterns !== undefined && includePatterns.length > 0) {
    for (i = 0; i < includePatterns.length; i++) {
      // An include pattern that returns true (and wasn't excluded at all)
      // should _not_ be ignored
      if (includePatterns[i].test(fullPath) === true) {
        return (this._shouldBeIgnoredCache[fullPath] = false);
      }
    }

    // If no include patterns were matched, ignore this file.
    return (this._shouldBeIgnoredCache[fullPath] = true);
  }

  // Otherwise, don't ignore this file
  return (this._shouldBeIgnoredCache[fullPath] = false);
};

CachingWriter.prototype.keyForTree = function (fullPath, initialRelativePath, dir) {
  var relativePath = initialRelativePath || '.';
  var stats;
  var statKeys;
  var type;

  try {
    this._stats.stats++;
    stats = fs.statSync(fullPath);
  } catch (err) {
    console.warn('Warning: failed to stat ' + fullPath);
    // fullPath has probably ceased to exist. Leave `stats` undefined and
    // proceed hashing.
  }

  var children;

  // has children;
  if (stats && stats.isDirectory()) {
    type = 'directory';

    var files;

    try {
      files = fs.readdirSync(fullPath).sort();
    } catch (err) {
      console.warn('Warning: Failed to read directory ' + fullPath);
      console.warn(err.stack);
    }

    if (canUseInputFiles(this._inputFiles)) {
      children = this._inputFiles.map(function(file) {
        return this.keyForTree(
          path.join(dir, file),
          file,
          dir
        );
      }, this);
      this._stats.files += children.length;
      children = children.filter(Boolean);
    } else if (files) {
      this._stats.files += files.length;
      children = files.map(function(file) {
        return this.keyForTree(
          path.join(fullPath, file),
          path.join(relativePath, file),
          dir
        );
      }, this).filter(Boolean);
    }

  } else if (stats && stats.isFile()) {
    type = 'file';

    if (this.shouldBeIgnored(fullPath)) {
      return null;
    }
  }

  return new Key(type, fullPath, relativePath, stats, children, this.debug());
};

// Returns a list of matched files
CachingWriter.prototype.listFiles = function() {
  function listFiles(keys, files) {
    for (var i=0; i< keys.length; i++) {
      var key = keys[i];
      if (key.type === 'file') {
        files.push(key.fullPath);
      } else {
        var children = key.children;
        if(children && children.length > 0) {
          listFiles(children, files);
        }
      }
    }
    return files;
  }
  return listFiles(this._lastKeys, []);
};

module.exports = CachingWriter;
