var http = require('http'),
    sys = require('sys'),
    fs = require('fs'),
    url = require('url'),
    path = require('path'),
    child_process = require('child_process');

var drop_dir;
var next_request_id = 0;

var exclude_payload = ['image/png', 'image/gif']

var payloadExtension = function(content_type, content_encoding) {
  var extensions = {'text/html': '.html',
                    'text/css': '.css',
                    'text/xml': '.xml',
                    'text/json': '.json',
                    'text/javascript': '.js'};
      
  var extension = extensions[content_type];

  if (extension == undefined) {
    sys.log('Unknown content-type [' + content_type + '] detected');
    extension = '';
  }

  return extension +  (content_encoding == 'gzip' ? '.gz' : '');
}

var jsonSelector = function(key, value) {
  var accepted = ['', 'method', 'httpVersion', 'statusCode', 'url', 'responseCode'];
    
  if (key == 'headers') return JSON.stringify(value);
  if (accepted.indexOf(key) > -1) return value;

  return undefined;
}

var decompressPayload = function(payload_drop_path) {
  child_process.exec('gzip -d ' + payload_drop_path,
    function(error) { if (error) {
      sys.log('Error decompressing file ' + payload_drop_path);
  }});
}

var requestHandler = function(request, response) {
  /* Handles each incoming request to the proxy server */

  var id = next_request_id++;
  var timestamp = Date.now();

  var base_drop_path = drop_dir + id + '-' + timestamp + '-';
  
  var request_drop_path = base_drop_path + 'request.json';
  var request_drop = fs.createWriteStream(request_drop_path)
  request_drop.write(JSON.stringify(request, jsonSelector));
  request_drop.end();
  
  var request_url = url.parse(request.url);

  var options = {
    host: request.headers['host'],
    port: 80,
    method: request.method, 
    path: (request_url.pathname || '/') + (request_url.search || ''), 
    headers: request.headers
  }

  var proxy_request = http.request(options, function(proxy_response) {

    var content_type = (proxy_response.headers['content-type'] || 'unknown').split(';')[0];
    var content_encoding = proxy_response.headers['content-encoding'];

    var base_drop_path_response = base_drop_path + content_type.replace('/', '_') + '-';

    /* Drop (write to file) request and response */

    var response_drop_path = base_drop_path_response + 'response.json';
    var response_drop = fs.createWriteStream(response_drop_path)
    response_drop.write(JSON.stringify(proxy_response, jsonSelector));
    response_drop.end();

    if (exclude_payload.indexOf(content_type) == -1) {
      var payload_drop_path = base_drop_path_response + 'payload' + 
        payloadExtension(content_type, content_encoding);
      
      var payload_drop = fs.createWriteStream(payload_drop_path);
    
      proxy_response.addListener('data', function(data) { 
        payload_drop.write(data, 'binary'); 
      });

      proxy_response.addListener('end', function() { 
        payload_drop.end(); 

        if (content_encoding == 'gzip') {
          decompressPayload(payload_drop_path);
        } 
      
      });
    }

    /* Repeat response to the client */ 
    
    response.writeHead(proxy_response.statusCode, proxy_response.headers);

    proxy_response.addListener('data', function(chunk) {
      response.write(chunk, 'binary');
    });
    
    proxy_response.addListener('end', function() {
      response.end();
    });
  });
  
  proxy_request.on('error', function(e) {
    sys.log('Error encountered when handling url ' + request.url);
  });

  var request_payload_drop_path = base_drop_path + 'request-payload.txt';
  var request_payload_drop = fs.createWriteStream(request_payload_drop_path);
  
  request.addListener('data', function(chunk) {
    proxy_request.write(chunk, 'binary');
    request_payload_drop.write(chunk, 'binary');
  });
  
  request.addListener('end', function() {
    proxy_request.end();
    request_payload_drop.end();
  });

}

if (process.argv.length < 3) {
  process.stdout.write('usage: node ' + process.argv[1] + ' /output/dir\n');
  process.exit(1);
}

drop_dir = path.join(process.argv[2], '/');
http.createServer(requestHandler).listen(8080);


process.stdout.write('proxy server created on port 8080\n');
