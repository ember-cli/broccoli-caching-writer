var fs = require('fs');
var path = require('path');
var RSVP = require('rsvp');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var crypto = require('crypto');
var walkSync = require('walk-sync');
var quickTemp = require('quick-temp');
var Writer = require('broccoli-writer');
var helpers = require('broccoli-kitchen-sink-helpers');


var canLink = testCanLink();

CachingWriter.prototype = Object.create(Writer.prototype);
CachingWriter.prototype.constructor = CachingWriter;
function CachingWriter (inputTree, options) {
  if (!(this instanceof CachingWriter)) return new CachingWriter(inputTree, options);

  this.inputTree = inputTree;

  this._oldCacheDirs = [];
  this._cacheInfoByHash = {};

  this._fileDigestCache = {};

  options = options || {};

  for (var key in options) {
    if (options.hasOwnProperty(key)) {
      this[key] = options[key];
    }
  }

  if (this.filterFromCache === undefined) {
    this.filterFromCache = {};
  }

  if (this.filterFromCache.include === undefined) {
    this.filterFromCache.include = [];
  }

  if (this.filterFromCache.exclude === undefined) {
    this.filterFromCache.exclude = [];
  }

  if (!Array.isArray(this.filterFromCache.include)) {
    throw new Error("Invalid filterFromCache.include option, it must be an array or undefined.")
  }

  if (!Array.isArray(this.filterFromCache.exclude)) {
    throw new Error("Invalid filterFromCache.exclude option, it must be an array or undefined.")
  }
};

CachingWriter.prototype.getCacheDir = function () {
  return quickTemp.makeOrReuse(this, 'tmpCacheDir');
};

// Returns a new cache dir and saves a reference to the old one (so that it can
// still be used, but still will eventually get deleted on cleanup)
CachingWriter.prototype.getCleanCacheDir = function () {

  // Store the old cache dir and ensure that `this.tmpCacheDir` is emptied so
  // we definitely get a new cache dir
  if (this.tmpCacheDir) {
    this._oldCacheDirs.push(this.tmpCacheDir);
    delete this.tmpCacheDir;

    // TODO, make oldCacheDirs do some sort of LRU eviction so that caches
    // don't grow forever
  }

  return quickTemp.makeOrRemake(this, 'tmpCacheDir');
};

CachingWriter.prototype.write = function (readTree, destDir) {
  var self = this;

  return readTree(this.inputTree).then(function (srcDir) {
    var inputTreeKeys = self.keysForTree(srcDir);
    var inputTreeHash = helpers.hashStrings(inputTreeKeys);

    return RSVP.resolve()
      .then(function() {
        var updateCacheResult;

        if (!self.hasCacheForHash(inputTreeHash)) {
          var newCachePath = self.getCleanCacheDir();
          self._cacheInfoByHash[inputTreeHash] = {
            hash: inputTreeHash,
            path: newCachePath
          };

          updateCacheResult = self.updateCache(srcDir, newCachePath);
        }

        return updateCacheResult;
      })
      .finally(function() {
        linkFromCache(self.cachePathForHash(inputTreeHash), destDir);
      });
  });
};

CachingWriter.prototype.cachePathForHash = function(treeHash) {
  var cacheInfo = this._cacheInfoByHash[treeHash];

  if (cacheInfo !== undefined) {
    return cacheInfo.path;
  }
};

CachingWriter.prototype.hasCacheForHash = function(treeHash) {
  return this.cachePathForHash(treeHash) !== undefined;
};

CachingWriter.prototype.cleanup = function () {
  quickTemp.remove(this, 'tmpCacheDir');

  // Remove all the old cache dirs we've collected as well
  for (var i = 0; i < this._oldCacheDirs.length; i++) {
    rimraf.sync(this._oldCacheDirs[i]);
  }

  this._oldCacheDirs = [];
  this._cacheInfoByHash = {};

  Writer.prototype.cleanup.call(this);
};

CachingWriter.prototype.updateCache = function (srcDir, destDir) {
  throw new Error('You must implement updateCache.');
};

// Takes in a path and { include, exclude }. Tests the path using regular expressions and
// returns true if the path does not match any exclude patterns AND matches atleast
// one include pattern.
CachingWriter.prototype.shouldBeIgnored = function (fullPath) {
  var excludePatterns = this.filterFromCache.exclude,
      includePatterns = this.filterFromCache.include,
      i = null;

  // Check exclude patterns
  for (i = 0; i < excludePatterns.length; i++) {
    // An exclude pattern that returns true should be ignored
    if (excludePatterns[i].test(fullPath) === true) {
      return true;
    }
  }

  // Check include patterns
  if (includePatterns !== undefined && includePatterns.length > 0) {
    for (i = 0; i < includePatterns.length; i++) {
      // An include pattern that returns true (and wasn't excluded at all)
      // should _not_ be ignored
      if (includePatterns[i].test(fullPath) === true) {
        return false;
      }
    }

    // If no include patterns were matched, ignore this file.
    return true;
  }

  // Otherwise, don't ignore this file
  return false;
}


