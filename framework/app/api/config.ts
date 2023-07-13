import { ApiConfig } from '@common/types/api';
import invokeApi from '@/framework/app/utils/invoke-api';

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
  invoke: invokeApi,
});

export function getConfig() {
  return configWrapper.getConfig();
}
