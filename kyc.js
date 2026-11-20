/** KYC provider interface. Replace with Smile ID, YouVerify or Dojah (BVN/NIN lookup, face match, liveness). */
export const kycProvider = {
  async verifyBvn(_bvn, _selfieBase64) {
    // Sandbox always returns a pending result. Never log or store raw BVN/NIN values.
    return { status: 'pending', tier: 1 };
  },
};
