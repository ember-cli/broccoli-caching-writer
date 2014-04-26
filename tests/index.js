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

  describe('write', function() {
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
  });

  describe('updateCache', function() {

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
});
