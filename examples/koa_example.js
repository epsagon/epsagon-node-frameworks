const Koa = require('koa');
const epsagon = require('epsagon-frameworks');

epsagon.init({
    token: 'my-secret-token',
    appName: 'my-app-name',
    metadataOnly: false,
});

const app = new Koa();

app.use(async ctx => {
  ctx.body = 'Hello World';

  // Example label usage
  ctx.epsagon.label('myFirstLabel', 'customValue1');
});

app.listen(3000)