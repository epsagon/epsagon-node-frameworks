const express = require('express');
// const epsagon = require('epsagon-frameworks');
// const epsagon = require('../../src/index');
const redis = require('redis');
const mysql = require('mysql');
// const path = require('path');
// const Sentry = require('@sentry/node');
// const bodyParser = require('body-parser')
// const favicon = require('serve-favicon');
// const compression = require('compression')
// const cookieParser = require('cookie-parser')

const app = express();

// Sentry.init({ dsn: "https://examplePublicKey@o0.ingest.sentry.io/0" });

// app.use(Sentry.Handlers.requestHandler());

// app.use(function(req, res, next) { 
//     Sentry.configureScope((scope) => { 
//         scope.setTransaction(req.path);  
//     });  
//     next();
// });

// app.use(compression());
// app.use(express.json({  
//     type: function(req) { 
//        return req.is('json') || req.is('text/plain'); 
//      },
//     limit: "50mb"
// }));

// app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
// // app.use(require('connect-multiparty')(config.upload));
// app.use(favicon(__dirname + '/public/favicon.ico', {  maxAge: 315360000})); //cache favicon

// // if (!config.website.noCompileStyles) {
// //       app.use(    
// //         stylus.middleware({
// //             src: path.resolve(__dirname),
// //             dest: path.resolve(__dirname, 'public'),
// //             debug: config.stylus.debug, 
// //             compress: config.stylus.compress, 
// //             force: config.stylus.force
// //         })  
// //     );
// // }

// // app.set('views', path.resolve(__dirname, 'views'));
// // app.set('view engine', 'pug');
// // app.set('view cache', config.pug.cache);
// // app.locals.pretty = !config.pug.compress;
// // app.use(shortUrlRedirect);
// // app.use(requireHTTPS);

// app.use(cookieParser())

// // app.use('/scripts/thirdparty', express.static(path.resolve(__dirname, 'public/scripts/thirdparty'), {  maxAge: 86400000}));

// // app.use('/ngpartials', function(req, res) { 
// //     var view = req.originalUrl.substr(1).split('.html')[0];
// //     res.render(view, req.query);
// // });

// app.use(express.static(path.resolve(__dirname, 'public')));
// app.use(favicon(path.resolve(__dirname, 'public', 'favicon.ico')));

// // if (config.logging.debug.express) {
// //   // must come right after "static" so as not to log every static file request
// //   app.use(morgan('dev'));
// // }

// // Set user info on apm
// app.use(function(req, res, next) {
// //   if (!objectUtils.getObjProperty(req, 'epsagon.label')) {
// //     return next();
// //   }

// //   let userId = objectUtils.getObjProperty(req, 'session.user.id') ||
// //     objectUtils.getObjProperty(req, 'dug');

//   if (req.params.userId) {
//     req.epsagon.label('userId',req.params.userId);
//   }

//   next();
// })

// // Set user info in sentry
// app.use(function(req, res, next) {
//   if (!req.session || !req.session.user) {
//     return next();
//   }

//   Sentry.configureScope((scope) => {
//     scope.setUser({
//       email: "test",
//       id: "tester-id"
//     });
//   });
//   next();
// });

// // The error handler must be before any other error middleware and after all controllers
// app.use(Sentry.Handlers.errorHandler());



const pool = mysql.createPool(
{
  connectionLimit: 60,
  waitForConnections: true,
  charset:"UTF8",
  host     : process.env.MYSQL_HOST || 'localhost',
  user     : process.env.MYSQL_USER || 'root',
  password : process.env.MYSQL_PASSWORD || 'secret',
  database : process.env.MYSQL_DB || 'mysql'
})

const host = process.env.REDIS_HOST || 'localhost';
const redisPort = process.env.REDIS_PORT || 6379;
const client = redis.createClient(redisPort, host, {});

// epsagon.init({
//     token: 'e9ea2287-c552-4891-8639-b6e268b01c78',
//     appName: 'haim-test',
//     ignoredKeys:['password*'], // Ignore PII keys, properties
//     metadataOnly: false,
//     sendTimeout: 2000
//   });

app.get('/redis_sql_pool', (req, res) => {
    client.get('test', (err, result)  => {
        if (err) throw err;
        pool.query('SELECT 1 + 1 AS solution', function (error, results, fields) {
            if (error) throw error;
            console.log("Express call log")
            res.send('Express return from mysql pool')
        });
    })
})

app.listen(3000, () => {
  console.log(`Server listening at http://localhost:${3000}`)
})