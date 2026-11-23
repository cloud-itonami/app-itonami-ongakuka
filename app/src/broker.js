// Broker: the only way the WebView can send anything.
//
// The page never holds a fetch to the Worker directly. It hands the broker
// "what to send" ({input, init}) and the broker (vendor/kotoba-client-runtime.js)
// validates the descriptor scope, snapshots the exact request, asks the
// trusted consent host (per operation, deny-by-default) and only then
// dispatches the captured browser fetch. No consent, no request: when the
// broker cannot run (no trusted document, descriptor mismatch), nothing is
// sent at all (fail-closed).
import {
  createClientConsentHost,
  createClientOperationBroker,
} from "../vendor/kotoba-client-runtime.js";

/**
 * Build the operation broker for the shipped descriptor.
 *
 * @param {object} options
 * @param {Document} [options.document] trusted host document (default: globalThis.document)
 * @param {object} options.descriptor kotoba.app.client-runtime.v1 descriptor (dist/descriptor.json)
 * @param {Function} [options.fetchImpl] transport for the broker to capture
 *   (default: the current global fetch). createClientOperationBroker binds the
 *   captured fetch at construction, so a test passes its stub here.
 */
export function createOngakukaBroker({ document: doc = globalThis.document, descriptor, fetchImpl } = {}) {
  const consentHost = createClientConsentHost({ document: doc });
  const previousFetch = globalThis.fetch;
  if (fetchImpl) globalThis.fetch = fetchImpl;
  try {
    return createClientOperationBroker({
      runtime: descriptor,
      requestedCapabilities: descriptor.operations.map((operation) => operation.capability),
      approvedOperations: descriptor.operations,
      hostSupportedOperations: descriptor.operations.map((operation) => [
        operation.capability,
        operation.service,
        operation.operation,
      ]),
      consentHost,
    });
  } finally {
    if (fetchImpl) globalThis.fetch = previousFetch;
  }
}