CachingWriter.prototype.keysForTree = function (fullPath, options) {
  options = options || {}

  var _stack         = options._stack;
  var _followSymlink = options._followSymlink;
  var relativePath   = options.relativePath || '.';
  var stats;
  var statKeys;

  try {
    if (_followSymlink) {
      stats = fs.statSync(fullPath);
    } else {
      stats = fs.lstatSync(fullPath);
    }
  } catch (err) {
    console.warn('Warning: failed to stat ' + fullPath);
    // fullPath has probably ceased to exist. Leave `stats` undefined and
    // proceed hashing.
  }
  var childKeys = [];
  if (stats) {
    statKeys = ['stats', stats.mode];
  } else {
    statKeys = ['stat failed'];
  }
  if (stats && stats.isDirectory()) {
    var fileIdentity = stats.dev + '\x00' + stats.ino;
    if (_stack != null && _stack.indexOf(fileIdentity) !== -1) {
      console.warn('Symlink directory loop detected at ' + fullPath + ' (note: loop detection may have false positives on Windows)');
    } else {
      if (_stack != null) _stack = _stack.concat([fileIdentity]);
      var entries;
      try {
        entries = fs.readdirSync(fullPath).sort();
      } catch (err) {
        console.warn('Warning: Failed to read directory ' + fullPath);
        console.warn(err.stack);
        childKeys = ['readdir failed'];
        // That's all there is to say about this directory.
      }
      if (entries != null) {
        for (var i = 0; i < entries.length; i++) {

          var keys = this.keysForTree(path.join(fullPath, entries[i]), {
            _stack: _stack,
            relativePath: path.join(relativePath, entries[i])
          });
          childKeys = childKeys.concat(keys);
        }
      }
    }

  } else if (stats && stats.isSymbolicLink()) {
    if (_stack == null) {
      // From here on in the traversal, we need to guard against symlink
      // directory loops. _stack is kept null in the absence of symlinks to we
      // don't have to deal with Windows for now, as long as it doesn't use
      // symlinks.
      _stack = [];
    }

    if (this.shouldBeIgnored(fullPath)) {
      return [];
    }

    childKeys = this.keysForTree(fullPath, {
      _stack: _stack,
      relativePath: relativePath,
      _followSymlink: true,
    }); // follow symlink

  } else if (stats && stats.isFile()) {
    if (this.shouldBeIgnored(fullPath)) {
      return [];
    }
    statKeys.push('contentdigest', this.digestOfFileContents(fullPath, relativePath, stats));
  }

  // Perhaps we should not use basename to infer the file name
  return ['path', relativePath]
    .concat(statKeys)
    .concat(childKeys);
};

// Get's a hashed digest of a file's contents. Stores that digest into another
// cache so that we don't need to re-read the file's contents in the basic case.
// (similar to how Sprockets does it, https://github.com/sstephenson/sprockets/blob/3c97dbd1faa811ad73e47a637f11ca2852ea0101/lib/sprockets/base.rb#L43-L55)
CachingWriter.prototype.digestOfFileContents = function (fullPath, relativePath, stats) {
  var fileDigestCacheKey = [
    relativePath,
    stats.mtime.getTime(),
    stats.size
  ].join(',');

  var digest = this._fileDigestCache[fileDigestCacheKey];

  if (digest === undefined) {
    digest = this._fileDigestCache[fileDigestCacheKey] = crypto
      .createHash('sha1')
      .update(fs.readFileSync(fullPath))
      .digest('hex');
  }

  return digest;
};


module.exports = CachingWriter;


function linkFromCache (srcDir, destDir) {
  var files = walkSync(srcDir);
  var length = files.length;
  var file;

  for (var i = 0; i < length; i++) {
    file = files[i];

    var srcFile = path.join(srcDir, file);
    var stats   = fs.statSync(srcFile);

    if (stats.isDirectory()) { continue; }

    if (!stats.isFile()) { throw new Error('Can not link non-file.'); }

    destFile = path.join(destDir, file);
    mkdirp.sync(path.dirname(destFile));
    if (canLink) {
      fs.linkSync(srcFile, destFile);
    }
    else {
      fs.writeFileSync(destFile, fs.readFileSync(srcFile));
    }
  }
}

function testCanLink () {
  var canLinkSrc  = path.join(__dirname, "canLinkSrc.tmp");
  var canLinkDest = path.join(__dirname, "canLinkDest.tmp");

  try {
    fs.writeFileSync(canLinkSrc);
  } catch (e) {
    return false;
  }

  try {
    fs.linkSync(canLinkSrc, canLinkDest);
  } catch (e) {
    fs.unlinkSync(canLinkSrc);
    return false;
  }

  fs.unlinkSync(canLinkDest);

  return true;
}
