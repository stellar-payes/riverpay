import { Contract, rpc, TransactionBuilder, BASE_FEE, Account, scValToNative } from '@stellar/stellar-sdk';
import { config } from '../config.js';

const server = new rpc.Server(config.sorobanRpcUrl);

// Simulation-only read: builds a throwaway tx from a dummy account, simulates
// it against the RPC node, and decodes the return value. No signature, no fee.
export async function callReadOnly(contractId, method, args = []) {
  const contract = new Contract(contractId);
  const dummy = new Account('GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7', '0');
  const tx = new TransactionBuilder(dummy, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation of ${method} on ${contractId} failed: ${sim.error}`);
  }
  return sim.result?.retval ? scValToNative(sim.result.retval) : null;
}

export { server };
