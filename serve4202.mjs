import { serveLikeProduction } from './scripts/lib/serve-like-production.mjs';
serveLikeProduction({ dist: './citadel-workspaces/dist', port: 4299,
  cert: '/tmp/work.test.crt', key: '/tmp/work.test.key',
  templatePath: 'docker/ui/nginx.conf.template', loopbackOrigin: 'wss://local.avarok.net:12345' });
console.log('serving dist on https://work.test:4202 with the production CSP');
