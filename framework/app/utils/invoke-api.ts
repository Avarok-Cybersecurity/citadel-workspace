import { ApiFetcherOptions, ApiInvokerResults } from '@common/types/api';
import { API_URL } from '@framework/const';

const invokeApi = async <T>({
  variables,
}: ApiFetcherOptions): Promise<ApiInvokerResults<T>> => {
  const res = await fetch(API_URL!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      variables,
    }),
  });
  const { data, errors } = await res.json();
  // ?? is checking if left hand expression is null or undefined -> if it is go with right expression
  // || is checking if left hand expression is null, undefined, "", 0, false
  if (errors) {
    throw new Error(errors[0].message ?? errors.message);
  }

  return { data };
};

export default invokeApi;
