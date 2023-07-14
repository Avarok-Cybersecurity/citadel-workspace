import invokeApi from '../utils/invoke-api';

const connectC2s = async () => {
  await invokeApi<void>({
    type: 'connect_c2s',
  });
};
export default connectC2s;
