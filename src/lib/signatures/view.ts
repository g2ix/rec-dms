export type SignatureSlotView = {
  fieldPath: string;
  label: string;
  required: boolean;
  canSign: boolean;
  waiting: string | null;
  status: "unsigned" | "signed" | "void";
  signerName: string | null;
  signedAtLabel: string | null;
  verifyRef: string | null;
  imageDataUrl: string | null;
};

export type SigningPrompt = {
  instanceId: string;
  hasPassword: boolean;
  /** An authenticator app is set up, so its code can confirm a signature too. */
  hasAuthenticator: boolean;
  fresh: boolean;
  email: string | null;
};
