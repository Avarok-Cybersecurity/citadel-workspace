/**
 * The control plane's own server-wasm instance: the signed-request checks (support-verifier.mjs)
 * and work.avarok.net's issuer identity (control-identity.mjs). Made on first use; everything it is
 * asked is pure, so one instance per isolate serves every request, and it is never one of the
 * tenants' (worker.mjs, control/tenant-node.mjs).
 */
import { instantiate } from "../server-wasm/pkg/instance.mjs";
import wasm from "../server-wasm/pkg/citadel_tenant_server_wasm_bg.wasm";

let instance = null;

export const controlWasm = () => (instance ??= instantiate(wasm));
