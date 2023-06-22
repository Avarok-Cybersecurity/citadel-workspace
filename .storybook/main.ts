import type { StorybookConfig } from '@storybook/nextjs';
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin';
import path from 'path';

const config: StorybookConfig = {
  stories: ['../components/**/*.stories.@(js|jsx|ts|tsx)'],
  addons: [
    '@storybook/addon-links',
    '@storybook/addon-essentials',
    '@storybook/addon-interactions',
    {
      name: '@storybook/addon-postcss',
      options: {
        postcssLoaderOptions: {
          implementation: require('postcss'),
        },
      },
    },
  ],
  framework: {
    name: '@storybook/nextjs',
    options: {},
  },
  core: {
    builder: '@storybook/builder-webpack5',
  },
  docs: {
    autodocs: 'tag',
  },
  staticDirs: ['../public'],
  webpackFinal: async (config, { configType }) => {
    config!.resolve!.plugins = [
      new TsconfigPathsPlugin({
        configFile: path.resolve(__dirname, '../tsconfig.json'),
      }) as any,
    ];

    return config;
  },
};
export default config;
