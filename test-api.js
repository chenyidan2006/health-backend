const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3002,
  path: '/api/data/txt',
  method: 'GET'
};

const req = http.request(options, (res) => {
  console.log('状态码:', res.statusCode);
  console.log('响应头:', res.headers);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('响应体长度:', data.length);
    console.log('响应体前200字符:', data.substring(0, 200));
  });
});

req.on('error', (e) => {
  console.error('请求错误:', e.message);
});

req.end();
