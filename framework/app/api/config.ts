import { ApiConfig } from '@common/types/api';
import invokeApi from '@framework/utils/invoke-api';

class Config {
  private config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
  }

  getConfig(): ApiConfig {
    return this.config;
  }
}

const configWrapper = new Config({
  serviceUrl: 'http://localhost:3000',
  invoker: invokeApi,
});

export function getConfig() {
  return configWrapper.getConfig();
}
