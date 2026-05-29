import { v2Request } from './session';

export {
  __resetV2ApiClientForTests,
  configureV2ApiClient,
  hasV2RefreshSessionHint,
  performV2TokenRefresh,
  v2Request,
} from './session';

let generatedClientPromise = null;

async function getGeneratedClient() {
  if (!generatedClientPromise) {
    generatedClientPromise = import('./generated/client').then(({ createGeneratedClient }) =>
      createGeneratedClient(v2Request)
    );
  }
  return generatedClientPromise;
}

export const v2Api = new Proxy({}, {
  get(_target, prop) {
    if (prop === 'then' || typeof prop === 'symbol') {
      return undefined;
    }
    return async (...args) => {
      const client = await getGeneratedClient();
      const operation = client[prop];
      if (typeof operation !== 'function') {
        throw new Error(`Unknown V2 API operation: ${String(prop)}`);
      }
      return operation(...args);
    };
  },
});
