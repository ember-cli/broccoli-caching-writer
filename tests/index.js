'use strict';

var fs = require('fs');
var path = require('path');
var expect = require('expect.js');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var root = process.cwd();
var broccoli = require('broccoli');

var cachingWriter = require('..');

var builder;

describe('broccoli-caching-writer', function(){
  var sourcePath = 'tests/fixtures/sample-project/lib';

  afterEach(function() {
    if (builder) {
      builder.cleanup();
    }
  });

  describe('updateCache', function() {
    it('calls updateCache when there is no cache', function(){
      var updateCacheCalled = false;
      var tree = cachingWriter(sourcePath, {
        updateCache: function() {
          updateCacheCalled = true;
        }
      });

      builder = new broccoli.Builder(tree);
      return builder.build().then(function() {
        expect(updateCacheCalled).to.be.ok();
      });
    });

    it('is provided a source and destination directory', function(){
      var updateCacheCalled = false;
      var tree = cachingWriter(sourcePath, {
        updateCache: function(srcDir, destDir) {
          expect(fs.statSync(srcDir).isDirectory()).to.be.ok();
          expect(fs.statSync(destDir).isDirectory()).to.be.ok();
        }
      });

      builder = new broccoli.Builder(tree);
      return builder.build()
    });

    it('can write files to destDir, and they will be in the final output', function(){
      var tree = cachingWriter(sourcePath, {
        updateCache: function(srcDir, destDir) {
          fs.writeFileSync(destDir + '/something-cool.js', 'zomg blammo', {encoding: 'utf8'});
        }
      });

      builder = new broccoli.Builder(tree);
      return builder.build().then(function(dir) {
        expect(fs.readFileSync(dir + '/something-cool.js', {encoding: 'utf8'})).to.eql('zomg blammo');
      });
    });
  });

  //it('does not clobber the directory', function(){
  //  var sourcePath = 'tests/fixtures/sample-ember-style-package';
  //  var priorFilePath = path.join(root, exportLocation, 'random-stuff.txt');
  //  var contents   = 'random stuff';

  //  var tree = exportTree(sourcePath, {
  //    destDir: exportLocation,
  //    clobber: false
  //  });

  //  mkdirp.sync(exportLocation);
  //  fs.writeFileSync(priorFilePath, contents, {encoding: 'utf8'});

  //  builder = new broccoli.Builder(tree);
  //  return builder.build().then(function(dir) {
  //    var filePath = '/lib/main.js';
  //    var expected = fs.readFileSync(sourcePath + filePath);
  //    var actual   = fs.readFileSync(exportLocation + filePath);

  //    expect(actual).to.eql(expected);
  //    expect(fs.readFileSync(priorFilePath, {encoding: 'utf8'})).to.eql(contents);
  //  });
  //})
});
