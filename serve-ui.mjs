import { serveLikeProduction } from './scripts/lib/serve-like-production.mjs';
serveLikeProduction({ dist: '../wt-ustack/dist', port: 4299,
  cert: '/tmp/work.test.crt', key: '/tmp/work.test.key',
  templatePath: 'docker/ui/nginx.conf.template', loopbackOrigin: 'wss://local.avarok.net:12345' });
console.log('serving the REBUILT dist on https://work.test:4299');
