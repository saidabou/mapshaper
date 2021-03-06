var mapshaper = require('../'),
  cli = mapshaper.cli,
  assert = require('assert'),
  optimist = require('optimist'),
  path = require("path");

process.chdir(__dirname); // cd to test/ directory

/*
var dataDir = path.join(__dirname, "test_data"),
    tmpDir = path.join(__dirname, "__tmp__");
*/

// Convert string of commandline options to optimist argv
//
function parseOpts(str) {
  var parts = str.split(/[\s]+/); // TODO: handle quoted strings
  return optimist.parse(parts);
}


describe('mapshaper-cli.js', function() {

  describe('validateSimplifyOpts()', function() {

    var good1 = "-p 0.2",
        good2 = "-i 2000 --dp -k",
        good3 = "-k --vis -p .9",
        good4 = "-q 1000";

    // var ok1 = "-p 0.4 -i 5000";

    var bad1 = "-p 10",
        bad2 = "-p 4%",
        bad3 = "-i 200km",
        bad4 = "-i",
        bad5 = "-p",
        bad6 = "-q 0.3",
        bad7 = "-q";

    function validate(str) {
      var argv = parseOpts(str);
      return mapshaper.cli.validateSimplifyOpts(argv);
    }

    it(good1, function() {
      assert.deepEqual(validate(good1), {
        use_simplification: true,
        simplify_pct: 0.2,
        keep_shapes: false,
        simplify_method: "mod"
      });
    })

    it(good2, function() {
      assert.deepEqual(validate(good2), {
        use_simplification: true,
        simplify_interval: 2000,
        keep_shapes: true,
        simplify_method: "dp"
      });
    })

    it(good3, function() {
      assert.deepEqual(validate(good3), {
        use_simplification: true,
        simplify_pct: 0.9,
        keep_shapes: true,
        simplify_method: "vis"
      });
    })

    it(good4, function() {
      assert.deepEqual(validate(good4), {
        use_simplification: false,
        topojson_resolution: 1000
      });
    })

    it(bad1 + " (invalid)", function() {
      assert.throws(function(){validate(bad1)});
    })

    it(bad2 + " (invalid)", function() {
      assert.throws(function(){validate(bad2)});
    })

    it(bad3 + " (invalid)", function() {
      assert.throws(function(){validate(bad3)});
    })

    it(bad4 + " (invalid)", function() {
      assert.throws(function(){validate(bad4)});
    })

    it(bad5 + " (invalid)", function() {
      assert.throws(function(){validate(bad5)});
    })

    it(bad6 + " (invalid)", function() {
      assert.throws(function(){validate(bad6)});
    })

    it(bad7 + " (invalid)", function() {
      assert.throws(function(){validate(bad7)});
    })
  })


  describe('validateInputOpts()', function() {

    function validate(str) {
      var argv = parseOpts(str);
      return mapshaper.cli.validateInputOpts(argv);
    }

    var good1 = "test_data/two_states.shp";
    it(good1, function() {
      assert.deepEqual(validate(good1), {
        input_file: "test_data/two_states.shp"
      });
    })

    var bad1 = "test_data/two_states";
    it(bad1 + " (missing file extension)", function() {
      assert.throws(function(){validate(bad1)});
    })

    var bad2 = "missing.shp";
    it(bad2 + " (file not found)", function() {
      assert.throws(function(){validate(bad2)});
    })

    var bad3 = "-o output.shp";
    it(bad3 + " (no input file given)", function() {
      assert.throws(function(){validate(bad3)});
    })
  })

  describe('validateOutputOpts()', function() {

    function validate(str) {
      var argv = parseOpts(str);
      var input = mapshaper.cli.validateInputOpts(argv);
      return mapshaper.cli.validateOutputOpts(argv, input);
    }

    var good1 = "test_data/two_states.shp";
    it(good1, function() {
      assert.deepEqual(validate(good1), {
        output_format: null,
        output_directory: ".",
        output_extension: "shp",
        output_file_base: "two_states"
      });
    })

    var good2 = "test_data/two_states.shp -o simplified";
    it(good2, function() {
      assert.deepEqual(validate(good2), {
        output_format: null,
        output_directory: ".",
        output_extension: "shp",
        output_file_base: "simplified"
      });
    })

    var good3 = "test_data/two_states.shp -o test_data/simplified.shp";
    it(good3, function() {
      assert.deepEqual(validate(good3), {
        output_format: null,
        output_extension: "shp",
        output_directory: "test_data",
        output_file_base: "simplified"
      });
    })

    var good4 = "test_data/two_states.json";
    it(good4, function() {
      assert.deepEqual(validate(good4), {
        output_format: null,
        output_extension: "json",
        output_directory: ".",
        output_file_base: "two_states"
      });
    })

    var good5 = "test_data/two_states.json -f shapefile";
    it(good5, function() {
      assert.deepEqual(validate(good5), {
        output_format: 'shapefile',
        output_directory: ".",
        output_extension: "shp",
        output_file_base: "two_states"
      });
    })

    var good6 = "test_data/two_states.shp -f topojson";
    it(good6, function() {
      assert.deepEqual(validate(good6), {
        output_format: 'topojson',
        output_directory: ".",
        output_extension: "json",
        output_file_base: "two_states"
      });
    })

    var good7 = "test_data/two_states.json -f geojson -o test_data/min";
    it(good7, function() {
      assert.deepEqual(validate(good7), {
        output_format: 'geojson',
        output_directory: "test_data",
        output_extension: "json",
        output_file_base: "min"
      });
    })

    // -o option takes a directory name
    var good8 = "test_data/two_states.shp -o test_data";
    it(good8, function() {
      assert.deepEqual(validate(good8), {
        output_format: null,
        output_directory: "test_data",
        output_extension: "shp",
        output_file_base: "two_states"
      });
    })

    var good9 = "test_data/two_states.shp -o .";
    it(good9, function() {
      assert.deepEqual(validate(good9), {
        output_format: null,
        output_directory: ".",
        output_extension: "shp",
        output_file_base: "two_states"
      });
    })

    // infer output type from .json extension
    var good10 = "test_data/two_states.shp -o two_states.json";
    it(good10, function() {
      assert.deepEqual(validate(good10), {
        output_format: "geojson",
        output_directory: ".",
        output_extension: "json",
        output_file_base: "two_states"
      });
    })

    // infer output type from .shp extension
    var good11 = "test_data/two_states.json -o two_states.shp";
    it(good11, function() {
      assert.deepEqual(validate(good11), {
        output_format: "shapefile",
        output_directory: ".",
        output_extension: "shp",
        output_file_base: "two_states"
      });
    })

    // infer output type from .topojson extension
    var good12 = "test_data/two_states.json -o two_states.topojson";
    it(good12, function() {
      assert.deepEqual(validate(good12), {
        output_format: "topojson",
        output_directory: ".",
        output_extension: "topojson",
        output_file_base: "two_states"
      });
    })

    // Don't infer output type from .json input + .json output
    var good13 = "test_data/two_states.json -o two_states.json";
    it(good13, function() {
      assert.deepEqual(validate(good13), {
        output_format: null,
        output_directory: ".",
        output_extension: "json",
        output_file_base: "two_states"
      });
    })


    var bad1 = "test_data/two_states.shp -o simplified.kml";
    it(bad1 + " (looks like unsupported file type)", function() {
      assert.throws(function() {validate(bad1)});
    })

    var bad2 = "test_data/two_states.shp -o missing/simplified.shp";
    it(bad2 + " (-o file in a missing directory)", function() {
      assert.throws(function() {validate(bad2)});
    })

    var bad4 = "test_data/two_states.shp -o test_data/two_states/../two_states.shp";
    it(bad4 + " (missing directory)", function() {
      assert.throws(function() {validate(bad4)});
    })

  })

  describe('testFileCollision()', function () {
    it('no collision -> false', function () {
      assert.ok(
        !cli.testFileCollision([{pathbase: "missing", extension: "shp"}], "")
      )
    })

    it('collison -> true', function() {
      assert.ok(
        cli.testFileCollision([{pathbase: "test_data/two_states", extension: "shp"}], "")
        );
    })

    it('collision + unique suffix -> false', function() {
      assert.ok(
        !cli.testFileCollision([{pathbase: "test_data/two_states", extension: "shp"}], "-ms")
        );
    })
  })

  describe('replaceFileExtension()', function() {
    it('counties.shp', function() {
      assert.equal("counties.prj", cli.replaceFileExtension('counties.shp', 'prj'));
    });

    it('shapefiles/counties.shp', function() {
      assert.equal("shapefiles/counties.prj", cli.replaceFileExtension('shapefiles/counties.shp', 'prj'));
    });

  })

  describe('getOutputPaths()', function () {
    it('add -ms extension to resolve collision', function () {
      assert.deepEqual(["test_data/two_states-ms.shp"],
        mapshaper.getOutputPaths(
          [{filebase: "two_states"}], "test_data", "shp"));
    })
  })
})
