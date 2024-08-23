export default function normalizeResponse<T, F>(response: {
  payload: any;
  error: boolean;
}) {
  if (response.error === false) return response as T;
  if (response.error === true) return response as F;
}
