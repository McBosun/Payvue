/**
 * Bill and airtime provider interface. Replace `sandbox` with a real adapter (e.g. VTpass, Flutterwave Bills).
 * pay() must be safe to retry with the same reference.
 */
export const SERVICES = ['airtime', 'data', 'electricity', 'cable'];

const sandbox = {
  async pay({ reference }) {
    return { ok: true, token: `SBX-${reference.slice(-8)}` };
  },
};

export const billsProvider = sandbox;
